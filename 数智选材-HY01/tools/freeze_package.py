"""在文档与媒体完成检查后冻结本地包，独立解压复验。不会上传。"""
from pathlib import Path
import hashlib,json,zipfile,shutil,subprocess,re,os,sys
# 用法：python3 tools/freeze_package.py [版本名=v2] [日期=20261022]。已存在的冻结包不会被覆盖。
VER=sys.argv[1] if len(sys.argv)>1 else 'v2';DAY=sys.argv[2] if len(sys.argv)>2 else '20261022'
R=Path(__file__).resolve().parents[1];S=R/f'提交包/数智选材_完整交付_{DAY}_{VER}'
assert not S.exists(),'冻结目录已存在，请另取版本名以保留已验证版本'
S.mkdir(parents=True)
def cp(src,dest):
 dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest)
def tree(src,dest):
 for p in src.rglob('*'):
  if p.is_file() and not any(x in p.parts for x in ['__pycache__','.DS_Store']):cp(p,dest/p.relative_to(src))
review=S/'评审材料';source=S/'研发源码';review.mkdir()
DOCS=R/('deliverables/文档_v2' if (R/'deliverables/文档_v2').exists() and VER!='v1' else 'deliverables/文档')
for p in DOCS.glob('*'):cp(p,review/('可编辑文档' if p.suffix=='.docx' else 'PDF文档')/p.name)
tree(R/'deliverables/演示',review/'演示材料')
for folder in ['engine','cases','tests','tools','prototype','data','assets','00_赛题']:
 tree(R/folder,source/folder)
cp(R/'README.md',source/'README.md')
for p in (R/'paper').glob('*.md'):cp(p,source/'paper'/p.name)
for d in ['verification_20261022','verification_v2']:
 if (R/'paper'/d).exists():tree(R/'paper'/d,source/'paper'/d)
# 小体积匿名原型源码附件，剔除本地作者路径、原始模板与打包器。
codezip=review/'原型与源码.zip'
with zipfile.ZipFile(codezip,'w',zipfile.ZIP_DEFLATED) as z:
 for folder in ['engine','cases','tests','prototype','data']:
  for p in (R/folder).rglob('*'):
   if p.is_file():z.write(p,p.relative_to(R))
 for n in ['README.md','tools/build.js','tools/case_report.js']:
  z.write(R/n,n)
 for d in ['verification_20261022','verification_v2']:
  for p in (R/'paper'/d).glob('*'):
   if p.is_file():z.write(p,p.relative_to(R))
readme='''# 数智选材本地完整交付（v2）

v2 保持默认选优数值与 v1 一致（回归测试锁定），因此 10 页 PPTX 与解说视频沿用 v1，内容未涉及的新能力：独立种子复验、稳健选优、碳排约束、Shapley 归因、雷达对比、关联图查询。若汇报中需要展示，应另行更新演示材料。文档中 02/04/05 为 v2 更新版。

本包用于本地交付和恢复。不能把整个归档直接当作平台提交回执。

## 评审材料

PDF文档包含项目简表、说明书、商业计划书、技术交接及七案例报告。另有可编辑DOCX、10页PPTX及PDF、约134秒中文合成语音方案解说视频、原型与源码ZIP。视频为汇报页解说，不是软件录屏。文档的中文字体已内嵌，PPT如需编辑可使用研发源码/assets/fonts中的OFL字体。

简表与说明书为必交；商业计划书和演示材料为选交；软件原型及源码需附。实际格式、文件大小和上传栏目须在官网登录后核对。请按栏目选择文件，不要上传研发源码目录中的原始参考模板及本地核验记录。

## 仍需真实确认

团队名称、作品编号、成员和身份字段的匿名处理方式尚未提供或确认，简表已明确标出，不能编造。学校资格审核、报名及上传状态尚无确认。本地包不代表已经报名或提交。

2026年10月23日中午12:00为报名及资格审核截止；10月25日中午12:00为作品提交截止，均为北京时间。以官网后续调整为准。

## 数据和验证边界

七例均为构造测试案例，规则门槛仍需原文逐项复核，材料性能和费用为待标定先验。模型内联合通过比例和抽样区间不能证明工程成功概率。暂无独立材料试验、客户收入或实际降本延寿证据。

引擎与本地API测试共36项通过，文档与汇报页已渲染检查，媒体全流解码通过。v2 已用无头 Chromium 在桌面与移动视口检查离线原型（收据见研发源码/paper/verification_v2/ui/），不等同于真机或用户测试。

## 复现

解压后进入研发源码，运行 node --test tests/*.test.js、node tools/build.js、node tools/case_report.js、node tools/robustness.js。核心原型仅需Node.js，无第三方依赖。文档生成另需Python及python-docx/lxml；演示生成使用随Codex提供的artifact-tool运行时，视频生成使用macOS Tingting合成语音与ffmpeg。

SHA256.json记录包内文件身份。修改任何文件后，应形成新版本重新校验。
'''
(S/'先读说明.md').write_text(readme)
qa=R/'.work/qa/document_text_checks.json';checks=json.loads(qa.read_text()) if qa.exists() else 'not_recorded_in_this_version'
(S/'本地核验摘要.json').write_text(json.dumps({'date':'2026-10-22 Asia/Shanghai','documents':checks,'slides':10,'native_tables':2,'tests':36,'ui_check':'headless Chromium, see 研发源码/paper/verification_v2/ui/receipt.json','selection_default':'point (v1 numbers locked by regression test)','video':{'duration_seconds':133.689229,'video_codec':'h264','audio_codec':'aac','resolution':'1280x720','mean_volume_db':-20.8,'max_volume_db':-5.3,'full_decode':'pass','synthetic_voice':'macOS Tingting'},'browser_interaction':'headless_chromium_desktop_and_mobile_viewport_only','portal':'not_submitted','identity_fields':'pending'},ensure_ascii=False,indent=2))
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
backup=Path(os.environ.get('SZXC_BACKUP',str(R/'.work/backup')))/f'完整交付_{VER}'
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
before=json.loads((cwd/'paper/verification_v2/cases.json').read_text())
subprocess.run(['node','tools/case_report.js'],cwd=cwd,check=True,capture_output=True)
after=json.loads((cwd/'paper/verification_v2/cases.json').read_text())
for xs in [before,after]:
 for x in xs:
  x['output'].pop('elapsedMs',None)
  if x.get('outputValidated'):x['outputValidated'].pop('elapsedMs',None)
assert before==after,'案例复现结果不一致'
receipt={'archive':archive.name,'bytes':archive.stat().st_size,'sha256':digest(archive),'files':len(manifest)+1,'crc':'pass','manifest_hashes':'pass','independent_copy':'pass','restored_tests':36,'offline_rebuild':'byte_identical','case_replay':'identical_except_timing','external_status':'not_uploaded_or_submitted'}
(R/f'提交包/校验回执_{DAY}_{VER}.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2))
cp(R/f'提交包/校验回执_{DAY}_{VER}.json',backup/'校验回执.json')
print(json.dumps(receipt,ensure_ascii=False,indent=2))
