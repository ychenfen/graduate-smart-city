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
