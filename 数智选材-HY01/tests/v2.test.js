const test = require('node:test');
const assert = require('node:assert');
const E = require('../engine/engine.js');
const G = require('../engine/graph.js');
const V = require('../engine/validate.js');
const cases = require('../cases/cases.json');
const v1 = require('./fixtures/v1_core.json');
const input = (id) => cases.find((c) => c.id === id).input;
const pick = (p) => ({ id: p.id, reliability: p.reliability, euac: p.euac, costM2: p.costM2, lifeMean: p.lifeMean, carbonYr: p.carbonYr });

test('v2 默认选优与 v1 冻结结果逐项一致（PPT/视频/文档中的数值仍然有效）', () => {
  for (const c of cases) {
    const o = E.recommend(c.input), f = v1[c.id];
    if (f.module === 'crack') { assert.strictEqual(o.sealant.id, f.sealant); assert.strictEqual(o.method, f.method); continue; }
    assert.deepStrictEqual(pick(o.recommended), f.recommended, c.id);
    assert.deepStrictEqual(pick(o.baselines.experience), f.experience, c.id);
    assert.deepStrictEqual(pick(o.baselines.weightedSum), f.weightedSum, c.id);
    assert.deepStrictEqual(pick(o.baselines.cheapest), f.cheapest, c.id);
    assert.deepStrictEqual(o.pareto.map((p) => p.id), f.pareto, c.id);
    assert.strictEqual(o.targetReached, f.targetReached, c.id);
    assert.strictEqual(o.stats.feasible, f.feasible, c.id);
  }
});

test('独立复验：种子独立、4000 次、结果确定，且字段自洽', () => {
  const a = E.recommend(input('C1')), b = E.recommend(input('C1'));
  const v = a.recommended.validation;
  assert.strictEqual(v.samples, 4000); assert.strictEqual(v.independent, true);
  assert.deepStrictEqual(v, b.recommended.validation);
  assert.ok(v.reliabilityInterval95[0] <= v.reliability && v.reliability <= v.reliabilityInterval95[1]);
  assert.ok(Math.abs(v.selectionGap - (a.recommended.reliability - v.reliability)) < 1e-3);
  assert.strictEqual(v.meetsTargetPoint, v.reliability >= a.targetReliability);
  assert.notStrictEqual(v.seed, a.scenario.seed);
  assert.ok(a.baselines.experience.validation);
});

test('稳健选优：复验通过则最终独立复验也应接近目标，且结果确定', () => {
  const a = E.recommend({ ...input('C1'), selection: 'validated' }), b = E.recommend({ ...input('C1'), selection: 'validated' });
  assert.strictEqual(a.recommended.id, b.recommended.id);
  assert.strictEqual(a.selection.mode, 'validated'); assert.ok(a.selection.validatedCandidates >= 1);
  assert.ok(a.recommended.validation.reliability >= a.targetReliability - 0.03, String(a.recommended.validation.reliability));
  const p = E.recommend(input('C1'));
  assert.ok(a.recommended.validation.reliability >= p.recommended.validation.reliability);
  assert.throws(() => E.recommend({ ...input('C1'), selection: 'x' }));
});

test('Shapley 归因满足效率性：各维贡献之和等于参考配方到所选配方的总变化', () => {
  for (const id of ['C1', 'C3', 'C4']) {
    const o = E.recommend(input(id));
    for (const x of o.explain.indicators) {
      const sum = x.contributions.reduce((a, c) => a + c.value, 0);
      assert.ok(Math.abs(sum - x.total) < 2e-3, `${id} ${x.ind} sum=${sum} total=${x.total}`);
    }
    const ds = o.explain.indicators.find((x) => x.ind === 'ds');
    const prod = ds.contributions.reduce((a, c) => a * c.factor, 1);
    assert.ok(Math.abs(Math.log(prod) - ds.total) < 5e-3);
    assert.strictEqual(o.explain.reference.id, 'AC13/B70/none/none/none/R0/none');
  }
});

test('Shapley：抗车辙剂对动稳定度的乘性贡献恰为字典值 1.6', () => {
  const o = E.recommend(input('C1'));
  const ds = o.explain.indicators.find((x) => x.ind === 'ds');
  assert.strictEqual(ds.contributions.find((c) => c.dim === 'rut').factor, 1.6);
});

test('碳排上限：约束生效、统计剔除数、极小上限给出无解', () => {
  const base = E.recommend(input('C1'));
  const cap = base.recommended.carbonYr * 0.9;
  const o = E.recommend({ ...input('C1'), carbonCapYr: cap });
  if (o.module === 'infeasible') assert.ok(o.stats.carbonCut > 0);
  else { assert.ok(o.recommended.carbonYr <= cap + 1e-9); assert.ok(o.stats.carbonCut > 0); }
  const none = E.recommend({ ...input('C1'), carbonCapYr: 0.01 });
  assert.strictEqual(none.module, 'infeasible'); assert.strictEqual(none.stats.carbonCut, none.stats.feasible);
  assert.ok(none.reason.includes('碳排'));
  assert.throws(() => E.recommend({ ...input('C1'), carbonCapYr: -1 }));
  assert.throws(() => E.recommend({ ...input('C1'), seed: 1.5 }));
});

test('雷达数据：6 轴、取值在 0–1、含推荐与经验基线且 id 不重复', () => {
  const o = E.recommend(input('C4'));
  assert.strictEqual(o.radar.axes.length, 6);
  const ids = o.radar.series.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.strictEqual(o.radar.series[0].role, 'recommended');
  assert.ok(o.radar.series.some((s) => s.role === 'experience') || ids.includes(o.baselines.experience.id));
  for (const s of o.radar.series) { assert.strictEqual(s.values.length, 6); assert.ok(s.values.every((x) => x >= 0 && x <= 1)); }
});

test('规则目录与引擎实际产生的剔除原因一致（无漂移）', () => {
  const texts = new Set(E.RULES.map((r) => r.text));
  for (const id of ['C1', 'C2', 'C4', 'C5']) {
    const scn = E.normalizeScenario(input(id));
    const { rejected } = E.enumerate(scn, E.climateOf(scn));
    for (const k of Object.keys(rejected)) assert.ok(texts.has(k), '目录缺少规则：' + k);
  }
  const scn = E.normalizeScenario({ ...input('C1'), speed: 'standing' });
  for (const k of Object.keys(E.enumerate(scn, E.climateOf(scn)).rejected)) assert.ok(texts.has(k), k);
});

test('关联图：节点边数合理、抗车辙剂提升动稳定度并牺牲低温应变、规则约束可查', () => {
  const g = G.graph();
  assert.ok(g.nodes.length > 50 && g.edges.length > 100);
  const p = G.profile(g, 'rut:antirut');
  assert.ok(p.improves.some((x) => x.indicator === 'ds' && x.effect === 60));
  assert.ok(p.worsens.some((x) => x.indicator === 'strain' && x.effect === -150));
  assert.ok(p.restrictedBy.some((r) => r.rule === 'R09'));
  const imp = G.improvers(g, 'tsr', { top: 3 });
  assert.strictEqual(imp.length, 3); assert.ok(imp[0].benefit >= imp[1].benefit);
  const low = G.improvers(g, 'pgLow', { top: 1 })[0];
  assert.ok(low.effect < 0 && low.benefit > 0, '低温分级越低越好');
  assert.ok(G.drivers(g, 'fatigue').some((d) => d.sourceId === 'trf:xheavy'));
  assert.throws(() => G.improvers(g, 'nope')); assert.throws(() => G.profile(g, 'x:y'));
});

test('运行时校验：七案例通过；错误字段逐项报告；未知字段仅警告', () => {
  for (const c of cases) assert.ok(V.validateScenario(c.input).ok, c.id);
  const r = V.validateScenario({ treatment: 'MR_UP', cityId: 'nowhere', traffic: 'huge', samples: 0, foo: 1 });
  assert.ok(!r.ok); const paths = r.errors.map((e) => e.path);
  assert.ok(paths.includes('traffic') && paths.includes('samples') && paths.includes('cityId'));
  assert.ok(r.warnings.some((w) => w.path === 'foo'));
  assert.ok(V.validateScenario({ scenario: input('C1') }).ok);
  assert.ok(!V.validateObservations([{ binderFamily: 'sbs', gradType: 'dense', indicator: 'tsr', ratio: -1 }]).ok);
  assert.ok(!V.validateObservations('x').ok);
});
