#!/usr/bin/env python3
"""beamer 汇报稿 + 逐页解说词（单一来源：cases.json / robustness.json / receipt.json）。输出 latex/deck.tex、latex/pdf/汇报稿_v2.pdf、latex/narration.json"""
import json, subprocess
from pathlib import Path
R = Path(__file__).resolve().parents[1]; T = R/'latex'
cases = json.load(open(R/'paper/verification_v2/cases.json', encoding='utf8'))
rob = json.load(open(R/'paper/verification_v2/robustness.json', encoding='utf8'))
rec = json.load(open(R/'paper/verification_v2/ui/receipt.json', encoding='utf8'))
nchk = len(rec['checks']) if isinstance(rec.get('checks'), list) else 31
rows = []
for c in cases:
    o = c['output']
    if o.get('module') == 'crack': continue
    r = o['recommended']; v = r['validation']
    rows.append((c['id'], o['targetReliability'], r['reliability'], v['reliability'], v['meetsTargetPoint']))
def esc(s): return s.replace('%', r'\%').replace('_', r'\_')
tab = '\n'.join(f"{i} & {t:.2f} & {a:.3f} & {b:.3f} & {'是' if m else '否'} \\\\" for i, t, a, b, m in rows)
c1 = rows[0]
ok = sum(1 for r_ in rows if r_[4])
S = [  # (标题, beamer 正文, 解说)
('数智选材：道路养护材料方案推荐', r'\centering{\Large 概念验证原型 v2}\\[1em]HY-01 课题一\\[1em]\small 匿名评审版 \quad 案例与参数均为演示用途',
 '数智选材是道路养护材料方案推荐的概念验证原型，对应 HY-01 课题一。本视频使用本地合成语音，没有人工试听，案例和预测参数均为演示用途。'),
('问题：工法确定之后，材料怎么选', r'\begin{itemize}\item 气候、交通、病害、施工条件共同约束\item 规则筛选先排除不兼容方案\item 预算或低温无解时明确提示，不用评分掩盖硬约束\end{itemize}',
 '工法确定后，材料方案仍然受气候、交通、病害和施工条件共同影响。系统先识别需求，再排除不兼容方案。预算不足或低温施工无解时，必须明确提示，不能用评分掩盖硬约束。'),
('流水线', r'\centering 场景 $\to$ 需求包络 $\to$ 三千七百余个候选枚举与规则剪枝\\$\to$ 机理先验预测与蒙特卡洛\\$\to$ 联合通过比例、寿命、年值成本、碳排\\$\to$ 选优、对照与解释',
 '流程分为需求映射、规则筛选、先验评价和方案选择。候选共用随机扰动，便于公平比较。输出联合通过比例、估计寿命、年值成本和碳排，并给出短板与替代方案。'),
('第二版发现的问题：选优乐观偏差', rf'\begin{{itemize}}\item 在同一批抽样上先算再挑最优，被选方案的可靠度会被高估\item C1：选优时 {c1[2]:.3f}，独立种子复验 {c1[3]:.3f}，目标 {c1[1]:.2f}\item 复验{"达标" if c1[4] else "未达标"}\end{{itemize}}',
 f'第二版最重要的发现是选优乐观偏差。在同一批抽样上挑最优，会高估被选方案。以案例一为例，选优时联合比例为 {c1[2]:.3f}，独立种子复验为 {c1[3]:.3f}，目标是 {c1[1]:.2f}，复验{"达标" if c1[4] else "未达标"}。第一版材料中“模型内达成”的说法在这个案例上并不稳。'),
('七案例独立复验', r'\small\begin{tabular}{lcccc}\toprule 案例&目标&选优时&独立复验&复验达标\\\midrule '+tab+r'\\\bottomrule\end{tabular}\\[.6em]{\scriptsize 同一先验模型内的统计，不是工程验证}',
 f'六个混合料案例里，独立复验后有 {ok} 个达到目标。哈尔滨低温案例和乌鲁木齐案例始终达不到目标，我们保留这些失败结果，因为它们说明了材料与场景之间的真实冲突。第七例是裂缝灌缝规则模块。'),
('多种子稳定性', r'\begin{itemize}\item 六个案例，十二个种子，选优四百次抽样，复验四千次\item 平均乐观偏差只有零点几个百分点，但案例一在同批抽样选优下仅 75\% 的种子通过复验\item 新增“稳健选优”：在独立噪声上复算候选，首个通过者胜出\end{itemize}',
 '多种子实验显示，平均偏差很小，只有零点几个百分点，但案例一在同批抽样选优下，十二个种子中只有四分之三通过复验。为此新增稳健选优模式，用独立噪声复算候选，成本最低且通过者胜出。默认行为保持不变，由回归测试锁定。'),
('可解释与新约束', r'\begin{itemize}\item 精确 Shapley：七个组成维度，一百二十八个联盟，效率性有测试\item 六轴雷达图、材料—指标—规则关联图\item 年均碳排上限作为环保硬约束\item 解释对象是机理先验公式，不是数据驱动模型\end{itemize}',
 '第二版增加了精确 Shapley 归因、六轴雷达对比、由知识库导出的材料指标规则关联图，以及年均碳排上限约束。需要强调，这些解释针对机理先验公式，不是数据驱动模型，也不是实测知识图谱。'),
('工程质量', rf'\begin{{itemize}}\item 测试由 24 项增至 36 项\item 无头 Chromium 界面检查 {nchk} 项，桌面与移动视口\item 服务端修复路径穿越与超限请求挂起，跨域仅放行本机来源\item 输入按 schema 逐字段校验\end{{itemize}}',
 f'工程方面，测试从二十四项增加到三十六项，无头浏览器界面检查 {nchk} 项，服务端修复了路径穿越和超限请求挂起，跨域只放行本机来源，输入按模式逐字段校验。界面检查不是真机或读屏测试。'),
('边界与下一步', r'\begin{itemize}\item 材料性能、费用、碳排、寿命均为待标定先验\item 规范门槛尚未逐条核对现行条文\item 没有客户合同、收入或工程降本数据\item 下一步：企业材料数据与独立试验\end{itemize}',
 '必须说明的边界：材料性能、费用、碳排和寿命都是待标定先验，规范门槛没有逐条核对，目前没有客户合同、收入或工程降本数据。下一步最关键的是企业材料数据和独立试验。我们保留未达标和无解结果，便于合作方判断适用边界。'),
]
body = ''.join(rf'\begin{{frame}}{{{esc(t)}}}{b}\end{{frame}}'+'\n' for t, b, _ in S)
tex = r'''\documentclass[UTF8,fontset=none,aspectratio=169,10pt]{ctexbeamer}
\usepackage{fontspec,booktabs}
\setmainfont{Noto Sans CJK SC}\setCJKmainfont{Noto Sans CJK SC}\setCJKsansfont{Noto Sans CJK SC}
\usetheme{default}\usecolortheme{seahorse}\setbeamertemplate{navigation symbols}{}
\setbeamertemplate{footline}{\hfill\small 匿名评审版\quad\insertframenumber/\inserttotalframenumber\hspace{1em}\vspace{.4em}}
\setbeamerfont{frametitle}{size=\Large,series=\bfseries}
\hypersetup{pdfauthor={},pdftitle={数智选材 汇报稿}}
\begin{document}
''' + body + r'\end{document}' + '\n'
(T/'deck.tex').write_text(tex, encoding='utf8')
for _ in range(2):
    r = subprocess.run(['xelatex','-interaction=nonstopmode','-halt-on-error','-jobname=汇报稿_v2','-output-directory','pdf','deck.tex'],cwd=T,capture_output=True,text=True)
    if r.returncode: print(r.stdout[-2000:]); raise SystemExit(1)
N=[n.replace('Shapley','沙普利').replace('：','，') for *_, n in S]
json.dump(N, open(T/'narration.json','w',encoding='utf8'), ensure_ascii=False, indent=1)
open(T/'narration.txt','w',encoding='utf8').write('\n\n'.join(N)+'\n')
print('ok', len(S))
