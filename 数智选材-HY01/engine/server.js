#!/usr/bin/env node
// 材料推荐引擎 HTTP 服务（零依赖）。养护决策系统通过它松耦合接入。
//   node engine/server.js [端口=8765]
//   POST /api/v1/recommend   body: ScenarioInput            → RecommendationOutput
//   POST /api/v1/feedback    body: {state, observations[]}  → {state}
//   GET  /api/v1/kb                                          → 知识库快照
//   GET  /api/v1/health
//   GET  /                                                   → 演示原型
const http = require('http');
const fs = require('fs');
const path = require('path');
const E = require('./engine.js');

const PORT = Number(process.argv[2] || process.env.PORT || 8765);
const ROOT = path.join(__dirname, '..', 'prototype');
let biasState = {};

function send(res, code, obj, type) {
  const body = type ? obj : JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = ''; req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });
}

http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    const url = req.url.split('?')[0];
    if (url === '/api/v1/health') return send(res, 200, { ok: true, engine: 'SZXC-1.0', kb: E.KB.meta });
    if (url === '/api/v1/kb') return send(res, 200, E.KB);
    if (url === '/api/v1/recommend' && req.method === 'POST') {
      const body = await readBody(req);
      const out = E.recommend(body.scenario || body, { biasState });
      if (!body.includeCloud) delete out.cloud;
      return send(res, 200, out);
    }
    if (url === '/api/v1/feedback' && req.method === 'POST') {
      const body = await readBody(req);
      biasState = E.updateBias(body.state || biasState, body.observations || []);
      return send(res, 200, { state: biasState });
    }
    const f = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ext = path.extname(f);
      const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' }[ext] || 'application/octet-stream';
      return send(res, 200, fs.readFileSync(f), type);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 400, { error: String(e.message || e) });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`数智选材引擎 http://127.0.0.1:${PORT}`));
