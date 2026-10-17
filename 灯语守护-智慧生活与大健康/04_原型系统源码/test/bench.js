/*
 * 评测公共代码：生成测试住户、运行引擎、按真值事件统计召回、延迟与误报。
 * 开发集：种子 1–40（用于调参）；留出测试集：种子 1001–1100（参数定稿后才运行）。
 */
'use strict';
var Sim = require('../simulator.js');
var Eng = require('../engine.js');

var DAYS = 90, WARM = 28;
var DANGER = ['fall_day', 'fall_night', 'never_wake', 'fall_bath', 'stove_on', 'tap_on'];
var CARE = ['night_restless', 'drift'];
var TYPES = DANGER.concat(CARE);
var NAMES = {
  fall_day: '白天在家跌倒/突发失能', fall_night: '夜间起夜跌倒', never_wake: '睡梦中突发疾病（未起床）', fall_bath: '洗澡时跌倒',
  stove_on: '电磁炉忘关', tap_on: '水龙头忘关', night_restless: '连续夜间频繁起夜', drift: '作息持续偏离'
};
// 每类事件允许的检测窗口（分钟）
var WINDOW = { fall_day: 720, fall_night: 720, never_wake: 720, fall_bath: 720, stove_on: null, tap_on: null, night_restless: null, drift: 28 * 1440 };

function scheduleFor(seed) {
  var r = Sim.rngOf(seed * 31 + 5);
  var order = [];
  // 轮转分配，保证各类事件数量大致均衡
  var t1 = TYPES[(seed * 3) % TYPES.length];
  if (t1 === 'drift') return [{ type: 'drift', day: r.int(34, 46) }];
  var t2 = DANGER[(seed * 5 + 1) % DANGER.length];
  var ev = [{ type: t1, day: r.int(33, 52), dinner: r.chance(0.5) }, { type: t2, day: r.int(62, 82), dinner: r.chance(0.5) }];
  return ev;
}

function buildHouse(seed, opt) {
  opt = opt || {};
  var p = Sim.makePersona(seed);
  var sim = Sim.simulateHousehold(p, { days: DAYS, events: scheduleFor(seed) });
  if (opt.noWater) sim.W = new Float32Array(sim.W.length);
  if (opt.missRate) { // 模拟采集失败：缺失时段按上一时段补齐、用水记 0
    var r = Sim.rngOf(seed * 13 + 7);
    for (var k = 1; k < sim.P.length; k++) if (r() < opt.missRate) { sim.P[k] = sim.P[k - 1]; sim.W[k] = 0; }
  }
  return sim;
}

// 已确认异常日：不进入基线
function excludeDays(sim) {
  var ex = {};
  sim.truth.forEach(function (t) {
    var d0 = Math.floor(t.onset / 1440), d1 = Math.floor(t.end / 1440);
    if (t.type === 'drift') return;           // 作息漂移是渐变的，系统无法事先知道，照常进入基线
    for (var d = d0; d <= d1 + 1; d++) ex[d] = 1;
  });
  return ex;
}

// 自动外呼的模拟假设：真正出事（跌倒/失能）时老人无法接听；
// 平安在家时 85% 能接听并按键报平安；外出未报备时 90% 能接听。
var CALL = { atHome: 0.85, away: 0.9 };
function confirmFor(sim) {
  var r = Sim.rngOf(sim.persona.seed * 977 + 11);
  return function (mon, k, alert) {
    var t = k * 15;
    var hurt = sim.truth.some(function (tr) { return /fall|never_wake/.test(tr.type) && t >= tr.onset && t <= tr.end; });
    if (hurt) return false;
    var away = sim.away.some(function (a) { return t >= a.s && t <= a.e; });
    return r() < (away ? CALL.away : CALL.atHome);
  };
}

function runOurs(sim, engOpt) {
  engOpt = Object.assign({}, engOpt || {});
  if (engOpt.noCall) delete engOpt.confirm; else engOpt.confirm = confirmFor(sim);
  var mon = new Eng.Monitor({ P: sim.P, W: sim.W, away: sim.away, name: sim.persona.name }, engOpt);
  var ex = excludeDays(sim);
  // 逐日推进，并在事件确认后把该日排除出基线
  var alerts = [];
  var K = sim.days * Eng.SPD;
  for (var k = 0; k < K; k++) {
    var d = Math.floor(k / Eng.SPD);
    if (k % Eng.SPD === 0) { for (var dd in ex) if (+dd < d) mon.exclude[dd] = 1; }
    var o = mon.step(k);
    for (var i = 0; i < o.length; i++) alerts.push(o[i]);
  }
  return alerts;
}

// 参照现有电力看护平台常见做法构造的固定阈值规则（团队复现，仅用电、按小时）
function runRule(sim) {
  var H = sim.days * 24, E = new Float32Array(H);
  for (var h = 0; h < H; h++) { var s = 0; for (var j = 0; j < 4; j++) s += sim.P[h * 4 + j]; E[h] = s / 4; }
  var alerts = [], quiet = 0, quietAlert = false, hp = 0;
  var daily = [];
  for (var h2 = 1; h2 < H; h2++) {
    var act = Math.abs(E[h2] - E[h2 - 1]) > 0.05;
    if (act) { quiet = 0; quietAlert = false; } else quiet++;
    if (quiet >= 12 && !quietAlert) { quietAlert = true; alerts.push({ k: h2 * 4 + 3, t: (h2 + 1) * 60, level: 'red', type: 'silence' }); }
    if (E[h2] > 1.0) hp++; else hp = 0;
    if (hp === 2) alerts.push({ k: h2 * 4 + 3, t: (h2 + 1) * 60, level: 'red', type: 'high_power' });
    if (h2 % 24 === 23) {
      var d = Math.floor(h2 / 24), kwh = 0; for (var x = d * 24; x < d * 24 + 24; x++) kwh += E[x];
      if (daily.length >= 14) {
        var ref = daily.slice(-30), m = ref.reduce(function (a, b) { return a + b; }, 0) / ref.length;
        if (kwh < 0.4 * m) alerts.push({ k: (d + 1) * 96, t: (d + 1) * 1440, level: 'yellow', type: 'low_daily' });
      }
      daily.push(kwh);
    }
  }
  return alerts;
}

function evaluate(seeds, opt) {
  opt = opt || {};
  var per = {}; TYPES.forEach(function (t) { per[t] = { n: 0, hit: 0, hitRed: 0, delays: [], redDelays: [] }; });
  var fa = { red: 0, yellow: 0, blue: 0, redAwayUnreported: 0, yellowAwayUnreported: 0 };
  var testDaysTotal = 0, alertsTotal = 0, steps = 0, ms = 0;
  var examples = [];
  seeds.forEach(function (seed) {
    var sim = buildHouse(seed, opt);
    var t0 = Date.now();
    var alerts = opt.rule ? runRule(sim) : runOurs(sim, opt.engine);
    ms += Date.now() - t0; steps += sim.days * 96;
    var testStart = WARM * 1440;
    alerts = alerts.filter(function (a) { return a.t >= testStart; });
    alertsTotal += alerts.length;
    // 排除窗口（事件期间及其后一天）
    var used = new Array(alerts.length).fill(false);
    sim.truth.forEach(function (tr) {
      var st = per[tr.type]; st.n++;
      var wEnd = WINDOW[tr.type] ? tr.onset + WINDOW[tr.type] : tr.end;
      if (tr.type === 'night_restless') wEnd = tr.end;
      var relevant = function (a) {
        if (tr.type === 'stove_on') return a.type === 'high_power';
        if (tr.type === 'tap_on') return a.type === 'water_run';
        if (tr.type === 'night_restless') return a.type === 'night_restless' && a.level !== 'blue';
        if (tr.type === 'drift') return a.type === 'drift' || (opt.rule && a.type === 'low_daily');
        return a.level === 'red' || a.level === 'yellow';
      };
      var first = null, firstRed = null;
      alerts.forEach(function (a, i) {
        var inExcl = a.t >= tr.onset - 30 && a.t <= (tr.type === 'drift' ? tr.onset + 28 * 1440 : tr.end + 1440);
        if (!inExcl) return;
        if (tr.type === 'drift') { if (a.type === 'drift' || a.type === 'low_daily') used[i] = true; }
        else used[i] = true;
        if (a.t <= wEnd && a.t >= tr.onset - 30 && relevant(a)) {
          if (!first) first = a;
          if (!firstRed && a.level === 'red') firstRed = a;
        }
      });
      if (first && tr.type === 'never_wake') { st.afterWake = st.afterWake || []; var pw = sim.plans[tr.day + 1] ? sim.plans[tr.day + 1].wake : tr.onset; st.afterWake.push((first.t - pw) / 60); }
      if (first && tr.type === 'fall_night') { st.afterWake = st.afterWake || []; var pw2 = sim.plans[tr.day + 1] ? sim.plans[tr.day + 1].wake : tr.onset; st.afterWake.push((first.t - pw2) / 60); }
      if (first) { st.hit++; st.delays.push((first.t - tr.onset) / 60); if (examples.length < 400) examples.push({ seed: seed, type: tr.type, delayH: +((first.t - tr.onset) / 60).toFixed(2), title: first.title || first.type, level: first.level }); }
      if (firstRed) { st.hitRed++; st.redDelays.push((firstRed.t - tr.onset) / 60); }
    });
    // 误报
    var unrep = sim.away.filter(function (a) { return !a.reported; });
    alerts.forEach(function (a, i) {
      if (used[i]) return;
      var inUnrep = unrep.some(function (u) { return a.t >= u.s && a.t <= u.e + 240; });
      fa[a.level]++;
      if (inUnrep && a.level === 'red') fa.redAwayUnreported++;
      if (inUnrep && a.level === 'yellow') fa.yellowAwayUnreported++;
    });
    testDaysTotal += sim.days - WARM;
  });
  var months = testDaysTotal / 30;
  function med(a) { return a.length ? Eng.quantile(a, 0.5) : null; }
  var res = { households: seeds.length, testDays: testDaysTotal, perType: {}, fa: {}, avgStepMs: ms / steps };
  var dn = 0, dh = 0, dr = 0, cn = 0, ch = 0, allDelay = [], allRedDelay = [];
  TYPES.forEach(function (t) {
    var s = per[t];
    res.perType[t] = { name: NAMES[t], n: s.n, recall: s.n ? s.hit / s.n : null, recallRed: s.n ? s.hitRed / s.n : null, medianDelayH: med(s.delays), p90DelayH: s.delays.length ? Eng.quantile(s.delays, 0.9) : null, medianRedDelayH: med(s.redDelays), medianAfterUsualWakeH: s.afterWake ? med(s.afterWake) : undefined };
    if (DANGER.indexOf(t) >= 0) { dn += s.n; dh += s.hit; dr += s.hitRed; allDelay = allDelay.concat(s.delays); allRedDelay = allRedDelay.concat(s.redDelays); }
    else { cn += s.n; ch += s.hit; }
  });
  res.danger = { n: dn, recall: dh / dn, recallRed: dr / dn, medianDelayH: med(allDelay), p90DelayH: allDelay.length ? Eng.quantile(allDelay, 0.9) : null, medianRedDelayH: med(allRedDelay) };
  res.care = { n: cn, recall: cn ? ch / cn : null };
  res.fa = {
    redPerHouseMonth: fa.red / months, yellowPerHouseMonth: fa.yellow / months, bluePerHouseMonth: fa.blue / months,
    redCount: fa.red, yellowCount: fa.yellow, blueCount: fa.blue,
    redOnUnreportedAway: fa.redAwayUnreported, yellowOnUnreportedAway: fa.yellowAwayUnreported
  };
  res.examples = examples;
  return res;
}

module.exports = { CALL: CALL, evaluate: evaluate, buildHouse: buildHouse, runOurs: runOurs, scheduleFor: scheduleFor, NAMES: NAMES, DAYS: DAYS, WARM: WARM };
