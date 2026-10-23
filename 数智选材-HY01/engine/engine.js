/*
 * 数智选材 · 材料方案推荐引擎（浏览器与 Node 通用，零依赖）
 *
 * 流程：场景标准化 → 需求包络（带出处） → 候选方案枚举与规则剪枝 →
 *       机理先验预测 + 工艺扰动 + 蒙特卡洛 → 达标可靠度 / 寿命 / 年均成本 / 年均碳排 →
 *       Pareto 前沿与选优 → 瓶颈、反事实、施工容错解释 → 监测反馈（贝叶斯偏差修正）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./kb.js'));
  else root.SZXC = factory(root.SZXC_KB);
})(typeof self !== 'undefined' ? self : this, function (KB) {
  'use strict';

  const IND = ['pgHigh', 'pgLow', 'ds', 'strain', 'tsr', 'fatigue', 'td'];
  const IND_NAME = {
    pgHigh: '高温分级 PG高温', pgLow: '低温分级 PG低温', ds: '高温抗车辙 动稳定度',
    strain: '低温抗裂 破坏应变', tsr: '水稳定性 冻融劈裂比', fatigue: '疲劳寿命', td: '抗滑 构造深度',
  };
  const IND_UNIT = { pgHigh: '°C', pgLow: '°C', ds: '次/mm', strain: 'με', tsr: '%', fatigue: 'lg次', td: 'mm' };

  // ---------- 工具 ----------
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normals(n, rng) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i += 2) {
      const u = Math.max(rng(), 1e-12), v = rng();
      const r = Math.sqrt(-2 * Math.log(u));
      out[i] = r * Math.cos(2 * Math.PI * v);
      if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * v);
    }
    return out;
  }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const byId = (arr, id) => arr.find((x) => x.id === id);
  const round = (x, d = 0) => { const k = Math.pow(10, d); return Math.round(x * k) / k; };
  const crf = (i, L) => (i * Math.pow(1 + i, L)) / (Math.pow(1 + i, L) - 1);
  const pgGradeHigh = (t) => Math.ceil((t - 4) / 6) * 6 + 4; // 52,58,64,70,76,82...
  const pgGradeLow = (t) => Math.min(-10, -Math.ceil((-t - 4) / 6) * 6 - 4); // -10,-16,-22,-28,-34,-40
  // Wilson 区间仅描述有限次蒙特卡洛抽样误差，不包含先验或模型误差。
  function wilson(k, n) {
    const z = 1.96, p = k / n, den = 1 + z * z / n;
    const c = (p + z * z / (2 * n)) / den;
    const d = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
    return [round(Math.max(0, c - d), 4), round(Math.min(1, c + d), 4)];
  }

  // ---------- 1. 结合料解析 ----------
  function resolveBinder(id) {
    const b = byId(KB.binders, id);
    if (!b) throw new Error('未知结合料 ' + id);
    if (b.family !== 'sbs') return b;
    const base = byId(KB.binders, b.base), m = KB.sbsModel, d = b.dose;
    return Object.assign({}, b, {
      trueHigh: base.trueHigh + m.dHigh * d,
      trueLow: base.trueLow + m.dLow * d,
      visc: base.visc + m.viscPerPct * d,
      mixT: m.mixT,
      price: base.price + m.pricePerPct * d + m.priceProcess,
      carbon: base.carbon + m.carbonPerPct * d + m.carbonProcess,
      strainBonus: m.strainBonus,
      tsr: m.tsr,
      fatigue: base.fatigue + m.fatiguePerPct * d,
    });
  }

  // ---------- 2. 气候与分区 ----------
  function climateOf(scn) {
    const c = scn.climate || byId(KB.cities, scn.cityId);
    if (!c) throw new Error('缺少气候信息：请给出 cityId 或 climate');
    const z = KB.climateZoning;
    const h = z.high.find((r) => c.julyAvgMax > r.min && c.julyAvgMax <= r.max) || z.high[2];
    const l = z.low.find((r) => c.extremeMin < r.lt);
    const r = z.rain.find((x) => c.rain > x.gt);
    const code = `${h.code}-${l.code}-${r.code}`;
    // Superpave/LTPPBind 路面温度换算（20mm 深度高温；SHRP 低温）
    const lat = c.lat;
    const pav20 = (tair) => (tair - 0.00618 * lat * lat + 0.2289 * lat + 42.2) * 0.9545 - 17.78;
    const pavLow = (tmin) => 0.859 * tmin + 1.7;
    const annualMinMean = c.extremeMin + 2 * c.tminSd; // 30 年极端值约为年极小值均值 − 2σ
    return Object.assign({}, c, {
      zone: { code, high: h, low: l, rain: r, dsKey: h.code === 3 ? '3' : `${h.code}-${l.code}` },
      pav20, pavLow, annualMinMean,
      pavHighMean: pav20(c.t7max), pavLowMean: pavLow(annualMinMean),
      pavHigh98: pav20(c.t7max + 2.054 * c.t7maxSd), pavLow98: pavLow(annualMinMean - 2.054 * c.tminSd),
    });
  }

  // ---------- 3. 场景标准化与标签 ----------
  function normalizeScenario(s) {
    const scn = Object.assign({
      roadClass: 'highway', traffic: 'heavy', speed: 'normal', treatment: 'MR_UP', aggregate: 'limestone',
      distresses: [], ambientT: 22, haulMin: 40, targetReliability: null, budgetPerM2: null, nightWork: false,
      samples: 400, seed: 20261021,
    }, s || {});
    scn.distresses = (scn.distresses || []).map((d) => (typeof d === 'string' ? { id: d, severity: 1 } : d));
    scn.distresses = scn.distresses.map(d => Object.assign({ severity: 1 }, d));
    if (scn.targetReliability == null) scn.targetReliability = KB.model.reliabilityByRoad[scn.roadClass] || 0.85;
    return scn;
  }
  function tagScenario(s) {
    const scn = normalizeScenario(s), c = climateOf(scn);
    const tags = [
      'CZ:' + c.zone.code, 'CZH:' + c.zone.high.code, 'CZL:' + c.zone.low.code, 'CZR:' + c.zone.rain.code,
      'TL:' + scn.traffic, 'SPD:' + scn.speed, 'TRT:' + scn.treatment, 'AGG:' + scn.aggregate, 'ROAD:' + scn.roadClass,
    ];
    scn.distresses.forEach((d) => { tags.push('DIS:' + d.id); tags.push('DIS:' + d.id + ':' + KB.severities[d.severity]); });
    return tags;
  }
  function similarity(a, b) {
    const A = new Set(a), B = new Set(b); let inter = 0;
    A.forEach((x) => { if (B.has(x)) inter++; });
    return inter / (A.size + B.size - inter);
  }

  // ---------- 4. 需求包络 ----------
  // 返回与候选无关的“场景目标” + 依候选类型变化的“规范底线”函数
  function sceneTargets(scn, clim) {
    const tl = byId(KB.traffic.levels, scn.traffic), sp = byId(KB.traffic.speed, scn.speed);
    const std = KB.standards, z = clim.zone;
    const dis = {}; scn.distresses.forEach((d) => { dis[d.id] = d.severity; });
    const why = {};
    // PG：路面设计温度 + 交通加级
    const bump = Math.min(2, tl.pgBump + sp.pgBump);
    const pgLowExtra = dis.thermalCrack != null ? KB.distresses[1].drives.pgLowExtra[dis.thermalCrack] : 0;
    why.pgHigh = `简化温度换算演示: 7日最高气温 ${clim.t7max}°C → 路面20mm处 ${round(clim.pavHighMean, 1)}°C；交通/车速加级 +${bump} 级(每级6°C)，待项目校核`;
    why.pgLow = `SHRP 公式: 年极端低温均值 ${round(clim.annualMinMean, 1)}°C → 路面 ${round(clim.pavLowMean, 1)}°C` + (pgLowExtra ? `；温缩裂缝严重，再降 ${pgLowExtra}°C` : '');
    // DS
    let ds;
    if (tl.dsFactor == null) {
      ds = std.dsDense.ordinary[z.dsKey] * (scn.traffic === 'medium' ? 1.5 : 1.0);
      why.ds = `规范普通沥青 ${std.dsDense.ordinary[z.dsKey]} 次/mm（${z.dsKey} 区）× 交通系数 ${scn.traffic === 'medium' ? 1.5 : 1.0}`;
    } else {
      ds = std.dsDense.modified[z.dsKey] * tl.dsFactor;
      why.ds = `规范改性沥青 ${std.dsDense.modified[z.dsKey]} 次/mm（${z.dsKey} 区）× ${tl.name}交通 ${tl.dsFactor}`;
    }
    ds *= sp.dsFactor; if (sp.dsFactor !== 1) why.ds += ` × ${sp.name} ${sp.dsFactor}`;
    if (dis.rutting != null) { const f = KB.distresses[0].drives.ds[dis.rutting]; ds *= f; if (f !== 1) why.ds += ` × 车辙病害 ${f}`; }
    // 低温应变
    const lowCode = z.low.code;
    const needMod = ['heavy', 'vheavy', 'xheavy'].includes(scn.traffic) || lowCode <= 2 || dis.thermalCrack != null;
    let strain = (needMod ? std.strain.modified : std.strain.ordinary)[lowCode];
    why.strain = `规范${needMod ? '改性' : '普通'}沥青 ${strain} με（${z.low.name}）`;
    if (dis.thermalCrack != null) { const f = KB.distresses[1].drives.strain[dis.thermalCrack]; strain *= f; if (f !== 1) why.strain += ` × 裂缝病害 ${f}`; }
    // TSR
    const wet = clim.rain >= 500;
    const tsrMod = z.rain.code === 1 || ['heavy', 'vheavy', 'xheavy'].includes(scn.traffic);
    let tsr = (wet ? std.tsr.wet : std.tsr.dry)[tsrMod ? 'modified' : 'ordinary'];
    why.tsr = `规范 ${wet ? '年降水≥500mm' : '年降水<500mm'} ${tsrMod ? '改性' : '普通'}沥青 ${tsr}%`;
    if (dis.moisture != null) { const a = KB.distresses[3].drives.tsr[dis.moisture]; tsr += a; why.tsr += ` + 水损害病害 ${a}%`; }
    // 疲劳
    let fatigue = tl.fatigueTarget; why.fatigue = `${tl.name}交通对应 lgNf ≥ ${tl.fatigueTarget}（四点弯曲 600με）`;
    if (dis.fatigueCrack != null) { const a = KB.distresses[2].drives.fatigue[dis.fatigueCrack]; fatigue += a; why.fatigue += ` + 网裂病害 ${a}`; }
    // 抗滑
    let td = scn.roadClass === 'local' ? 0.45 : 0.55; why.td = `${scn.roadClass === 'local' ? '一般道路' : '高等级道路'}构造深度 ${td} mm`;
    if (dis.skid != null) { td = Math.max(td, KB.distresses[4].drives.td[dis.skid]); why.td = `抗滑不足病害，目标构造深度 ${td} mm`; }
    return { bump, pgLowExtra, ds, strain, tsr, fatigue, td, why };
  }
  function standardFloor(scn, clim, cand) {
    const std = KB.standards, z = clim.zone, mod = cand.binder.modified, g = cand.grad;
    const wet = clim.rain >= 500, cls = mod ? 'modified' : 'ordinary';
    let ds;
    if (g.type === 'sma') ds = std.dsSMA[cls];
    else if (g.type === 'ogfc') ds = ['heavy', 'vheavy', 'xheavy'].includes(scn.traffic) ? std.dsOGFC.heavy : std.dsOGFC.normal;
    else ds = std.dsDense[cls][z.dsKey];
    const tsr = g.type === 'sma' ? std.tsr.sma[cls] : (wet ? std.tsr.wet : std.tsr.dry)[cls];
    const strain = std.strain[cls][z.low.code];
    return { ds, tsr, strain };
  }

  // ---------- 5. 候选方案枚举 ----------
  function treatmentOf(scn) { return byId(KB.treatments, scn.treatment); }
  function enumerate(scn, clim) {
    const trt = treatmentOf(scn), A = KB.additives, out = [], rejected = {};
    const reject = (code) => { rejected[code] = (rejected[code] || 0) + 1; };
    const agg = byId(KB.aggregates, scn.aggregate);
    const tMm = trt.thicknessCm * 10;
    for (const g of KB.gradations) {
      if (tMm < 2.5 * g.nmas || tMm > 4.0 * g.nmas) { reject('R08 层厚与公称最大粒径不匹配(2.5–4.0倍)'); continue; }
      for (const b0 of KB.binders) {
        const b = resolveBinder(b0.id);
        const fibers = g.type === 'dense' ? ['none', 'basalt'] : ['lignin', 'basalt'];
        for (const w of A.water) for (const r of A.rut) for (const wm of A.warm) for (const rap of A.rap) for (const fid of fibers) {
          const f = byId(A.fiber, fid);
          const why = rule(scn, clim, g, b, w, r, wm, rap, f, agg);
          if (why) { reject(why); continue; }
          out.push({ id: [g.id, b.id, w.id, r.id, wm.id, rap.id, f.id].join('/'), grad: g, binder: b, water: w, rut: r, warm: wm, rap, fiber: f, agg });
        }
      }
    }
    return { candidates: out, rejected };
  }
  function rule(scn, clim, g, b, w, r, wm, rap, f, agg) {
    const lowCode = clim.zone.low.code, heavy = ['heavy', 'vheavy', 'xheavy'].includes(scn.traffic);
    if (g.type === 'sma' && !b.modified) return 'R01 SMA 须用改性沥青';
    if (g.type === 'ogfc' && b.id !== 'HVA') return 'R02 OGFC 须用高粘高弹沥青';
    if (g.type === 'ogfc' && lowCode <= 2) return 'R03 冬寒/严寒区不用排水路面(冻融堵塞)';
    if (g.type === 'ogfc' && scn.speed === 'standing') return 'R03 停滞重载不用排水路面(剪切松散)';
    if (g.type !== 'dense' && rap.pct > 0) return 'R04 SMA/OGFC 表层不掺RAP';
    if (b.id === 'B30' && (g.id !== 'AC16' || lowCode <= 2)) return 'R05 硬质沥青仅用于 AC-16 且限非寒区';
    if (agg.acidic && heavy && w.id === 'none') return 'R06 酸性石料用于重交通须抗剥落措施';
    const minT = (b.modified ? KB.model.pavingMinT.modified : KB.model.pavingMinT.ordinary) - (wm.id === 'warm' ? KB.model.pavingMinT.warmRelief : 0);
    if (scn.ambientT < minT) return 'R07 施工气温低于铺筑下限';
    if (r.id !== 'none' && (g.type === 'ogfc' || b.id === 'HVA')) return 'R09 OGFC/高粘沥青不再加抗车辙剂';
    if (rap.pct > 0 && (b.id === 'HVA' || b.id === 'CR20' || b.id === 'B30')) return 'R11 RAP 不与高粘/橡胶/硬质沥青组合';
    if (g.type === 'dense' && f.id !== 'none' && rap.pct === 30) return 'R12 高RAP 掺量不再加纤维';
    return null;
  }

  // ---------- 6. 预测（机理先验） ----------
  function biasOf(state, cand, ind) {
    if (!state) return { m: 0, v: 0 };
    const k = `${cand.binder.family}|${cand.grad.type}|${ind}`;
    return state[k] ? { m: state[k].mean, v: state[k].var } : { m: 0, v: 0 };
  }
  function predictMean(cand, bias) {
    const g = cand.grad, b = cand.binder;
    const rapShiftH = cand.rap.pct === 30 ? 2.5 : cand.rap.pct === 15 ? 1.5 : 0;
    const rapShiftL = cand.rap.pct === 30 ? 3.0 : cand.rap.pct === 15 ? 1.5 : 0;
    const p = {
      pgHigh: b.trueHigh + rapShiftH,
      pgLow: b.trueLow + rapShiftL,
      ds: g.ds * Math.exp(0.11 * (b.trueHigh - 66)) * cand.rut.dsMul * cand.rap.dsMul,
      strain: g.strain + 90 * (-19 - b.trueLow) + b.strainBonus + cand.rut.strain + cand.rap.strain + cand.fiber.strain,
      tsr: g.tsr + b.tsr + cand.water.tsr + cand.agg.tsr + cand.warm.tsr + cand.rap.tsr,
      fatigue: g.fatigue + b.fatigue + cand.rap.fatigue + cand.fiber.fatigue,
      td: g.td + cand.agg.td,
    };
    if (bias) {
      p.ds *= Math.exp(bias(cand, 'ds').m); p.strain *= Math.exp(bias(cand, 'strain').m);
      p.tsr *= Math.exp(bias(cand, 'tsr').m); p.fatigue += bias(cand, 'fatigue').m;
    }
    return p;
  }

  // ---------- 7. 工艺扰动：压实欠缺 → 空隙率增量 ----------
  function compaction(scn, cand, ambientOverride) {
    const C = KB.model.compaction, trt = treatmentOf(scn);
    const T = ambientOverride != null ? ambientOverride : scn.ambientT;
    const thin = trt.thicknessCm <= 2.5 ? C.thinFactor : 1;
    const d = cand.binder.visc * cand.warm.viscMul * Math.max(0, C.Tref - T) / 10 * (1 + scn.haulMin / 120) * thin
            + (scn.nightWork ? 0.15 * cand.binder.visc * cand.warm.viscMul : 0);
    return { d, vaMean: C.vaPerD * d, vaSd: C.vaSd0 + C.vaSdPerD * d };
  }

  // ---------- 8. 蒙特卡洛评估 ----------
  function makeNoise(n, seed) {
    const rng = mulberry32(seed);
    const k = {}; ['tair', 'tmin', 'pgH', 'pgL', 'ds', 'st', 'tsr', 'fat', 'td', 'va'].forEach((x) => { k[x] = normals(n, rng); });
    const rho = -0.4; // 高温与低温误差负相关（偏硬的料抗车辙好、抗裂差）
    for (let i = 0; i < n; i++) k.st[i] = rho * k.ds[i] + Math.sqrt(1 - rho * rho) * k.st[i];
    return k;
  }
  function evaluate(scn, clim, tgt, cand, noise, opts) {
    opts = opts || {};
    const S = KB.model.sd, P = KB.model.perVa, Lm = KB.model.life, n = noise.ds.length;
    const bias = opts.biasState ? (c, ind) => biasOf(opts.biasState, c, ind) : null;
    const mu = predictMean(cand, bias);
    const fl = standardFloor(scn, clim, cand);
    const req = {
      ds: Math.max(tgt.ds, fl.ds), strain: Math.max(tgt.strain, fl.strain), tsr: Math.max(tgt.tsr, fl.tsr),
      fatigue: tgt.fatigue, td: tgt.td,
    };
    const binding = { ds: tgt.ds >= fl.ds ? 'scene' : 'std', strain: tgt.strain >= fl.strain ? 'scene' : 'std', tsr: tgt.tsr >= fl.tsr ? 'scene' : 'std' };
    const comp = compaction(scn, cand, opts.ambientT);
    const vaShift = opts.vaShift || 0;
    const bv = bias ? { ds: bias(cand, 'ds').v, st: bias(cand, 'strain').v, tsr: bias(cand, 'tsr').v, fat: bias(cand, 'fatigue').v } : { ds: 0, st: 0, tsr: 0, fat: 0 };
    const sdDs = Math.sqrt(S.dsLog * S.dsLog + bv.ds), sdSt = Math.sqrt(1 + bv.st) * S.strain, sdTsr = Math.sqrt(1 + bv.tsr) * S.tsr, sdFat = Math.sqrt(S.fatigue * S.fatigue + bv.fat);
    const ogfcVa = cand.grad.type === 'ogfc' ? 0.5 : 1;
    const pass = { pgHigh: 0, pgLow: 0, ds: 0, strain: 0, tsr: 0, fatigue: 0, td: 0 };
    let all = 0, lifeSum = 0, crfSum = 0; const lives = new Float64Array(n);
    const trt = treatmentOf(scn);
    const severe = scn.distresses.some((d) => d.severity === 2) ? Lm.severeFactor : 1;
    const i_ = KB.model.econ.discount;
    for (let i = 0; i < n; i++) {
      const reqH = clim.pav20(clim.t7max + clim.t7maxSd * noise.tair[i]) + 6 * tgt.bump;
      const reqL = clim.pavLow(clim.annualMinMean + clim.tminSd * noise.tmin[i]) - tgt.pgLowExtra;
      const dva = Math.max(-0.5, comp.vaMean + comp.vaSd * noise.va[i] + vaShift) * ogfcVa;
      const pgH = mu.pgHigh + S.pg * noise.pgH[i];
      const pgL = mu.pgLow + S.pg * noise.pgL[i];
      const ds = mu.ds * Math.exp(sdDs * noise.ds[i]) * Math.pow(P.dsMul, dva);
      const st = mu.strain + sdSt * noise.st[i] + P.strain * dva;
      const ts = mu.tsr + sdTsr * noise.tsr[i] + P.tsr * dva;
      const fa = mu.fatigue + sdFat * noise.fat[i] + P.fatigue * dva;
      const td = mu.td + S.td * noise.td[i] + P.td * dva;
      const ok = { pgHigh: pgH >= reqH, pgLow: pgL <= reqL, ds: ds >= req.ds, strain: st >= req.strain, tsr: ts >= req.tsr, fatigue: fa >= req.fatigue, td: td >= req.td };
      let okAll = true;
      for (const k of IND) { if (ok[k]) pass[k]++; else okAll = false; }
      if (okAll) all++;
      // 寿命：最弱裕度决定
      const m = Math.min(
        Math.exp(0.06 * (pgH - reqH)), Math.exp(0.06 * (reqL - pgL)),
        Math.pow(ds / req.ds, Lm.betaDs), Math.pow(Math.max(st, 1) / req.strain, Lm.betaStrain),
        Math.pow(Math.max(ts, 1) / req.tsr, Lm.betaTsr), Math.pow(10, Lm.betaFatigue * 0.5 * (fa - req.fatigue)),
        Math.pow(Math.max(td, 0.05) / req.td, 0.5)
      );
      const L = trt.baseLife * severe * clamp(m, Lm.min, Lm.max);
      lives[i] = L; lifeSum += L; crfSum += crf(i_, L);
    }
    const passRate = {}; for (const k of IND) passRate[k] = pass[k] / n;
    const sorted = Array.from(lives).sort((a, b) => a - b);
    const econ = costCarbon(scn, cand);
    const lifeMean = lifeSum / n;
    return {
      id: cand.id, cand, mean: mu, req, binding, comp,
      reliability: all / n, passRate,
      reliabilityInterval95: wilson(all, n), samples: n,
      bottleneck: IND.reduce((a, k) => (passRate[k] < passRate[a] ? k : a), IND[0]),
      lifeMean, lifeP10: sorted[Math.floor(0.1 * n)],
      costM2: econ.costM2, euac: econ.costM2 * (crfSum / n), carbonM2: econ.carbonM2, carbonYr: econ.carbonM2 / lifeMean,
      costBreak: econ.parts,
    };
  }
  function costCarbon(scn, cand) {
    const E = KB.model.econ, Cc = KB.model.carbon, trt = treatmentOf(scn), g = cand.grad, b = cand.binder;
    const pb = g.pb / 100;
    const materials = (pb * b.price + (1 - pb) * (g.aggPrice + cand.agg.price)) * cand.rap.costMul;
    const adds = cand.water.costMix + cand.rut.costMix + cand.warm.costMix + cand.fiber.costMix;
    const prod = E.production - (cand.warm.id === 'warm' ? E.warmProdSave : 0);
    const perT = materials + adds + prod + E.laying;
    const tPerM2 = (trt.thicknessCm / 100) * g.density;
    const costM2 = tPerM2 * perT + (trt.milling ? E.milling : 0);
    const matC = (pb * b.carbon + (1 - pb) * Cc.aggregate) * cand.rap.carbonMul;
    const cPerT = matC + Cc.production * cand.warm.fuelMul + Cc.transport + cand.water.carbonMix + cand.rut.carbonMix + cand.fiber.carbonMix;
    const carbonM2 = tPerM2 * cPerT + (trt.milling ? Cc.milling : 0);
    return { costM2, carbonM2, parts: { materials: tPerM2 * materials, additives: tPerM2 * adds, production: tPerM2 * (prod + E.laying), milling: trt.milling ? E.milling : 0 } };
  }

  // ---------- 9. 选优、Pareto、解释 ----------
  function pareto(rows) {
    // 目标：可靠度↑、年均成本↓、年均碳排↓
    // 按展示精度比较，避免“显示相同、内部差 1e-6”造成的伪支配；完全相同的点只保留一个
    const key = (r) => [round(r.reliability, 3), round(r.euac, 2), round(r.carbonYr, 2)];
    const ks = rows.map(key), front = [], seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      const [ra, ea, ca] = ks[i];
      let dominated = false;
      for (let j = 0; j < rows.length && !dominated; j++) {
        if (i === j) continue;
        const [rb, eb, cb] = ks[j];
        if (rb >= ra && eb <= ea && cb <= ca && (rb > ra || eb < ea || cb < ca)) dominated = true;
      }
      const sig = ks[i].join('|');
      if (!dominated && !seen.has(sig)) { seen.add(sig); front.push(rows[i]); }
    }
    return front.sort((x, y) => x.euac - y.euac);
  }
  function choose(rows, target) {
    const ok = rows.filter((r) => r.reliability >= target);
    if (ok.length) return { pick: ok.reduce((a, b) => (b.euac < a.euac - 1e-9 || (Math.abs(b.euac - a.euac) < 1e-9 && b.carbonYr < a.carbonYr) ? b : a)), reached: true };
    return { pick: rows.reduce((a, b) => (b.reliability > a.reliability ? b : a)), reached: false };
  }
  const DIMS = ['grad', 'binder', 'water', 'rut', 'warm', 'rap', 'fiber'];
  const DIM_NAME = { grad: '级配', binder: '结合料', water: '抗水损措施', rut: '抗车辙剂', warm: '拌和工艺', rap: 'RAP掺量', fiber: '纤维' };
  function diffDims(a, b) { return DIMS.filter((d) => a.cand[d].id !== b.cand[d].id); }
  function counterfactuals(best, rows, target) {
    const nb = rows.filter((r) => r !== best && diffDims(r, best).length === 1);
    return nb.map((r) => {
      const d = diffDims(r, best)[0];
      return {
        change: `${DIM_NAME[d]}：${best.cand[d].name} → ${r.cand[d].name}`, dim: d, id: r.id,
        dRel: r.reliability - best.reliability, dEuac: r.euac - best.euac, dCarbonYr: r.carbonYr - best.carbonYr,
        meets: r.reliability >= target, bottleneck: r.bottleneck, bottleneckRate: r.passRate[r.bottleneck],
      };
    }).sort((a, b) => a.dEuac - b.dEuac);
  }
  function describe(r) {
    const c = r.cand, parts = [c.grad.name, c.binder.name];
    if (c.water.id !== 'none') parts.push(c.water.name);
    if (c.rut.id !== 'none') parts.push(c.rut.name);
    if (c.warm.id !== 'none') parts.push(c.warm.name);
    if (c.rap.id !== 'R0') parts.push(c.rap.name);
    if (c.fiber.id !== 'none') parts.push(c.fiber.name);
    return parts.join(' + ');
  }
  function processAdvice(scn, clim, r, noise, opts) {
    const c = r.cand, mixT = c.binder.mixT + c.warm.dT;
    const minT = (c.binder.modified ? KB.model.pavingMinT.modified : KB.model.pavingMinT.ordinary) - (c.warm.id === 'warm' ? KB.model.pavingMinT.warmRelief : 0);
    const tgt = sceneTargets(scn, clim);
    const cold = evaluate(scn, clim, tgt, c, noise, Object.assign({}, opts, { ambientT: scn.ambientT - 8 }));
    const loose = evaluate(scn, clim, tgt, c, noise, Object.assign({}, opts, { vaShift: 1.0 }));
    return {
      mixTemp: [mixT - 5, mixT + 5], compactionStartMin: mixT - 25, minAmbient: minT,
      vaDesign: c.grad.va, vaExpectedExcess: round(r.comp.vaMean, 2),
      robustness: { colder8: round(cold.reliability - r.reliability, 3), va1: round(loose.reliability - r.reliability, 3) },
    };
  }
  function scarcity(rows) {
    const s = {};
    for (const k of IND) s[k] = 1 - rows.reduce((a, r) => a + r.passRate[k], 0) / rows.length;
    return IND.slice().sort((a, b) => s[b] - s[a]).map((k) => ({ ind: k, name: IND_NAME[k], scarcity: round(s[k], 3) }));
  }

  // ---------- 10. 基准方法（用于对比） ----------
  function experienceBaseline(scn, clim) {
    const thin = treatmentOf(scn).thicknessCm <= 2.5;
    const heavy = ['vheavy', 'xheavy'].includes(scn.traffic) || scn.speed === 'standing';
    const cold = clim.zone.low.code <= 2, hot = clim.zone.high.code === 1;
    // 经验选型：重载/停滞 → SMA；抗滑不足 → SMA；严寒/寒区 → 软基质 SBS；炎热或重交通 → 70# 基 SBS；
    //         酸性石料或水损害 → 抗剥落剂；温缩裂缝严重 → 提高 SBS 剂量
    const has = (id) => scn.distresses.some((d) => d.id === id);
    let g = thin ? 'AC10' : 'AC13', b = 'B70', f = 'none';
    const cold1 = clim.zone.low.code === 1;
    if (heavy || has('skid')) { g = thin ? 'SMA10' : 'SMA13'; f = 'lignin'; b = cold1 ? 'SBS110_5' : cold ? 'SBS90_4' : 'SBS70_4'; }
    else if (cold) b = cold1 ? 'SBS110_5' : 'SBS90_4';
    else if (hot || ['heavy'].includes(scn.traffic)) b = 'SBS70_4';
    if (has('thermalCrack') && b === 'SBS90_4') b = 'SBS90_5';
    const agg = byId(KB.aggregates, scn.aggregate);
    const w = agg.acidic || has('moisture') ? 'amine' : 'none';
    return [g, b, w, 'none', 'none', 'R0', f].join('/');
  }
  function weightedSumPick(rows) {
    // 常见 AHP 式加权打分：各指标“均值/要求”截断后加权，减去成本项
    const W = { ds: 0.25, strain: 0.2, tsr: 0.2, fatigue: 0.15, td: 0.05 }, wc = 0.15;
    const cMin = Math.min(...rows.map((r) => r.costM2)), cMax = Math.max(...rows.map((r) => r.costM2));
    let best = null, bs = -Infinity;
    for (const r of rows) {
      let s = 0; for (const k in W) s += W[k] * Math.min(1.3, k === 'fatigue' ? Math.pow(10, r.mean[k] - r.req[k]) : r.mean[k] / r.req[k]);
      s -= wc * (r.costM2 - cMin) / (cMax - cMin || 1);
      if (s > bs) { bs = s; best = r; }
    }
    return best;
  }

  // ---------- 11. 主入口 ----------
  function recommend(input, opts) {
    opts = opts || {};
    const t0 = Date.now();
    const scn = normalizeScenario(input);
    for (const [key, values] of Object.entries({roadClass:['highway','arterial','local'], traffic:KB.traffic.levels.map(x=>x.id), speed:KB.traffic.speed.map(x=>x.id), aggregate:KB.aggregates.map(x=>x.id)})) {
      if (!values.includes(scn[key])) throw new Error('未知场景字段 ' + key);
    }
    if (!Number.isFinite(scn.ambientT) || !Number.isFinite(scn.haulMin) || scn.haulMin < 0) throw new Error('施工温度和运输时长须为有效数值，运输时长不可为负');
    if (scn.crackWidthMm != null && (!Number.isFinite(scn.crackWidthMm) || scn.crackWidthMm <= 0)) throw new Error('裂缝宽度须为正数');
    for (const d of scn.distresses) if (!KB.distresses.some(x=>x.id===d.id) || ![0,1,2].includes(d.severity)) throw new Error('病害编号或严重程度无效');
    if (scn.climate) {
      for (const k of ['lat','julyAvgMax','t7max','t7maxSd','extremeMin','tminSd','rain']) if (!Number.isFinite(scn.climate[k])) throw new Error('自定义气候字段无效：' + k);
      if (Math.abs(scn.climate.lat)>90 || ['rain','t7maxSd','tminSd'].some(k=>scn.climate[k]<0)) throw new Error('自定义气候超出有效范围');
    }
    if (!Number.isInteger(scn.samples) || scn.samples < 1 || scn.samples > 10000) throw new Error('采样数须为 1–10000 的整数');
    if (!Number.isFinite(scn.targetReliability) || scn.targetReliability <= 0 || scn.targetReliability > 1) throw new Error('目标可靠度须大于 0 且不超过 1');
    if (scn.budgetPerM2 != null && (!Number.isFinite(scn.budgetPerM2) || scn.budgetPerM2 < 0)) throw new Error('预算须为非负有限数值');
    const trt = treatmentOf(scn);
    if (!trt) throw new Error('未知养护工法 ' + scn.treatment);
    const clim = climateOf(scn);
    if (!trt.mix) return crackRecommend(scn, clim);
    const tgt = sceneTargets(scn, clim);
    const { candidates, rejected } = enumerate(scn, clim);
    const noise = makeNoise(scn.samples, scn.seed);
    let rows = candidates.map((c) => evaluate(scn, clim, tgt, c, noise, opts));
    const nAll = rows.length;
    let budgetCut = 0;
    if (scn.budgetPerM2 != null) { const keep = rows.filter((r) => r.costM2 <= scn.budgetPerM2); budgetCut = rows.length - keep.length; rows = keep; }
    if (!rows.length) return {
      engine: 'SZXC-1.0', module: 'infeasible', scenario: scn,
      targetReached: false, recommended: null, alternatives: [], pareto: [], cloud: [],
      reason: nAll ? '预算内无可行方案，请调整预算或养护工法。' : '当前施工条件下无可行方案，请调整施工气温、工法或材料条件。',
      stats: { feasible: nAll, budgetCut, rejected, samples: scn.samples },
    };
    const { pick, reached } = choose(rows, scn.targetReliability);
    const front = pareto(rows);
    const cheapest = rows.reduce((a, b) => (b.costM2 < a.costM2 ? b : a));
    const expId = experienceBaseline(scn, clim);
    const exp = rows.find((r) => r.id === expId) || evaluate(scn, clim, tgt, Object.assign({}, rebuild(expId, scn)), noise, opts);
    const ws = weightedSumPick(rows);
    const alts = front.filter((r) => r !== pick).sort((a, b) => Math.abs(a.euac - pick.euac) - Math.abs(b.euac - pick.euac)).slice(0, 4);
    const pg = { high: pgGradeHigh(clim.pavHigh98 + 6 * tgt.bump), low: pgGradeLow(clim.pavLow98 - tgt.pgLowExtra) };
    return {
      engine: 'SZXC-1.0', elapsedMs: Date.now() - t0, scenario: scn, tags: tagScenario(scn),
      climate: { city: clim.name, zone: clim.zone.code, zoneName: `${clim.zone.high.name}·${clim.zone.low.name}·${clim.zone.rain.name}`,
        pavHigh98: round(clim.pavHigh98, 1), pavLow98: round(clim.pavLow98, 1), pgRequired98: `PG ${pg.high}-${-pg.low}` },
      requirements: IND.map((k) => ({ ind: k, name: IND_NAME[k], unit: IND_UNIT[k], sceneTarget: k === 'pgHigh' ? round(clim.pavHighMean + 6 * tgt.bump, 1) : k === 'pgLow' ? round(clim.pavLowMean - tgt.pgLowExtra, 1) : round(tgt[k], 2), why: tgt.why[k] })),
      priorities: scarcity(rows),
      stats: { enumerated: nAll + Object.values(rejected).reduce((a, b) => a + b, 0), feasible: nAll, budgetCut, rejected, samples: scn.samples },
      targetReliability: scn.targetReliability, targetReached: reached,
      recommended: summarize(pick, true), process: processAdvice(scn, clim, pick, noise, opts),
      counterfactuals: counterfactuals(pick, rows, scn.targetReliability).slice(0, 12),
      alternatives: alts.map((r) => summarize(r)),
      pareto: front.map((r) => summarize(r)),
      baselines: { experience: summarize(exp), weightedSum: summarize(ws), cheapest: summarize(cheapest) },
      cloud: rows.map((r) => [round(r.reliability, 3), round(r.euac, 2), round(r.carbonYr, 2), r.id]),
    };
    function rebuild(id, s) {
      const [g, b, w, r, wm, rap, f] = id.split('/'), A = KB.additives;
      return { id, grad: byId(KB.gradations, g), binder: resolveBinder(b), water: byId(A.water, w), rut: byId(A.rut, r), warm: byId(A.warm, wm), rap: byId(A.rap, rap), fiber: byId(A.fiber, f), agg: byId(KB.aggregates, s.aggregate) };
    }
  }
  function summarize(r, full) {
    const o = {
      id: r.id, label: describe(r), reliability: round(r.reliability, 3), reliabilityInterval95: r.reliabilityInterval95, samples: r.samples, passRate: Object.fromEntries(IND.map((k) => [k, round(r.passRate[k], 3)])),
      bottleneck: r.bottleneck, bottleneckName: IND_NAME[r.bottleneck], lifeMean: round(r.lifeMean, 1), lifeP10: round(r.lifeP10, 1),
      costM2: round(r.costM2, 1), euac: round(r.euac, 2), carbonM2: round(r.carbonM2, 1), carbonYr: round(r.carbonYr, 2),
    };
    if (full) {
      o.formula = {
        gradation: r.cand.grad.name, binder: r.cand.binder.name, binderContent: r.cand.grad.pb, aggregate: r.cand.agg.name,
        water: r.cand.water.name, rut: r.cand.rut.name, warm: r.cand.warm.name, rap: r.cand.rap.name, fiber: r.cand.fiber.name,
        binderPG: `PG ${pgGradeHigh(r.cand.binder.trueHigh)}-${-pgGradeLow(r.cand.binder.trueLow)}`,
      };
      o.predicted = Object.fromEntries(IND.map((k) => [k, { mean: round(r.mean[k], k === 'td' ? 2 : k === 'fatigue' ? 2 : 1), req: k in r.req ? round(r.req[k], 2) : null, binding: r.binding[k] || 'scene' }]));
      o.costBreak = Object.fromEntries(Object.entries(r.costBreak).map(([k, v]) => [k, round(v, 1)]));
    }
    return o;
  }

  // ---------- 12. 裂缝处治模块 ----------
  function crackRecommend(scn, clim) {
    const w = scn.crackWidthMm || 6;
    const rule = KB.crackRules.find((r) => w <= r.maxWidth);
    const lowNeed = clim.pavLow98, highNeed = clim.pavHigh98 + 15; // 灌缝胶软化点需高于路表最高温约 15°C（ENG）
    const ok = KB.sealants.filter((s) => s.lowTest <= lowNeed && s.softening >= highNeed);
    const pick = (ok.length ? ok : KB.sealants.slice().sort((a, b) => a.lowTest - b.lowTest)).sort((a, b) => a.price - b.price)[0];
    return {
      engine: 'SZXC-1.0', module: 'crack', scenario: scn, tags: tagScenario(scn),
      climate: { city: clim.name, zone: clim.zone.code, pavHigh98: round(clim.pavHigh98, 1), pavLow98: round(clim.pavLow98, 1) },
      method: rule.method, sealant: pick, feasibleSealants: ok.map((s) => s.name),
      reason: `路表低温(98%) ${round(lowNeed, 1)}°C，要求低温拉伸试验温度不高于该值；路表高温 ${round(clim.pavHigh98, 1)}°C，软化点宜≥${round(highNeed, 0)}°C`,
      note: ok.length ? '' : '无完全满足的型号，按低温优先取最耐寒型，并建议夏季加强巡查',
    };
  }

  // ---------- 13. 监测反馈：贝叶斯偏差修正 ----------
  // obs: [{binderFamily, gradType, indicator, ratio}]  ratio = 实测/预测 (fatigue 用 lg 差值)
  function updateBias(state, obs, prior) {
    prior = prior || { tau: 0.15, sigma: 0.20 };
    if (!Number.isFinite(prior.tau) || prior.tau<=0 || !Number.isFinite(prior.sigma) || prior.sigma<=0) throw new Error('反馈先验参数须为正数');
    if (!Array.isArray(obs) || obs.length>1000) throw new Error('反馈观测须为不超过1000项的数组');
    const st = JSON.parse(JSON.stringify(state || {}));
    for (const o of obs) {
      if (!['base','hard','sbs','rubber','hva'].includes(o.binderFamily) || !['dense','sma','ogfc'].includes(o.gradType) || !['ds','strain','tsr','fatigue'].includes(o.indicator) || !Number.isFinite(o.ratio) || (o.indicator!=='fatigue' && o.ratio<=0)) throw new Error('反馈字段无效，比值须为正数');
      const k = `${o.binderFamily}|${o.gradType}|${o.indicator}`;
      const y = o.indicator === 'fatigue' ? o.ratio : Math.log(o.ratio);
      const cur = st[k] || { mean: 0, var: prior.tau * prior.tau, n: 0 };
      if (!Number.isFinite(cur.mean) || !Number.isFinite(cur.var) || cur.var<=0 || !Number.isInteger(cur.n) || cur.n<0) throw new Error('反馈状态无效');
      const prec = 1 / cur.var + 1 / (prior.sigma * prior.sigma);
      const mean = (cur.mean / cur.var + y / (prior.sigma * prior.sigma)) / prec;
      st[k] = { mean, var: 1 / prec, n: cur.n + 1 };
    }
    return st;
  }

  return { KB, IND, IND_NAME, IND_UNIT, recommend, climateOf, normalizeScenario, tagScenario, similarity, sceneTargets, enumerate, evaluate, makeNoise, resolveBinder, predictMean, updateBias, describe, experienceBaseline, pgGradeHigh, pgGradeLow };
});
