/*
 * 灯语守护 · 居家水电数据模拟器
 * ------------------------------------------------------------
 * 按分钟模拟独居老人一天的起居（起床、做饭、外出、午睡、看电视、洗澡、起夜……）
 * 与家电负荷（冰箱、待机、照明、电视、烧水壶、电磁炉、电饭煲、热水器、洗衣机），
 * 再聚合为智能电表 / 水表常见的 15 分钟曲线：每个时段的平均功率（kW）与用水量（升）。
 *
 * 可注入带真值的异常事件，用于测试预警算法：
 *   fall_day     白天在家跌倒/突发失能：此后不再有人为操作，正开着的电视、灯保持原状
 *   fall_night   夜间起夜时跌倒：卫生间灯一直亮着，早上不再起床
 *   never_wake   睡梦中突发疾病：一切如常关闭，只是早上再没有起床
 *   fall_bath    洗澡时跌倒：热水器和水流一直不停
 *   stove_on     忘关电磁炉：大功率恒定运行 2.5–4 小时，人其他行为正常
 *   tap_on       忘关水龙头：持续出水 1.5–3 小时
 *   night_restless 连续 3 晚频繁起夜（如尿路感染、发热、心衰加重的早期表现）
 *   drift        3 周内作息逐渐变乱：起得越来越晚、外出和做饭越来越少
 * 以及不应报警的正常扰动：外出探亲（报备或未报备）、子女周末来访、偶尔睡懒觉等。
 *
 * 浏览器与 Node.js 通用，不依赖任何第三方库。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LampSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SLOT = 15;             // 电表曲线时段长度（分钟）
  var SPD = 96;              // 每天时段数
  var MPD = 1440;            // 每天分钟数

  // ---------- 随机数 ----------
  function rngOf(seed) {
    var a = (seed >>> 0) || 1;
    function r() {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    r.normal = function (mu, sd) {
      var u = 1 - r(), v = r();
      return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    r.range = function (a, b) { return a + (b - a) * r(); };
    r.int = function (a, b) { return Math.floor(a + (b - a + 1) * r()); };
    r.pick = function (arr) { return arr[Math.floor(r() * arr.length)]; };
    r.chance = function (p) { return r() < p; };
    r.poisson = function (lam) {
      var L = Math.exp(-lam), k = 0, p = 1;
      do { k++; p *= r(); } while (p > L);
      return k - 1;
    };
    return r;
  }

  var SURNAMES = '王李张刘陈杨赵黄周吴徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧程曹袁邓许傅沈曾彭吕苏卢蒋蔡贾丁魏薛叶阎余潘杜戴夏钟汪田任姜范方石姚谭廖邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段雷钱汤尹黎易常武乔贺赖龚文'.split('');

  // ---------- 生成一位老人的生活画像 ----------
  function makePersona(seed) {
    var r = rngOf(seed * 7919 + 17);
    var female = r.chance(0.62);                 // 独居老人中女性占多数
    var age = r.int(66, 91);
    var sur = r.pick(SURNAMES);
    var call = female ? r.pick(['奶奶', '阿婆', '阿姨', '大娘']) : r.pick(['爷爷', '大爷', '老伯', '叔']);
    var early = r.chance(0.55);
    var p = {
      seed: seed,
      name: sur + call,
      surname: sur,
      female: female,
      age: age,
      wakeMu: early ? r.range(325, 390) : r.range(380, 460),   // 5:25–6:30 / 6:20–7:40
      wakeSd: r.range(8, 30),
      bedMu: early ? r.range(1235, 1320) : r.range(1290, 1395), // 20:35–22:00 / 21:30–23:15
      bedSd: r.range(10, 35),
      napProb: r.range(0.2, 0.85),
      outingProb: age > 85 ? r.range(0.1, 0.4) : r.range(0.35, 0.85),
      walkProb: r.range(0.1, 0.5),
      tvLevel: r.range(0.2, 1),
      tvKw: r.range(0.07, 0.14),
      lightKw: r.range(0.025, 0.08),
      nightLam: r.range(0.4, 1.8) + (age > 80 ? 0.4 : 0),
      flushGap: r.range(110, 200),                 // 白天在家时大约多久冲一次马桶（分钟）
      heater: r.chance(0.5) ? 'electric' : 'gas',  // 电热水器 / 燃气热水器
      showerProb: r.range(0.25, 0.7),
      laundryProb: r.range(0.12, 0.35),
      stoveProb: r.range(0.45, 0.9),               // 午晚饭用电磁炉的概率（其余用燃气或微波炉）
      stoveKw: r.range(1.3, 2.1),
      cookerProb: r.range(0.3, 0.8),
      kettleProb: r.range(0.4, 0.95),
      blanket: r.chance(0.25),
      fridgeKw: r.range(0.07, 0.14),
      standby: r.range(0.012, 0.04),
      visitProb: r.range(0.05, 0.35),              // 周末子女来访
      tripPerMonth: r.range(0, 0.9),               // 每月外出过夜次数
      reportProb: r.range(0.4, 0.9),               // 外出时家属/本人报备的概率
      sleepInProb: r.range(0.02, 0.06),            // 偶尔睡懒觉
      unit: null
    };
    p.persona = (early ? '早起型' : '晚起型') + (p.outingProb > 0.6 ? '·爱出门' : p.outingProb < 0.3 ? '·少出门' : '') + (p.tvLevel > 0.7 ? '·电视迷' : '');
    return p;
  }

  // ---------- 一天的计划 ----------
  // 返回本日的人为活动（相对全局分钟）与用水。manual=true 表示需要人去关（灯、电视、灶具）
  function planDay(p, d, r, mod) {
    mod = mod || {};
    var base = d * MPD;
    var dow = d % 7;                     // 约定 day0 为周一
    var weekend = dow >= 5;
    var acts = [], water = [];
    var drift = mod.drift || 0;          // 0..1 作息漂移程度
    function A(s, e, kw, kind, manual) { if (e > s) acts.push({ s: base + Math.round(s), e: base + Math.round(e), kw: kw, kind: kind, manual: !!manual }); }
    function W(s, e, lpm, kind) { if (e > s) water.push({ s: base + Math.round(s), e: base + Math.round(e), lpm: lpm, kind: kind }); }

    var wake = p.wakeMu + r.normal(0, p.wakeSd) + (weekend ? r.range(0, 20) : 0) + drift * 110;
    if (r.chance(p.sleepInProb)) wake += r.range(50, 120);
    var bed = p.bedMu + r.normal(0, p.bedSd) - drift * 20;
    var visit = weekend && r.chance(p.visitProb) && !drift;
    if (visit) bed += r.range(20, 70);
    var sunrise = 395, sunset = 1065;    // 秋季约 6:35 日出 / 17:45 日落

    var homeBlocks = [];                 // 在家清醒时间段，用来散布冲马桶等
    var outs = [];

    // 早晨
    var t = wake;
    if (t < sunrise) A(t, Math.min(sunrise + 10, t + r.range(25, 60)), p.lightKw, 'light', true);
    W(t + 2, t + 3, 6, 'toilet');
    W(t + 5, t + 7, 1.5, 'wash');
    var bf = t + r.range(12, 30);
    if (r.chance(p.kettleProb)) A(bf, bf + r.range(3, 5), 1.8, 'kettle', false);
    if (r.chance(0.3)) A(bf + 2, bf + r.range(30, 45), 0.6, 'cooker', false);
    else if (r.chance(0.4)) A(bf + 5, bf + 8, 1.0, 'microwave', false);
    W(bf + 10, bf + 12, 1, 'wash');
    if (r.chance(p.laundryProb)) { var lw = bf + r.range(20, 50); A(lw, lw + r.range(40, 55), 0.35, 'washer', false); W(lw, lw + 30, 1.7, 'washer'); }

    // 上午外出买菜
    var outP = p.outingProb * (1 - 0.85 * drift);
    if (visit) outP *= 0.4;
    var amStart = bf + r.range(45, 110);
    if (r.chance(outP)) {
      var amEnd = amStart + r.range(60, 160);
      outs.push([amStart, amEnd]);
      homeBlocks.push([wake + 10, amStart]);
      t = amEnd;
    } else { t = amStart; homeBlocks.push([wake + 10, amStart]); }
    // 上午在家看会儿电视
    if (r.chance(p.tvLevel * 0.5 + drift * 0.3)) { var tvs = t + r.range(10, 40); A(tvs, tvs + r.range(30, 100), p.tvKw, 'tv', true); }

    // 午饭
    var lunch = r.range(660, 720) + drift * 30;
    if (lunch < t + 10) lunch = t + 10;
    homeBlocks.push([t, lunch]);
    var stoveP = p.stoveProb * (1 - 0.6 * drift);
    if (r.chance(stoveP)) A(lunch, lunch + r.range(12, 26), p.stoveKw, 'stove', true);
    else if (r.chance(0.5)) A(lunch + 5, lunch + 8, 1.0, 'microwave', false);
    if (r.chance(p.cookerProb)) A(lunch - 35, lunch + 5, 0.7, 'cooker', false);
    W(lunch - 5, lunch + 2, 0.6, 'cook');
    W(lunch + 30, lunch + 34, 1, 'dish');
    t = lunch + 40;

    // 午睡
    if (r.chance(p.napProb + drift * 0.2)) { var nap = r.range(45, 100) * (1 + drift); homeBlocks.push([t, t + 5]); t += 5 + nap; }
    // 下午散步
    if (r.chance(p.walkProb * (1 - 0.8 * drift)) && !visit) { var ws = t + r.range(20, 80), we = ws + r.range(50, 120); homeBlocks.push([t, ws]); outs.push([ws, we]); t = we; }
    if (r.chance(p.tvLevel * 0.6)) { var ts = t + r.range(10, 50); A(ts, ts + r.range(40, 120), p.tvKw, 'tv', true); }

    // 晚饭
    var dinner = r.range(1035, 1110);
    if (dinner < t + 10) dinner = t + 10;
    homeBlocks.push([t, dinner]);
    if (r.chance(stoveP + (visit ? 0.3 : 0))) A(dinner, dinner + r.range(15, 30) * (visit ? 1.6 : 1), p.stoveKw, 'stove', true);
    else if (r.chance(0.6)) A(dinner + 3, dinner + 6, 1.0, 'microwave', false);
    if (r.chance(p.cookerProb) || visit) A(dinner - 40, dinner + 2, 0.7, 'cooker', false);
    W(dinner - 8, dinner, 0.6, 'cook');
    W(dinner + 35, dinner + 40, 1, 'dish');

    // 晚间照明与电视
    var lightStart = Math.min(sunset + r.range(-10, 20), dinner - 15);
    A(lightStart, bed - r.range(0, 8), p.lightKw * (visit ? 1.8 : 1), 'light', true);
    if (r.chance(p.tvLevel * 0.9 + 0.1)) { var es = dinner + r.range(40, 70); A(es, bed - r.range(10, 30), p.tvKw, 'tv', true); }
    // 洗澡
    if (r.chance(p.showerProb)) {
      var sh = r.range(1170, 1260); if (sh > bed - 30) sh = bed - 30 - r.range(0, 30);
      var dur = r.range(8, 14);
      W(sh, sh + dur, 6, 'shower');
      if (p.heater === 'electric') A(sh - r.range(5, 15), sh + dur + r.range(10, 25), 2.0, 'heater', false);
    }
    homeBlocks.push([dinner + 40, bed - 10]);
    W(bed - 8, bed - 6, 1.5, 'wash');
    W(bed - 4, bed - 3, 6, 'toilet');
    if (p.blanket) A(bed - 30, bed + 120, 0.06, 'blanket', false);

    // 白天冲马桶（只在家清醒时）
    for (var i = 0; i < homeBlocks.length; i++) {
      var b0 = homeBlocks[i][0], b1 = homeBlocks[i][1];
      var x = b0 + r.range(20, p.flushGap);
      while (x < b1) { W(x, x + 1, 6, 'toilet'); if (r.chance(0.5)) W(x + 1, x + 2, 1.5, 'wash'); x += r.range(p.flushGap * 0.6, p.flushGap * 1.5) * (1 + drift * 0.3); }
    }
    // 来访时多些用水与电器
    if (visit) { for (var v = 0; v < 4; v++) { var vx = r.range(wake + 120, bed - 30); W(vx, vx + 1, 6, 'toilet'); } A(r.range(800, 900), r.range(940, 1000), 0.12, 'tv', true); }

    // 夜里起夜（时间算在第二天凌晨）
    var lam = p.nightLam + (mod.nightExtra || 0) + drift * 1.2;
    var trips = r.poisson(lam) + (mod.nightExtra ? 3 : 0);   // 事件定义：每晚至少多起夜 3 次
    var nights = [];
    for (var n = 0; n < trips; n++) {
      var nt = r.range(bed + 50, MPD + p.wakeMu - 25);
      nights.push(nt);
      A(nt, nt + r.range(3, 8) * (mod.nightExtra ? 1.6 : 1), p.lightKw, 'light', true);
      W(nt + 2, nt + 3, 6, 'toilet');
    }

    return { acts: acts, water: water, wake: base + wake, bed: base + bed, outs: outs.map(function (o) { return [base + o[0], base + o[1]]; }), nights: nights.map(function (x) { return base + x; }), visit: visit };
  }

  // ---------- 模拟一户若干天 ----------
  // opts: { days, events:[{type, day, ...}], trips:[{start,len,reported}] , autoTrips:true }
  function simulateHousehold(p, opts) {
    var D = opts.days || 60;
    var r = rngOf(p.seed * 104729 + 3 + (opts.salt || 0));
    var acts = [], water = [];
    var plans = [];
    var events = (opts.events || []).map(function (e) { return Object.assign({}, e); });

    // 外出过夜（探亲/旅游）
    var trips = opts.trips ? opts.trips.slice() : [];
    if (opts.autoTrips !== false && !opts.trips) {
      var d0 = 3;
      while (d0 < D - 3) {
        var gap = Math.round(30 / Math.max(0.05, p.tripPerMonth) * r.range(0.5, 1.5));
        d0 += gap;
        if (d0 >= D - 3) break;
        var len = r.int(1, 4);
        trips.push({ start: d0, len: len, reported: r.chance(p.reportProb) });
        d0 += len + 2;
      }
    }
    // 事件所在的日子不安排外出
    trips = trips.filter(function (tr) {
      return !events.some(function (e) { var ed = e.day, el = (e.type === 'drift' ? 21 : e.type === 'night_restless' ? 4 : 3); return tr.start <= ed + el && tr.start + tr.len + 1 >= ed - 1; });
    });
    var awayDay = new Array(D).fill(0);  // 0 在家, 1 出发日, 2 整天不在, 3 返回日
    trips.forEach(function (tr) {
      for (var k = 0; k <= tr.len; k++) {
        var dd = tr.start + k; if (dd >= D) break;
        awayDay[dd] = k === 0 ? 1 : (k === tr.len ? 3 : 2);
      }
    });

    var evByDay = {};
    events.forEach(function (e) { evByDay[e.day] = evByDay[e.day] || []; evByDay[e.day].push(e); });
    var nightExtraDays = {}, driftDays = {};
    events.forEach(function (e) {
      if (e.type === 'night_restless') { for (var k = 0; k < 3; k++) nightExtraDays[e.day + k] = 4 + r.range(0, 2); }
      if (e.type === 'drift') { for (var k2 = 0; k2 < 21; k2++) driftDays[e.day + k2] = (k2 + 1) / 21; for (var k3 = 21; k3 < 40; k3++) driftDays[e.day + k3] = 1; }
    });

    var awayIntervals = [];
    for (var d = 0; d < D; d++) {
      var plan = planDay(p, d, r, { drift: driftDays[d] || 0, nightExtra: nightExtraDays[d] || 0 });
      var a = awayDay[d];
      if (a) {
        var base = d * MPD;
        var leave = a === 1 ? plan.wake + r.range(60, 150) : base;
        var back = a === 3 ? base + r.range(840, 1080) : base + MPD + 400;
        if (a === 2) back = (d + 1) * MPD + (awayDay[d + 1] ? 400 : 0);
        var tr = trips.filter(function (t) { return d >= t.start && d <= t.start + t.len; })[0];
        awayIntervals.push({ s: leave, e: back, reported: tr ? tr.reported : false, day: d });
        // 外出期间删除人为活动；出发前关掉所有手动电器
        plan.acts = plan.acts.filter(function (x) { return x.e <= leave || x.s >= back; }).map(function (x) {
          if (x.s < leave && x.e > leave && x.manual) return Object.assign({}, x, { e: leave });
          return x;
        });
        plan.water = plan.water.filter(function (x) { return x.e <= leave || x.s >= back; });
        if (a !== 3) plan.nights = [];
        plan.acts = plan.acts.filter(function (x) { return !(x.kind === 'light' && x.s > back - 1 && a === 2); });
      }
      plans.push(plan);
      Array.prototype.push.apply(acts, plan.acts);
      Array.prototype.push.apply(water, plan.water);
    }
    // 合并相邻外出段
    var awayMerged = [];
    awayIntervals.sort(function (x, y) { return x.s - y.s; }).forEach(function (iv) {
      var last = awayMerged[awayMerged.length - 1];
      if (last && iv.s <= last.e + 60) { last.e = Math.max(last.e, iv.e); }
      else awayMerged.push({ s: iv.s, e: iv.e, reported: iv.reported });
    });

    // ---------- 注入事件 ----------
    var truth = [];
    events.forEach(function (e) {
      var plan = plans[e.day]; if (!plan) return;
      var base = e.day * MPD;
      var onset, end, rescue, info = {};
      if (e.type === 'fall_day' || e.type === 'fall_night' || e.type === 'never_wake' || e.type === 'fall_bath') {
        if (e.type === 'fall_day') {
          // 在家清醒、不在外出途中的时刻
          for (var tries = 0; tries < 50; tries++) {
            onset = base + r.range(Math.max(plan.wake - base + 90, 540), 1230);
            if (!plan.outs.some(function (o) { return onset > o[0] - 10 && onset < o[1] + 10; })) break;
          }
        } else if (e.type === 'fall_night') {
          var nt = plan.nights.filter(function (x) { return x > plan.bed + 30; });
          if (!nt.length) { // 没有起夜就补一次
            var x = plan.bed + r.range(120, 300);
            acts.push({ s: Math.round(x), e: Math.round(x + 6), kw: p.lightKw, kind: 'light', manual: true });
            nt = [x];
          }
          onset = Math.round(nt[0] + 1);
        } else if (e.type === 'never_wake') {
          onset = Math.round(plan.bed + r.range(90, 300));
        } else { // fall_bath：选一个洗澡时刻，没有就补
          var sh = water.filter(function (w) { return w.kind === 'shower' && w.s >= base && w.s < base + MPD; })[0];
          if (!sh) {
            var s0 = base + Math.round(r.range(1170, 1230)); sh = { s: s0, e: s0 + 10, lpm: 6, kind: 'shower' }; water.push(sh);
            if (p.heater === 'electric') acts.push({ s: s0 - 8, e: s0 + 25, kw: 2.0, kind: 'heater', manual: false });
          }
          onset = sh.s + 3;
          info.water = true;
        }
        onset = Math.round(onset);
        rescue = onset + (e.hold || 26 * 60);    // 模拟中假定无人发现则持续约一天
        // 删除此后的人为活动；进行中的手动电器保持不关
        acts = acts.filter(function (x) { return !(x.s > onset && x.s < rescue); }).map(function (x) {
          if (x.s <= onset && x.e > onset && x.manual) { info.stuck = (info.stuck || []).concat(x.kind); return Object.assign({}, x, { e: rescue }); }
          return x;
        });
        water = water.filter(function (x) { return !(x.s > onset && x.s < rescue); }).map(function (x) {
          if (x.s <= onset && x.e > onset && e.type === 'fall_bath') return Object.assign({}, x, { e: onset + Math.round(r.range(120, 300)), lpm: x.lpm * 0.7 }); // 水一直流，直到热水器/阀门……
          return x;
        });
        if (e.type === 'fall_bath' && p.heater === 'electric') acts.push({ s: onset, e: onset + Math.round(r.range(90, 200)), kw: 2.0, kind: 'heater', manual: false });
        end = rescue;
      } else if (e.type === 'stove_on') {
        onset = base + Math.round(e.dinner ? r.range(1045, 1100) : r.range(670, 720));
        var dur = Math.round(r.range(150, 240));
        acts.push({ s: onset, e: onset + dur, kw: p.stoveKw, kind: 'stove_forgot', manual: true });
        end = onset + dur;
      } else if (e.type === 'tap_on') {
        onset = base + Math.round(r.range(500, 1200));
        var dur2 = Math.round(r.range(90, 180));
        water.push({ s: onset, e: onset + dur2, lpm: r.range(2, 4), kind: 'tap_forgot' });
        end = onset + dur2;
      } else if (e.type === 'night_restless') {
        onset = base + MPD; end = base + 4 * MPD + 360;
      } else if (e.type === 'drift') {
        onset = base; end = base + 21 * MPD;
      }
      truth.push({ type: e.type, day: e.day, onset: onset, end: end, info: info });
    });

    // ---------- 渲染为分钟功率与用水 ----------
    var M = D * MPD;
    var pw = new Float32Array(M), wa = new Float32Array(M);
    // 冰箱压缩机周期 + 待机
    var phase = Math.floor(r() * 40), on = r.range(12, 18), period = r.range(35, 50);
    for (var m = 0; m < M; m++) {
      var cyc = (m + phase) % period;
      pw[m] = p.standby + (cyc < on ? p.fridgeKw : 0.004) + r.normal(0, 0.002);
    }
    acts.forEach(function (x) { for (var mm = Math.max(0, x.s); mm < Math.min(M, x.e); mm++) pw[mm] += x.kw; });
    water.forEach(function (x) { for (var mm = Math.max(0, x.s); mm < Math.min(M, x.e); mm++) wa[mm] += x.lpm; });

    // 聚合为 15 分钟曲线
    var K = D * SPD;
    var P = new Float32Array(K), Wt = new Float32Array(K);
    for (var k = 0; k < K; k++) {
      var sp = 0, sw = 0;
      for (var j = 0; j < SLOT; j++) { sp += pw[k * SLOT + j]; sw += wa[k * SLOT + j]; }
      P[k] = Math.round(sp / SLOT * 1000) / 1000;
      Wt[k] = Math.round(sw * 10) / 10;
    }
    return {
      persona: p, days: D, P: P, W: Wt,
      truth: truth,
      away: awayMerged,
      plans: plans.map(function (pl) { return { wake: pl.wake, bed: pl.bed, outs: pl.outs, visit: pl.visit }; })
    };
  }

  return { SLOT: SLOT, SPD: SPD, MPD: MPD, rngOf: rngOf, makePersona: makePersona, simulateHousehold: simulateHousehold };
});
