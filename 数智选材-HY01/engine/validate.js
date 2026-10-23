/*
 * 接口输入校验：按 engine/schema.json 的 JSON Schema 子集逐字段检查，并补充业务规则。
 * 支持 type / enum / minimum / maximum / exclusiveMinimum / exclusiveMaximum / required / items /
 * properties / minItems / maxItems；未声明的字段只给出警告，不拒绝。仅 Node 使用。
 * 引擎自身仍保留关键边界检查（深度防御）。
 */
'use strict';
const schema = require('./schema.json');
const KB = require('./kb.js');

function typeOk(t, v) {
  if (t === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
  if (t === 'array') return Array.isArray(v);
  if (t === 'string') return typeof v === 'string';
  if (t === 'boolean') return typeof v === 'boolean';
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (t === 'integer') return Number.isInteger(v);
  if (t === 'null') return v === null;
  return true;
}
function check(def, v, path, errors, warnings) {
  if (def.type && !typeOk(def.type, v)) { errors.push({ path, message: `类型应为 ${def.type}` }); return; }
  if (def.enum && !def.enum.includes(v)) errors.push({ path, message: `取值须为 ${def.enum.join(' / ')} 之一` });
  if (typeof v === 'number') {
    if (def.minimum != null && v < def.minimum) errors.push({ path, message: `不得小于 ${def.minimum}` });
    if (def.maximum != null && v > def.maximum) errors.push({ path, message: `不得大于 ${def.maximum}` });
    if (def.exclusiveMinimum != null && v <= def.exclusiveMinimum) errors.push({ path, message: `须大于 ${def.exclusiveMinimum}` });
    if (def.exclusiveMaximum != null && v >= def.exclusiveMaximum) errors.push({ path, message: `须小于 ${def.exclusiveMaximum}` });
  }
  if (Array.isArray(v)) {
    if (def.minItems != null && v.length < def.minItems) errors.push({ path, message: `至少 ${def.minItems} 项` });
    if (def.maxItems != null && v.length > def.maxItems) errors.push({ path, message: `至多 ${def.maxItems} 项` });
    if (def.items) v.forEach((x, i) => check(def.items, x, `${path}[${i}]`, errors, warnings));
  }
  if (def.type === 'object' && v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of def.required || []) if (!(k in v)) errors.push({ path: path ? `${path}.${k}` : k, message: '缺少必填字段' });
    const props = def.properties || {};
    for (const [k, x] of Object.entries(v)) {
      if (props[k]) check(props[k], x, path ? `${path}.${k}` : k, errors, warnings);
      else if (def.properties) warnings.push({ path: path ? `${path}.${k}` : k, message: '未在接口规范中声明，已忽略' });
    }
  }
}

function validateScenario(input) {
  const errors = [], warnings = [];
  const s = input && typeof input === 'object' && 'scenario' in input && input.scenario && typeof input.scenario === 'object' ? input.scenario : input;
  check(schema.$defs.ScenarioInput, s, '', errors, warnings);
  if (s && typeof s === 'object') {
    if (s.cityId == null && s.climate == null) errors.push({ path: 'cityId', message: '须给出 cityId 或 climate' });
    if (s.cityId != null && typeof s.cityId === 'string' && !KB.cities.some((c) => c.id === s.cityId) && s.climate == null) {
      errors.push({ path: 'cityId', message: '未知城市编号；可用：' + KB.cities.map((c) => c.id).join('、') });
    }
    if (s.treatment !== 'CRACK' && s.crackWidthMm != null) warnings.push({ path: 'crackWidthMm', message: '仅 CRACK 工法使用，已忽略' });
    if (s.treatment === 'CRACK' && (s.budgetPerM2 != null || s.carbonCapYr != null)) warnings.push({ path: 'budgetPerM2', message: '裂缝处治模块不使用预算与碳排约束' });
    if (Array.isArray(s.distresses)) {
      const seen = new Set();
      s.distresses.forEach((d, i) => { const id = typeof d === 'string' ? d : d && d.id; if (id && seen.has(id)) warnings.push({ path: `distresses[${i}]`, message: '病害重复，后者覆盖前者的严重程度' }); seen.add(id); });
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

function validateObservations(list) {
  const errors = [], warnings = [];
  if (!Array.isArray(list)) return { ok: false, errors: [{ path: 'observations', message: '须为数组' }], warnings };
  if (list.length > 1000) errors.push({ path: 'observations', message: '至多 1000 项' });
  list.slice(0, 1000).forEach((o, i) => {
    check(schema.$defs.Observation, o, `observations[${i}]`, errors, warnings);
    if (o && typeof o.ratio === 'number' && o.indicator !== 'fatigue' && o.ratio <= 0) errors.push({ path: `observations[${i}].ratio`, message: '实测/预测比值须为正数' });
  });
  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { validateScenario, validateObservations };
