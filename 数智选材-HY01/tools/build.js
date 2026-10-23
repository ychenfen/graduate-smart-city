#!/usr/bin/env node
// 把知识库、引擎、案例内联进单文件原型：prototype/index.html（可双击离线打开）
const fs = require('fs');
const path = require('path');
const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');

let html = read('prototype/app.template.html');
html = html.replace('/*@KB*/', () => safe(read('engine/kb.js')))
           .replace('/*@ENGINE*/', () => safe(read('engine/engine.js')))
           .replace('/*@CASES*/[]', () => safe(JSON.stringify(JSON.parse(read('cases/cases.json')))));
fs.writeFileSync(path.join(R, 'prototype/index.html'), html);
fs.writeFileSync(path.join(R, 'data/kb.json'), JSON.stringify(require(path.join(R, 'engine/kb.js')), (k, v) => (v === Infinity ? 'Infinity' : v === -Infinity ? '-Infinity' : v), 2));
console.log('built prototype/index.html', (html.length / 1024).toFixed(0) + ' KB');
