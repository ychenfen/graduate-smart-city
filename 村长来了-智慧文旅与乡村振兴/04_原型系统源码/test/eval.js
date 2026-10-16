/*
 * 原型问答测试：node test/eval.js [输出 JSON 路径]
 * 指标：Top-1 准确率、Top-3 召回率、拒答精确率/召回率、多轮追问准确率、单次检索时延
 */
const path = require("path");
const { KB, createEngine } = require(path.join(__dirname, "..", "engine.js"));
const DEV = require(path.join(__dirname, "testset.js"));
const HOLD = require(path.join(__dirname, "testset_holdout.js"));
let T = DEV;

function run(threshold) {
  const eng = createEngine(JSON.parse(JSON.stringify(KB)), { threshold });
  let top1 = 0, top3 = 0, wrongRefuse = 0;
  const fails = [];
  for (const [q, id] of T.inScope) {
    const r = eng.ask(q);
    if (r.hit && r.hit.id === id) top1++;
    else fails.push({ q, expect: id, got: r.hit ? r.hit.id : "拒答", conf: +r.conf.toFixed(2) });
    if (r.top.some(x => x.id === id)) top3++;
    if (!r.hit) wrongRefuse++;
  }
  let refused = 0; const leaks = [];
  for (const q of T.outOfScope) {
    const r = eng.ask(q);
    if (!r.hit) refused++; else leaks.push({ q, got: r.hit.id, conf: +r.conf.toFixed(2) });
  }
  let follow = 0; const followFails = [];
  for (const [q1, q2, id] of T.followUp) {
    const r1 = eng.ask(q1);
    const r2 = eng.ask(q2, { lastSpot: r1.hit && r1.hit.spot });
    if (r2.hit && r2.hit.id === id) follow++; else followFails.push({ q1, q2, expect: id, got: r2.hit ? r2.hit.id : "拒答" });
  }
  const nIn = T.inScope.length, nOut = T.outOfScope.length;
  const tp = refused, fp = wrongRefuse; // 拒答视为“正类”
  return {
    threshold, nKB: KB.length, nIn, nOut, nFollow: T.followUp.length,
    top1: top1 / nIn, top3: top3 / nIn,
    refuseRecall: refused / nOut, refusePrecision: tp + fp ? tp / (tp + fp) : 1,
    followAcc: follow / T.followUp.length,
    overallAcc: (top1 + refused) / (nIn + nOut),
    fails, leaks, followFails,
  };
}

function latency() {
  const eng = createEngine(JSON.parse(JSON.stringify(KB)));
  const qs = [...HOLD.inScope.map(x => x[0]), ...HOLD.outOfScope];
  for (let i = 0; i < 200; i++) eng.ask(qs[i % qs.length]); // 预热
  const ts = [];
  for (let k = 0; k < 20; k++) for (const q of qs) {
    const t0 = process.hrtime.bigint(); eng.ask(q); ts.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  ts.sort((a, b) => a - b);
  return { n: ts.length, mean: ts.reduce((a, b) => a + b, 0) / ts.length, p50: ts[Math.floor(ts.length * .5)], p95: ts[Math.floor(ts.length * .95)], max: ts[ts.length - 1] };
}

const thr = createEngine([]).opt.threshold;
T = DEV; const dev = run(thr);
// 阈值扫描只在开发集上做，用于选择阈值
const sweep = [0.2, 0.25, 0.3, 0.35, 0.4, 0.42, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7].map(t => {
  const r = run(t); return { t, top1: r.top1, refuseRecall: r.refuseRecall, overall: r.overallAcc };
});
T = HOLD; const main = run(thr);
const out = { date: new Date().toISOString().slice(0, 10), node: process.version, threshold: thr, dev, main, sweep, latency: latency() };
const pct = x => (x * 100).toFixed(1) + "%";
console.log(`[开发集] Top-1 ${pct(dev.top1)}  拒答召回 ${pct(dev.refuseRecall)}  追问 ${pct(dev.followAcc)}`);
console.log("[留出测试集]");
console.log(`知识条目 ${main.nKB} | 测试 ${main.nIn} 条域内 + ${main.nOut} 条域外 + ${main.nFollow} 组追问`);
console.log(`Top-1 ${pct(main.top1)}  Top-3 ${pct(main.top3)}  拒答召回 ${pct(main.refuseRecall)}  拒答精确 ${pct(main.refusePrecision)}  追问 ${pct(main.followAcc)}  总体 ${pct(main.overallAcc)}`);
console.log(`时延 均值 ${out.latency.mean.toFixed(3)} ms  P95 ${out.latency.p95.toFixed(3)} ms`);
if (process.argv[2]) require("fs").writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
if (process.env.VERBOSE) console.log(JSON.stringify({ fails: main.fails, leaks: main.leaks, followFails: main.followFails }, null, 1));
