"""最终完整包（LaTeX 文档 + beamer 汇报稿 + 新解说视频 + 源码）。不会上传。"""
from pathlib import Path
import hashlib, json, shutil, zipfile, subprocess
R = Path(__file__).resolve().parents[1]
NAME = '数智选材_完整交付_20261023_v3'
S = R/'提交包'/NAME
assert not S.exists()
def cp(a, b): b.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(a, b)
def tree(a, b):
    for p in a.rglob('*'):
        if p.is_file() and '__pycache__' not in p.parts and p.suffix not in ('.aux',): cp(p, b/p.relative_to(a))
rv = S/'评审材料'
for p in (R/'latex/pdf').glob('*.pdf'): cp(p, rv/'LaTeX_PDF'/p.name)
for p in (R/'latex').glob('*.tex'): cp(p, rv/'LaTeX_源码'/p.name)
for p in ['tools/build_latex.py', 'tools/build_deck_latex.py']: cp(R/p, rv/'LaTeX_源码'/Path(p).name)
for p in (R/'deliverables/文档_v2').glob('*.docx'): cp(p, rv/'备用_DOCX（官网模板为DOCX）'/p.name)
tree(R/'deliverables/演示_v2', rv/'解说视频')
old = R/'提交包/数智选材_完整交付_20261022_v2/评审材料/原型与源码.zip'
cp(old, rv/'原型与源码.zip')
src = S/'研发源码'
for f in ['engine', 'cases', 'tests', 'tools', 'prototype', 'data', 'assets', '00_赛题', 'latex']: tree(R/f, src/f)
for f in ['README.md', 'CHANGELOG_v2.md', 'MANIFEST.md']: cp(R/f, src/f)
for p in (R/'paper').glob('*.md'): cp(p, src/'paper'/p.name)
tree(R/'paper/verification_v2', src/'paper/verification_v2')
tree(R/'paper/figs', src/'paper/figs')
(S/'先读说明.md').write_text('''# 数智选材 完整交付（v3：LaTeX 文档版）

## 内容
- 评审材料/LaTeX_PDF：01 项目简表、02 项目说明书、03 商业计划书、04 技术交接与数据证据、05 七案例验证报告、汇报稿_v2（beamer，9 页）。全部由 XeLaTeX 排版，源码在 LaTeX_源码（`python3 tools/build_latex.py` 与 `tools/build_deck_latex.py` 可重建，需 texlive-lang-chinese 与 Noto CJK 字体）。
- 评审材料/解说视频：新做的 9 页解说视频（约 3 分 49 秒）及解说词。
- 评审材料/备用_DOCX：官网附件模板为 DOCX，如平台强制上传 DOCX，请用这一版（由 v2 脚本生成，非 LaTeX）。
- 评审材料/原型与源码.zip、研发源码：引擎、离线原型、36 项测试、验证数据。

## 必须知道的限制
1. 解说为本地合成语音（sherpa-onnx，vits-zh-hf-fanchen-C，许可证未核实），没有人工试听，请先听一遍再决定是否使用；“Shapley”读作“沙普利”。
2. 视频为静态汇报页加解说，不是软件录屏；v1 的 PPTX 与旧视频未更新，已不再随本包提供，汇报稿以 beamer PDF 为准。
3. 独立复验显示 C1 在默认种子下选优 0.865、复验 0.838，低于 0.85 目标；C2、C5 始终未达标。所有数字均来自待标定先验的同一模型，不是工程验证。
4. 简表与说明书字数、官网格式、匿名要求须在官网登录后再核对；团队名、作品编号、成员待确认。未向比赛官网提交。
5. 截止时间：作品提交 10 月 25 日 12:00（北京时间），以官网为准。
''', encoding='utf8')
h = {str(p.relative_to(S)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(S.rglob('*')) if p.is_file()}
(S/'SHA256.json').write_text(json.dumps(h, ensure_ascii=False, indent=1), encoding='utf8')
z = R/'提交包'/(NAME+'.zip')
with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as zf:
    for p in sorted(S.rglob('*')):
        if p.is_file(): zf.write(p, Path(NAME)/p.relative_to(S))
print(z, z.stat().st_size, len(h))
