// 展示 PPT 生成脚本（pptxgenjs）：node ppt.js → ../06_展示PPT_灯语守护.pptx
const pptxgen = require('pptxgenjs');
const { applyTheme } = require('/mnt/skills/public/pptx/scripts/apply_theme.js');
const R = require('../04_原型系统源码/test/results.json');
const A = require('../04_原型系统源码/test/ablation.json');
const ab = (k) => A.find((x) => x.key === k);
const OUT = '../06_展示PPT_灯语守护.pptx';

const THEME = {
  name: '灯语守护', headFontFace: 'Microsoft YaHei', bodyFontFace: 'Microsoft YaHei',
  colors: { dk1: '1D2633', lt1: 'FFFFFF', dk2: '1B2A4A', lt2: 'EEF1F5', accent1: 'F2B33D', accent2: '3D8FD6', accent3: 'CC3333', accent4: '2F8A5E', accent5: 'C96A10', accent6: '8A94A6', hlink: '2A4F86', folHlink: '5D6878' }
};
const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = '灯语守护'; pres.author = '守灯人';
const C = pres.SchemeColor;
const NAVY = C.text2, LAMP = C.accent1, WATER = C.accent2, RED = C.accent3, GREEN = C.accent4, MUTED = C.accent6;

// 版式：深色封面/结尾、浅色内容（仅标题）
pres.defineSlideMaster({ title: 'DARK', background: { color: '1B2A4A' }, objects: [],
  slideNumber: { x: 12.5, y: 7.0, w: 0.6, h: 0.3, color: '8A94A6', fontSize: 10 } });
pres.defineSlideMaster({ title: 'CONTENT', background: { color: 'FFFFFF' },
  objects: [{ placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.35, w: 12.1, h: 0.8, fontSize: 30, bold: true, color: '1B2A4A', valign: 'middle', align: 'left', margin: 0 }, text: '' } },
    { text: { text: '灯语守护 · 智慧生活与大健康', options: { x: 0.6, y: 7.0, w: 6, h: 0.3, fontSize: 10, color: '8A94A6', margin: 0 } } }],
  slideNumber: { x: 12.5, y: 7.0, w: 0.6, h: 0.3, color: '8A94A6', fontSize: 10 } });

// 视觉母题：四格小窗（亮/暗）
function windowIcon(s, x, y, size, lit) {
  const g = size * 0.08, c = (size - g * 3) / 2;
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: size, h: size, fill: { color: '1B2A4A' }, rectRadius: 0.06, line: { color: '1B2A4A' } });
  [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([i, j], n) => s.addShape(pres.shapes.RECTANGLE, { x: x + g + i * (c + g), y: y + g + j * (c + g), w: c, h: c, fill: { color: lit.includes(n) ? 'F2B33D' : '3A4C70' }, line: { color: lit.includes(n) ? 'F2B33D' : '3A4C70' } }));
}
function T(s, text, o) { s.addText(text, Object.assign({ isTextBox: true, margin: 0, fontSize: 16, color: '1D2633', valign: 'top' }, o)); }
function card(s, x, y, w, h, fill) { s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, fill: { color: fill || 'EEF1F5' }, line: { color: fill || 'EEF1F5' }, rectRadius: 0.12 }); }

let sec = '';
function slide(master, section) { if (section && section !== sec) { pres.addSection({ title: section }); sec = section; } return pres.addSlide({ masterName: master, sectionTitle: sec }); }

// 1 封面
{
  const s = slide('DARK', '开场');
  s.addImage({ path: 'fig/s_facade.png', x: 6.9, y: 0.9, w: 5.9, h: 5.9 * 1052 / 1428, rounding: false });
  windowIcon(s, 0.8, 1.2, 0.9, [0, 3]);
  T(s, '灯语守护', { x: 0.8, y: 2.35, w: 6, h: 1.1, fontSize: 54, bold: true, color: 'FFFFFF' });
  T(s, '基于居家水电数据无感感知的独居老人安全预警系统', { x: 0.8, y: 3.5, w: 5.9, h: 0.9, fontSize: 20, color: 'DCE4F2' });
  T(s, '不装设备，只读两块表；学会一个人，守住一个家', { x: 0.8, y: 4.6, w: 5.9, h: 0.5, fontSize: 16, color: 'F2B33D' });
  T(s, '第十二届中国研究生智慧城市技术与创意设计大赛\n定向赛道 · 智慧生活与大健康　　团队：守灯人', { x: 0.8, y: 5.8, w: 6, h: 0.8, fontSize: 12, color: '8A94A6' });
  s.addNotes('各位评委好，我们是守灯人团队，作品叫“灯语守护”。一句话介绍：不给老人装任何设备，只读家里已有的电表和水表，就能每天确认一声“老人还好吗”。右边这栋楼来自我们的原型系统，每扇窗的明暗都由这一户此刻的用电量驱动。');
}
// 2 痛点
{
  const s = slide('CONTENT', '问题');
  s.addText('4600 万独居老人，最怕“出了事没人知道”', { placeholder: 'title' });
  const stats = [['3.23 亿', '60 周岁及以上老年人口\n占总人口 23.0%（2025 年末）'], ['约 4600 万', '独居老人\n按 14.2% 的独居比例推算'], ['首位', '跌倒是我国 65 岁以上老人\n因伤致死的首位原因']];
  stats.forEach(([n, l], i) => { const x = 0.6 + i * 4.1; card(s, x, 1.45, 3.8, 2.2); T(s, n, { x: x + 0.3, y: 1.65, w: 3.3, h: 0.9, fontSize: 40, bold: true, color: NAVY }); T(s, l, { x: x + 0.3, y: 2.6, w: 3.3, h: 0.9, fontSize: 14, color: '5D6878' }); });
  T(s, '现有手段各有短板', { x: 0.6, y: 3.95, w: 6, h: 0.45, fontSize: 20, bold: true, color: NAVY });
  const gaps = [['人工探访', '频次有限，夜间和节假日难覆盖'], ['摄像头 / 雷达', '要入户安装，老人抵触'], ['手环 / 紧急按钮', '要记得戴、记得按，出事时常用不上'], ['电力看护平台', '按小时看用电、固定阈值，发现慢、误报多']];
  gaps.forEach(([a, b], i) => { const x = 0.6 + (i % 2) * 6.15, y = 4.55 + Math.floor(i / 2) * 1.05; windowIcon(s, x, y + 0.08, 0.55, []); T(s, a, { x: x + 0.75, y, w: 5, h: 0.4, fontSize: 16, bold: true }); T(s, b, { x: x + 0.75, y: y + 0.42, w: 5.2, h: 0.4, fontSize: 14, color: '5D6878' }); });
  T(s, '数据来源：民政部、全国老龄办《2025 年度国家老龄事业发展公报》；第五次中国城乡老年人生活状况抽样调查；央视新闻', { x: 0.6, y: 6.65, w: 12, h: 0.3, fontSize: 10, color: '8A94A6' });
  s.addNotes('截至 2025 年末，我国 60 岁以上老人 3.23 亿，按 14.2% 的独居比例推算，独居老人约 4600 万。跌倒是 65 岁以上老人因伤致死的首位原因，独居老人最怕的是出了事没人知道。现有手段各有短板：人工探访频次有限；摄像头老人抵触；手环要记得戴；已有的电力看护平台按小时看用电、用固定阈值，发现慢、误报多。');
}
// 3 灵感
{
  const s = slide('CONTENT', '思路');
  s.addText('每天的开灯、烧水、冲马桶，就是最稳定的平安信号', { placeholder: 'title' });
  s.addImage({ path: 'fig/f3_day.png', x: 0.6, y: 1.4, w: 7.6, h: 7.6 * 0.405 });
  card(s, 8.6, 1.4, 4.1, 4.6, 'EEF1F5');
  T(s, '核心判据', { x: 8.9, y: 1.6, w: 3.6, h: 0.4, fontSize: 16, color: '5D6878' });
  T(s, '该有动静\n却没有动静', { x: 8.9, y: 2.05, w: 3.6, h: 1.4, fontSize: 30, bold: true, color: NAVY });
  T(s, [{ text: '电表：', options: { bold: true } }, { text: '开关电器形成“台阶”\n', options: {} }, { text: '水表：', options: { bold: true } }, { text: '冲马桶、洗漱几乎每次都是人的动作\n', options: {} }, { text: '颗粒度：', options: { bold: true } }, { text: '每 15 分钟一个读数，与智能电表、远传水表一致', options: {} }], { x: 8.9, y: 3.6, w: 3.6, h: 2.3, fontSize: 14, color: '1D2633', paraSpaceAfter: 6 });
  T(s, '蓝色区间是这位老人过去 28 天同一时刻的常见范围；橙线为当天用电，蓝柱为当天用水（模拟数据）', { x: 0.6, y: 4.65, w: 7.6, h: 0.5, fontSize: 12, color: '5D6878' });
  T(s, '三个转变：从“装设备”到“用数据”；从“一把尺子”到“一人一策”；从“人工核实”到“机器先问”', { x: 0.6, y: 5.5, w: 7.6, h: 0.8, fontSize: 16, bold: true, color: NAVY });
  s.addNotes('灵感来自一个朴素的观察：老人每天几点开灯、几点烧水、几点冲马桶，本身就是最稳定的平安信号。这张图是一位老人一天的用电和用水，蓝色区间是她过去 28 天同一时刻的常见范围。我们的核心判据只有一句话：该有动静却没有动静。');
}
// 4 架构
{
  const s = slide('CONTENT', '方案');
  s.addText('三层架构：采集、研判、处置', { placeholder: 'title' });
  const cols = [['采集', ['智能电表：15 分钟用电量', '远传水表：15 分钟用水量', '老人或家属授权接入', '户内不装任何新设备'], 'FFF4DE'], ['研判（社区边缘服务器）', ['个人基线：每晚重学 28 天', '分时段静默画像', '情境判断：灯亮无人 / 只剩冰箱', '大功率、持续用水', '起夜增多、作息偏离'], 'E3ECF8'], ['处置', ['关注：AI 自动外呼确认平安', '紧急：家属 + 网格员派单', '家属端：每日平安、外出报备', '处置结果回流调参'], 'FBE6E3']];
  cols.forEach(([h, items, fill], i) => {
    const x = 0.6 + i * 4.2; card(s, x, 1.45, 3.8, 4.6, fill);
    T(s, h, { x: x + 0.3, y: 1.7, w: 3.3, h: 0.5, fontSize: 20, bold: true, color: NAVY });
    T(s, items.map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < items.length - 1 } })), { x: x + 0.3, y: 2.4, w: 3.3, h: 3.4, fontSize: 15, paraSpaceAfter: 8 });
    if (i < 2) s.addShape(pres.shapes.RIGHT_ARROW, { x: x + 3.85, y: 3.55, w: 0.32, h: 0.4, fill: { color: '8A94A6' }, line: { color: '8A94A6' } });
  });
  T(s, '只传两条“15 分钟总量”曲线，不含图像、声音、位置；原始数据不出社区', { x: 0.6, y: 6.3, w: 12, h: 0.45, fontSize: 16, color: GREEN, bold: true });
  s.addNotes('系统分三层。采集层经授权读取电表和水表每 15 分钟的读数，户内不装任何设备。研判层部署在社区或街道的边缘服务器上，原始数据不出社区。处置层分级：关注级先由 AI 给老人打电话，紧急级同时通知家属和网格员。');
}
// 5 个人基线
{
  const s = slide('CONTENT', '方案');
  s.addText('一人一策：为每位老人学出“作息指纹”', { placeholder: 'title' });
  s.addImage({ path: 'fig/f4_print.png', x: 0.6, y: 1.35, w: 7.4, h: 7.4 * 0.42 });
  const pts = [['每晚重学', '用最近 28 个正常日更新基线，季节和作息变化自然吸收'], ['分时段静默画像', '“从这个时刻开始安静，TA 通常会安静多久”，按小时分别统计'], ['以起床为界', '夜里开始的安静，最晚在平时 95% 的起床时刻后 1 小时报警'], ['说得清', '“平时 95% 的日子在 06:45 前起床，今天到 08:15 仍没有动静”']];
  pts.forEach(([a, b], i) => { const y = 1.4 + i * 1.25; windowIcon(s, 8.4, y + 0.05, 0.5, [i % 4]); T(s, a, { x: 9.1, y, w: 3.7, h: 0.4, fontSize: 17, bold: true, color: NAVY }); T(s, b, { x: 9.1, y: y + 0.42, w: 3.7, h: 0.75, fontSize: 13, color: '5D6878' }); });
  T(s, '消融实验：去掉个人基线、改用统一阈值，危险事件检出率从 100% 降到 ' + (ab('noPersonal').dangerRecall * 100).toFixed(1) + '%，需上门误报升到 ' + ab('noPersonal').redFA.toFixed(2) + ' 次/户·月', { x: 0.6, y: 6.25, w: 12, h: 0.5, fontSize: 15, bold: true, color: RED });
  s.addNotes('同样安静 4 个小时，对爱午睡的老人很正常，对上午从不歇着的老人就很反常。所以我们为每位老人学出自己的作息指纹，按时段统计 TA 通常会安静多久。消融实验显示，去掉个人基线后，检出率从 100% 降到 72%，误报增加十倍。');
}
// 6 情境判断
{
  const s = slide('CONTENT', '方案');
  s.addText('情境判断：看动静“停”在什么状态', { placeholder: 'title' });
  const cs = [['灯一直亮着、功率纹丝不动', '睡眠时段出现 → 起夜后没能回床，阈值减半、直接紧急', RED], ['电器全关、只剩冰箱在转', '更像出门了 → 标注“疑似外出未归”，先外呼确认', MUTED], ['水一直流、没人开关电器', '持续出水超过个人最长时长 → 疑似浴室跌倒，紧急', WATER], ['大功率恒定运行 75 分钟', '电磁炉、电暖器空烧特征 → 火灾隐患，紧急', LAMP]];
  cs.forEach(([a, b, col], i) => { const y = 1.4 + i * 1.2; s.addShape(pres.shapes.OVAL, { x: 0.6, y: y + 0.12, w: 0.4, h: 0.4, fill: { color: col }, line: { color: col } }); T(s, a, { x: 1.2, y, w: 4.6, h: 0.45, fontSize: 17, bold: true }); T(s, b, { x: 1.2, y: y + 0.47, w: 4.6, h: 0.65, fontSize: 13, color: '5D6878' }); });
  s.addImage({ path: 'fig/f5_case.png', x: 6.1, y: 1.4, w: 6.7, h: 6.7 * 0.43 });
  T(s, '案例（模拟数据）：81 岁老人 00:41 起夜跌倒，卫生间灯一直亮着；系统 02:45 发出紧急预警，比她平时起床早约 4.7 小时', { x: 6.1, y: 4.45, w: 6.7, h: 0.8, fontSize: 13, color: '1D2633' });
  T(s, '夜间起夜跌倒 ' + R.perType.fall_night.n + ' 起全部检出，中位在平时起床前 ' + Math.abs(R.perType.fall_night.medianAfterUsualWakeH).toFixed(1) + ' 小时报警', { x: 6.1, y: 5.45, w: 6.7, h: 0.5, fontSize: 16, bold: true, color: NAVY });
  s.addNotes('光看有没有动静还不够，我们还看动静停在了什么状态。半夜卫生间灯一直亮着、功率纹丝不动，说明有人开了灯却没能去关，系统直接报紧急；电器全关、只剩冰箱，更像出门了，先打电话确认。右边是一个模拟案例：老人凌晨起夜跌倒，系统两点四十五分报警，比她平时起床早四个多小时。');
}
// 7 分级处置
{
  const s = slide('CONTENT', '方案');
  s.addText('机器先问一声，人再上门', { placeholder: 'title' });
  const steps = [['发现异常', '每条预警附依据', 'EEF1F5'], ['AI 自动外呼', '老人按任意键即报平安', 'FFF4DE'], ['未接通 / 紧急', '家属与网格员同时收到', 'FBE6E3'], ['上门处置', '结果回填，误报回流调参', 'E1F1E8']];
  steps.forEach(([a, b, f], i) => { const x = 0.6 + i * 2.15; card(s, x, 1.5, 1.95, 1.9, f); T(s, String(i + 1), { x: x + 0.2, y: 1.62, w: 0.6, h: 0.5, fontSize: 22, bold: true, color: NAVY }); T(s, a, { x: x + 0.2, y: 2.15, w: 1.6, h: 0.45, fontSize: 15, bold: true }); T(s, b, { x: x + 0.2, y: 2.6, w: 1.65, h: 0.7, fontSize: 12, color: '5D6878' }); });
  T(s, [{ text: '去掉自动外呼，需人上门的误报从 ', options: {} }, { text: R.fa.redPerHouseMonth.toFixed(2), options: { bold: true, color: GREEN } }, { text: ' 升到 ', options: {} }, { text: ab('noCall').redFA.toFixed(2), options: { bold: true, color: RED } }, { text: ' 次/户·月', options: {} }], { x: 0.6, y: 3.8, w: 8.4, h: 0.5, fontSize: 17 });
  T(s, '家属端只说家人关心的话：几点起的床、做没做饭、出没出门；没事时每晚一句“今天挺好”，出门旅游一键报备。', { x: 0.6, y: 4.5, w: 8.2, h: 1.0, fontSize: 15, color: '1D2633' });
  s.addImage({ path: 'fig/s_phone.png', x: 9.6, y: 1.25, w: 2.9, h: 2.9 * 1380 / 720 });
  s.addNotes('处置上，我们的原则是机器先问一声、人再上门。关注级先由系统自动给老人打电话，按任意键就算报平安；电话没人接或者出现紧急情况，家属和网格员同时收到提醒。这一环把大量其实没事的情况留在系统里消化，测试中需人上门的误报因此减少了一半以上。右边是家属端的样子。');
}
// 8 原型
{
  const s = slide('CONTENT', '原型');
  s.addText('原型系统：双击即可运行，不联网、不调用外部接口', { placeholder: 'title' });
  s.addImage({ path: 'fig/s_board.png', x: 0.6, y: 1.35, w: 8.6, h: 8.6 * 0.625 });
  const f = ['36 户独居老人的楼，窗户明暗由真实用电驱动', '点开一户：当天曲线、个人常见范围、作息指纹', '现场注入：夜里跌倒、洗澡跌倒、电磁炉忘关、水龙头忘关、报备外出', '算法不知道注入了什么，只看电表、水表读数', '家属手机端、方法与实测一并展示'];
  T(s, f.map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < f.length - 1 } })), { x: 9.5, y: 1.45, w: 3.3, h: 4.9, fontSize: 14, paraSpaceAfter: 10 });
  s.addNotes('这是我们的原型系统，双击网页即可运行，不联网、不调用任何外部接口。它模拟一栋 36 户独居老人的楼，按播放后能看到清晨窗户一扇扇亮起。答辩现场我们可以任选一户，注入“夜里起夜跌倒”或“电磁炉忘关”，系统会快进到它发现为止。');
}
// 9 测试结果
{
  const s = slide('CONTENT', '实测');
  s.addText('100 户、6200 个评测日：危险事件全部检出', { placeholder: 'title' });
  const big = [[(R.danger.recall * 100).toFixed(0) + '%', '六类危险事件检出率\n（' + R.danger.n + ' 起）'], [R.danger.medianDelayH.toFixed(1) + ' 小时', '从出事到报警的\n中位时间'], [R.fa.redPerHouseMonth.toFixed(2), '需人上门的误报\n次/户·月']];
  big.forEach(([n, l], i) => { const y = 1.45 + i * 1.6; T(s, n, { x: 0.6, y, w: 3.6, h: 0.85, fontSize: 40, bold: true, color: NAVY }); T(s, l, { x: 0.6, y: y + 0.85, w: 3.6, h: 0.65, fontSize: 13, color: '5D6878' }); });
  const keys = Object.keys(R.perType);
  s.addChart(pres.charts.BAR, [{ name: '检出率', labels: keys.map((k) => R.perType[k].name), values: keys.map((k) => +(R.perType[k].recall * 100).toFixed(1)) }], {
    x: 4.5, y: 1.35, w: 8.3, h: 4.9, barDir: 'bar', chartColors: ['1B2A4A'], showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: '0.0"%"', dataLabelFontSize: 11, dataLabelFontFace: '+mn-lt',
    catAxisLabelFontSize: 12, catAxisLabelFontFace: '+mn-lt', catAxisLabelColor: '1D2633', catAxisOrientation: 'maxMin', valAxisHidden: true, valAxisMaxVal: 115, valAxisMinVal: 0,
    valGridLine: { style: 'none' }, catGridLine: { style: 'none' }, showLegend: false, showTitle: true, title: '各类事件检出率（留出测试集）', titleFontSize: 13, titleFontFace: '+mn-lt', titleColor: '5D6878' });
  T(s, '数据由团队模拟器生成，开发集 40 户调参，留出集 100 户在参数定稿后运行；真实住户效果需试点验证。慢变化（起夜、作息偏离）检出率较低，定位为提醒关注。', { x: 0.6, y: 6.3, w: 12.2, h: 0.55, fontSize: 12, color: '5D6878' });
  s.addNotes('测试上，我们用自研的模拟器生成 100 户、每户 90 天的数据，参数只在另外 40 户的开发集上调整。留出集上 163 起危险事件全部检出，中位 1.2 小时报警，需人上门的误报每户每月 0.07 次。需要说明，这些都是模拟数据，真实效果要在试点中验证；起夜增多和作息偏离这类慢变化检出率较低，我们定位为提醒家属关注。');
}
// 10 对比
{
  const s = slide('CONTENT', '实测');
  s.addText('与固定阈值规则相比：发现更早，误报少 98%', { placeholder: 'title' });
  const sel = ['full', 'noPersonal', 'elecOnly', 'rule'].map(ab); const nm = ['本方法', '去掉个人基线', '只用电表', '固定阈值规则'];
  const ch = (x, title, vals, fmt, max) => s.addChart(pres.charts.BAR, [{ name: title, labels: nm, values: vals }], { x, y: 1.4, w: 4.0, h: 4.4, barDir: 'col', chartColors: ['1B2A4A', 'AEB8C7', 'AEB8C7', 'AEB8C7'], showValue: true, dataLabelPosition: 'outEnd', dataLabelFormatCode: fmt, dataLabelFontSize: 11, dataLabelFontFace: '+mn-lt', catAxisLabelFontSize: 11, catAxisLabelFontFace: '+mn-lt', catAxisLabelColor: '1D2633', valAxisHidden: true, valAxisMinVal: 0, valAxisMaxVal: max, valGridLine: { style: 'none' }, catGridLine: { style: 'none' }, showLegend: false, showTitle: true, title, titleFontSize: 14, titleFontFace: '+mn-lt', titleColor: '1D2633' });
  ch(0.6, '危险事件检出率（%）', sel.map((a) => +(a.dangerRecall * 100).toFixed(1)), '0.0', 115);
  ch(4.65, '中位检出时间（小时）', sel.map((a) => +a.dangerMedianDelayH.toFixed(1)), '0.0', 9.5);
  ch(8.7, '需人上门的误报（次/户·月）', sel.map((a) => +a.redFA.toFixed(2)), '0.00', 5);
  T(s, '固定阈值规则为团队参照公开报道复现（连续 12 小时用电无变化、日用电量低于近期均值 40% 等），并非任何一家的真实系统。“去掉个人基线”中位时间更短，是因为对所有人用了偏紧的阈值，代价是漏检和误报大增。', { x: 0.6, y: 6.0, w: 12.2, h: 0.8, fontSize: 12, color: '5D6878' });
  s.addNotes('我们按公开报道复现了一套固定阈值规则作为对照：它的检出率 65%，中位要 7.9 小时才报警，需人上门的误报每户每月 4 次以上。我们的方法检出率 100%，中位 1.2 小时，误报 0.07 次。只用电表时效果明显下降，说明水表数据很关键。');
}
// 11 商业模式
{
  const s = slide('CONTENT', '商业');
  s.addText('谁来付费：政府购买服务为主，家属订阅与企业合作为辅', { placeholder: 'title' });
  const pay = [['街道、民政部门', '纳入探访关爱与居家养老服务', '120 元/户·年'], ['老人子女', '每日平安、即时电话、多人共享', '99 元/户·年'], ['供电、水务企业', '算法与平台嵌入其民生服务', '按区县授权或分成']];
  pay.forEach(([a, b, c], i) => { const y = 1.45 + i * 1.35; card(s, 0.6, y, 6.2, 1.15); T(s, a, { x: 0.9, y: y + 0.15, w: 3.6, h: 0.4, fontSize: 17, bold: true, color: NAVY }); T(s, b, { x: 0.9, y: y + 0.6, w: 3.8, h: 0.4, fontSize: 13, color: '5D6878' }); T(s, c, { x: 4.5, y: y + 0.32, w: 2.1, h: 0.5, fontSize: 16, bold: true, color: C.accent5, align: 'right' }); });
  T(s, '单户年直接成本约 45 元，社区版毛利率约 62%（测算假设）', { x: 0.6, y: 5.6, w: 6.2, h: 0.5, fontSize: 14, color: '1D2633' });
  s.addChart(pres.charts.BAR, [{ name: '营业收入（万元）', labels: ['2027', '2028', '2029'], values: [13, 260, 790] }], { x: 7.2, y: 1.4, w: 5.6, h: 4.3, barDir: 'col', chartColors: ['F2B33D'], showValue: true, dataLabelPosition: 'outEnd', dataLabelFontSize: 12, dataLabelFontFace: '+mn-lt', catAxisLabelFontSize: 12, catAxisLabelFontFace: '+mn-lt', catAxisLabelColor: '1D2633', valAxisHidden: true, valAxisMinVal: 0, valAxisMaxVal: 900, valGridLine: { style: 'none' }, catGridLine: { style: 'none' }, showLegend: false, showTitle: true, title: '三年营业收入测算（万元）', titleFontSize: 14, titleFontFace: '+mn-lt', titleColor: '1D2633' });
  T(s, '服务户数：约 2000 → 2 万 → 6 万户；2029 年净利润约 120 万元（测算假设）', { x: 7.2, y: 5.8, w: 5.6, h: 0.6, fontSize: 13, color: '5D6878' });
  s.addNotes('付费方以街道和民政部门为主，把系统纳入特殊困难老年人探访关爱服务，按户收年费；子女可以订阅家属版；供电、水务企业可以把我们的算法嵌入它们的民生服务。按测算，单户年成本约 45 元，三年服务约 6 万户，年收入约 790 万元。');
}
// 12 竞争与计划
{
  const s = slide('CONTENT', '商业');
  s.addText('优势与路线图', { placeholder: 'title' });
  const adv = [['零硬件，易复制', '无设备采购和安装，一个街道几天即可上线'], ['算法差异化', '个人基线 + 情境判断，发现早、误报少'], ['服务闭环', 'AI 外呼、派单、家属端、处置回填打通'], ['与电网合作而非竞争', '对方提供数据与渠道，我们提供算法与服务']];
  adv.forEach(([a, b], i) => { const y = 1.45 + i * 1.15; windowIcon(s, 0.6, y + 0.05, 0.5, [0, 1, 2, 3].slice(0, i + 1)); T(s, a, { x: 1.3, y, w: 4.6, h: 0.4, fontSize: 17, bold: true, color: NAVY }); T(s, b, { x: 1.3, y: y + 0.45, w: 4.8, h: 0.5, fontSize: 13, color: '5D6878' }); });
  const tl = [['2026.10—12', '原型验证', '原型与模拟测试、参赛'], ['2027.1—3', '真实数据校准', '与供电企业合作，授权住户历史数据'], ['2027.4—9', '社区试点', '1—2 个街道约 500 户，逐条复盘'], ['2027.10 起', '区域复制', '以区县为单位纳入服务采购']];
  s.addShape(pres.shapes.LINE, { x: 6.9, y: 1.75, w: 0, h: 4.3, line: { color: 'AEB8C7', width: 2 } });
  tl.forEach(([d, a, b], i) => { const y = 1.5 + i * 1.15; s.addShape(pres.shapes.OVAL, { x: 6.75, y: y + 0.1, w: 0.3, h: 0.3, fill: { color: i === 0 ? 'F2B33D' : '1B2A4A' }, line: { color: 'FFFFFF', width: 1 } }); T(s, d, { x: 7.3, y, w: 1.8, h: 0.4, fontSize: 13, color: '5D6878' }); T(s, a, { x: 9.1, y, w: 3.7, h: 0.4, fontSize: 16, bold: true }); T(s, b, { x: 9.1, y: y + 0.42, w: 3.7, h: 0.5, fontSize: 13, color: '5D6878' }); });
  s.addNotes('我们的优势有四点：零硬件、易复制；个人基线和情境判断带来的算法差异；外呼、派单、家属端打通的服务闭环；以及和电网是合作而不是竞争关系。路线图上，明年一季度用真实数据校准，二三季度在一到两个街道试点，之后按区县复制。');
}
// 13 结尾
{
  const s = slide('DARK', '结尾');
  windowIcon(s, 0.8, 1.4, 1.1, [0, 1, 2, 3]);
  T(s, '让每一盏灯，都替老人报一声平安', { x: 0.8, y: 2.8, w: 11.5, h: 1.0, fontSize: 40, bold: true, color: 'FFFFFF' });
  T(s, '不装设备 · 不看画面 · 一人一策 · 机器先问', { x: 0.8, y: 3.9, w: 11, h: 0.6, fontSize: 20, color: 'F2B33D' });
  T(s, '局限：结果来自模拟数据；依赖远传水表；慢变化检出率仍需提高。下一步：真实数据校准与社区试点。', { x: 0.8, y: 5.4, w: 11.5, h: 0.6, fontSize: 14, color: 'AEB8C7' });
  T(s, '谢谢各位评委', { x: 0.8, y: 6.2, w: 6, h: 0.5, fontSize: 16, color: 'FFFFFF' });
  s.addNotes('最后，我们也清楚项目的局限：结果来自模拟数据，依赖远传水表，慢变化的检出率还要提高。下一步就是用真实数据校准，并在社区试点。我们希望让每一盏灯，都替老人报一声平安。谢谢各位评委。');
}
(async () => { await pres.writeFile({ fileName: OUT }); await applyTheme(OUT, THEME); console.log('written', OUT); })();
