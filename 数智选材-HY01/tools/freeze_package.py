"""在文档与媒体完成检查后冻结本地包，独立解压复验。不会上传。"""
from pathlib import Path
import hashlib,json,zipfile,shutil,subprocess,re,os
R=Path(__file__).resolve().parents[1];S=R/'提交包/数智选材_完整交付_20261022'
assert not S.exists(),'冻结目录已存在，请另取版本名以保留已验证版本'
S.mkdir(parents=True)
def cp(src,dest):
 dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest)
def tree(src,dest):
 for p in src.rglob('*'):
  if p.is_file() and not any(x in p.parts for x in ['__pycache__','.DS_Store']):cp(p,dest/p.relative_to(src))
review=S/'评审材料';source=S/'研发源码';review.mkdir()
for p in (R/'deliverables/文档').glob('*'):cp(p,review/('可编辑文档' if p.suffix=='.docx' else 'PDF文档')/p.name)
tree(R/'deliverables/演示',review/'演示材料')
for folder in ['engine','cases','tests','tools','prototype','data','assets','00_赛题']:
 tree(R/folder,source/folder)
cp(R/'README.md',source/'README.md')
for p in (R/'paper').glob('*.md'):cp(p,source/'paper'/p.name)
tree(R/'paper/verification_20261022',source/'paper/verification_20261022')
# 小体积匿名原型源码附件，剔除本地作者路径、原始模板与打包器。
codezip=review/'原型与源码.zip'
with zipfile.ZipFile(codezip,'w',zipfile.ZIP_DEFLATED) as z:
 for folder in ['engine','cases','tests','prototype','data']:
  for p in (R/folder).rglob('*'):
   if p.is_file():z.write(p,p.relative_to(R))
 for n in ['README.md','tools/build.js','tools/case_report.js']:
  z.write(R/n,n)
 for p in (R/'paper/verification_20261022').glob('*'):z.write(p,p.relative_to(R))
readme='''# 数智选材本地完整交付

本包用于本地交付和恢复。不能把整个归档直接当作平台提交回执。

## 评审材料

PDF文档包含项目简表、说明书、商业计划书、技术交接及七案例报告。另有可编辑DOCX、10页PPTX及PDF、约134秒中文合成语音方案解说视频、原型与源码ZIP。视频为汇报页解说，不是软件录屏。文档的中文字体已内嵌，PPT如需编辑可使用研发源码/assets/fonts中的OFL字体。

简表与说明书为必交；商业计划书和演示材料为选交；软件原型及源码需附。实际格式、文件大小和上传栏目须在官网登录后核对。请按栏目选择文件，不要上传研发源码目录中的原始参考模板及本地核验记录。

## 仍需真实确认

团队名称、作品编号、成员和身份字段的匿名处理方式尚未提供或确认，简表已明确标出，不能编造。学校资格审核、报名及上传状态尚无确认。本地包不代表已经报名或提交。

2026年10月23日中午12:00为报名及资格审核截止；10月25日中午12:00为作品提交截止，均为北京时间。以官网后续调整为准。

## 数据和验证边界

七例均为构造测试案例，规则门槛仍需原文逐项复核，材料性能和费用为待标定先验。模型内联合通过比例和抽样区间不能证明工程成功概率。暂无独立材料试验、客户收入或实际降本延寿证据。

引擎与本地API测试通过，文档与汇报页已渲染检查，媒体全流解码通过。浏览器工具曾阻止file协议访问，本轮未形成真实浏览器交互或移动端验收证据。请打开原型后按七案例、零预算和极低施工温度检查界面。

## 复现

解压后进入研发源码，运行 node --test tests/*.test.js、node tools/build.js、node tools/case_report.js。核心原型仅需Node.js，无第三方依赖。文档生成另需Python及python-docx/lxml；演示生成使用随Codex提供的artifact-tool运行时，视频生成使用macOS Tingting合成语音与ffmpeg。

SHA256.json记录包内文件身份。修改任何文件后，应形成新版本重新校验。
'''
(S/'先读说明.md').write_text(readme)
checks=json.loads((R/'.work/qa/document_text_checks.json').read_text())
(S/'本地核验摘要.json').write_text(json.dumps({'date':'2026-10-22 Asia/Shanghai','documents':checks,'slides':10,'native_tables':2,'tests':24,'video':{'duration_seconds':133.689229,'video_codec':'h264','audio_codec':'aac','resolution':'1280x720','mean_volume_db':-20.8,'max_volume_db':-5.3,'full_decode':'pass','synthetic_voice':'macOS Tingting'},'browser_interaction':'not_verified','portal':'not_submitted','identity_fields':'pending'},ensure_ascii=False,indent=2))
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
files=[p for p in S.rglob('*') if p.is_file()]
manifest={str(p.relative_to(S)):{'bytes':p.stat().st_size,'sha256':digest(p)} for p in sorted(files)}
(S/'SHA256.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
archive=S.with_suffix('.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for p in sorted(S.rglob('*')):
  if p.is_file():z.write(p,p.relative_to(S))
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 assert len(z.namelist())==len(set(z.namelist()))
 assert all(not n.startswith('/') and '..' not in Path(n).parts for n in z.namelist())
 for n,v in manifest.items():assert hashlib.sha256(z.read(n)).hexdigest()==v['sha256']
backup=Path.home()/'Documents/竞赛交付备份/数智选材_HY01_20261022/完整交付_v1'
backup.mkdir(parents=True,exist_ok=True);cp(archive,backup/archive.name)
assert digest(archive)==digest(backup/archive.name)
restored=backup/'独立解压复验';assert not restored.exists();restored.mkdir()
with zipfile.ZipFile(backup/archive.name) as z:z.extractall(restored)
for n,v in manifest.items():assert digest(restored/n)==v['sha256']
cwd=restored/'研发源码'
tests=subprocess.run(['node','--test',*[str(p) for p in (cwd/'tests').glob('*.test.js')]],cwd=cwd,capture_output=True,text=True)
assert tests.returncode==0,tests.stdout+tests.stderr
(backup/'测试复验.txt').write_text(tests.stdout)
old=digest(cwd/'prototype/index.html')
subprocess.run(['node','tools/build.js'],cwd=cwd,check=True,capture_output=True)
assert old==digest(cwd/'prototype/index.html')
before=json.loads((cwd/'paper/verification_20261022/cases.json').read_text())
subprocess.run(['node','tools/case_report.js'],cwd=cwd,check=True,capture_output=True)
after=json.loads((cwd/'paper/verification_20261022/cases.json').read_text())
for xs in [before,after]:
 for x in xs:x['output'].pop('elapsedMs',None)
assert before==after,'案例复现结果不一致'
receipt={'archive':archive.name,'bytes':archive.stat().st_size,'sha256':digest(archive),'files':len(manifest)+1,'crc':'pass','manifest_hashes':'pass','independent_copy':'pass','restored_tests':24,'offline_rebuild':'byte_identical','case_replay':'identical_except_timing','external_status':'not_uploaded_or_submitted'}
(R/'提交包/校验回执_20261022.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2))
cp(R/'提交包/校验回执_20261022.json',backup/'校验回执.json')
print(json.dumps(receipt,ensure_ascii=False,indent=2))
