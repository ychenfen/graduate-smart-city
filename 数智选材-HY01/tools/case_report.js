// 独立生成案例交接报告，不覆盖论文实验结果。
const fs = require('node:fs');
const path = require('node:path');
const E = require('../engine/engine.js');
const cases = require('../cases/cases.json');
const out = path.join(__dirname, '../paper/verification_20261022');
fs.mkdirSync(out, { recursive: true });
const results = cases.map(c => ({ ...c, output: E.recommend(c.input) }));
fs.writeFileSync(path.join(out, 'cases.json'), JSON.stringify(results, null, 2));
let md = '# 七案例推荐与验证报告\n\n本报告由 tools/case_report.js 生成。案例均为构造案例，城市气候为演示近似值，材料参数为待标定先验；可靠度是模型内蒙特卡洛通过比例，不是实际工程成功概率。成本、寿命和碳排为假设模型估算，不代表实测收益。经验基线由程序规则构造，不代表专家审定方案。\n\n';
for (const {id,title,background,input,output:o} of results) {
  md += `## ${id} ${title}\n\n${background}\n\n输入：\n\n\`\`\`json\n${JSON.stringify(input,null,2)}\n\`\`\`\n\n`;
  if(o.module === 'crack') { md += `规则输出：${o.method}；材料：${o.sealant.name}。依据：${o.reason}。${o.note}\n\n该案例为规则适用性演示，无实验对照和材料性能验证。\n\n`; continue; }
  if(o.module === 'infeasible') { md += `${o.reason}\n\n`; continue; }
  md += `推荐：${o.recommended.label}。候选数 ${o.stats.feasible}，目标比例 ${o.targetReliability}，${o.targetReached?'模型内达到目标':'模型内未达到目标，须人工复核'}。主要瓶颈：${o.recommended.bottleneckName}。95%抽样区间：${o.recommended.reliabilityInterval95.join('—')}（${o.recommended.samples}次抽样，不含模型与先验误差）。\n\n`;
  md += '|方法|模型内联合通过率|初始成本 元/m²|估计寿命 年|年值成本 元/(m²·年)|估计年均碳排 kgCO₂e/(m²·年)|\n|---|---:|---:|---:|---:|---:|\n';
  for(const [name,r] of [['推荐',o.recommended],['规则经验',o.baselines.experience],['加权评分',o.baselines.weightedSum],['最低初始成本',o.baselines.cheapest]]) md += `|${name}|${r.reliability}|${r.costM2}|${r.lifeMean}|${r.euac}|${r.carbonYr}|\n`;
  md += '\n候选替代：'+o.alternatives.map(r=>r.label).join('；')+'。\n\n';
  md += '推荐依据：'+o.requirements.map(r=>r.why).join('；')+'。\n\n';
  md += '对照限制：所有方法使用同一先验评价器；该比较只能检验决策逻辑，不能用于证明预测精度或工程优越性。经验基线可能不满足候选规则，实施前必须单独复核。\n\n';
}
fs.writeFileSync(path.join(out, '案例验证报告.md'), md);
console.log(`generated ${results.length} cases in ${out}`);
