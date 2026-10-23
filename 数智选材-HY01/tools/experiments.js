#!/usr/bin/env node
// 生成论文所需的全部实验数据 → paper/figdata/*.json|csv
//   node tools/experiments.js
const fs = require('fs');
const path = require('path');
const E = require('../engine/engine.js');
const KB = E.KB;
const R = path.join(__dirname, '..');
const OUT = path.join(R, 'paper/figdata');
fs.mkdirSync(OUT, { recursive: true });
const cases = JSON.parse(fs.readFileSync(path.join(R, 'cases/cases.json'), 'utf8'));
const w = (f, o) => fs.writeFileSync(path.join(OUT, f), typeof o === 'string' ? o : JSON.stringify(o, null, 1));
const T0 = Date.now();

// ---------- 1. 案例对比 ----------
const caseRows = [];
const full = {};
for (const c of cases) {
  const o = E.recommend(c.input);
  full[c.id] = o;
  if (o.module === 'crack') continue;
  const pick = (k, x) => ({ case: c.id, method: k, label: x.label, rel: x.reliability, life: x.lifeMean, cost: x.costM2, euac: x.euac, carbonYr: x.carbonYr, bottleneck: x.bottleneckName, bottleRate: x.passRate[x.bottleneck] });
  caseRows.push(pick('ours', o.recommended), pick('experience', o.baselines.experience), pick('weighted', o.baselines.weightedSum), pick('cheapest', o.baselines.cheapest));
}
w('cases_full.json', Object.fromEntries(Object.entries(full).map(([k, v]) => [k, Object.assign({}, v, { cloud: undefined })])));
w('case_compare.json', caseRows);
// 散点：C1、C2
for (const id of ['C1', 'C2', 'C5']) w(`cloud_${id}.json`, { cloud: full[id].cloud, pareto: full[id].pareto.map((p) => p.id), rec: full[id].recommended.id, exp: full[id].baselines.experience, ws: full[id].baselines.weightedSum, target: full[id].targetReliability });

// ---------- 2. 施工气温扫描（材料—工艺耦合） ----------
{
  const base = cases.find((c) => c.id === 'C2').input;
  const plans = [
    'AC16/SBS110_5/lime/antirut/warm/R0/basalt', // 冷季推荐（温拌）
    'AC16/SBS110_5/lime/antirut/none/R0/basalt', // 同配方热拌
    'AC13/SBS110_5/none/none/none/R0/none',      // 经验选型
    'SMA13/SBS90_5/lime/antirut/warm/R0/basalt',
  ];
  const scn0 = E.normalizeScenario(base), clim = E.climateOf(scn0), tgt = E.sceneTargets(scn0, clim);
  const noise = E.makeNoise(800, 7);
  const A = KB.additives, by = (a, i) => a.find((x) => x.id === i);
  const rows = [];
  for (let T = 2; T <= 26; T += 1) {
    const scn = Object.assign({}, scn0, { ambientT: T });
    const r = { T };
    for (const id of plans) {
      const [g, b, wa, ru, wm, rap, f] = id.split('/');
      const cand = { id, grad: by(KB.gradations, g), binder: E.resolveBinder(b), water: by(A.water, wa), rut: by(A.rut, ru), warm: by(A.warm, wm), rap: by(A.rap, rap), fiber: by(A.fiber, f), agg: by(KB.aggregates, scn.aggregate) };
      const minT = (cand.binder.modified ? KB.model.pavingMinT.modified : KB.model.pavingMinT.ordinary) - (wm === 'warm' ? KB.model.pavingMinT.warmRelief : 0);
      const ev = E.evaluate(scn, clim, tgt, cand, noise);
      r[id] = T < minT ? null : ev.reliability;
      r[id + '#va'] = ev.comp.vaMean;
    }
    rows.push(r);
  }
  w('ambient_sweep.json', { plans, rows });
}

// ---------- 3. 反馈学习收敛 ----------
{
  // 真值：湿热区 SBS 密级配水稳定性比先验低 12%；逐段回流观测（含噪声 σ=0.2）
  const truth = Math.log(0.88), sigma = 0.20;
  const rng = (() => { let s = 99; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  const gauss = () => { const u = Math.max(rng(), 1e-12), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const reps = 200, N = 30, track = [];
  const sum = Array(N + 1).fill(0), sumsq = Array(N + 1).fill(0), sdPost = Array(N + 1).fill(0);
  for (let k = 0; k < reps; k++) {
    let st = {};
    const one = [0];
    for (let n = 1; n <= N; n++) {
      st = E.updateBias(st, [{ binderFamily: 'sbs', gradType: 'dense', indicator: 'tsr', ratio: Math.exp(truth + sigma * gauss()) }]);
      const m = st['sbs|dense|tsr'].mean; one.push(m);
      sum[n] += m; sumsq[n] += m * m; sdPost[n] = Math.sqrt(st['sbs|dense|tsr'].var);
    }
    if (k < 5) track.push(one);
  }
  const conv = [];
  for (let n = 0; n <= N; n++) {
    const mean = n ? sum[n] / reps : 0, sd = n ? Math.sqrt(Math.max(0, sumsq[n] / reps - mean * mean)) : 0;
    conv.push({ n, mean: Math.exp(mean), lo: Math.exp(mean - 1.96 * sd), hi: Math.exp(mean + 1.96 * sd), postSd: n ? sdPost[n] : 0.15 });
  }
  // 推荐随回流段数的变化：选一个对 SBS 密级配敏感的场景（C6）
  const switchTrack = [];
  let st = {};
  const inp = cases.find((c) => c.id === 'C6').input;
  for (let n = 0; n <= 20; n += 2) {
    if (n) st = E.updateBias(st, Array.from({ length: 2 }, () => ({ binderFamily: 'sbs', gradType: 'dense', indicator: 'tsr', ratio: 0.88 })));
    const o = E.recommend(inp, { biasState: st });
    switchTrack.push({ n, id: o.recommended.id, label: o.recommended.label, rel: o.recommended.reliability, euac: o.recommended.euac, bias: n ? Math.exp(st['sbs|dense|tsr'].mean) : 1 });
  }
  w('feedback.json', { truth: Math.exp(truth), conv, track: track.map((t) => t.map(Math.exp)), switchTrack });
}

// ---------- 4. 蒙特卡洛样本数收敛 ----------
{
  // 以 N=6000 的结果作“真值”，看小样本选出的方案在真值下是否达标、年值成本多花多少
  const out = [];
  for (const cid of ['C1', 'C3']) {
    const inp = cases.find((c) => c.id === cid).input;
    const truth = E.recommend(Object.assign({}, inp, { samples: 6000, seed: 1 }));
    const T = new Map(truth.cloud.map((x) => [x[3], x]));
    const tgt = truth.targetReliability, best = truth.recommended;
    const id0 = best.id;
    for (const n of [50, 100, 200, 400, 800, 1600]) {
      const rels = [], regrets = [], okTrue = []; const picks = new Set();
      for (let s = 1; s <= 30; s++) {
        const o = E.recommend(Object.assign({}, inp, { samples: n, seed: 1000 + s }));
        rels.push(o.cloud.find((x) => x[3] === id0)[0]);
        const t = T.get(o.recommended.id); picks.add(o.recommended.id);
        okTrue.push(t[0] >= tgt - 0.02 ? 1 : 0); regrets.push(t[1] - best.euac);
      }
      const m = rels.reduce((a, b) => a + b, 0) / rels.length, sd = Math.sqrt(rels.reduce((a, b) => a + (b - m) * (b - m), 0) / rels.length);
      out.push({ case: cid, n, relMean: m, relSd: sd, truthRel: T.get(id0)[0], pickOkTrue: okTrue.reduce((a, b) => a + b, 0) / 30,
        regretMean: regrets.reduce((a, b) => a + b, 0) / 30, regretMax: Math.max(...regrets), distinctPicks: picks.size });
    }
  }
  w('mc_convergence.json', out);
}

// ---------- 5. 先验参数扰动下的推荐稳定性 ----------
{
  const snap = JSON.stringify({ g: KB.gradations, b: KB.binders, s: KB.sbsModel, m: KB.model });
  const restore = () => { const o = JSON.parse(snap); KB.gradations.splice(0, KB.gradations.length, ...o.g); KB.binders.splice(0, KB.binders.length, ...o.b); Object.assign(KB.sbsModel, o.s); KB.model.sd = o.m.sd; KB.model.perVa = o.m.perVa; };
  const fam = (id) => { const [g, b] = id.split('/'); return KB.gradations.find((x) => x.id === g).type + '|' + E.resolveBinder(b).family; };
  const base = {}; for (const c of cases) if (c.input.treatment !== 'CRACK') base[c.id] = E.recommend(Object.assign({}, c.input, { samples: 300 }));
  let s = 4242; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const U = (k) => 1 + k * (2 * rnd() - 1);
  const K = 40, res = {};
  for (const id of Object.keys(base)) res[id] = { sameExact: 0, sameFamily: 0, relDrop: [], regret: [] };
  for (let k = 0; k < K; k++) {
    for (const g of KB.gradations) { g.ds *= U(0.15); g.strain *= U(0.08); g.tsr *= U(0.04); g.fatigue += 0.15 * (2 * rnd() - 1); g.td *= U(0.10); }
    for (const b of KB.binders) if (b.trueHigh != null) { b.trueHigh += 2 * (2 * rnd() - 1); b.trueLow += 2 * (2 * rnd() - 1); b.price *= U(0.10); }
    KB.sbsModel.dHigh *= U(0.2); KB.sbsModel.dLow *= U(0.2); KB.sbsModel.pricePerPct *= U(0.2);
    for (const c of cases) {
      if (!base[c.id]) continue;
      const o = E.recommend(Object.assign({}, c.input, { samples: 300 }));
      const b0 = base[c.id].recommended;
      if (o.recommended.id === b0.id) res[c.id].sameExact++;
      if (fam(o.recommended.id) === fam(b0.id)) res[c.id].sameFamily++;
      // 若在扰动世界里仍执行“原推荐”，可靠度与年值成本的损失（遗憾）
      const r0 = o.cloud.find((x) => x[3] === b0.id);
      if (r0) { res[c.id].relDrop.push(o.recommended.reliability - r0[0]); res[c.id].regret.push(r0[1] - o.recommended.euac); }
    }
    restore();
  }
  const summ = Object.entries(res).map(([id, r]) => ({
    case: id, sameExact: r.sameExact / K, sameFamily: r.sameFamily / K,
    relLossMedian: median(r.relDrop), euacRegretMedian: median(r.regret),
  }));
  w('prior_stability.json', summ);
  function median(a) { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; }
}

// ---------- 6. 城市需求包络 ----------
{
  const rows = KB.cities.map((c) => {
    const cl = E.climateOf({ cityId: c.id });
    return { id: c.id, name: c.name, zone: cl.zone.code, pavHigh98: +cl.pavHigh98.toFixed(1), pavLow98: +cl.pavLow98.toFixed(1),
      pg: `PG ${E.pgGradeHigh(cl.pavHigh98)}-${-E.pgGradeLow(cl.pavLow98)}`, range: +(cl.pavHigh98 - cl.pavLow98).toFixed(1) };
  });
  w('city_envelope.json', rows);
}

// ---------- 7. 统计：规则剪枝与运行时间 ----------
{
  const st = {};
  for (const c of cases) { if (c.input.treatment === 'CRACK') continue; const o = full[c.id]; st[c.id] = { enumerated: o.stats.enumerated, feasible: o.stats.feasible, rejected: o.stats.rejected, ms: o.elapsedMs }; }
  w('stats.json', st);
}
console.log('experiments done in', ((Date.now() - T0) / 1000).toFixed(1), 's');
