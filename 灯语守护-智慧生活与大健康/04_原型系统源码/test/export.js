/* 把 results.json 与 ablation.json 打包为界面可直接读取的 results.js（双击 index.html 时无法 fetch 本地 JSON） */
'use strict';
var fs = require('fs'), path = require('path');
var r = JSON.parse(fs.readFileSync(path.join(__dirname, 'results.json'), 'utf8'));
var a = JSON.parse(fs.readFileSync(path.join(__dirname, 'ablation.json'), 'utf8'));
delete r.sample;
fs.writeFileSync(path.join(__dirname, 'results.js'), '/* 由 test/export.js 生成，请勿手改 */\nwindow.LAMP_RESULTS = ' + JSON.stringify({ results: r, ablation: a }) + ';\n');
console.log('results.js written');
