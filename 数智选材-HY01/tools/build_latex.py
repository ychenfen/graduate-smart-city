#!/usr/bin/env python3
"""用 LaTeX（XeLaTeX + ctex）生成评审文档：简表、说明书、商业计划书、技术交接、七案例报告。
内容单一来源：paper/*.md 内容稿、paper/verification_v2/*.json、tests 与实验输出；不手抄数字。
用法：python3 tools/build_latex.py        # 生成 latex/*.tex 并编译为 latex/pdf/*.pdf
依赖：xelatex、texlive-lang-chinese、Noto Serif/Sans CJK 字体。
匿名：不写作者、单位和导师；PDF 元数据 Author 留空。"""
import json, re, subprocess, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEX = ROOT / 'latex'
PDF = TEX / 'pdf'
TEX.mkdir(exist_ok=True)
PDF.mkdir(exist_ok=True)
TITLE = '数智选材 道路养护材料方案推荐原型'

PREAMBLE = r'''\documentclass[UTF8,fontset=none,zihao=-4,a4paper]{ctexart}
\usepackage[top=2.5cm,bottom=2.4cm,left=2.6cm,right=2.6cm]{geometry}
\usepackage{fontspec}
\setmainfont{Noto Serif CJK SC}
\setsansfont{Noto Sans CJK SC}
\setmonofont{Noto Sans Mono CJK SC}[Scale=0.88]
\setCJKmainfont{Noto Serif CJK SC}
\setCJKsansfont{Noto Sans CJK SC}
\setCJKmonofont{Noto Sans Mono CJK SC}[Scale=0.88]
\usepackage{booktabs,longtable,array,graphicx,xcolor,amssymb,amsmath}
\usepackage{fancyhdr,url,enumitem,tcolorbox}
\usepackage[hidelinks,pdfauthor={},pdfcreator={XeLaTeX},pdftitle={%(title)s}]{hyperref}
\urlstyle{same}
\def\UrlBreaks{\do\/\do\-\do\_\do\.\do\=\do\?\do\&}
\setlength{\parindent}{2em}
\linespread{1.32}
\setlist{itemsep=2pt,topsep=4pt}
\ctexset{section={format=\Large\bfseries\sffamily,beforeskip=1.6ex plus .3ex,afterskip=1.0ex},
         subsection={format=\large\bfseries\sffamily,beforeskip=1.2ex,afterskip=.6ex}}
\pagestyle{fancy}\fancyhf{}
\fancyhead[L]{\small\sffamily %(head)s}
\fancyhead[R]{\small\sffamily 匿名评审版}
\fancyfoot[C]{\small\thepage}
\renewcommand{\headrulewidth}{0.3pt}
\definecolor{note}{RGB}{245,241,230}
\newtcolorbox{notebox}{colback=note,colframe=black!35,boxrule=.4pt,left=6pt,right=6pt,top=4pt,bottom=4pt}
\newcommand{\ck}{$\boxtimes$}
\newcommand{\uck}{$\square$}
\begin{document}
'''
END = '\n\\end{document}\n'

SPECIAL = {'\\': r'\textbackslash{}', '&': r'\&', '%': r'\%', '$': r'\$', '#': r'\#', '_': r'\_', '{': r'\{', '}': r'\}', '~': r'\textasciitilde{}', '^': r'\textasciicircum{}'}
SUB = {'₂': r'\textsubscript{2}', '²': r'\textsuperscript{2}', '³': r'\textsuperscript{3}'}


def esc(s):
    return ''.join(SPECIAL.get(c, SUB.get(c, c)) for c in s)


def tt(s):
    out = ''
    for c in s:
        out += SPECIAL.get(c, c)
        if c in '/._-=,':
            out += r'\allowbreak{}'
    return r'\texttt{' + out + '}'


TOK = re.compile(r'(`[^`]+`|\*\*[^*]+\*\*|https?://[^\s，。；）)]+)')


def inline(s):
    out = ''
    for part in TOK.split(s):
        if not part:
            continue
        if part.startswith('`'):
            out += tt(part[1:-1])
        elif part.startswith('**'):
            out += r'\textbf{' + esc(part[2:-2]) + '}'
        elif part.startswith('http'):
            out += r'\url{' + part + '}'
        else:
            out += esc(part)
    return out


def table(rows, widths=None):
    n = len(rows[0])
    if widths is None:
        widths = [1 / n] * n
    spec = ''.join(r'>{\raggedright\arraybackslash}p{%.3f\dimexpr\textwidth-%d\tabcolsep\relax}' % (w, 2 * n) for w in widths)
    t = r'\begingroup\small\setlength{\parindent}{0pt}\linespread{1.15}' + '\n' + r'\begin{longtable}{' + spec + '}\n\\toprule\n'
    t += ' & '.join(r'\textbf{' + inline(c) + '}' for c in rows[0]) + ' \\\\\n\\midrule\n\\endhead\n'
    for r in rows[1:]:
        t += ' & '.join(inline(c) for c in r) + ' \\\\\n'
    return t + '\\bottomrule\n\\end{longtable}\n\\endgroup\n'


def md_blocks(text, heading_level0=1):
    """极简 Markdown → LaTeX：## 一级节，### 小节，- 列表，| 表格，空行分段。"""
    out, lines, i = '', text.splitlines(), 0
    para = []

    def flush():
        nonlocal para, out
        if para:
            out += inline(' '.join(para)) + '\n\n'
            para = []
    while i < len(lines):
        ln = lines[i]
        if ln.startswith('## '):
            flush(); out += '\\section*{' + inline(ln[3:]) + '}\n'
        elif ln.startswith('### '):
            flush(); out += '\\subsection*{' + inline(ln[4:]) + '}\n'
        elif ln.startswith('|'):
            flush(); rows = []
            while i < len(lines) and lines[i].startswith('|'):
                if not lines[i].startswith('|---'):
                    rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')])
                i += 1
            out += table(rows, [0.22, 0.38, 0.40] if len(rows[0]) == 3 else None)
            continue
        elif ln.startswith('- '):
            flush(); out += '\\begin{itemize}\n'
            while i < len(lines) and lines[i].startswith('- '):
                out += '\\item ' + inline(lines[i][2:]) + '\n'; i += 1
            out += '\\end{itemize}\n'
            continue
        elif not ln.strip():
            flush()
        else:
            para.append(ln.strip())
        i += 1
    flush()
    return out


def sections(path):
    t = path.read_text(encoding='utf8')
    parts = re.split(r'\n## ', t)[1:]
    return [(p.split('\n', 1)[0], p.split('\n', 1)[1].strip()) for p in parts]


def titleblock(sub):
    return (r'\begin{center}{\Large\bfseries\sffamily ' + esc(TITLE) + r'}\\[4pt]{\large ' + sub + r'}\end{center}' + '\n\\vspace{2pt}\n')


def write(name, head, body):
    (TEX / name).write_text(PREAMBLE % {'title': TITLE, 'head': head} + body + END, encoding='utf8')


def md_section_body(sec):
    # 内容稿里的“### 小标题”保留，段落正文
    return md_blocks(sec)


# ---------- 01 项目简表 ----------
def build_brief():
    secs = sections(ROOT / 'paper/项目简表_内容稿.md')[:4]
    limits = [300, 300, 600, 300]
    labels = ['（1）项目背景', '（2）立项思路', '（3）解决方案', '（4）商业模式和预期效益']
    for (_, s), lim in zip(secs, limits):
        assert len(re.sub(r'\s', '', s)) <= lim, (len(re.sub(r'\s', '', s)), lim)
    rows = [
        ('作品名称', esc(TITLE)),
        ('团队名称', '待确认（匿名团队名，不得含培养单位）'),
        ('参赛赛道/赛题', r'\ck\ 13.企业揭榜赛道\quad HY-01 课题一'),
        ('队长姓名/联系电话', '匿名评审版'),
        ('团队成员', '匿名评审版，身份信息按报名系统登记'),
    ]
    b = titleblock('项目简表（附件 1 栏目）')
    b += r'{\small\noindent 参照官网附件 1 栏目编排；该 PDF 为 LaTeX 排版件，官方 DOCX 模板填写版另见随附可编辑文档。\par}' + '\n'
    b += r'\begin{longtable}{>{\bfseries\sffamily}p{3.2cm}p{\dimexpr\textwidth-3.2cm-4\tabcolsep}}' + '\n\\toprule\n'
    for k, v in rows:
        b += k + ' & ' + v + ' \\\\\n\\midrule\n'
    for lab, (_, s), lim in zip(labels, secs, limits):
        b += r'\multicolumn{2}{l}{\bfseries\sffamily ' + lab + r'\quad{\small\mdseries（不超过 %d 字，实际 %d 字）}} \\' % (lim, len(re.sub(r'\s', '', s))) + '\n'
        b += r'\multicolumn{2}{p{\dimexpr\textwidth-2\tabcolsep}}{\setlength{\parindent}{2em}' + md_blocks(s).replace('\n\n', r'\par ') + '} \\\\\n\\midrule\n'
    b += '作品所处研发阶段 & \\ck\\ 创意设计类\\quad \\uck\\ 基础研究类\\quad \\uck\\ 软硬件开发类\\quad \\uck\\ 工程实施类 \\\\\n\\midrule\n'
    b += '先进性 & \\uck\\ 国际领先\\quad \\uck\\ 国际先进\\quad \\uck\\ 国内领先\\quad \\uck\\ 国内先进\\quad \\uck\\ 国内一般\\quad \\ck\\ 无法判断 \\\\\n\\midrule\n'
    b += '成果交付物类型 & \\uck\\ 硬件\\quad \\ck\\ 软件\\quad \\uck\\ 工艺\\quad \\ck\\ 方法\\quad \\uck\\ 服务\\quad \\uck\\ 商业模式 \\\\\n\\midrule\n'
    b += '技术成熟度（单选） & \\uck\\ 第 1 级\\quad \\uck\\ 第 2 级\\quad \\ck\\ 第 3 级\\quad \\uck\\ 第 4--9 级。自评：概念验证，未开展工程试验。 \\\\\n\\midrule\n'
    b += '国内外对比参照物 & \\ck\\ 无产品对标参照物。方法基线：程序化经验规则、加权评分和最低初始成本。无同条件商业产品实测。 \\\\\n\\midrule\n'
    b += r'关键指标提升情况 & {\small\setlength{\tabcolsep}{4pt}\begin{tabular}{@{}lllll@{}}\toprule 指标名称&指标值&参照值&提升度\%&参照对象\\\midrule 材料性能提升&未验证&未验证&不适用&无独立试验\\ 工程成本降低&未验证&未验证&不适用&无工程试点\\ 实际寿命提升&未验证&未验证&不适用&无长期监测\\ 实际减碳收益&未验证&未验证&不适用&无完整清单\\ 软件验证&见案例附件&方法基线&不作工程提升&本地测试\\\bottomrule\end{tabular}} \\' + '\n\\midrule\n'
    b += '提升维度 & \\uck\\ 质量提升（未实测）\\quad \\uck\\ 成本降低（未实测）\\quad \\uck\\ 效率提升（未计时验证）\\quad \\uck\\ 交付周期缩短（未实测）\\quad \\ck\\ 新功能实现：约束筛选、候选解释、独立复验、无解提示和反馈演示 \\\\\n\\bottomrule\n\\end{longtable}\n'
    write('01_项目简表.tex', '项目简表', b)


# ---------- 02 / 03 ----------
def build_body_doc(md, out, sub, head, source_sentence=None):
    b = titleblock(sub)
    for h, s in sections(md):
        if h == '来源与附件' and source_sentence:
            b += '\\section*{来源与附件}\n' + inline(source_sentence) + '\n\n'
            continue
        b += '\\section*{' + inline(h) + '}\n' + md_section_body(s)
    write(out, head, b)


# ---------- 04 技术交接 ----------
def build_tech():
    t = (ROOT / 'paper/技术交接与数据证据.md').read_text(encoding='utf8')
    body = md_blocks('\n'.join(t.splitlines()[1:]))
    rob = json.loads((ROOT / 'paper/verification_v2/robustness.json').read_text(encoding='utf8'))
    b = titleblock('技术交接与数据证据')
    b += body
    b += '\\section*{附表：多种子稳定性与选优乐观偏差}\n'
    b += '{\\small 6 个混合料案例 $\\times$ 12 个种子；选优 400 次抽样，复验为独立种子 4000 次抽样。同一先验模型内的统计，不是工程验证。\\par}\n'
    rows = [['案例', '目标', '选优方式', '同一推荐占比', '选优均值', '复验均值', '偏差均值', '复验达标比例']]
    for r in rob['rows']:
        for k, m in r['modes'].items():
            rows.append([r['id'], f"{r['target']:.2f}", '同批抽样' if k == 'point' else '独立复算', f"{m['modalAgreement']*100:.0f}\\%".replace('\\%', '%'), f"{m['selectionReliabilityMean']:.3f}", f"{m['validatedReliabilityMean']:.3f}", f"{m['optimismGapMean']:+.3f}", f"{m['validatedMeetsTargetRate']*100:.0f}%"])
    b += table(rows, [0.08, 0.08, 0.14, 0.16, 0.13, 0.13, 0.13, 0.15])
    write('04_技术交接与数据证据.tex', '技术交接与数据证据', b)


# ---------- 05 七案例 ----------
def build_cases():
    data = json.loads((ROOT / 'paper/verification_v2/cases.json').read_text(encoding='utf8'))
    b = titleblock('七案例推荐与验证')
    b += '七个案例均为合理构造的测试案例。气候为近似演示值，材料和费用为待标定先验。表中结果为同一模型内比较，不能证明工程精度、实际降本或延寿。95\\% 区间仅含抽样误差。\n\n'
    for c in data:
        o = c['output']
        b += '\\section*{' + esc(c['id'] + ' ' + c['title']) + '}\n' + esc(c['background']) + '\n\n'
        if o.get('module') == 'crack':
            b += '规则方案：' + esc(o['method']) + '；' + esc(o['sealant']['name']) + '。' + esc(o['reason']) + '。\n\n无独立材料试验和专家对照，此例仅检查规则适用流程。\n\n'
            continue
        r = o['recommended']
        b += '\\textbf{推荐：}' + esc(r['label']) + '\n\n'
        b += f"规则后候选 {o['stats']['feasible']} 个，目标 {o['targetReliability']:.2f}，选优抽样内{'达到' if o['targetReached'] else '未达'}目标；瓶颈指标：{esc(r['bottleneckName'])}；95\\% 抽样区间 {r['reliabilityInterval95'][0]}--{r['reliabilityInterval95'][1]}（{r['samples']} 次）。\n\n"
        v = r['validation']
        b += f"\\textbf{{独立种子复验}}（{v['samples']} 次）：联合比例 {v['reliability']}，区间 {v['reliabilityInterval95'][0]}--{v['reliabilityInterval95'][1]}，选优偏差 {v['selectionGap']:+.3f}，{'仍达到' if v['meetsTargetPoint'] else '\\textbf{未达到}'}目标。\n\n"
        w = c.get('outputValidated')
        if w and w.get('recommended'):
            wr = w['recommended']
            same = wr['id'] == r['id']
            b += '稳健选优' + ('与默认选优为同一方案。' if same else f"方案：{esc(wr['label'])}；复验联合比例 {wr['validation']['reliability']}，年值成本 {wr['euac']}（默认 {r['euac']}）。") + '\n\n'
        rows = [['方法', '联合比例', '成本 元/m²', '估计寿命 年', '年值成本', '碳排']]
        for n, x in [('推荐', r), ('规则经验', o['baselines']['experience']), ('加权评分', o['baselines']['weightedSum']), ('最低成本', o['baselines']['cheapest'])]:
            rows.append([n, str(x['reliability']), str(x['costM2']), str(x['lifeMean']), str(x['euac']), str(x['carbonYr'])])
        b += table(rows, [0.18, 0.14, 0.17, 0.17, 0.17, 0.17]).replace('成本 元/m\\$\\^2\\$', '成本 元/m²')
        b += '{\\small 年均碳排单位 kgCO$_2$e/(m$^2\\cdot$年)。经验基线未必满足全部施工规则，不能直接作为可实施方案。\\par}\n\n'
        q = next(q['why'] for q in o['requirements'] if q['ind'] == r['bottleneck'])
        b += '\\textbf{瓶颈指标的需求依据：}' + esc(q) + '\n\n'
    b += '\\section*{验证范围}\n本报告检验场景录入、约束筛选、选优与解释逻辑。六个混合料案例及一个裂缝案例满足不少于五例的展示数量，覆盖至少三类需求；全部结果来自同一个先验评价器，不作为外部独立验证。完整输入输出见随附 JSON。\n'
    write('05_七案例验证报告.tex', '七案例推荐与验证', b)


def compile_all():
    for tex in sorted(TEX.glob('*.tex')):
        for _ in range(2):
            r = subprocess.run(['xelatex', '-interaction=nonstopmode', '-halt-on-error', '-output-directory', str(PDF), tex.name], cwd=TEX, capture_output=True, text=True)
            if r.returncode != 0:
                print(r.stdout[-2500:])
                sys.exit(f'xelatex failed: {tex.name}')
        print('ok', tex.name)
    for ext in ('aux', 'log', 'out', 'nav', 'snm', 'toc', 'vrb'):
        for f in PDF.glob('*.' + ext):
            if ext != 'log':
                f.unlink()


if __name__ == '__main__':
    build_brief()
    build_body_doc(ROOT / 'paper/项目说明书_内容稿.md', '02_项目说明书.tex', '项目说明书（附件 2 栏目）', '项目说明书',
                   '依据：官网 2026 参赛指南第 6—7 页与 HY-01 课题一第 1—5 页。数据来源分级与适用边界见技术交接附件。')
    build_body_doc(ROOT / 'paper/商业计划书_内容稿.md', '03_商业计划书.tex', '商业计划书（附件 3 栏目）', '商业计划书')
    build_tech()
    build_cases()
    compile_all()
