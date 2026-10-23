#!/usr/bin/env node
// 用法：node engine/cli.js <场景.json> [--brief]
//   场景文件可以是单个场景对象，也可以是 cases/cases.json 里的 {id,title,input} 数组
const fs = require('fs');
const E = require('./engine.js');

const file = process.argv[2];
if (!file) { console.error('用法: node engine/cli.js <场景.json> [--brief]'); process.exit(1); }
const brief = process.argv.includes('--brief');
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const list = Array.isArray(raw) ? raw : [{ id: 'S', title: '', input: raw.input || raw }];

for (const c of list) {
  const out = E.recommend(c.input);
  if (!brief) { console.log(JSON.stringify(Object.assign({ caseId: c.id }, out, { cloud: undefined }), null, 2)); continue; }
  console.log(`\n== ${c.id} ${c.title}  [${out.climate.zone} ${out.climate.zoneName || ''}]`);
  if (out.module === 'crack') { console.log('  ', out.method, '|', out.sealant.name, '|', out.reason); continue; }
  const r = out.recommended, b = out.baselines;
  console.log(`   需求 PG(98%): ${out.climate.pgRequired98}  候选 ${out.stats.feasible}/${out.stats.enumerated}  目标可靠度 ${out.targetReliability} 达成=${out.targetReached}  ${out.elapsedMs}ms`);
  console.log('   优先级(稀缺度):', out.priorities.slice(0, 4).map((p) => `${p.name}:${p.scarcity}`).join(' > '));
  const line = (t, x) => console.log(`   ${t.padEnd(6)} R=${x.reliability} 寿命${x.lifeMean}y 造价${x.costM2} 年均${x.euac} 碳${x.carbonYr}kg/m²·y 瓶颈:${x.bottleneckName}(${x.passRate[x.bottleneck]}) | ${x.label}`);
  line('推荐', r); line('经验', b.experience); line('加权', b.weightedSum); line('最省', b.cheapest);
  console.log('   工艺:', JSON.stringify(out.process));
  out.counterfactuals.slice(0, 4).forEach((cf) => console.log(`   反事实 ${cf.change}: ΔR=${cf.dRel.toFixed(3)} Δ年均=${cf.dEuac.toFixed(2)} ${cf.meets ? '仍达标' : '不达标·瓶颈 ' + E.IND_NAME[cf.bottleneck]}`));
}
