// 通用 Word 生成器：把简单的内容块数组渲染为与模板风格一致的 .docx
// 块类型：title / subtitle / name / h1 / h2 / h3 / p{lead,text} / bullets / num / img / table / note / meta / pagebreak
const fs = require('fs');
const path = require('path');
const sizeOf = (f) => { // 读取 PNG 尺寸
  const b = fs.readFileSync(f); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};
const D = require('docx');
const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, ShadingType, BorderStyle, Footer, PageNumber, LevelFormat, VerticalAlign, PageBreak } = D;

const FULL = 9026;
function runs(text, opts = {}) {
  // 支持 **粗体** 标记
  const parts = String(text).split(/(\*\*[^*]+\*\*)/);
  return parts.filter(Boolean).map((t) => t.startsWith('**') ? new TextRun({ text: t.slice(2, -2), bold: true, ...opts }) : new TextRun({ text: t, ...opts }));
}
function cellPara(text, o = {}) {
  return new Paragraph({ alignment: o.align || AlignmentType.LEFT, spacing: { line: 300, lineRule: D.LineRuleType.AUTO }, children: runs(text, { size: 21, bold: o.bold }) });
}
function table(b) {
  const cols = b.cols; const total = cols.reduce((a, c) => a + c, 0);
  const widths = cols.map((c) => Math.round(c / total * FULL)); widths[widths.length - 1] += FULL - widths.reduce((a, c) => a + c, 0);
  const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const mk = (cells, head) => new TableRow({ tableHeader: head, children: cells.map((t, i) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA }, borders, verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: head ? { type: ShadingType.CLEAR, color: 'auto', fill: 'DCE4EF' } : undefined,
    children: String(t).split('\n').map((line) => cellPara(line, { bold: head, align: head || (b.center && b.center.includes(i)) ? AlignmentType.CENTER : AlignmentType.LEFT }))
  })) });
  return new Table({ width: { size: FULL, type: WidthType.DXA }, columnWidths: widths, alignment: AlignmentType.CENTER,
    rows: [mk(b.head, true)].concat(b.rows.map((r) => mk(r, false))) });
}
function caption(t, next) { return new Paragraph({ keepNext: !!next, alignment: AlignmentType.CENTER, spacing: { before: 60, after: 200 }, children: [new TextRun({ text: t, size: 21, font: { eastAsia: 'SimHei' } })] }); }

function render(blocks, base) {
  const out = []; let fig = 0, tab = 0;
  for (const b of blocks) {
    if (b.title) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: b.title, bold: true, size: 28, font: { eastAsia: 'SimHei' } })] }));
    else if (b.subtitle) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: b.subtitle, bold: true, size: 36, font: { eastAsia: 'SimHei' } })] }));
    else if (b.name) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 }, children: [new TextRun({ text: b.name, size: 24, font: { eastAsia: 'SimHei' } })] }));
    else if (b.meta) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: b.meta, size: 21, color: '444444' })] }));
    else if (b.h1) out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(b.h1)] }));
    else if (b.h2) out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(b.h2)] }));
    else if (b.h3) out.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(b.h3)] }));
    else if (b.p !== undefined) out.push(new Paragraph({ indent: { firstLine: 480 }, alignment: AlignmentType.JUSTIFIED, children: (b.lead ? [new TextRun({ text: b.lead, bold: true })] : []).concat(runs(b.p)) }));
    else if (b.bullets) b.bullets.forEach((t) => out.push(new Paragraph({ numbering: { reference: 'bul', level: 0 }, alignment: AlignmentType.JUSTIFIED, children: runs(t) })));
    else if (b.num) { const ref = 'num' + (render.numId = (render.numId || 0) + 1); render.numRefs.push(ref); b.num.forEach((t) => out.push(new Paragraph({ numbering: { reference: ref, level: 0 }, alignment: AlignmentType.JUSTIFIED, children: runs(t) }))); }
    else if (b.img) {
      fig++; const f = path.resolve(base, b.img); const s = sizeOf(f); const w = b.w || 560; const h = Math.round(w * s.h / s.w);
      out.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, line: 240, lineRule: D.LineRuleType.AUTO }, children: [new ImageRun({ type: 'png', data: fs.readFileSync(f), transformation: { width: w, height: h } })] }));
      out.push(caption('图 ' + fig + '　' + b.caption));
    } else if (b.table) {
      tab++; out.push(caption('表 ' + tab + '　' + b.caption, true));
      out.push(table(b.table));
      out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    } else if (b.note) out.push(new Paragraph({ spacing: { line: 300, lineRule: D.LineRuleType.AUTO, after: 120 }, alignment: AlignmentType.JUSTIFIED, children: runs(b.note, { size: 20, color: '555555' }) }));
    else if (b.pagebreak) out.push(new Paragraph({ children: [new PageBreak()] }));
  }
  return out;
}
render.numRefs = [];

async function build(blocks, outFile, base) {
  render.numRefs = []; render.numId = 0;
  const children = render(blocks, base);
  const doc = new Document({
    styles: {
      default: { document: { run: { font: { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: 'SimSun' }, size: 24 }, paragraph: { spacing: { line: 360, lineRule: D.LineRuleType.AUTO } } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: true, font: { eastAsia: 'SimHei' } }, paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, font: { eastAsia: 'SimHei' } }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, font: { eastAsia: 'SimHei' } }, paragraph: { spacing: { before: 120, after: 60 }, outlineLevel: 2 } }
      ]
    },
    numbering: { config: [{ reference: 'bul', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }]
      .concat(render.numRefs.map((r) => ({ reference: r, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }))) },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })] }) },
      children
    }]
  });
  fs.writeFileSync(outFile, await Packer.toBuffer(doc));
}

// 字数统计：按章节（h1）统计去除空白后的字符（含标题、表格与图注）
function countBySection(blocks) {
  const res = []; let cur = null; let fig = 0, tab = 0;
  const add = (t) => { if (cur) cur.n += String(t).replace(/\*\*/g, '').replace(/\s/g, '').length; };
  for (const b of blocks) {
    if (b.h1) { cur = { h: b.h1, n: 0 }; res.push(cur); add(b.h1); continue; }
    if (b.h2) add(b.h2); if (b.h3) add(b.h3);
    if (b.p !== undefined) add((b.lead || '') + b.p);
    if (b.bullets) b.bullets.forEach(add); if (b.num) b.num.forEach(add);
    if (b.img) { fig++; add('图' + fig + b.caption); }
    if (b.table) { tab++; add('表' + tab + b.caption); add(b.table.head.join('')); b.table.rows.forEach((r) => add(r.join(''))); }
    if (b.note) add(b.note);
  }
  return res;
}
module.exports = { build, countBySection };
