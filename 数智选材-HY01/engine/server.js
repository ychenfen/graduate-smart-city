#!/usr/bin/env node
// 材料推荐引擎 HTTP 服务（零依赖）。养护决策系统通过它松耦合接入。
//   node engine/server.js [端口=8765]
//   POST /api/v1/recommend        body: ScenarioInput 或 {scenario, includeCloud}  → RecommendationOutput
//   POST /api/v1/validate         body: ScenarioInput                              → {ok, errors, warnings}
//   POST /api/v1/feedback         body: {state?, observations[]}                   → {state}
//   GET  /api/v1/feedback         当前反馈偏差状态
//   POST /api/v1/feedback/reset   清空反馈状态
//   GET  /api/v1/kb               知识库快照
//   GET  /api/v1/graph            材料—性能关联图（可加 ?summary=1 仅返回统计）
//   GET  /api/v1/graph/improvers?indicator=tsr&top=5[&cls=binder]
//   GET  /api/v1/graph/profile?id=rut:antirut
//   GET  /api/v1/graph/drivers?indicator=ds
//   GET  /api/v1/health
//   GET  /                        演示原型
//
// 安全边界：仅绑定回环地址；跨域默认只放行同源回环来源，可用 SZXC_CORS_ORIGIN 显式放行；
// 请求体上限 1 MB；无认证、无持久化、无审计，不适合公开部署。
const http = require('http');
const fs = require('fs');
const path = require('path');
const E = require('./engine.js');
const G = require('./graph.js');
const V = require('./validate.js');

const PORT = Number(process.argv[2] || process.env.PORT || 8765);
const ROOT = path.resolve(__dirname, '..', 'prototype');
const MAX_BODY = 1e6;
const EXTRA_ORIGIN = process.env.SZXC_CORS_ORIGIN || '';
let biasState = {};

class HttpError extends Error { constructor(code, message, extra) { super(message); this.code = code; this.extra = extra; } }

function allowedOrigin(req) {
  const o = req.headers.origin;
  if (!o) return null;
  if (EXTRA_ORIGIN && o === EXTRA_ORIGIN) return o;
  try {
    const u = new URL(o);
    if (['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && Number(u.port || 80) === PORT) return o;
  } catch (e) { /* 非法来源，拒绝 */ }
  return null;
}
function send(req, res, code, obj, type) {
  const body = type ? obj : JSON.stringify(obj);
  const headers = {
    'Content-Type': type || 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  };
  const origin = allowedOrigin(req);
  if (origin) { headers['Access-Control-Allow-Origin'] = origin; headers['Vary'] = 'Origin'; headers['Access-Control-Allow-Headers'] = 'Content-Type'; headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'; }
  res.writeHead(code, headers);
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, '请求体超过 1 MB 上限')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(new HttpError(400, '请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}
function serveStatic(req, res, url) {
  let rel;
  try { rel = decodeURIComponent(url === '/' ? '/index.html' : url); } catch (e) { throw new HttpError(400, '路径编码无效'); }
  const f = path.resolve(ROOT, '.' + rel);
  // 必须带分隔符比较，避免 /prototype-evil 之类的同前缀目录绕过
  if (f !== ROOT && !f.startsWith(ROOT + path.sep)) throw new HttpError(403, '禁止访问');
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw new HttpError(404, 'not found');
  const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' }[path.extname(f)] || 'application/octet-stream';
  send(req, res, 200, fs.readFileSync(f), type);
}
function query(req) { return Object.fromEntries(new URL(req.url, 'http://x').searchParams); }

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(req, res, 204, '');
    const url = req.url.split('?')[0];
    if (url === '/api/v1/health') return send(req, res, 200, { ok: true, engine: E.ENGINE_ID, kb: E.KB.meta });
    if (url === '/api/v1/kb') return send(req, res, 200, E.KB);
    if (url === '/api/v1/graph') {
      const g = G.graph();
      return send(req, res, 200, query(req).summary ? { meta: g.meta } : g);
    }
    if (url === '/api/v1/graph/improvers') {
      const q = query(req); const top = q.top == null ? 8 : Number(q.top);
      if (!Number.isInteger(top) || top < 1 || top > 50) throw new HttpError(400, 'top 须为 1–50 的整数');
      return send(req, res, 200, { indicator: q.indicator, items: G.improvers(G.graph(), q.indicator, { top, cls: q.cls }) });
    }
    if (url === '/api/v1/graph/profile') return send(req, res, 200, G.profile(G.graph(), query(req).id));
    if (url === '/api/v1/graph/drivers') { const q = query(req); return send(req, res, 200, { indicator: q.indicator, items: G.drivers(G.graph(), q.indicator) }); }
    if (url === '/api/v1/validate' && req.method === 'POST') return send(req, res, 200, V.validateScenario(await readBody(req)));
    if (url === '/api/v1/recommend' && req.method === 'POST') {
      const body = await readBody(req);
      const v = V.validateScenario(body);
      if (!v.ok) throw new HttpError(400, '输入未通过校验：' + v.errors.map((e) => `${e.path} ${e.message}`).join('；'), { errors: v.errors, warnings: v.warnings });
      const out = E.recommend(body.scenario || body, { biasState });
      if (!body.includeCloud) delete out.cloud;
      if (v.warnings.length) out.warnings = v.warnings;
      return send(req, res, 200, out);
    }
    if (url === '/api/v1/feedback' && req.method === 'GET') return send(req, res, 200, { state: biasState });
    if (url === '/api/v1/feedback/reset' && req.method === 'POST') { biasState = {}; return send(req, res, 200, { state: biasState }); }
    if (url === '/api/v1/feedback' && req.method === 'POST') {
      const body = await readBody(req);
      const v = V.validateObservations(body.observations || []);
      if (!v.ok) throw new HttpError(400, '反馈未通过校验：' + v.errors.map((e) => `${e.path} ${e.message}`).join('；'), { errors: v.errors });
      biasState = E.updateBias(body.state || biasState, body.observations || []);
      return send(req, res, 200, { state: biasState });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, '方法不被支持');
    return serveStatic(req, res, url);
  } catch (e) {
    const code = e instanceof HttpError ? e.code : 400;
    send(req, res, code, Object.assign({ error: String(e.message || e) }, e.extra || {}));
  }
});

// 防止慢速连接长期占用
server.headersTimeout = 10000; server.requestTimeout = 30000;
server.listen(PORT, '127.0.0.1', () => console.log(`数智选材引擎 http://127.0.0.1:${PORT}`));
