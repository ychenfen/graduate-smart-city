/*
 * 消融与对比实验（留出测试集）：逐项去掉关键设计，并与“固定阈值规则”对比。
 * 运行：node test/ablation.js → test/ablation.json
 */
'use strict';
var fs = require('fs'), path = require('path');
var B = require('./bench.js');
var seeds = []; for (var i = 1001; i <= 1100; i++) seeds.push(i);
var configs = [
  { key: 'full', name: '完整方法（水电联合 + 个人基线 + 情境判断 + 自动外呼）', opt: {} },
  { key: 'noCall', name: '去掉自动外呼确认', opt: { engine: { noCall: true } } },
  { key: 'noContext', name: '去掉情境判断（灯一直亮/只剩冰箱）', opt: { engine: { useContext: false } } },
  { key: 'noHourly', name: '去掉分时段静默画像（全天一个阈值）', opt: { engine: { useHourly: false } } },
  { key: 'noFlat', name: '去掉“恒定大功率”判据', opt: { engine: { useFlat: false } } },
  { key: 'noPersonal', name: '去掉个人基线（所有人统一阈值）', opt: { engine: { usePersonal: false } } },
  { key: 'elecOnly', name: '只用电表、不用水表', opt: { noWater: true } },
  { key: 'miss1', name: '完整方法 + 1% 数据缺失', opt: { missRate: 0.01 } },
  { key: 'miss5', name: '完整方法 + 5% 数据缺失', opt: { missRate: 0.05 } },
  { key: 'rule', name: '对照：固定阈值规则（仅用电、按小时，团队复现）', opt: { rule: true } }
];
var out = [];
configs.forEach(function (c) {
  var r = B.evaluate(seeds, c.opt);
  var row = {
    key: c.key, name: c.name,
    dangerRecall: r.danger.recall, dangerRecallRed: r.danger.recallRed, dangerMedianDelayH: r.danger.medianDelayH, dangerP90DelayH: r.danger.p90DelayH,
    careRecall: r.care.recall,
    redFA: r.fa.redPerHouseMonth, yellowFA: r.fa.yellowPerHouseMonth,
    perType: Object.keys(r.perType).reduce(function (o, k) { o[k] = { recall: r.perType[k].recall, medianDelayH: r.perType[k].medianDelayH }; return o; }, {})
  };
  out.push(row);
  console.log(c.key.padEnd(10), 'danger', row.dangerRecall.toFixed(3), 'red', row.dangerRecallRed.toFixed(3), 'med', (row.dangerMedianDelayH || 0).toFixed(2), 'p90', (row.dangerP90DelayH || 0).toFixed(2), 'care', (row.careRecall || 0).toFixed(2), 'redFA', row.redFA.toFixed(3), 'yFA', row.yellowFA.toFixed(3));
});
fs.writeFileSync(path.join(__dirname, 'ablation.json'), JSON.stringify(out, null, 2));
