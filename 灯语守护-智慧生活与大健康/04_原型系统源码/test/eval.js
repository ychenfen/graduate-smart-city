/*
 * 留出测试集评测：100 户 × 90 天（前 28 天为学习期，后 62 天评测），参数已在开发集（种子 1–40）上定稿。
 * 运行：node test/eval.js  → 输出 test/results.json 与界面使用的 test/results.js
 */
'use strict';
var fs = require('fs'), path = require('path');
var B = require('./bench.js');
var seeds = []; for (var i = 1001; i <= 1100; i++) seeds.push(i);
var t0 = Date.now();
var res = B.evaluate(seeds, {});
res.wallMs = Date.now() - t0;
res.split = '留出测试集：种子 1001–1100（100 户），每户 90 天，前 28 天学习期，后 62 天评测';
res.callAssumption = B.CALL;
res.node = process.version;
var ex = res.examples; delete res.examples;
res.sample = ex.slice(0, 40);
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, function (k, v) { return typeof v === 'number' ? Math.round(v * 1000) / 1000 : v; }, 1));
