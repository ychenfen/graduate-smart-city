const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const path=require('node:path');
const E=require('../engine/engine.js');
const cases=require('../cases/cases.json');
const port=20000+process.pid%20000,base=`http://127.0.0.1:${port}`;
let child;
test.before(async()=>{
  child=spawn(process.execPath,[path.join(__dirname,'../engine/server.js'),String(port)],{stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('server startup timeout')),5000);
    child.stdout.once('data',()=>{clearTimeout(timer);resolve()});
    child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error('server exit '+code))});
  });
});
test.after(()=>child?.kill());
const post=async(p,b)=>fetch(base+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});
test('健康、静态原型和知识库可读取',async()=>{
 assert.equal((await(await fetch(base+'/api/v1/health')).json()).ok,true);
 const page=await(await fetch(base+'/')).text();assert.ok(page.includes('模型内联合通过比例'));
 assert.equal((await(await fetch(base+'/api/v1/kb')).json()).meta.version,E.KB.meta.version);
});
test('接口输出与本地引擎逐字段一致',async()=>{
 const input=cases[2].input,expected=E.recommend(input);
 const response=await post('/api/v1/recommend',{scenario:input,includeCloud:true});assert.equal(response.status,200);
 const actual=await response.json();delete actual.elapsedMs;delete expected.elapsedMs;assert.deepEqual(actual,expected);
});
test('接口明确返回预算无解和输入错误',async()=>{
 const res=await post('/api/v1/recommend',{...cases[0].input,budgetPerM2:0});assert.equal((await res.json()).module,'infeasible');
 assert.equal((await post('/api/v1/recommend',{...cases[0].input,samples:0})).status,400);
 const bad=await fetch(base+'/api/v1/recommend',{method:'POST',body:'{'});assert.equal(bad.status,400);
});
test('反馈无效时拒绝，合法状态可清空重算',async()=>{
 assert.equal((await post('/api/v1/feedback',{observations:[{binderFamily:'sbs',gradType:'dense',indicator:'tsr',ratio:0}]})).status,400);
 const good=await post('/api/v1/feedback',{observations:[{binderFamily:'sbs',gradType:'dense',indicator:'tsr',ratio:0.88}]});assert.equal(good.status,200);
 assert.ok((await good.json()).state['sbs|dense|tsr'].mean<0);
 const reset=await post('/api/v1/feedback',{state:{},observations:[]});assert.deepEqual((await reset.json()).state,{});
});
test('图谱、校验、反馈状态与重置接口',async()=>{
 const imp=await(await fetch(base+'/api/v1/graph/improvers?indicator=tsr&top=3')).json();assert.equal(imp.items.length,3);
 assert.equal((await fetch(base+'/api/v1/graph/improvers?indicator=tsr&top=0')).status,400);
 assert.equal((await fetch(base+'/api/v1/graph/improvers?indicator=bad')).status,400);
 const prof=await(await fetch(base+'/api/v1/graph/profile?id='+encodeURIComponent('rut:antirut'))).json();assert.ok(prof.improves.length>0);
 assert.ok((await(await fetch(base+'/api/v1/graph?summary=1')).json()).meta.nodes>50);
 const v=await(await post('/api/v1/validate',{treatment:'MR_UP',traffic:'huge'})).json();assert.equal(v.ok,false);
 const bad=await post('/api/v1/recommend',{...cases[0].input,traffic:'huge'});assert.equal(bad.status,400);assert.ok((await bad.json()).errors.length>0);
 await post('/api/v1/feedback',{observations:[{binderFamily:'sbs',gradType:'dense',indicator:'tsr',ratio:0.9}]});
 assert.ok((await(await fetch(base+'/api/v1/feedback')).json()).state['sbs|dense|tsr']);
 assert.deepEqual((await(await post('/api/v1/feedback/reset',{})).json()).state,{});
});
test('安全：路径穿越、超大请求体、跨域来源',async()=>{
 const raw=(p)=>new Promise((resolve)=>{const s=require('node:net').connect(port,'127.0.0.1',()=>s.write(`GET ${p} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));let d='';s.on('data',c=>d+=c);s.on('close',()=>resolve(d));});
 for(const p of ['/..%2fengine%2fengine.js','/%2e%2e/engine/kb.js','/../engine/engine.js']){const r=await raw(p);assert.ok(/^HTTP\/1\.1 (403|404)/.test(r),p+' '+r.slice(0,40));assert.ok(!r.includes('mulberry32'));}
 const big=await fetch(base+'/api/v1/recommend',{method:'POST',body:'{"x":"'+'a'.repeat(1.2e6)+'"}'}).then(r=>r.status,()=>413);assert.equal(big,413);
 const evil=await fetch(base+'/api/v1/health',{headers:{origin:'http://evil.example'}});assert.equal(evil.headers.get('access-control-allow-origin'),null);
 const ok=await fetch(base+'/api/v1/health',{headers:{origin:base}});assert.equal(ok.headers.get('access-control-allow-origin'),base);
 assert.equal((await fetch(base+'/api/v1/health')).headers.get('x-content-type-options'),'nosniff');
});
