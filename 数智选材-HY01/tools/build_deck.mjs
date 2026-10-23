import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=process.env.CODEX_ARTIFACT_RUNTIME||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies');
process.env.RUNTIME_NODE_MODULES=runtime+'/node/node_modules';
const skill=process.env.CODEX_PRESENTATIONS_SKILL||path.join(os.homedir(),'.codex/plugins/cache/openai-primary-runtime/presentations/26.1017.22135/skills/presentations');
const {Presentation,PresentationFile}=await import(pathToFileURL(runtime+'/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs'));
const {finalizePresentation}=await import(pathToFileURL(skill+'/container_tools/artifact_tool_utils.mjs'));
const {GlobalFonts}=await import(pathToFileURL(runtime+'/node/node_modules/@napi-rs/canvas/index.js'));
GlobalFonts.registerFromPath(root+'/assets/fonts/NotoSerifSC-Regular.ttf','Noto Serif SC');
const FONT='Noto Serif SC';
const build=root+'/.work/deck',out=root+'/deliverables/演示';
await fs.mkdir(build,{recursive:true});await fs.mkdir(out,{recursive:true});
const data=JSON.parse(await fs.readFile(root+'/paper/verification_20261022/cases.json','utf8'));
const pres=Presentation.create({slideSize:{width:1280,height:720}});
function box(slide,s,x,y,w,h,size=29,bold=false,color='#242724') {
 const sh=slide.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 sh.text=s;sh.text.style={fontFamily:FONT,typeface:FONT,fontSize:size,bold,color};return sh;
}
const narration=[];
function slide(title,script,source='当前引擎、知识库和七个构造案例。') {
 const s=pres.slides.add();s.background.fill='#F7F4EC';
 box(s,title,68,48,1140,80,42,true);
 box(s,String(pres.slides.items.length),1180,658,40,30,16,false,'#77776E');
 s.speakerNotes.text=script+'\n来源：'+source+'\n本作品为演示先验与构造案例，预测不代表工程保证。';
 narration.push({slide:pres.slides.items.length,title,text:script});return s;
}
function lines(s,items){items.forEach((t,i)=>box(s,t,72,165+i*103,1120,88,29));}
function table(s,values,widths,top=170,height=350) {
 const t=s.tables.add({rows:values.length,columns:values[0].length,left:70,top,width:1140,height,columnWidths:widths,values});
 for(let r=0;r<values.length;r++)for(let c=0;c<values[0].length;c++){
  const cell=t.getCell(r,c);cell.fill=r===0?'#DFE5DC':r%2?'#F7F4EC':'#ECEEE7';
  cell.text.style={fontFamily:FONT,typeface:FONT,fontSize:23,color:'#242724',bold:r===0};
 }
 return t;
}
let s=slide('数智选材','数智选材是道路养护材料方案推荐的概念验证原型。我们关注工法确定之后的材料选择，展示约束、候选和推荐理由。本视频使用本地合成语音，案例和预测参数均为演示用途。','官网HY-01课题一。');
box(s,'道路养护材料方案推荐原型',74,210,1100,115,49,true);
box(s,'HY-01 课题一',76,380,1100,58,29);
box(s,'构造案例与演示先验，支持工程师复核',76,495,1100,65,28,false,'#67715F');
s=slide('材料选型中的约束','工法确定后，材料方案仍然受到气候、交通、病害和施工条件共同影响。系统先识别需求，再排除不兼容方案。预算不足和低温施工无解时，必须明确提示，不能以评分掩盖硬约束。');
lines(s,['气候与病害决定性能需求','材料兼容和施工条件决定可行范围','预算约束先于方案评分','候选结果由工程师结合试验复核']);
s=slide('推荐流程','原型分为需求映射、规则筛选、先验评价和方案选择。相同场景下的候选共用随机扰动，方便比较。输出包括短板、替代方案和估计费用。裂缝处治使用独立规则模块。');
lines(s,['场景输入：气候、交通、病害、工法与预算','规则筛选：材料兼容、层厚与施工气温','先验评价：多项性能和工艺扰动','方案选择：目标比例约束下比较年值成本']);
s=slide('不确定性与推荐边界','页面中的联合通过比例是模型内统计量。抽样区间只表示有限次模拟的波动，不包含模型和材料先验的误差。当前没有独立试验验证，模拟寿命和成本不能当作已实现的工程收益。');
lines(s,['联合通过比例：全部指标同时满足的模拟比例','95%抽样区间：仅反映有限次采样误差','目标未达：显示短板并要求人工复核','寿命、成本和碳排：显式假设下的估计']);
s=slide('六个混合料案例','六个混合料案例覆盖高温重载、寒区裂缝、水损害、抗滑与预算约束。结果来自同一先验模型。哈尔滨和乌鲁木齐案例未达到目标，保留这些失败结果有助于展示材料与场景之间的冲突。');
table(s,[['案例','需求','模型内比例','目标','结果'],...data.slice(0,6).map(c=>[c.id,({C1:'洋浦重载车辙',C2:'哈尔滨低温裂缝',C3:'重庆水损害',C4:'武汉抗滑',C5:'乌鲁木齐温差',C6:'西安预算约束'})[c.id],c.output.recommended.reliability.toFixed(3),c.output.targetReliability.toFixed(2),c.output.targetReached?'模型内达到':'未达到'])],[100,390,250,180,220],155,390);
box(s,'同模型构造案例对比，尚无独立工程验证',76,588,1120,55,24,false,'#6F765F');
s=slide('三类典型需求的方案比较','洋浦案例强调重载和抗水损，寒区案例同时面对低温抗裂和施工气温约束，重庆案例强调水稳定性。模型内选优采用相同评价器，规则经验方案只是程序化基线，不能冒充专家审定结论。');
table(s,[['案例','推荐比例','规则经验比例','估计年值成本'],...data.slice(0,3).map(c=>[c.id,c.output.recommended.reliability.toFixed(3),c.output.baselines.experience.reliability.toFixed(3),c.output.recommended.euac.toFixed(2)])],[130,290,360,360],190,280);
box(s,'年值成本单位：元/(m²·年)，费用与寿命均为演示假设',76,535,1120,70,25,false,'#6F765F');
s=slide('裂缝规则与无解处理','第七例为寒区横向裂缝，系统按温度和缝宽选择处治规则。另设零预算与极低施工温度回归用例，要求返回无解原因。这样的边界行为比始终给出一个配方更适合辅助工程讨论。');
lines(s,['C7：按温度包络和缝宽筛选灌缝方案','零预算：返回预算内无候选','极低施工温度：返回施工条件无解','材料预测和裂缝规则分模块交接']);
s=slide('软件与技术交接','交付包含可离线打开的原型、引擎、知识库、七例输入输出、接口说明及回归测试。服务仅绑定本机。监测偏差更新用于演示，重启后清空；生产应用还需要独立数据验证、权限和持久化。');
lines(s,['浏览器与Node共用推荐引擎','七案例输入、输出和报告可重新生成','本地接口覆盖推荐、反馈与知识库','源码、字体许可和运行说明随包提供']);
s=slide('应用路径与商业模式','产品化先从规则复核与数据整理开始，再开展历史案例回放和独立试验。只有验证效果和客户采购意愿后，才讨论接口实施费与维护服务。当前没有客户合同、收入或工程降本数据。');
lines(s,['规则复核与企业材料字段映射','历史案例封存回放和独立试验','有限试点后确认验收与责任边界','实施与维护服务按验证结果定价']);
s=slide('当前成果与下一步验证','本项目已经形成可运行的材料推荐概念验证与可复用交接材料。下一步最关键的是企业材料数据和独立实验。我们保留未达标案例和无解结果，便于合作方判断适用边界。');
lines(s,['已实现：需求映射、候选筛选、解释和反馈演示','已交接：正式文档、案例、原型与源码','待验证：真实材料误差、实际寿命及成本收益','工程使用前须完成规范与实验复核']);
await fs.writeFile(out+'/解说词.json',JSON.stringify(narration,null,2));
await fs.writeFile(out+'/解说词.txt',narration.map(x=>x.text).join('\n\n'));
for(let i=0;i<pres.slides.items.length;i++){
 const blob=await pres.export({slide:pres.slides.items[i],format:'png',scale:1});
 await fs.writeFile(build+`/slide-${String(i+1).padStart(2,'0')}.png`,new Uint8Array(await blob.arrayBuffer()));
}
const candidate=build+'/candidate.pptx';await(await PresentationFile.exportPptx(pres)).save(candidate);
// 使用任务字体目录，避免隔离渲染器缺少中文字体。
const fontConfig=build+'/fonts.conf';
await fs.writeFile(fontConfig,`<?xml version="1.0"?><fontconfig><dir>${root}/assets/fonts</dir><cachedir>${build}/fontcache</cachedir></fontconfig>`);
const pdfProcess=spawnSync(runtime+'/bin/override/soffice',['--headless','--convert-to','pdf','--outdir',out,candidate],{env:{...process.env,FONTCONFIG_FILE:fontConfig,SAL_FONTPATH:root+'/assets/fonts'},encoding:'utf8'});
if(pdfProcess.status!==0)throw new Error(pdfProcess.stderr);
await fs.rename(out+'/candidate.pdf',out+'/数智选材_汇报.pdf');
if(process.argv.includes('--pdf-only'))process.exit(0);
const result=await finalizePresentation({workspaceDir:root,candidatePath:candidate,finalPath:out+'/数智选材_汇报.pptx',pythonExecutable:runtime+'/python/bin/python3',integrityValidatorPath:skill+'/container_tools/inspect_presentation_package_integrity.py',layoutValidatorPath:skill+'/container_tools/inspect_presentation_layout_geometry.py',layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit','--require-native-table-slide','5','--require-native-table-slide','6'],explicitTotalSlideCount:10,requiredNativeTableOwnerSlides:[5,6],fontPolicy:{basis:'design',families:[FONT]},verifyArtifactToolImport:true,receiptPath:build+'/validation.json'});
console.log(JSON.stringify(result));
