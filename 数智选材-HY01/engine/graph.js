/*
 * 数智选材 · 场景—材料—性能 关联图（浏览器与 Node 通用，零依赖）
 *
 * 由结构化知识库与推荐引擎的机理先验“导出”的有向图，用于回答
 * “哪些材料能提升某项性能、代价是什么、受哪些规则约束、哪些病害/交通把该指标目标拉高”。
 *
 * 边权不是实测数据：材料→指标 的 effect 来自引擎预测式，在参考配方
 * AC-13 + 70# 基质沥青 + 无助剂 上做单一组成替换得到（basis: 'mechanism-prior'）。
 * 因此它是“可查询、可推理的结构化底座”，不应称为由真实工程数据构建的知识图谱。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.SZXC_GRAPH = factory(root.SZXC);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const KB = E.KB, IND = E.IND, IND_NAME = E.IND_NAME, IND_UNIT = E.IND_UNIT;
  const REF = 'AC13/B70/none/none/none/R0/none';
  // 数值越小越好的指标（低温分级）
  const LOWER_BETTER = { pgLow: true };
  const SKIP_OPT = new Set(['none', 'R0']);
  const CLASS_NAME = { grad: '级配', binder: '结合料', water: '抗水损措施', rut: '抗车辙剂', warm: '拌和工艺', rap: 'RAP', fiber: '纤维', agg: '集料' };
  const CLASS_SRC = {
    grad: () => KB.gradations, binder: () => KB.binders, water: () => KB.additives.water, rut: () => KB.additives.rut,
    warm: () => KB.additives.warm, rap: () => KB.additives.rap, fiber: () => KB.additives.fiber, agg: () => KB.aggregates,
  };

  function nid(cls, id) { return cls + ':' + id; }
  const round = (x, d) => { const k = Math.pow(10, d); return Math.round(x * k) / k; };

  function buildGraph() {
    const nodes = new Map(), edges = [];
    const addNode = (id, type, name, extra) => { if (!nodes.has(id)) nodes.set(id, Object.assign({ id, type, name }, extra || {})); return id; };
    const addEdge = (from, to, rel, props) => edges.push(Object.assign({ from, to, rel }, props || {}));

    IND.forEach((k) => addNode(nid('ind', k), 'indicator', IND_NAME[k], { unit: IND_UNIT[k], lowerBetter: !!LOWER_BETTER[k] }));

    // 材料节点
    for (const cls of Object.keys(CLASS_SRC)) {
      for (const o of CLASS_SRC[cls]()) {
        if (SKIP_OPT.has(o.id)) continue;
        const extra = { cls, className: CLASS_NAME[cls] };
        if (cls === 'grad') extra.gradType = o.type;
        if (cls === 'binder') { extra.family = o.family; extra.modified = !!o.modified; }
        addNode(nid(cls, o.id), 'material', o.name, extra);
      }
    }

    // 材料 → 指标：参考配方上做单一组成替换
    const refCand = E.buildCand(REF, 'limestone');
    const refMu = E.predictMean(refCand, null);
    const swapKey = { grad: 'grad', binder: 'binder', water: 'water', rut: 'rut', warm: 'warm', rap: 'rap', fiber: 'fiber', agg: 'agg' };
    for (const cls of Object.keys(CLASS_SRC)) {
      for (const o of CLASS_SRC[cls]()) {
        if (SKIP_OPT.has(o.id)) continue;
        const cand = Object.assign({}, refCand);
        cand[swapKey[cls]] = cls === 'binder' ? E.resolveBinder(o.id) : o;
        // 参考配方已含的组成：替换为自身，效应为 0，不建边
        if (cls === 'grad' && o.id === 'AC13') continue;
        if (cls === 'binder' && o.id === 'B70') continue;
        if (cls === 'agg' && o.id === 'limestone') continue;
        const mu = E.predictMean(cand, null);
        for (const k of IND) {
          const isDs = k === 'ds';
          const effect = isDs ? (mu.ds / refMu.ds - 1) * 100 : mu[k] - refMu[k];
          if (Math.abs(effect) < (isDs ? 0.05 : 1e-6)) continue;
          addEdge(nid(cls, o.id), nid('ind', k), 'affects', {
            effect: round(effect, isDs ? 1 : 3), unit: isDs ? '%' : IND_UNIT[k] === '%' ? '百分点' : IND_UNIT[k], mode: isDs ? 'relative' : 'absolute',
            benefit: round((LOWER_BETTER[k] ? -1 : 1) * effect, 3), basis: 'mechanism-prior',
          });
        }
      }
    }

    // 病害 → 指标目标
    const DRIVE_MAP = { ds: ['ds', 'multiply'], strain: ['strain', 'multiply'], pgLowExtra: ['pgLow', 'extra-cooling'], fatigue: ['fatigue', 'add'], tsr: ['tsr', 'add'], td: ['td', 'target'] };
    for (const d of KB.distresses) {
      addNode(nid('dis', d.id), 'distress', d.name);
      for (const [key, arr] of Object.entries(d.drives || {})) {
        const m = DRIVE_MAP[key]; if (!m) continue;
        addEdge(nid('dis', d.id), nid('ind', m[0]), 'drives', { bySeverity: arr.slice(), mode: m[1], basis: 'ENG' });
      }
    }
    // 交通与车速 → 指标目标
    for (const t of KB.traffic.levels) {
      addNode(nid('trf', t.id), 'scenario', '交通：' + t.name);
      addEdge(nid('trf', t.id), nid('ind', 'fatigue'), 'raises', { value: t.fatigueTarget, mode: 'target', basis: 'ENG' });
      if (t.dsFactor != null) addEdge(nid('trf', t.id), nid('ind', 'ds'), 'raises', { value: t.dsFactor, mode: 'multiply', basis: 'ENG' });
      if (t.pgBump) addEdge(nid('trf', t.id), nid('ind', 'pgHigh'), 'raises', { value: t.pgBump, mode: 'grade-bump', basis: 'ENG' });
    }
    for (const sp of KB.traffic.speed) {
      addNode(nid('spd', sp.id), 'scenario', '车速：' + sp.name);
      if (sp.dsFactor !== 1) addEdge(nid('spd', sp.id), nid('ind', 'ds'), 'raises', { value: sp.dsFactor, mode: 'multiply', basis: 'ENG' });
      if (sp.pgBump) addEdge(nid('spd', sp.id), nid('ind', 'pgHigh'), 'raises', { value: sp.pgBump, mode: 'grade-bump', basis: 'ENG' });
    }
    for (const t of KB.treatments) addNode(nid('trt', t.id), 'scenario', '工法：' + t.name);

    // 规则 → 材料
    const resolveInvolved = (ref) => {
      const [kind, val] = ref.split(':');
      if (kind === 'grad') {
        if (['sma', 'ogfc', 'dense'].includes(val)) return KB.gradations.filter((g) => g.type === val).map((g) => nid('grad', g.id));
        return nodes.has(nid('grad', val)) ? [nid('grad', val)] : [];
      }
      if (kind === 'binder') {
        if (val === 'modified') return KB.binders.filter((b) => b.modified).map((b) => nid('binder', b.id));
        return nodes.has(nid('binder', val)) ? [nid('binder', val)] : [];
      }
      if (['rap', 'rut', 'water', 'fiber', 'agg'].includes(kind)) return nodes.has(nid(kind, val)) ? [nid(kind, val)] : [];
      if (kind === 'speed') return nodes.has(nid('spd', val)) ? [nid('spd', val)] : [];
      return [];
    };
    for (const r of E.RULES) {
      addNode('rule:' + r.key, 'rule', r.text);
      const hit = new Set();
      r.involves.forEach((x) => resolveInvolved(x).forEach((id) => hit.add(id)));
      hit.forEach((id) => addEdge('rule:' + r.key, id, 'restricts', { basis: 'ENG' }));
    }

    return { meta: { reference: REF, basis: '由结构化知识库与机理先验导出，不是实测知识图谱', nodes: nodes.size, edges: edges.length }, nodes: Array.from(nodes.values()), edges };
  }

  // ---------- 查询 ----------
  function neighbors(g, id, opts) {
    opts = opts || {};
    const dir = opts.dir || 'both';
    return g.edges.filter((e) => (!opts.rel || e.rel === opts.rel) && ((dir !== 'in' && e.from === id) || (dir !== 'out' && e.to === id)));
  }
  const nodeOf = (g, id) => g.nodes.find((n) => n.id === id);

  // 哪些材料能改善某项指标，以及改善它要付出哪些其他指标上的代价
  function improvers(g, indicator, opts) {
    opts = opts || {};
    const top = opts.top || 8;
    if (!IND.includes(indicator)) throw new Error('未知指标 ' + indicator);
    const items = [];
    for (const e of g.edges) {
      if (e.rel !== 'affects' || e.to !== nid('ind', indicator) || e.benefit <= 0) continue;
      const n = nodeOf(g, e.from);
      if (opts.cls && n.cls !== opts.cls) continue;
      const tradeoffs = g.edges.filter((x) => x.rel === 'affects' && x.from === e.from && x.to !== e.to && x.benefit < 0)
        .map((x) => ({ indicator: x.to.slice(4), name: IND_NAME[x.to.slice(4)], effect: x.effect, unit: x.unit }));
      items.push({
        id: n.id, name: n.name, cls: n.cls, className: n.className, effect: e.effect, unit: e.unit, benefit: e.benefit, tradeoffs,
        restrictedBy: neighbors(g, n.id, { rel: 'restricts', dir: 'in' }).map((x) => x.from.slice(5)),
      });
    }
    // 不同指标量纲不同，仅在同一指标内按收益排序
    return items.sort((a, b) => b.benefit - a.benefit).slice(0, top);
  }

  // 一个材料节点的全部影响
  function profile(g, id) {
    const n = nodeOf(g, id); if (!n) throw new Error('图中无节点 ' + id);
    const eff = neighbors(g, id, { rel: 'affects', dir: 'out' }).map((e) => ({
      indicator: e.to.slice(4), name: IND_NAME[e.to.slice(4)], effect: e.effect, unit: e.unit, better: e.benefit > 0,
    }));
    return {
      node: n, improves: eff.filter((x) => x.better), worsens: eff.filter((x) => !x.better),
      restrictedBy: neighbors(g, id, { rel: 'restricts', dir: 'in' }).map((x) => ({ rule: x.from.slice(5), text: nodeOf(g, x.from).name })),
    };
  }

  // 哪些场景因素会抬高某指标的目标
  function drivers(g, indicator) {
    if (!IND.includes(indicator)) throw new Error('未知指标 ' + indicator);
    return g.edges.filter((e) => (e.rel === 'drives' || e.rel === 'raises') && e.to === nid('ind', indicator))
      .map((e) => Object.assign({ source: nodeOf(g, e.from).name, sourceId: e.from, rel: e.rel }, e.bySeverity ? { bySeverity: e.bySeverity } : { value: e.value }, { mode: e.mode }));
  }

  let cached = null;
  return { buildGraph, graph: () => cached || (cached = buildGraph()), neighbors, improvers, profile, drivers, REF };
});
