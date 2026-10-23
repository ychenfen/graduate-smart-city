// node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const E = require('../engine/engine.js');
const cases = require('../cases/cases.json');

const byCase = (id) => cases.find((c) => c.id === id).input;

test('预算不可行时拒绝推荐，包括零预算', () => {
  for (const budgetPerM2 of [0, 0.01]) {
    const out = E.recommend({ ...byCase('C6'), budgetPerM2 });
    assert.strictEqual(out.module, 'infeasible');
    assert.strictEqual(out.recommended, null);
    assert.strictEqual(out.targetReached, false);
    assert.strictEqual(out.stats.budgetCut, out.stats.feasible);
  }
});

test('低温导致全部候选被剪枝时返回明确的不可行结果', () => {
  const out = E.recommend({ ...byCase('C1'), ambientT: -40 });
  assert.strictEqual(out.module, 'infeasible');
  assert.strictEqual(out.stats.feasible, 0);
});

test('非法采样数、可靠度和预算在计算前被拒绝', () => {
  for (const patch of [{samples: 0}, {samples: 1.5}, {samples: 10001}, {targetReliability: 2}, {budgetPerM2: -1}]) {
    assert.throws(() => E.recommend({ ...byCase('C1'), ...patch }));
  }
});

test('气候分区：哈尔滨 2-1-2、武汉 1-3-1、洋浦 1-4-1', () => {
  assert.strictEqual(E.climateOf({ cityId: 'harbin' }).zone.code, '2-1-2');
  assert.strictEqual(E.climateOf({ cityId: 'wuhan' }).zone.code, '1-3-1');
  assert.strictEqual(E.climateOf({ cityId: 'yangpu' }).zone.code, '1-4-1');
});

test('LTPPBind 路面高温换算落在合理区间', () => {
  const c = E.climateOf({ cityId: 'yangpu' });
  assert.ok(c.pavHighMean > 55 && c.pavHighMean < 62, String(c.pavHighMean));
  assert.ok(c.pavHigh98 > c.pavHighMean);
  assert.ok(E.climateOf({ cityId: 'harbin' }).pavLow98 < -28);
});

test('PG 取整到标准等级', () => {
  assert.strictEqual(E.pgGradeHigh(61.2), 64);
  assert.strictEqual(E.pgGradeHigh(64), 64);
  assert.strictEqual(E.pgGradeLow(-23), -28);
  assert.strictEqual(E.pgGradeLow(5), -10);
});

test('SBS 剂量单调：剂量↑ → 高温分级↑、低温分级↓、动稳定度↑', () => {
  const a = E.resolveBinder('SBS70_3'), b = E.resolveBinder('SBS70_5');
  assert.ok(b.trueHigh > a.trueHigh && b.trueLow < a.trueLow && b.price > a.price);
});

test('规则剪枝：SMA 不用基质沥青，严寒区不出现 OGFC', () => {
  const scn = E.normalizeScenario(byCase('C2'));
  const { candidates, rejected } = E.enumerate(scn, E.climateOf(scn));
  assert.ok(!candidates.some((c) => c.grad.type === 'sma' && !c.binder.modified));
  assert.ok(!candidates.some((c) => c.grad.type === 'ogfc'));
  assert.ok(Object.keys(rejected).some((k) => k.startsWith('R07')), '9°C 施工应剔除热拌改性方案');
});

test('酸性石料 + 重交通 必须带抗剥落措施', () => {
  const scn = E.normalizeScenario(byCase('C1'));
  const { candidates } = E.enumerate(scn, E.climateOf(scn));
  assert.ok(candidates.length > 0 && candidates.every((c) => c.water.id !== 'none'));
});

test('同一种子结果确定', () => {
  const a = E.recommend(byCase('C3')), b = E.recommend(byCase('C3'));
  assert.strictEqual(a.recommended.id, b.recommended.id);
  assert.strictEqual(a.recommended.reliability, b.recommended.reliability);
});

test('达成目标时推荐方案可靠度不低于目标，且年均成本在达标集合中最低', () => {
  for (const id of ['C1', 'C3', 'C4', 'C6']) {
    const out = E.recommend(byCase(id));
    assert.ok(out.targetReached, id);
    assert.ok(out.recommended.reliability >= out.targetReliability, id);
    const cheaperOk = out.cloud.filter((r) => r[0] >= out.targetReliability && r[1] < out.recommended.euac - 1e-6);
    assert.strictEqual(cheaperOk.length, 0, id);
  }
});

test('Pareto 前沿内部互不支配', () => {
  const p = E.recommend(byCase('C5')).pareto;
  for (const a of p) for (const b of p) {
    if (a === b) continue;
    const dom = b.reliability >= a.reliability && b.euac <= a.euac && b.carbonYr <= a.carbonYr &&
      (b.reliability > a.reliability || b.euac < a.euac || b.carbonYr < a.carbonYr);
    assert.ok(!dom, `${b.id} 支配 ${a.id}`);
  }
});

test('预算约束生效', () => {
  const out = E.recommend(byCase('C6'));
  assert.ok(out.recommended.costM2 <= 52 + 1e-9);
  assert.ok(out.stats.budgetCut > 0);
});

test('施工更冷 → 可靠度不升', () => {
  const out = E.recommend(byCase('C2'));
  assert.ok(out.process.robustness.colder8 <= 0);
});

test('反馈学习：观测偏低 → 后验均值为负且方差收缩', () => {
  const obs = Array.from({ length: 8 }, () => ({ binderFamily: 'sbs', gradType: 'dense', indicator: 'tsr', ratio: 0.88 }));
  const st = E.updateBias({}, obs);
  const k = st['sbs|dense|tsr'];
  assert.ok(k.mean < 0 && k.mean > Math.log(0.88));
  assert.ok(k.var < 0.15 * 0.15);
  assert.strictEqual(k.n, 8);
});

test('反馈后同场景的水稳定性通过率下降', () => {
  const inp = byCase('C6');
  const before = E.recommend(inp);
  const st = E.updateBias({}, Array.from({ length: 10 }, () => ({ binderFamily: 'sbs', gradType: 'dense', indicator: 'tsr', ratio: 0.85 })));
  const after = E.recommend(inp, { biasState: st });
  const pr = (o, id) => { const r = o.cloud.find((x) => x[3] === id); return r && r[0]; };
  assert.ok(pr(after, before.recommended.id) < pr(before, before.recommended.id));
});

test('裂缝处治：哈尔滨选寒冷型灌缝胶', () => {
  const out = E.recommend(byCase('C7'));
  assert.strictEqual(out.module, 'crack');
  assert.strictEqual(out.sealant.id, 'S_COLD');
});

test('场景标签与相似度', () => {
  const a = E.tagScenario(byCase('C2')), b = E.tagScenario(byCase('C7')), c = E.tagScenario(byCase('C1'));
  assert.ok(E.similarity(a, b) > E.similarity(a, c));
});

test('抽样区间包含未舍入通过比例且样本量增加后收窄', () => {
  const a = E.recommend({ ...byCase('C3'), samples: 100 }).recommended;
  const b = E.recommend({ ...byCase('C3'), samples: 1600 }).recommended;
  assert.ok(a.reliabilityInterval95[0] <= a.reliability && a.reliabilityInterval95[1] >= a.reliability);
  assert.ok(b.reliabilityInterval95[1]-b.reliabilityInterval95[0] < a.reliabilityInterval95[1]-a.reliabilityInterval95[0]);
});

test('无效场景和反馈不会污染计算', () => {
  for (const patch of [{ traffic:'unknown' }, { haulMin:-1 }, { crackWidthMm:0 }, { climate:{} }, { distresses:[{id:'rutting',severity:4}] }]) assert.throws(()=>E.recommend({...byCase('C1'),...patch}));
  for (const ratio of [0,-1,NaN,Infinity]) assert.throws(()=>E.updateBias({},[{binderFamily:'sbs',gradType:'dense',indicator:'tsr',ratio}]));
  assert.throws(()=>E.updateBias({'sbs|dense|tsr':{mean:0,var:0,n:1}},[{binderFamily:'sbs',gradType:'dense',indicator:'tsr',ratio:1}]));
});
