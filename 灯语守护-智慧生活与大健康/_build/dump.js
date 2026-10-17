// 导出画图用的数据（一户 40 天 + 夜间跌倒案例 + 白天正常日）
var Sim = require('../04_原型系统源码/simulator.js'), Eng = require('../04_原型系统源码/engine.js');
var fs = require('fs');
var seed = 1095; // 选一户
var p = Sim.makePersona(seed);
var sim = Sim.simulateHousehold(p, { days: 40, events: [{ type: 'fall_night', day: 36 }], trips: [] });
var mon = new Eng.Monitor({ P: sim.P, W: sim.W, away: sim.away, name: p.name });
var alerts = [];
for (var k = 0; k < 40 * 96; k++) alerts = alerts.concat(mon.step(k));
var m = Eng.learn(sim.P, sim.W, Array.from({ length: 28 }, (_, i) => i + 6));
var prof = Eng.profile(sim.P, sim.W, m, m.days);
var act = []; for (var d = 6; d < 34; d++) { var row = []; for (var s = 0; s < 96; s++) row.push(mon.isAct(d * 96 + s) ? (sim.W[d*96+s] > 1 ? 2 : 1) : (sim.P[d*96+s]-m.bg>m.sleepLevel.q90+m.sleepLevel.m+0.02?0.4:0)); act.push(row); }
fs.writeFileSync('data.json', JSON.stringify({
  persona: p, P: Array.from(sim.P), W: Array.from(sim.W), truth: sim.truth, plans: sim.plans,
  alerts: alerts.map(a => ({ k: a.k, level: a.level, type: a.type, title: a.title, why: a.why })),
  model: { bg: m.bg, delta: m.delta, silThr: m.silThr, wakeQ95: m.wake.q95, wakeList: m.wake.list, bedQ50: m.bed.q50 }, prof: prof, act: act
}));
console.log(p.name, p.age, p.persona, sim.truth, alerts.filter(a=>a.k>=36*96).map(a=>Eng.fmtSlot(a.k%96)+' '+a.title));
