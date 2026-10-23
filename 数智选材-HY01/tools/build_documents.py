"""使用原始官网模板制作评审文档，原件不改写。依赖 python-docx / lxml。"""
from pathlib import Path
from copy import deepcopy
import hashlib, json, re, zipfile
import uuid
from lxml import etree as ET
from docx import Document
from docx.shared import Pt

ROOT=Path(__file__).resolve().parents[1]
REF=ROOT/'00_赛题/官网附件_20261022'
OUT=ROOT/'deliverables/文档'
QA=ROOT/'.work/qa'
OUT.mkdir(parents=True,exist_ok=True); QA.mkdir(parents=True,exist_ok=True)
NS={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
W='{'+NS['w']+'}'
TITLE='数智选材 道路养护材料方案推荐原型'
FONT='Noto Serif SC'

def text(el): return ''.join(el.itertext()) if False else ''.join(el.xpath('.//w:t/text()',namespaces=NS))
def setp(p,s):
    rp=p.find('.//'+W+'rPr'); rp=deepcopy(rp) if rp is not None else None
    for c in list(p):
        if c.tag!=W+'pPr': p.remove(c)
    pp=p.find(W+'pPr')
    if pp is None:pp=ET.SubElement(p,W+'pPr')
    spacing=pp.find(W+'spacing')
    if spacing is None:spacing=ET.SubElement(pp,W+'spacing')
    spacing.set(W+'line','480');spacing.set(W+'lineRule','exact')
    r=ET.SubElement(p,W+'r')
    if rp is not None:r.append(rp)
    else:rp=ET.SubElement(r,W+'rPr')
    rf=rp.find(W+'rFonts')
    if rf is None:rf=ET.SubElement(rp,W+'rFonts')
    for k in ['ascii','hAnsi','eastAsia','cs']:rf.set(W+k,FONT)
    for k in ['asciiTheme','hAnsiTheme','eastAsiaTheme','cstheme']:rf.attrib.pop(W+k,None)
    t=ET.SubElement(r,W+'t');t.text=s;t.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
    return p
def newp(proto,s): return setp(deepcopy(proto),s)
def write_package(src,root,target):
    changed=[]
    with zipfile.ZipFile(src) as zin,zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            b=zin.read(info.filename)
            if info.filename=='word/document.xml': b=ET.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True);changed.append(info.filename)
            elif info.filename=='docProps/core.xml':
                c=ET.fromstring(b)
                for e in c:
                    if ET.QName(e).localname in ['creator','lastModifiedBy','keywords','description']:e.text=''
                b=ET.tostring(c,xml_declaration=True,encoding='UTF-8',standalone=True);changed.append(info.filename)
            zout.writestr(info,b)
    with zipfile.ZipFile(src) as a,zipfile.ZipFile(target) as b:
        assert b.testzip() is None
        assert all(a.read(n)==b.read(n) for n in a.namelist() if n not in changed)
    return changed
def load(src):
    with zipfile.ZipFile(src) as z:return ET.fromstring(z.read('word/document.xml'))
def parse_md(path):
    t=path.read_text();parts=re.split(r'\n## ',t)[1:]
    return [(p.split('\n',1)[0],p.split('\n',1)[1].strip()) for p in parts]
def plain(s):return s.replace('`','').replace('**','')

# 结构与版式契约。正文/摘要为允许编辑区，其他部件保持原始字节。
contract=['# 官网模板执行契约','原始模板保留不变。修改仅涉及word/document.xml及去身份的core.xml。',
'官方正文标题、A4页面、页边距、表格网格、样式、页脚和关系均保留。正文填入会自然增加页数。',
'简表仅替换填写区、删去填写区的占位空段，保留所有栏目及嵌套指标表。',
'身份栏写匿名评审版，团队名写待确认，外部报名前必须核实。附录沿用说明书的页面样式。']
for n in ['项目简表','项目说明书','商业计划书']:
    p=REF/(n+'.docx');d=Document(p)
    contract.append(f'\n## {n}\n原件SHA256 {hashlib.sha256(p.read_bytes()).hexdigest()}')
    for s in d.sections:contract.append(f'A4 {s.page_width}×{s.page_height} EMU；边距 {s.top_margin},{s.right_margin},{s.bottom_margin},{s.left_margin}；页脚距 {s.footer_distance}')
    contract.append('段落槽位：'+ '; '.join(f'{i}:{p.text[:40]}' for i,p in enumerate(d.paragraphs) if p.text))
    contract.append('表格行数：'+str([len(t.rows) for t in d.tables]))
(ROOT/'.work/artifact.md').write_text('\n'.join(contract))

receipts=[]
# 项目简表：保持模板表格和各类选择项，替换内容槽。
src=REF/'项目简表.docx';root=load(src);body=root.find('w:body',NS);tbl=body.find('w:tbl',NS);rows=tbl.findall('w:tr',NS)
def cell(row,col):return rows[row].findall('w:tc',NS)[col]
def fillcell(c,s):
    ps=c.findall('w:p',NS);p=ps[0];setp(p,s)
    for q in ps[1:]:c.remove(q)
def replace_in(el,a,b):
    for p in el.xpath('.//w:p',namespaces=NS):
        if a in text(p):setp(p,text(p).replace(a,b))
fillcell(cell(0,1),TITLE)
fillcell(cell(1,1),'待确认（匿名团队名，不得含培养单位）')
replace_in(cell(2,1),'13.企业揭榜赛道               □','13.企业揭榜赛道               ☑  HY-01课题一')
for e in cell(2,1).xpath('.//w:sz|.//w:szCs',namespaces=NS):e.set(W+'val','24')
fillcell(cell(3,1),'匿名评审版');fillcell(cell(3,3),'匿名评审版');fillcell(cell(4,1),'匿名评审版，身份信息按报名系统登记')
sections=parse_md(ROOT/'paper/项目简表_内容稿.md')
for row,(_,s),limit in zip([6,8,10,12],sections[:4],[300,300,600,300]):
    assert len(re.sub(r'\s','',s))<=limit
    fillcell(cell(row,1),plain(s))
fillcell(cell(13,2),'☑创意设计类；□基础研究类；\n□软硬件开发类；□工程实施类')
fillcell(cell(14,2),'□国际领先；□国际先进；□国内领先；□国内先进；□国内一般；☑无法判断')
fillcell(cell(15,2),'□硬件 ☑软件 □工艺 ☑方法 □服务 □商业模式 □其他')
fillcell(cell(16,2),'□第1级 □第2级 ☑第3级 □第4级 □第5级 □第6级 □第7级 □第8级 □第9级\n自评：概念验证，未开展工程试验。')
fillcell(cell(17,2),'☑无产品对标参照物。方法基线：程序化经验规则、加权评分和最低初始成本。无同条件商业产品实测。')
inner=cell(18,2).find('w:tbl',NS)
for i,row in enumerate(inner.findall('w:tr',NS)[1:]):
    vals=[['材料性能提升','未验证','未验证','不适用','无独立试验'],['工程成本降低','未验证','未验证','不适用','无工程试点'],['实际寿命提升','未验证','未验证','不适用','无长期监测'],['实际减碳收益','未验证','未验证','不适用','无完整清单'],['软件验证','见案例附件','方法基线','不作工程提升','本地测试']][i]
    for c,s in zip(row.findall('w:tc',NS),vals):fillcell(c,s)
fillcell(cell(19,2),'□质量提升（未实测）\n□成本降低（未实测）\n□效率提升（未计时验证）\n□生产/交付周期缩短（未实测）\n☑新功能实现：约束筛选、候选解释、无解提示和反馈演示。')
fillcell(cell(19,1),'提升维度（可多选）：')
for i in [3,4,5,7,9,11,13,14,15,16,17,19]:
    prop=rows[i].find(W+'trPr')
    if prop is None:prop=ET.SubElement(rows[i],W+'trPr')
    ET.SubElement(prop,W+'cantSplit')
for p in body.findall('w:p',NS):
    if text(p)=='(模板)':setp(p,'HY-01课题一  匿名评审版')
receipts.append({'file':'01_项目简表.docx','changedParts':write_package(src,root,OUT/'01_项目简表.docx')})

def template_body(name,md,target,subtitle=TITLE):
    src=REF/(name+'.docx');root=load(src);body=root.find('w:body',NS);ps=body.findall('w:p',NS)
    head=deepcopy(ps[5]);proto=deepcopy(ps[6] if name=='项目说明书' else ps[8])
    setp(ps[3],subtitle)
    # 第5个正文段以后是填写槽，保留前面的题头和分节设置。
    for child in list(body)[5:]:
        if child.tag!=W+'sectPr':body.remove(child)
    sec=body.find('w:sectPr',NS)
    for h,s in parse_md(md):
        if h=='来源与附件':
            body.insert(body.index(sec),newp(proto,'依据：官网2026参赛指南第6—7页与HY-01课题一第1—5页。数据来源分级与适用边界见技术交接附件。'))
            continue
        p=newp(head,h);body.insert(body.index(sec),p)
        pp=p.find(W+'pPr')
        if pp is None:pp=ET.SubElement(p,W+'pPr')
        ET.SubElement(pp,W+'keepNext')
        rp=p.find('.//'+W+'rPr');ET.SubElement(rp,W+'b')
        for para in re.split(r'\n\s*\n',s):
            if para.startswith('### '):p=newp(proto,plain(para[4:]));
            else:p=newp(proto,plain(para.replace('\n',' ')))
            body.insert(body.index(sec),p)
    receipts.append({'file':target,'changedParts':write_package(src,root,OUT/target)})

template_body('项目说明书',ROOT/'paper/项目说明书_内容稿.md','02_项目说明书.docx')
template_body('商业计划书',ROOT/'paper/商业计划书_内容稿.md','03_商业计划书.docx')

# 技术附录用说明书的页边距和正文风格创建，正文更紧凑，所有对象可编辑。
def appendix(title):
    d=Document(REF/'项目说明书.docx')
    defaults=Document()
    for st in defaults.styles:
        if st.name not in d.styles:d.styles._element.append(deepcopy(st._element))
    for p in list(d.paragraphs):
        if p._p.getparent() is not None:p._p.getparent().remove(p._p)
    p=d.add_paragraph(title);p.style='Title'
    for st in ['Normal','Title','Heading 1','Heading 2']:
        d.styles[st].font.name=FONT;d.styles[st]._element.get_or_add_rPr().get_or_add_rFonts().set(W+'eastAsia',FONT)
        d.styles[st].font.color.rgb=__import__('docx').shared.RGBColor(0,0,0)
        pp=d.styles[st]._element.find(W+'pPr')
        if pp is not None:
            for b in pp.findall(W+'pBdr'):pp.remove(b)
    d.styles['Normal'].font.size=Pt(11)
    d.styles['Normal'].paragraph_format.line_spacing=Pt(19)
    d.styles['Normal'].paragraph_format.space_after=Pt(6)
    for st,size in [('Title',21),('Heading 1',14),('Heading 2',12)]:
        d.styles[st].font.size=Pt(size)
        d.styles[st].paragraph_format.line_spacing=Pt(size+8)
        d.styles[st].paragraph_format.keep_with_next=True
    for s in d.sections:
        grid=s._sectPr.find(W+'docGrid')
        if grid is not None:s._sectPr.remove(grid)
    d.core_properties.author='';d.core_properties.last_modified_by=''
    return d
d=appendix('数智选材 技术交接与数据证据')
technical_table=None
for line in (ROOT/'paper/技术交接与数据证据.md').read_text().splitlines()[1:]:
    if line.startswith('## '):d.add_heading(line[3:],1)
    elif line.startswith('|---'):continue
    elif line.startswith('|'):
        values=[x.strip() for x in line.strip('|').split('|')]
        if technical_table is None:technical_table=d.add_table(rows=0,cols=len(values));technical_table.style='Table Grid'
        for c,s in zip(technical_table.add_row().cells,values):c.text=s
    elif line.strip():d.add_paragraph(plain(line))
d.save(OUT/'04_技术交接与数据证据.docx')

data=json.loads((ROOT/'paper/verification_20261022/cases.json').read_text())
d=appendix('数智选材 七案例推荐与验证')
d.add_paragraph('七个案例均为合理构造的测试案例。气候为近似演示值，材料和费用为待标定先验。表中结果为同一模型内比较，不能证明工程精度、实际降本或延寿。95%区间仅含抽样误差。')
for c in data:
    d.add_heading(c['id']+' '+c['title'],1);d.add_paragraph(c['background']);o=c['output']
    if o.get('module')=='crack':
        d.add_paragraph('规则方案：'+o['method']+'；'+o['sealant']['name']);d.add_paragraph(o['reason']);d.add_paragraph('无独立材料试验和专家对照，此例仅检查规则适用流程。');continue
    r=o['recommended'];d.add_paragraph('推荐：'+r['label'])
    d.add_paragraph(f"规则后候选{o['stats']['feasible']}个，目标{o['targetReliability']:.2f}，模型内{'达到' if o['targetReached'] else '未达'}目标。瓶颈：{r['bottleneckName']}。95%抽样区间{r['reliabilityInterval95']}，样本数{r['samples']}。")
    tb=d.add_table(rows=1,cols=5);tb.style='Table Grid'
    for x,s in zip(tb.rows[0].cells,['方法','联合比例','成本 元/m²','估计寿命 年','年值成本']):x.text=s
    for n,v in [('推荐',r),('规则经验',o['baselines']['experience']),('加权评分',o['baselines']['weightedSum']),('最低成本',o['baselines']['cheapest'])]:
        for x,s in zip(tb.add_row().cells,[n,v['reliability'],v['costM2'],v['lifeMean'],v['euac']]):x.text=str(s)
    d.add_paragraph('年均碳排估计：'+str(r['carbonYr'])+' kgCO₂e/(m²·年)。经验基线未必满足全部施工规则，不能直接作为可实施方案。')
    d.add_paragraph('解释：'+next(q['why'] for q in o['requirements'] if q['ind']==r['bottleneck']))
d.add_heading('验证范围',1);d.add_paragraph('本报告检验场景录入、约束筛选、选优与解释逻辑。六个混合料案例及一个裂缝案例满足不少于五例的展示数量，覆盖至少三类需求；全部结果来自同一个先验评价器，不作为外部独立验证。完整输入输出在随附JSON中。')
d.save(OUT/'05_七案例验证报告.docx')

def embed_font(p):
    # 原模板内嵌仿宋仅覆盖原有字符。为新内容独立嵌入OFL完整字体。
    f=ROOT/'assets/fonts/NotoSerifSC-Regular.ttf'
    b=bytearray(f.read_bytes()); key=uuid.UUID('b35dbbc7-0481-4f95-9247-a38481e9c0a8');k=key.bytes[::-1]
    for i in range(32):b[i]^=k[i%16]
    RN='{http://schemas.openxmlformats.org/package/2006/relationships}'
    R='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
    CT='{http://schemas.openxmlformats.org/package/2006/content-types}'
    with zipfile.ZipFile(p) as z:parts={n:z.read(n) for n in z.namelist()}
    ft=ET.fromstring(parts['word/fontTable.xml']);entry=ET.SubElement(ft,W+'font');entry.set(W+'name',FONT)
    e=ET.SubElement(entry,W+'embedRegular');e.set(R+'id','rIdNotoFull');e.set(W+'fontKey','{'+str(key).upper()+'}')
    parts['word/fontTable.xml']=ET.tostring(ft,xml_declaration=True,encoding='UTF-8',standalone=True)
    rel=ET.fromstring(parts.get('word/_rels/fontTable.xml.rels',f'<Relationships xmlns="{RN[1:-1]}"/>'.encode()))
    e=ET.SubElement(rel,RN+'Relationship');e.set('Id','rIdNotoFull');e.set('Type',R[1:-1]+'/font');e.set('Target','fonts/NotoSerifSC.odttf')
    parts['word/_rels/fontTable.xml.rels']=ET.tostring(rel,xml_declaration=True,encoding='UTF-8',standalone=True)
    ct=ET.fromstring(parts['[Content_Types].xml'])
    if not any(e.get('Extension')=='odttf' for e in ct):
        e=ET.SubElement(ct,CT+'Default');e.set('Extension','odttf');e.set('ContentType','application/vnd.openxmlformats-officedocument.obfuscatedFont')
    parts['[Content_Types].xml']=ET.tostring(ct,xml_declaration=True,encoding='UTF-8',standalone=True)
    parts['word/fonts/NotoSerifSC.odttf']=bytes(b)
    # 附录继承的直接字符格式也须使用完整字体，防止主题字体指向原子集。
    doc=ET.fromstring(parts['word/document.xml'])
    if p.name.startswith(('04_','05_')):
        for table in doc.xpath('//w:tbl',namespaces=NS):
            trs=table.findall(W+'tr')
            for i,tr in enumerate(trs):
                prop=tr.find(W+'trPr')
                if prop is None:prop=ET.SubElement(tr,W+'trPr')
                ET.SubElement(prop,W+'cantSplit')
                if i==0:
                    ET.SubElement(prop,W+'tblHeader')
                    for pp in tr.xpath('.//w:p',namespaces=NS):
                        pr=pp.find(W+'pPr')
                        if pr is None:pr=ET.SubElement(pp,W+'pPr')
                        ET.SubElement(pr,W+'keepNext')
    for run in doc.xpath('//w:r[w:t]',namespaces=NS):
        rp=run.find(W+'rPr')
        if rp is None:rp=ET.SubElement(run,W+'rPr')
        rf=rp.find(W+'rFonts')
        if rf is None:rf=ET.SubElement(rp,W+'rFonts')
        for a in ['ascii','hAnsi','eastAsia','cs']:rf.set(W+a,FONT)
        for a in ['asciiTheme','hAnsiTheme','eastAsiaTheme','cstheme']:rf.attrib.pop(W+a,None)
    parts['word/document.xml']=ET.tostring(doc,xml_declaration=True,encoding='UTF-8',standalone=True)
    with zipfile.ZipFile(p,'w',zipfile.ZIP_DEFLATED) as z:
        for n,b in parts.items():z.writestr(n,b)
for p in OUT.glob('*.docx'):embed_font(p)
(ROOT/'.work/artifact.md').write_text((ROOT/'.work/artifact.md').read_text()+'\n字体修正：所有正文使用完整OFL Noto Serif SC并内嵌，修复原模板字体子集漏字；保留原有字体部件，新增fontTable条目及关系。标题和页面几何不变。\n')
(QA/'document_build_receipt.json').write_text(json.dumps(receipts,ensure_ascii=False,indent=2))
print('built 5 editable documents',OUT)
