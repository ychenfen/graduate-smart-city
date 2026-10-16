"""养护场景 → 沥青混合料性能需求的量化映射，以及多约束下的指标权重分配。

映射分两层：
1. 规范底线：按 JTG F40 气候分区给出普通/改性沥青混合料的技术指标下限；
2. 场景修正：交通荷载、病害类型与严重程度、特殊路段、结构层位对底线进行放大，
   每一步都记录在 trace 中，保证“为什么是这个目标值”可追溯。
"""
from __future__ import annotations

from copy import deepcopy

TRAFFIC_LEVELS = ["轻", "中等", "重", "特重", "极重"]
SEVERITY = {"轻": 1, "中": 2, "重": 3}
LAYERS = ["上面层", "中面层", "下面层"]
STRUCTURES = {"semi_rigid": "半刚性基层", "flexible": "柔性基层", "bridge_deck": "桥面铺装"}
SPECIALS = {"none": "一般路段", "long_grade": "长大纵坡", "intersection": "平面交叉口/公交站台"}
DISTRESS = {"rutting": "车辙", "thermal_crack": "低温横向裂缝", "fatigue_crack": "疲劳龟裂",
            "reflective_crack": "反射裂缝", "water_damage": "水损害（坑槽/松散）", "skid": "抗滑不足",
            "none": "预防性养护"}
PRIORITY = {"低": 0, "中": 1, "高": 2}

HIGH_ZONE_NAME = {1: "夏炎热区", 2: "夏热区", 3: "夏凉区"}
LOW_ZONE_NAME = {1: "冬严寒区", 2: "冬寒区", 3: "冬冷区", 4: "冬温区"}
RAIN_ZONE_NAME = {1: "潮湿区", 2: "湿润区", 3: "半干区", 4: "干旱区"}

INDICATORS = ["ds", "eps", "tsr", "fatigue", "modulus", "td"]
IND_NAME = {"ds": "高温抗车辙", "eps": "低温抗裂", "tsr": "水稳定性", "fatigue": "抗疲劳",
            "modulus": "结构承载", "td": "抗滑"}

PRESETS = {
    "hainan_heavy_rut": {
        "name": "海南西部 · 高温重载车辙处治",
        "climate": {"hot_month_max": 33.5, "extreme_min": 6.0, "annual_rain": 1150},
        "traffic": "特重", "layer": "上面层", "thickness_cm": 4.0, "structure": "semi_rigid", "special": "none",
        "distress": [{"type": "rutting", "severity": "重"}], "method": "铣刨重铺上面层",
        "constraints": {"cost_priority": "中", "carbon_priority": "中", "allow_rap": True}},
    "harbin_thermal_crack": {
        "name": "哈尔滨 · 寒冷地区裂缝处治",
        "climate": {"hot_month_max": 27.5, "extreme_min": -38.5, "annual_rain": 520},
        "traffic": "中等", "layer": "上面层", "thickness_cm": 4.0, "structure": "semi_rigid", "special": "none",
        "distress": [{"type": "thermal_crack", "severity": "中"}], "method": "铣刨重铺上面层",
        "constraints": {"cost_priority": "中", "carbon_priority": "中", "allow_rap": True}},
    "wuhan_water_damage": {
        "name": "长江中游 · 水损害路段修复（中面层）",
        "climate": {"hot_month_max": 33.0, "extreme_min": -12.0, "annual_rain": 1260},
        "traffic": "重", "layer": "中面层", "thickness_cm": 6.0, "structure": "semi_rigid", "special": "none",
        "distress": [{"type": "water_damage", "severity": "重"}], "method": "铣刨重铺中面层",
        "constraints": {"cost_priority": "中", "carbon_priority": "中", "allow_rap": True}},
    "expressway_skid_noise": {
        "name": "城市快速路 · 抗滑不足与降噪",
        "climate": {"hot_month_max": 31.5, "extreme_min": -6.0, "annual_rain": 1450},
        "traffic": "重", "layer": "上面层", "thickness_cm": 4.0, "structure": "flexible", "special": "none",
        "distress": [{"type": "skid", "severity": "重"}], "method": "排水降噪罩面",
        "constraints": {"cost_priority": "低", "carbon_priority": "中", "allow_rap": False}},
    "northwest_reflective": {
        "name": "西北干旱区 · 半刚性基层反射裂缝",
        "climate": {"hot_month_max": 30.5, "extreme_min": -26.0, "annual_rain": 210},
        "traffic": "重", "layer": "上面层", "thickness_cm": 4.0, "structure": "semi_rigid", "special": "none",
        "distress": [{"type": "reflective_crack", "severity": "中"}, {"type": "fatigue_crack", "severity": "中"}],
        "method": "铣刨重铺上面层",
        "constraints": {"cost_priority": "中", "carbon_priority": "中", "allow_rap": True}},
    "intersection_extreme": {
        "name": "城市主干道交叉口 · 极重荷载车辙（中面层）",
        "climate": {"hot_month_max": 29.5, "extreme_min": -15.0, "annual_rain": 650},
        "traffic": "极重", "layer": "中面层", "thickness_cm": 6.0, "structure": "semi_rigid", "special": "intersection",
        "distress": [{"type": "rutting", "severity": "重"}], "method": "铣刨重铺中面层",
        "constraints": {"cost_priority": "中", "carbon_priority": "低", "allow_rap": True}},
    "rural_low_carbon": {
        "name": "县乡道路 · 低预算低碳预防性养护",
        "climate": {"hot_month_max": 31.0, "extreme_min": -8.0, "annual_rain": 1100},
        "traffic": "轻", "layer": "上面层", "thickness_cm": 4.0, "structure": "semi_rigid", "special": "none",
        "distress": [{"type": "none", "severity": "轻"}], "method": "铣刨重铺上面层",
        "constraints": {"cost_priority": "高", "carbon_priority": "高", "allow_rap": True}},
}


def climate_zones(hot_month_max: float, extreme_min: float, annual_rain: float) -> dict:
    """JTG F40 沥青路面使用性能气候分区。"""
    hz = 1 if hot_month_max > 30 else (2 if hot_month_max >= 20 else 3)
    lz = 1 if extreme_min < -37 else (2 if extreme_min < -21.5 else (3 if extreme_min < -9 else 4))
    rz = 1 if annual_rain > 1000 else (2 if annual_rain >= 500 else (3 if annual_rain >= 250 else 4))
    return {"high_zone": hz, "low_zone": lz, "rain_zone": rz}


def normalize_scenario(s: dict) -> dict:
    """补全气候分区与缺省值，形成标准化的场景描述（场景标签）。"""
    s = deepcopy(s)
    if "high_zone" not in s:
        c = s.get("climate") or {}
        s.update(climate_zones(c.get("hot_month_max", 30), c.get("extreme_min", -15), c.get("annual_rain", 800)))
    s.setdefault("traffic", "中等")
    s.setdefault("layer", "上面层")
    s.setdefault("structure", "semi_rigid")
    s.setdefault("special", "none")
    s.setdefault("distress", [{"type": "none", "severity": "轻"}])
    s.setdefault("constraints", {})
    s["constraints"].setdefault("cost_priority", "中")
    s["constraints"].setdefault("carbon_priority", "中")
    s["constraints"].setdefault("allow_rap", True)
    s["constraints"].setdefault("budget_max", None)
    if s.get("thickness_cm") is None:
        s["thickness_cm"] = {"上面层": 4.0, "中面层": 6.0, "下面层": 8.0}[s["layer"]]
    return s


def scenario_tags(s: dict) -> list[str]:
    tags = [f"高温{s['high_zone']}-{HIGH_ZONE_NAME[s['high_zone']]}",
            f"低温{s['low_zone']}-{LOW_ZONE_NAME[s['low_zone']]}",
            f"雨量{s['rain_zone']}-{RAIN_ZONE_NAME[s['rain_zone']]}",
            f"交通-{s['traffic']}", f"层位-{s['layer']}", f"结构-{STRUCTURES[s['structure']]}",
            f"路段-{SPECIALS[s['special']]}"]
    for d in s["distress"]:
        if d["type"] != "none":
            tags.append(f"病害-{DISTRESS[d['type']]}({d['severity']})")
    return tags


def _sev(s: dict, *types: str) -> int:
    return max([SEVERITY[d["severity"]] for d in s["distress"] if d["type"] in types] or [0])


def map_requirements(scenario: dict) -> dict:
    """主函数：返回目标性能指标、权重与推导轨迹。"""
    s = normalize_scenario(scenario)
    trace: list[str] = []
    t_idx = TRAFFIC_LEVELS.index(s["traffic"])
    hz, lz, rz = s["high_zone"], s["low_zone"], s["rain_zone"]
    layer = s["layer"]
    rut_sev = _sev(s, "rutting")
    crack_sev = _sev(s, "thermal_crack", "reflective_crack")
    fat_sev = _sev(s, "fatigue_crack", "reflective_crack")
    water_sev = _sev(s, "water_damage")
    skid_sev = _sev(s, "skid")
    heavy = t_idx >= 2

    modified_level = heavy or rut_sev >= 2 or crack_sev >= 2 or s["special"] != "none" or s["structure"] == "bridge_deck"
    lvl = "改性" if modified_level else "普通"
    trace.append(f"气候分区 {hz}-{lz}-{rz}（{HIGH_ZONE_NAME[hz]}/{LOW_ZONE_NAME[lz]}/{RAIN_ZONE_NAME[rz]}）；"
                 f"按{'改性' if modified_level else '普通'}沥青混合料技术要求取规范底线"
                 + ("（重载/病害/特殊路段触发改性级要求）" if modified_level else ""))

    targets: dict[str, dict] = {}

    # 高温：动稳定度
    ds = ({1: 2800, 2: 2400, 3: 1800} if modified_level else {1: 1000, 2: 800, 3: 600})[hz]
    basis = [f"JTG F40 {HIGH_ZONE_NAME[hz]}{lvl}混合料 ≥{ds}"]
    mult = [1.0, 1.0, 1.1, 1.25, 1.4][t_idx]
    if mult > 1:
        basis.append(f"交通{s['traffic']} ×{mult}")
    if rut_sev:
        f = {1: 1.05, 2: 1.15, 3: 1.3}[rut_sev]
        mult *= f
        basis.append(f"车辙病害({['', '轻', '中', '重'][rut_sev]}) ×{f}")
    if s["special"] != "none":
        mult *= 1.2
        basis.append(f"{SPECIALS[s['special']]} ×1.2")
    if layer == "中面层" and (heavy or rut_sev):
        mult *= 1.1
        basis.append("中面层为剪应力最大层 ×1.1")
    if layer == "下面层":
        mult *= 0.7
        basis.append("下面层 ×0.7")
    ds_t = round(min(ds * mult, 9000) / 100) * 100
    targets["ds"] = {"target": ds_t, "hard": True, "basis": "；".join(basis)}

    # 低温：弯曲破坏应变
    eps = ({1: 3000, 2: 2800, 3: 2500, 4: 2500} if modified_level else {1: 2600, 2: 2300, 3: 2000, 4: 2000})[lz]
    basis = [f"JTG F40 {LOW_ZONE_NAME[lz]}{lvl}混合料 ≥{eps}"]
    if crack_sev:
        add = {1: 0, 2: 100, 3: 200}[crack_sev]
        eps += add
        basis.append(f"裂缝类病害 +{add}")
    if layer != "上面层":
        eps -= 300
        basis.append(f"{layer}温度梯度小 -300")
    targets["eps"] = {"target": eps, "hard": lz <= 2 or crack_sev >= 2, "basis": "；".join(basis)}

    # 水稳定性：冻融劈裂强度比
    tsr = ({1: 80, 2: 80, 3: 75, 4: 75} if modified_level else {1: 75, 2: 75, 3: 70, 4: 70})[rz]
    basis = [f"JTG F40 {RAIN_ZONE_NAME[rz]}{lvl}混合料 ≥{tsr}%"]
    if water_sev:
        add = {1: 2, 2: 4, 3: 6}[water_sev]
        tsr += add
        basis.append(f"水损害病害 +{add}%")
    if s["structure"] == "bridge_deck":
        tsr += 3
        basis.append("桥面铺装 +3%")
    targets["tsr"] = {"target": min(tsr, 90), "hard": True, "basis": "；".join(basis)}

    # 疲劳寿命
    nf = [4.8, 5.0, 5.3, 5.6, 5.8][t_idx]
    basis = [f"交通{s['traffic']} 基准 lgNf≥{nf}"]
    if fat_sev:
        add = {1: 0.1, 2: 0.2, 3: 0.35}[fat_sev]
        nf += add
        basis.append(f"疲劳/反射裂缝病害 +{add}")
    if s["structure"] == "semi_rigid" and fat_sev:
        nf += 0.1
        basis.append("半刚性基层反射裂缝风险 +0.1")
    targets["fatigue"] = {"target": round(nf, 2), "hard": fat_sev >= 2, "basis": "；".join(basis)}

    # 动态模量（中下面层承载）
    if layer == "上面层":
        targets["modulus"] = {"target": 6000, "hard": False, "basis": "上面层仅作参考下限"}
    else:
        e = [7000, 8000, 9500, 10500, 11500][t_idx]
        targets["modulus"] = {"target": e, "hard": True, "basis": f"{layer}承载，交通{s['traffic']} ≥{e}MPa"}

    # 抗滑：构造深度
    if layer == "上面层":
        wet = rz == 1 and t_idx >= 1
        td = (0.50 if t_idx == 0 else 0.55) + (0.05 if heavy else 0) + (0.05 if wet else 0)
        basis = [f"上面层抗滑底线 {0.50 if t_idx == 0 else 0.55}mm"] + (["重载 +0.05"] if heavy else []) + \
            (["潮湿区 +0.05"] if wet else [])
        if skid_sev:
            add = {1: 0.1, 2: 0.2, 3: 0.4}[skid_sev]
            td += add
            basis.append(f"抗滑不足病害 +{add}")
        targets["td"] = {"target": round(td, 2), "hard": True, "basis": "；".join(basis)}
    else:
        targets["td"] = {"target": 0.0, "hard": False, "basis": "非表面层，不考核"}

    # ---------------- 权重（多约束优先级排序）
    w = {"ds": 1.0, "eps": 1.0, "tsr": 1.0, "fatigue": 0.8, "modulus": 0.3 if layer == "上面层" else 1.0,
         "td": 0.6 if layer == "上面层" else 0.0}
    wt = []
    f = {1: 1.5, 2: 1.0, 3: 0.7}[hz]
    w["ds"] *= f
    wt.append(f"{HIGH_ZONE_NAME[hz]} → 高温权重×{f}")
    f = [0.8, 1.0, 1.2, 1.4, 1.6][t_idx]
    w["ds"] *= f
    w["fatigue"] *= f
    wt.append(f"交通{s['traffic']} → 高温/疲劳权重×{f}")
    if s["special"] != "none":
        w["ds"] *= 1.3
        wt.append(f"{SPECIALS[s['special']]} → 高温权重×1.3")
    f = {1: 1.8, 2: 1.4, 3: 1.0, 4: 0.6}[lz]
    w["eps"] *= f * (0.6 if layer != "上面层" else 1.0)
    wt.append(f"{LOW_ZONE_NAME[lz]} → 低温权重×{f}" + ("（非表面层再×0.6）" if layer != "上面层" else ""))
    f = {1: 1.4, 2: 1.2, 3: 0.9, 4: 0.7}[rz]
    w["tsr"] *= f
    wt.append(f"{RAIN_ZONE_NAME[rz]} → 水稳权重×{f}")
    if s["structure"] == "bridge_deck":
        w["tsr"] *= 1.4
        wt.append("桥面铺装 → 水稳权重×1.4")
    sev_f = {0: 1.0, 1: 1.3, 2: 1.6, 3: 2.0}
    for ind, sev, nm in (("ds", rut_sev, "车辙"), ("eps", crack_sev, "裂缝"), ("fatigue", fat_sev, "疲劳/反射裂缝"),
                         ("tsr", water_sev, "水损害"), ("td", skid_sev, "抗滑不足")):
        if sev:
            w[ind] *= sev_f[sev]
            wt.append(f"{nm}病害 → {IND_NAME[ind]}权重×{sev_f[sev]}")

    c = s["constraints"]
    cost_w = [0.10, 0.20, 0.35][PRIORITY[c["cost_priority"]]]
    carbon_w = [0.05, 0.12, 0.25][PRIORITY[c["carbon_priority"]]]
    perf_share = 1.0 - cost_w - carbon_w
    tot = sum(w.values())
    weights = {k: round(v / tot * perf_share, 4) for k, v in w.items()}
    weights["cost"] = cost_w
    weights["carbon"] = carbon_w
    weights["upfront_share"] = [0.2, 0.3, 0.6][PRIORITY[c["cost_priority"]]]
    wt.append(f"成本优先级{c['cost_priority']} → 成本权重{cost_w}（一次性投入占{weights['upfront_share']:.0%}，其余按全寿命年均）；"
              f"环保优先级{c['carbon_priority']} → 碳排权重{carbon_w}")

    ranking = sorted([k for k in INDICATORS if weights[k] > 0], key=lambda k: -weights[k])
    return {
        "scenario": s,
        "tags": scenario_tags(s),
        "targets": targets,
        "weights": weights,
        "priority": [IND_NAME[k] for k in ranking],
        "trace": trace + wt,
    }
