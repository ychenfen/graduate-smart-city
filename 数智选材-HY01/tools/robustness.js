#!/usr/bin/env node
// 多种子稳定性与乐观偏差实验：对 6 个混合料案例分别用 12 个种子跑 point / validated 两种选优，
// 统计推荐方案一致率、选优可靠度与独立复验可靠度的差距（选优乐观偏差）。输出 paper/verification_v2/。
const fs = require('node:fs');
const path = require('node:path');
const E = require('../engine/engine.js');
const cases = require('../cases/cases.json').filter((c) => c.input.treatment !== 'CRACK');
const SEEDS = Array.from({ length: 12 }, (_, i) => 20261021 + 7919 * i);
const out = path.join(__dirname, '../paper/verification_v2');
fs.mkdirSync(out, { recursive: true });
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const mode = (a) => { const c = {}; a.forEach((x) => { c[x] = (c[x] || 0) + 1; }); return Object.entries(c).sort((x, y) => y[1] - x[1])[0]; };
const rows = [];
for (const c of cases) {
  const rec = { id: c.id, title: c.title, modes: {} };
  for (const selection of ['point', 'validated']) {
    const runs = SEEDS.map((seed) => E.recommend({ ...c.input, seed, selection }));
    const ids = runs.map((o) => o.recommended.id), [topId, topN] = mode(ids);
    const sel = runs.map((o) => o.recommended.reliability), val = runs.map((o) => o.recommended.validation.reliability);
    rec.modes[selection] = {
      seeds: SEEDS.length, distinctRecommendations: new Set(ids).size, modalAgreement: topN / SEEDS.length, modalLabel: runs.find((o) => o.recommended.id === topId).recommended.label,
      selectionReliabilityMean: +mean(sel).toFixed(3), validatedReliabilityMean: +mean(val).toFixed(3), validatedReliabilitySd: +sd(val).toFixed(3),
      optimismGapMean: +mean(runs.map((o) => o.recommended.validation.selectionGap)).toFixed(3),
      validatedMeetsTargetRate: runs.filter((o) => o.recommended.validation.meetsTargetPoint).length / SEEDS.length,
      targetReachedRate: runs.filter((o) => o.targetReached).length / SEEDS.length,
      euacMean: +mean(runs.map((o) => o.recommended.euac)).toFixed(2),
    };
  }
  rec.target = E.recommend(c.input).targetReliability;
  rows.push(rec);
  console.log(c.id, JSON.stringify(rec.modes.point), JSON.stringify(rec.modes.validated));
}
fs.writeFileSync(path.join(out, 'robustness.json'), JSON.stringify({ seeds: SEEDS, rows }, null, 2));
let md = '# 多种子稳定性与选优乐观偏差\n\n由 tools/robustness.js 生成；6 个混合料案例 × 12 个种子，每次 400 次选优抽样，复验为独立种子 4000 次抽样。全部为同一先验模型内的统计，不是工程验证。\n\n';
md += '|案例|目标|选优方式|同一推荐出现比例|选优可靠度均值|独立复验均值|复验标准差|乐观偏差均值|复验达标比例|年值成本均值|\n|---|---:|---|---:|---:|---:|---:|---:|---:|---:|\n';
for (const r of rows) for (const [k, m] of Object.entries(r.modes)) md += `|${r.id}|${r.target}|${k === 'point' ? '同批抽样(v1)' : '独立复算'}|${(m.modalAgreement * 100).toFixed(0)}%|${m.selectionReliabilityMean}|${m.validatedReliabilityMean}|${m.validatedReliabilitySd}|${m.optimismGapMean}|${(m.validatedMeetsTargetRate * 100).toFixed(0)}%|${m.euacMean}|\n`;
md += '\n读法：乐观偏差=选优时可靠度减独立复验可靠度，为正说明“在同一批抽样上挑最优”会高估。复验达标比例为 12 个种子中独立复验可靠度不低于目标的比例。\n';
fs.writeFileSync(path.join(out, 'robustness.md'), md);
