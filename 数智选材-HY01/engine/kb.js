/*
 * 数智选材 · 场景—材料结构化知识库 (Knowledge Base)
 *
 * 取值分三类，每条都带 src 字段说明来源层级：
 *   STD  —— 按现行行业规范整理的门槛值（JTG F40—2004 等），提交前应按最新版本逐条核对；
 *   LIT  —— 依据公开文献的典型趋势设定的先验值，用于演示，需企业数据标定；
 *   ENG  —— 本作品设定的工程参数（企业可调），属于方法的一部分而非事实陈述。
 * 城市气候数据为公开气象资料的近似值，仅用于演示，正式应用应替换为气象站 30 年序列。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SZXC_KB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const meta = {
    version: '1.0.0',
    updated: '2026-10-21',
    note: '演示版知识库；STD 门槛需按现行规范核对，LIT/ENG 参数需企业数据标定',
  };

  // ---------- 1. 气候：城市样本（近似值，src: LIT） ----------
  // julyAvgMax: 最热月平均最高气温; t7max: 年最热连续7天平均最高气温; extremeMin: 极端最低气温;
  // rain: 年降水量 mm; sd: 年际标准差 (°C)
  const cities = [
    { id: 'yangpu',   name: '海南洋浦', lat: 19.7, julyAvgMax: 33.0, t7max: 35.0, t7maxSd: 1.0, extremeMin: 6.0,   tminSd: 2.0, rain: 1100 },
    { id: 'haikou',   name: '海口',     lat: 20.0, julyAvgMax: 33.2, t7max: 35.3, t7maxSd: 1.0, extremeMin: 4.9,   tminSd: 2.0, rain: 1680 },
    { id: 'guangzhou',name: '广州',     lat: 23.1, julyAvgMax: 33.0, t7max: 35.5, t7maxSd: 1.1, extremeMin: 0.0,   tminSd: 2.2, rain: 1720 },
    { id: 'chongqing',name: '重庆',     lat: 29.6, julyAvgMax: 34.5, t7max: 38.3, t7maxSd: 1.4, extremeMin: -1.8,  tminSd: 1.8, rain: 1100 },
    { id: 'wuhan',    name: '武汉',     lat: 30.6, julyAvgMax: 33.0, t7max: 37.0, t7maxSd: 1.3, extremeMin: -18.1, tminSd: 3.5, rain: 1260 },
    { id: 'nanjing',  name: '南京',     lat: 32.0, julyAvgMax: 32.3, t7max: 36.5, t7maxSd: 1.3, extremeMin: -14.0, tminSd: 3.0, rain: 1100 },
    { id: 'xian',     name: '西安',     lat: 34.3, julyAvgMax: 32.5, t7max: 37.5, t7maxSd: 1.5, extremeMin: -20.6, tminSd: 3.2, rain: 580 },
    { id: 'beijing',  name: '北京',     lat: 39.9, julyAvgMax: 31.0, t7max: 35.5, t7maxSd: 1.5, extremeMin: -27.4, tminSd: 3.5, rain: 550 },
    { id: 'lanzhou',  name: '兰州',     lat: 36.1, julyAvgMax: 29.5, t7max: 33.0, t7maxSd: 1.4, extremeMin: -23.1, tminSd: 3.0, rain: 310 },
    { id: 'lhasa',    name: '拉萨',     lat: 29.6, julyAvgMax: 23.0, t7max: 26.5, t7maxSd: 1.0, extremeMin: -16.5, tminSd: 2.5, rain: 450 },
    { id: 'kunming',  name: '昆明',     lat: 25.0, julyAvgMax: 24.5, t7max: 27.5, t7maxSd: 1.0, extremeMin: -7.8,  tminSd: 2.0, rain: 1000 },
    { id: 'urumqi',   name: '乌鲁木齐', lat: 43.8, julyAvgMax: 31.0, t7max: 35.0, t7maxSd: 1.5, extremeMin: -41.5, tminSd: 4.0, rain: 290 },
    { id: 'harbin',   name: '哈尔滨',   lat: 45.8, julyAvgMax: 28.0, t7max: 31.5, t7maxSd: 1.3, extremeMin: -38.1, tminSd: 3.5, rain: 530 },
  ];

  // ---------- 2. 沥青路面使用性能气候分区（src: STD, JTG F40 附录 A 三级指标） ----------
  const climateZoning = {
    src: 'STD',
    ref: 'JTG F40—2004 附录A 沥青路面使用性能气候分区',
    high: [ { max: Infinity, min: 30, code: 1, name: '夏炎热区' }, { max: 30, min: 20, code: 2, name: '夏热区' }, { max: 20, min: -Infinity, code: 3, name: '夏凉区' } ],
    low:  [ { lt: -37.0, code: 1, name: '冬严寒区' }, { lt: -21.5, code: 2, name: '冬寒区' }, { lt: -9.0, code: 3, name: '冬冷区' }, { lt: Infinity, code: 4, name: '冬温区' } ],
    rain: [ { gt: 1000, code: 1, name: '潮湿区' }, { gt: 500, code: 2, name: '湿润区' }, { gt: 250, code: 3, name: '半干区' }, { gt: -Infinity, code: 4, name: '干旱区' } ],
  };

  // ---------- 3. 合规底线（src: STD, JTG F40—2004 表5.3.3 系列整理值，提交前核对现行版） ----------
  const standards = {
    ref: 'JTG F40—2004 第5.3.3条 沥青混合料技术要求（整理值）',
    // 车辙试验动稳定度 (次/mm)，键为 高温区-低温区 组合
    dsDense: {
      ordinary: { '1-1': 800, '1-2': 800, '1-3': 1000, '1-4': 1000, '2-1': 600, '2-2': 800, '2-3': 800, '2-4': 800, '3': 600 },
      modified: { '1-1': 2400, '1-2': 2400, '1-3': 2800, '1-4': 2800, '2-1': 2000, '2-2': 2400, '2-3': 2400, '2-4': 2400, '3': 1800 },
    },
    dsSMA: { ordinary: 1500, modified: 3000 },
    dsOGFC: { normal: 1500, heavy: 3000 },
    // 低温弯曲试验破坏应变 (με)，按低温区
    strain: { ordinary: { 1: 2600, 2: 2300, 3: 2000, 4: 2000 }, modified: { 1: 3000, 2: 2800, 3: 2500, 4: 2500 } },
    // 浸水马歇尔残留稳定度 (%)，按年降水 ≥500 / <500
    ms0: { wet: { ordinary: 80, modified: 85 }, dry: { ordinary: 75, modified: 80 }, sma: { ordinary: 75, modified: 80 } },
    // 冻融劈裂强度比 TSR (%)
    tsr: { wet: { ordinary: 75, modified: 80 }, dry: { ordinary: 70, modified: 75 }, sma: { ordinary: 75, modified: 80 } },
  };

  // ---------- 4. 交通荷载等级与场景增强系数（src: ENG，等级划分参照 JTG D50—2017） ----------
  const traffic = {
    levels: [
      { id: 'light',  name: '轻',   esal: '<4×10^6',      dsFactor: null, fatigueTarget: 4.5, pgBump: 0 },
      { id: 'medium', name: '中等', esal: '4–8×10^6',     dsFactor: null, fatigueTarget: 4.8, pgBump: 0 },
      { id: 'heavy',  name: '重',   esal: '8–19×10^6',    dsFactor: 1.0,  fatigueTarget: 5.1, pgBump: 0 },
      { id: 'vheavy', name: '特重', esal: '19–100×10^6',  dsFactor: 1.2,  fatigueTarget: 5.3, pgBump: 1 },
      { id: 'xheavy', name: '极重', esal: '>100×10^6',    dsFactor: 1.4,  fatigueTarget: 5.5, pgBump: 1 },
    ],
    // 车速：Superpave 加级思路（AASHTO M323 的慢速 +1 级、停滞 +2 级）
    speed: [
      { id: 'normal',   name: '正常行驶 (>70 km/h)', pgBump: 0, dsFactor: 1.0 },
      { id: 'slow',     name: '慢速 (20–70 km/h)',   pgBump: 1, dsFactor: 1.15 },
      { id: 'standing', name: '停滞/渠化 (<20 km/h)',pgBump: 2, dsFactor: 1.3 },
    ],
    src: 'ENG',
    note: '轻/中等交通的 DS 目标取规范普通沥青值×1.0/1.5；重及以上取改性沥青值×dsFactor',
  };

  // ---------- 5. 病害与养护工法（src: ENG，工法名称对应 JTG 5142—2019 养护工程分类） ----------
  const distresses = [
    { id: 'rutting',     name: '车辙',       drives: { ds: [1.0, 1.05, 1.10] } },
    { id: 'thermalCrack',name: '横向/温度裂缝', drives: { strain: [1.0, 1.03, 1.05], pgLowExtra: [0, 0, 3] } },
    { id: 'fatigueCrack',name: '网裂/疲劳裂缝', drives: { fatigue: [0.1, 0.2, 0.3] } },
    { id: 'moisture',    name: '水损害/坑槽松散', drives: { tsr: [0, 2, 4] } },
    { id: 'skid',        name: '抗滑不足',   drives: { td: [0.60, 0.70, 0.80] } },
    { id: 'aging',       name: '老化/表面磨损', drives: {} },
  ];
  const severities = ['轻', '中', '重'];

  const treatments = [
    { id: 'MR_UP', name: '铣刨重铺上面层', thicknessCm: 4.0, baseLife: 8, milling: true,  mix: true },
    { id: 'THIN',  name: '薄层罩面',       thicknessCm: 2.5, baseLife: 6, milling: false, mix: true },
    { id: 'MR_UM', name: '铣刨重铺中上面层(本系统设计上面层)', thicknessCm: 4.0, baseLife: 10, milling: true, mix: true },
    { id: 'CRACK', name: '裂缝处治',       mix: false },
  ];

  // ---------- 6. 沥青结合料（src: LIT 典型值；price 元/t、carbon kgCO2e/t 为演示参数） ----------
  // trueHigh/trueLow: 连续分级温度 (°C)；visc: 压实难度系数(相对 70#)；mixT: 推荐拌和温度
  const binders = [
    { id: 'B110', name: '110#A 道路石油沥青',    family: 'base', modified: false, trueHigh: 56.5, trueLow: -27.0, visc: 0.85, mixT: 145, price: 3820, carbon: 230, strainBonus: 0,   tsr: 0,  fatigue: 0.25 },
    { id: 'B90',  name: '90#A 道路石油沥青',     family: 'base', modified: false, trueHigh: 60.5, trueLow: -23.0, visc: 0.9, mixT: 150, price: 3850, carbon: 230, strainBonus: 0,   tsr: 0,  fatigue: 0.15 },
    { id: 'B70',  name: '70#A 道路石油沥青',     family: 'base', modified: false, trueHigh: 66.0, trueLow: -19.0, visc: 1.0, mixT: 155, price: 3900, carbon: 230, strainBonus: 0,   tsr: 0,  fatigue: 0 },
    { id: 'B50',  name: '50#A 道路石油沥青',     family: 'base', modified: false, trueHigh: 70.0, trueLow: -15.0, visc: 1.1, mixT: 160, price: 3950, carbon: 235, strainBonus: 0,   tsr: 1,  fatigue: -0.15 },
    { id: 'B30',  name: '30# 硬质沥青(高模量)',  family: 'hard', modified: false, trueHigh: 79.0, trueLow: -8.0,  visc: 1.3, mixT: 170, price: 4300, carbon: 240, strainBonus: 0,   tsr: 2,  fatigue: -0.45 },
    { id: 'SBS70_3', name: 'SBS改性沥青(70#基, 3.5%)', family: 'sbs', modified: true, base: 'B70', dose: 3.5 },
    { id: 'SBS70_4', name: 'SBS改性沥青(70#基, 4.5%)', family: 'sbs', modified: true, base: 'B70', dose: 4.5 },
    { id: 'SBS70_5', name: 'SBS改性沥青(70#基, 5.5%)', family: 'sbs', modified: true, base: 'B70', dose: 5.5 },
    { id: 'SBS90_4', name: 'SBS改性沥青(90#基, 4.5%)', family: 'sbs', modified: true, base: 'B90', dose: 4.5 },
    { id: 'SBS90_5', name: 'SBS改性沥青(90#基, 5.5%)', family: 'sbs', modified: true, base: 'B90', dose: 5.5 },
    { id: 'SBS110_5', name: 'SBS改性沥青(110#基, 5.5%)', family: 'sbs', modified: true, base: 'B110', dose: 5.5 },
    { id: 'CR20', name: '橡胶改性沥青(20%胶粉)', family: 'rubber', modified: true, trueHigh: 76.0, trueLow: -27.0, visc: 1.6, mixT: 180, price: 4550, carbon: 205, strainBonus: 250, tsr: 2, fatigue: 0.6 },
    { id: 'HVA',  name: '高粘高弹改性沥青',     family: 'hva',  modified: true, trueHigh: 86.0, trueLow: -30.0, visc: 1.8, mixT: 185, price: 7600, carbon: 600, strainBonus: 300, tsr: 5,  fatigue: 0.75 },
  ];
  // SBS 剂量效应（src: LIT 趋势）：高温 +2.3°C/%，低温 -1.3°C/%，加工及 SBS 费用、碳排
  const sbsModel = { dHigh: 2.3, dLow: -1.3, viscPerPct: 0.09, mixT: 175, pricePerPct: 230, priceProcess: 250, carbonPerPct: 33, carbonProcess: 15, strainBonus: 150, tsr: 3, fatiguePerPct: 0.11, src: 'LIT' };

  // ---------- 7. 级配（src: LIT 典型值；性能为 70# 基质、目标空隙率下的基准） ----------
  // ds 次/mm, strain με, tsr %, fatigue log10(Nf @600με, 15°C, 10Hz), td mm 构造深度
  const gradations = [
    { id: 'AC10',   name: 'AC-10',   type: 'dense', nmas: 9.5,  pb: 5.4, density: 2.38, va: 4.0, ds: 900,  strain: 2350, tsr: 85, fatigue: 5.10, td: 0.45, aggPrice: 92 },
    { id: 'AC13',   name: 'AC-13',   type: 'dense', nmas: 13.2, pb: 4.9, density: 2.40, va: 4.0, ds: 1100, strain: 2250, tsr: 84, fatigue: 5.00, td: 0.55, aggPrice: 88 },
    { id: 'AC16',   name: 'AC-16',   type: 'dense', nmas: 16.0, pb: 4.6, density: 2.42, va: 4.0, ds: 1250, strain: 2150, tsr: 83, fatigue: 4.90, td: 0.62, aggPrice: 85 },
    { id: 'SMA10',  name: 'SMA-10',  type: 'sma',   nmas: 9.5,  pb: 6.1, density: 2.42, va: 3.5, ds: 1500, strain: 2650, tsr: 87, fatigue: 5.30, td: 0.80, aggPrice: 110 },
    { id: 'SMA13',  name: 'SMA-13',  type: 'sma',   nmas: 13.2, pb: 5.9, density: 2.44, va: 3.5, ds: 1600, strain: 2600, tsr: 87, fatigue: 5.30, td: 0.90, aggPrice: 108 },
    { id: 'OGFC10', name: 'OGFC-10', type: 'ogfc',  nmas: 9.5,  pb: 5.0, density: 1.98, va: 18.0, ds: 600, strain: 2500, tsr: 77, fatigue: 4.60, td: 1.30, aggPrice: 108 },
    { id: 'OGFC13', name: 'OGFC-13', type: 'ogfc',  nmas: 13.2, pb: 4.8, density: 1.95, va: 20.0, ds: 650, strain: 2450, tsr: 77, fatigue: 4.60, td: 1.60, aggPrice: 105 },
  ];

  // ---------- 8. 功能助剂 / 再生 / 纤维（src: LIT 趋势 + ENG 成本） ----------
  // costMix: 元/t 混合料; carbonMix: kgCO2e/t 混合料
  const additives = {
    water: [
      { id: 'none',  name: '无',                 tsr: 0, costMix: 0,  carbonMix: 0 },
      { id: 'amine', name: '胺类抗剥落剂(0.4%油重)', tsr: 6, costMix: 7,  carbonMix: 0.3 },
      { id: 'lime',  name: '消石灰替代1.5%矿粉',   tsr: 7, costMix: 4,  carbonMix: 1.2 },
    ],
    rut: [
      { id: 'none',   name: '无',                 dsMul: 1.0, strain: 0,    costMix: 0,  carbonMix: 0 },
      { id: 'antirut',name: '抗车辙剂(0.4%混合料)', dsMul: 1.6, strain: -150, costMix: 56, carbonMix: 10 },
    ],
    warm: [
      { id: 'none', name: '热拌',               dT: 0,   viscMul: 1.0,  tsr: 0,  costMix: 0, fuelMul: 1.0 },
      { id: 'warm', name: '表面活性剂温拌(0.5%油重)', dT: -25, viscMul: 0.55, tsr: -1, costMix: 6, fuelMul: 0.75 },
    ],
    rap: [
      { id: 'R0',  name: '不掺RAP',         pct: 0,  dsMul: 1.00, strain: 0,    fatigue: 0,     tsr: 0,  costMul: 1.00, carbonMul: 1.00 },
      { id: 'R15', name: 'RAP 15%',         pct: 15, dsMul: 1.12, strain: -150, fatigue: -0.10, tsr: -1, costMul: 0.89, carbonMul: 0.91 },
      { id: 'R30', name: 'RAP 30%+再生剂',  pct: 30, dsMul: 1.25, strain: -330, fatigue: -0.22, tsr: -2, costMul: 0.80, carbonMul: 0.83 },
    ],
    fiber: [
      { id: 'none',    name: '无',            strain: 0,   fatigue: 0,    costMix: 0,  carbonMix: 0 },
      { id: 'lignin',  name: '木质素纤维0.3%', strain: 0,   fatigue: 0,    costMix: 18, carbonMix: 1.5 },
      { id: 'basalt',  name: '玄武岩纤维0.3%', strain: 150, fatigue: 0.10, costMix: 54, carbonMix: 6 },
    ],
  };

  const aggregates = [
    { id: 'limestone', name: '石灰岩', acidic: false, tsr: 0,  td: 0,    price: 0 },
    { id: 'basalt',    name: '玄武岩', acidic: false, tsr: -3, td: 0.05, price: 22 },
    { id: 'granite',   name: '花岗岩', acidic: true,  tsr: -9, td: 0.03, price: -5 },
  ];

  // ---------- 9. 预测不确定性、工艺敏感性、经济与碳参数（src: ENG/LIT） ----------
  const model = {
    sd: { dsLog: 0.22, strain: 200, tsr: 3.5, fatigue: 0.22, td: 0.08, pg: 1.5 },
    // 空隙率每偏大 1% 的性能折减（src: LIT 经验规律，如“空隙率每增 1%，寿命约降 10%”）
    perVa: { dsMul: 0.88, strain: -60, tsr: -3.0, fatigue: -0.08, td: 0.02 },
    // 压实欠缺：d = visc×viscMul × max(0, Tref−Tamb)/10 × (1 + haul/120) × (薄层?1.5:1)
    compaction: { Tref: 15, vaPerD: 1.2, vaSd0: 0.6, vaSdPerD: 0.4, thinFactor: 1.5 },
    pavingMinT: { modified: 10, ordinary: 5, warmRelief: 5, src: '参照 JTG F40 施工气温限制（需核对）' },
    life: { betaDs: 0.35, betaStrain: 1.0, betaTsr: 2.0, betaFatigue: 1.15, min: 0.35, max: 1.35, severeFactor: 0.88 },
    econ: { discount: 0.04, production: 75, laying: 45, milling: 12, warmProdSave: 8 },
    carbon: { aggregate: 8, production: 26, transport: 5, milling: 1.2 },
    reliabilityByRoad: { highway: 0.90, arterial: 0.85, local: 0.75 },
  };

  // ---------- 10. 裂缝处治：灌缝材料（src: ENG，分型思路参照 JT/T 740） ----------
  const sealants = [
    { id: 'S_HOT',  name: '高温型加热灌缝胶', lowTest: -10, softening: 95, price: 13, note: '夏炎热区、冬温区' },
    { id: 'S_STD',  name: '普通型加热灌缝胶', lowTest: -20, softening: 88, price: 12, note: '大部分地区' },
    { id: 'S_LOW',  name: '低温型加热灌缝胶', lowTest: -30, softening: 82, price: 14, note: '冬寒区' },
    { id: 'S_COLD', name: '寒冷型加热灌缝胶', lowTest: -40, softening: 78, price: 16, note: '冬严寒区' },
  ];
  const crackRules = [
    { maxWidth: 3,   method: '雾封层或不处理，纳入观察', unitPriceFactor: 0.3 },
    { maxWidth: 10,  method: '开槽灌缝（槽宽 10–15mm）', unitPriceFactor: 1.0 },
    { maxWidth: 25,  method: '开槽灌缝（槽宽 15–20mm）+ 贴缝带', unitPriceFactor: 1.4 },
    { maxWidth: 999, method: '挖补或填缝料修补，并核查基层', unitPriceFactor: 3.0 },
  ];

  return { meta, cities, climateZoning, standards, traffic, distresses, severities, treatments, binders, sbsModel, gradations, additives, aggregates, model, sealants, crackRules };
});
