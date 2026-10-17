import re, shutil, zipfile, os, html
import content_brief as c
SRC = '../../村长来了-智慧文旅与乡村振兴/01_项目简表_村长来了.docx'
OUT = '../01_项目简表_灯语守护.docx'
z = zipfile.ZipFile(SRC)
xml = z.read('word/document.xml').decode('utf8')

# 按段落取出原文本
paras = re.findall(r'<w:p>.*?</w:p>|<w:p .*?</w:p>', xml, re.S)
def ptext(p): return ''.join(re.findall(r'<w:t[^>]*>(.*?)</w:t>', p, re.S))
old_texts = [html.unescape(ptext(p)) for p in paras]

def find_after(label, n):
    i = old_texts.index(label)
    out = []
    j = i + 1
    while len(out) < n:
        if old_texts[j].strip() and not old_texts[j].startswith('（'):
            out.append(old_texts[j])
        j += 1
    return out

mapping = {}
def m(old, new): mapping[old] = new
m('村长来了——基于本地化多模态大模型的乡村文旅数字人导览与运营系统', c.NAME)
m('云上村声', c.TEAM)
m('5.定向赛道-智慧文旅与乡村振兴 ■', '5.定向赛道-智慧文旅与乡村振兴 □')
m('9.定向赛道-智慧生活与大健康 □', '9.定向赛道-智慧生活与大健康 ■')
for label, new in [('（1）项目背景', c.BG), ('（2）立项思路', c.IDEA), ('（3）解决方案', c.SOL), ('（4）商业模式和预期效益', c.BIZ)]:
    olds = find_after(label, len(new))
    for o, nw in zip(olds, new): m(o, nw)
m('□硬件　■软件　□工艺　□方法　■服务　■商业模式　□其他', '□硬件　■软件　□工艺　■方法　■服务　■商业模式　□其他')
m('对标产品：景区“一码游”类智慧导览小程序；传统景区电子语音导览器。', c.REF)
# 关键指标表
old_kpi = ['域外问题拒答率','100%','85.0%','17.6','去除两项改进的同一引擎','问答总体正确率','83.9%','80.4%','4.4','去除两项改进的同一引擎','讲解服务时段','24 小时/天','8 小时/天','200','人工讲解员','断网可用功能','问答、识物、明信片均可用','导览不可用','—','云端导览小程序']
new_kpi = [x for row in c.KPI for x in row]
note_old = [t for t in old_texts if t.startswith('注：前两项')][0]
m(note_old, c.KPI_NOTE)
nf_old = [t for t in old_texts if t.startswith('■新功能实现')][0]
m(nf_old, c.NEWFUNC)

# 逐段替换：KPI 单元格文本有重复，按出现顺序替换
kpi_iter = iter(zip(old_kpi, new_kpi))
start = old_texts.index('参照对象')
pending = next(kpi_iter, None)
new_paras = []
for idx, (p, t) in enumerate(zip(paras, old_texts)):
    nt = None
    if idx > start and pending and t == pending[0]:
        nt = pending[1]; pending = next(kpi_iter, None)
    elif t in mapping:
        nt = mapping[t]
    if nt is None:
        new_paras.append(p); continue
    runs = re.findall(r'<w:r>.*?</w:r>|<w:r .*?</w:r>', p, re.S)
    assert runs, t
    first = runs[0]
    if len(runs) >= 2 and '<w:b/>' in first and '：' in nt[:8]:
        lab, rest = nt.split('：', 1)
        r1 = re.sub(r'<w:t[^>]*>.*?</w:t>', '<w:t xml:space="preserve">' + html.escape(lab, quote=False) + '</w:t>', first, count=1, flags=re.S)
        r2 = re.sub(r'<w:t[^>]*>.*?</w:t>', '<w:t xml:space="preserve">' + html.escape('：' + rest, quote=False) + '</w:t>', runs[1], count=1, flags=re.S)
        q = p.replace(first, r1, 1).replace(runs[1], r2, 1)
        for r in runs[2:]: q = q.replace(r, '', 1)
        new_paras.append(q); continue
    if t.startswith('5.定向赛道'): first2 = first.replace('<w:b/><w:bCs/>', '<w:b w:val="false"/><w:bCs w:val="false"/>')
    elif t.startswith('9.定向赛道'): first2 = first.replace('<w:b w:val="false"/><w:bCs w:val="false"/>', '<w:b/><w:bCs/>')
    else: first2 = first
    p = p.replace(first, first2, 1); first = first2
    newrun = re.sub(r'<w:t[^>]*>.*?</w:t>', '<w:t xml:space="preserve">' + html.escape(nt, quote=False) + '</w:t>', first, count=1, flags=re.S)
    q = p.replace(first, newrun, 1)
    for r in runs[1:]: q = q.replace(r, '', 1)
    new_paras.append(q)
assert pending is None, pending
# 回写
out = xml
for p, q in zip(paras, new_paras):
    if p != q: out = out.replace(p, q, 1)
left = [k for k in mapping if k not in old_texts]
assert not left, left
tmp = OUT + '.tmp'
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == 'word/document.xml': data = out.encode('utf8')
        zout.writestr(item, data)
os.replace(tmp, OUT)
print('written', OUT)
