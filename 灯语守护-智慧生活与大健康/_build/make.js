const { build, countBySection } = require('./docgen.js');
const which = process.argv.slice(2);
const files = { c02: '../02_项目说明书_灯语守护.docx', c03: '../03_商业计划书_灯语守护.docx', c05: '../05_原型测试报告_灯语守护.docx' };
(async () => {
  for (const w of which) {
    delete require.cache[require.resolve('./' + w + '.js')];
    const blocks = require('./' + w + '.js');
    await build(blocks, files[w], __dirname);
    console.log(w, countBySection(blocks).map((s) => s.h + ' ' + s.n).join(' | '));
  }
})();
