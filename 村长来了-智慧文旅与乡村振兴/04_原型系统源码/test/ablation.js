/* 消融实验：在留出测试集上分别关闭“口语归一”和“覆盖度置信度”，各自重新选阈值（在开发集上取总体正确率最高者） */
const path = require("path");
const { KB, createEngine } = require(path.join(__dirname, "..", "engine.js"));
const DEV = require("./testset.js"), HOLD = require("./testset_holdout.js");
function evalSet(T, o) {
  const e = createEngine(JSON.parse(JSON.stringify(KB)), o);
  let t1 = 0, rf = 0;
  for (const [q, id] of T.inScope) { const r = e.ask(q); if (r.hit && r.hit.id === id) t1++; }
  for (const q of T.outOfScope) if (!e.ask(q).hit) rf++;
  return { top1: t1 / T.inScope.length, refuse: rf / T.outOfScope.length, overall: (t1 + rf) / (T.inScope.length + T.outOfScope.length) };
}
const variants = [
  ["完整方案", {}], ["去掉口语归一", { synonyms: false }], ["去掉覆盖度置信度", { coverage: false }], ["两者都去掉", { synonyms: false, coverage: false }],
];
const out = variants.map(([name, o]) => {
  let best = null;
  for (let t = 0.2; t <= 0.8001; t += 0.05) { const r = evalSet(DEV, { ...o, threshold: +t.toFixed(2) }); if (!best || r.overall > best.r.overall) best = { t: +t.toFixed(2), r }; }
  if (name === "完整方案") best.t = createEngine([]).opt.threshold;
  return { name, threshold: best.t, ...evalSet(HOLD, { ...o, threshold: best.t }) };
});
out.forEach(x => console.log(x.name.padEnd(10), "阈值", x.threshold, "Top-1", (x.top1 * 100).toFixed(1), "拒答", (x.refuse * 100).toFixed(1), "总体", (x.overall * 100).toFixed(1)));
if (process.argv[2]) require("fs").writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
