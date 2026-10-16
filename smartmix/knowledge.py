"""材料知识底座：加载知识库、计算结合料性质、枚举候选配方、执行规则推理、构建知识图谱。"""
from __future__ import annotations

import itertools
import json
import math
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from pathlib import Path

KB_DIR = Path(__file__).parent / "kb"


@lru_cache(maxsize=1)
def load_kb() -> dict:
    materials = json.loads((KB_DIR / "materials.json").read_text(encoding="utf-8"))
    kg = json.loads((KB_DIR / "kg_relations.json").read_text(encoding="utf-8"))
    return {"materials": materials, "kg": kg}


def M() -> dict:
    return load_kb()["materials"]


@dataclass
class Mix:
    """一个沥青混合料材料方案（配方 + 关键工艺参数）。"""
    base: str = "70#"
    modifier: str = "none"
    dose: float = 0.0
    gradation: str = "AC-13"
    oil_offset: float = 0.0        # 油石比相对级配典型最佳油石比的偏移（%）
    anti_strip: int = 0
    anti_rut: int = 0
    warm_mix: int = 0
    rap: int = 0                   # RAP 掺量（%）
    compaction: float = 98.0       # 现场压实度（%）
    aging: int = 0                 # 0 短期老化(标准试验状态) / 1 长期老化

    def key(self) -> str:
        return (f"{self.base}|{self.modifier}|{self.dose}|{self.gradation}|{self.oil_offset:+.1f}|"
                f"{self.anti_strip}{self.anti_rut}{self.warm_mix}|{self.rap}")

    def to_dict(self) -> dict:
        return asdict(self)

    @property
    def family(self) -> str:
        return M()["gradations"][self.gradation]["family"]

    @property
    def oil_ratio(self) -> float:
        return round(M()["gradations"][self.gradation]["oac"] + self.oil_offset, 2)

    def label(self) -> str:
        """人类可读的配方名称。"""
        mats = M()
        if self.modifier == "none":
            binder = mats["base_binders"][self.base]["name"]
        elif self.modifier == "HVA":
            binder = f"高粘高弹改性沥青（{self.base}基，高粘剂{self.dose:g}%）"
        elif self.modifier == "SBS":
            binder = f"SBS改性沥青（{self.base}基，SBS {self.dose:g}%）"
        else:
            binder = f"橡胶沥青（{self.base}基，胶粉{self.dose:g}%）"
        extras = []
        if mats["gradations"][self.gradation]["fiber"]:
            extras.append("木质素纤维0.3%")
        if self.anti_strip:
            extras.append("抗剥落剂")
        if self.anti_rut:
            extras.append("抗车辙剂")
        if self.warm_mix:
            extras.append("温拌剂")
        if self.rap:
            extras.append(f"RAP {self.rap}%+再生剂")
        s = f"{self.gradation} · {binder}"
        if extras:
            s += " · " + "、".join(extras)
        return s


def binder_props(base: str, modifier: str, dose: float) -> dict:
    """知识库中的“名义”结合料性质（PG 连续分级温度），属于机理先验的一部分。"""
    mats = M()
    b = mats["base_binders"][base]
    m = mats["modifiers"][modifier]
    high = b["pg_high"] + m["d_high_per_dose"] * dose
    low = b["pg_low"] + m["d_low_per_dose"] * dose
    return {"pg_high_c": round(high, 2), "pg_low_c": round(low, 2),
            "pg_grade": pg_grade(high, low)}


def pg_grade(high: float, low: float) -> str:
    hi = 46 + 6 * math.floor((high - 46) / 6)
    k = math.floor((-low - 4) / 6)
    lo = -(4 + 6 * k)
    return f"PG {hi}-{abs(lo)}"


def binder_price(mix: Mix) -> float:
    mats = M()
    b = mats["base_binders"][mix.base]
    m = mats["modifiers"][mix.modifier]
    return b["price"] + m["price"] * mix.dose / 100.0


def binder_carbon(mix: Mix) -> float:
    mats = M()
    b = mats["base_binders"][mix.base]
    m = mats["modifiers"][mix.modifier]
    return b["carbon"] + m["carbon"] * mix.dose / 100.0


def mixing_temperature(mix: Mix) -> tuple[int, int]:
    mats = M()
    lo, hi = mats["base_binders"][mix.base]["mix_temp"]
    add = mats["modifiers"][mix.modifier]["mix_temp_add"]
    drop = mats["additives"]["warm_mix"]["mix_temp_drop"] if mix.warm_mix else 0
    return lo + add - drop, hi + add - drop


# ---------------------------------------------------------------- 候选空间

def all_binders() -> list[tuple[str, str, float]]:
    mats = M()
    out = []
    for mod_key, mod in mats["modifiers"].items():
        for base in mod["bases"]:
            for d in mod["doses"]:
                out.append((base, mod_key, float(d)))
    return out


def enumerate_candidates(layer: str | None = None, thickness_cm: float | None = None,
                         allow_rap: bool = True, oil_offsets=(-0.2, 0.0, 0.2)) -> list[Mix]:
    """枚举全部合法候选方案（结构层与厚度约束 + 材料兼容性约束）。"""
    mats = M()
    grads = []
    for g, info in mats["gradations"].items():
        if layer and layer not in info["layers"]:
            continue
        if thickness_cm is not None:
            lo, hi = info["thickness"]
            if not (lo - 0.25 <= thickness_cm <= hi + 0.25):
                continue
        grads.append(g)
    out: list[Mix] = []
    for (base, mod, dose), g in itertools.product(all_binders(), grads):
        ginfo = mats["gradations"][g]
        req = ginfo.get("requires_modifier")
        if req and mod not in req:
            continue
        if mod == "HVA" and ginfo["family"] not in ("OGFC", "SMA"):
            continue  # 高粘沥青原型中仅用于排水与SMA磨耗层
        rap_levels = mats["additives"]["rap"]["levels"] if (allow_rap and ginfo["family"] in ("AC", "SUP")) else [0]
        for oo, a_s, a_r, wm, rap in itertools.product(oil_offsets, (0, 1), (0, 1), (0, 1), rap_levels):
            if a_r and ginfo["family"] == "OGFC":
                continue
            out.append(Mix(base, mod, dose, g, oo, a_s, a_r, wm, rap))
    return out


# ---------------------------------------------------------------- 规则推理

def check_rules(mix: Mix, scenario: dict) -> list[dict]:
    """返回该方案在该场景下触发的规则（forbid 为硬约束，prefer 为软约束）。"""
    rules = load_kb()["kg"]["rules"]
    hits = []
    fam = mix.family
    distress_types = {d["type"] for d in scenario.get("distress", [])}
    for r in rules:
        c = r["if"]
        ok = True
        if "gradation_family" in c and fam != c["gradation_family"]:
            ok = False
        if "gradation_family_in" in c and fam not in c["gradation_family_in"]:
            ok = False
        if "low_zone_in" in c and scenario.get("low_zone") not in c["low_zone_in"]:
            ok = False
        if "high_zone_in" in c and scenario.get("high_zone") not in c["high_zone_in"]:
            ok = False
        if "rap_gt" in c and not mix.rap > c["rap_gt"]:
            ok = False
        if "anti_rut" in c and mix.anti_rut != c["anti_rut"]:
            ok = False
        if "warm_mix" in c and mix.warm_mix != c["warm_mix"]:
            ok = False
        if "base" in c and mix.base != c["base"]:
            ok = False
        if "distress_in" in c and not (distress_types & set(c["distress_in"])):
            ok = False
        if "structure_in" in c and scenario.get("structure") not in c["structure_in"]:
            ok = False
        if "traffic_in" in c and scenario.get("traffic") not in c["traffic_in"]:
            ok = False
        if "layer" in c and scenario.get("layer") != c["layer"]:
            ok = False
        if not ok:
            continue
        if r["type"] == "requires":
            if mix.modifier not in r["then"]["modifier_in"]:
                hits.append({"id": r["id"], "type": "forbid", "reason": r["reason"]})
        elif r["type"] == "prefer":
            if mix.modifier in r["then"].get("modifier_not", []):
                hits.append({"id": r["id"], "type": "prefer", "reason": r["reason"]})
        else:
            hits.append({"id": r["id"], "type": r["type"], "reason": r["reason"]})
    return hits


# ---------------------------------------------------------------- 知识图谱

GROUP_OF_MATERIAL = {"SMA": "级配", "OGFC": "级配", "AC-20": "级配", "AC-25": "级配"}


def build_graph() -> dict:
    """导出知识图谱（节点 + 边），供前端可视化与解释路径查询。"""
    kb = load_kb()
    mats, kg = kb["materials"], kb["kg"]
    nodes: dict[str, dict] = {}

    def add(nid, name, cat):
        nodes.setdefault(nid, {"id": nid, "name": name, "category": cat})

    for k, v in mats["base_binders"].items():
        add(k, v["name"], "基质沥青")
    for k, v in mats["modifiers"].items():
        if k != "none":
            add(k, v["name"], "改性剂")
    for k, v in mats["gradations"].items():
        add(k, k, "级配")
        add(v["family"], {"AC": "AC 密级配", "SMA": "SMA 沥青玛蹄脂碎石", "OGFC": "OGFC 排水沥青", "SUP": "Superpave"}[v["family"]], "级配类型")
    for k in ("anti_strip", "anti_rut", "warm_mix", "rap", "fiber"):
        add(k, mats["additives"][k]["name"], "功能助剂")
    groups = sorted({v["group"] for v in mats["performance_indicators"].values()} | {"碳排放", "材料成本"})
    for gname in groups:
        add(gname, gname, "性能/目标")
    for k, v in mats["performance_indicators"].items():
        add(k, f"{v['name']}({v['unit']})", "性能指标")
    for k, v in kg["nodes_extra"]["distress"].items():
        if k != "none":
            add(k, v["name"], "病害")
    for r in kg["scenario_requirements"]:
        add(r["src"], r["src"], "场景标签")

    edges = []
    for k, v in mats["gradations"].items():
        edges.append({"source": k, "target": v["family"], "relation": "属于"})
    for k, v in mats["performance_indicators"].items():
        edges.append({"source": k, "target": v["group"], "relation": "表征"})
    for e in kg["material_effects"]:
        edges.append({"source": e["src"], "target": e["dst"], "relation": "提升" if e["sign"] > 0 else "降低",
                      "strength": e["strength"]})
    for k, v in kg["nodes_extra"]["distress"].items():
        for g in v["indicator_groups"]:
            edges.append({"source": g, "target": k, "relation": "缓解"})
    for r in kg["scenario_requirements"]:
        edges.append({"source": r["src"], "target": r["dst"], "relation": "要求", "strength": r["strength"]})
    for mod_key, mod in mats["modifiers"].items():
        if mod_key == "none":
            continue
        for b in mod["bases"]:
            edges.append({"source": mod_key, "target": b, "relation": "改性基质"})
    return {"nodes": list(nodes.values()), "edges": edges}


def explain_path(mix: Mix, distress_type: str) -> list[str]:
    """沿知识图谱给出“材料 → 性能 → 病害”的推理路径（文本）。"""
    kb = load_kb()
    groups = kb["kg"]["nodes_extra"]["distress"].get(distress_type, {}).get("indicator_groups", [])
    present = {mix.base, mix.modifier, mix.family, mix.gradation}
    if mix.anti_strip:
        present.add("anti_strip")
    if mix.anti_rut:
        present.add("anti_rut")
    if mix.warm_mix:
        present.add("warm_mix")
    if mix.rap:
        present.add("rap")
    names = {n["id"]: n["name"] for n in build_graph()["nodes"]}
    dname = kb["kg"]["nodes_extra"]["distress"].get(distress_type, {}).get("name", distress_type)
    paths = []
    for e in kb["kg"]["material_effects"]:
        if e["src"] in present and e["dst"] in groups:
            verb = "提升" if e["sign"] > 0 else "削弱"
            paths.append(f"{names.get(e['src'], e['src'])} —{verb}({'★' * e['strength']})→ {e['dst']} —缓解→ {dname}")
    return paths
