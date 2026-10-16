"""材料成本、碳排放与预期寿命估算（示意参数，可替换为企业采购价与 LCA 数据库）。"""
from __future__ import annotations

import math

from .knowledge import M, Mix, binder_carbon, binder_price, mixing_temperature

DENSITY = 2.40          # t/m³ 压实混合料毛体积密度（OGFC 取 2.05）
RAP_BINDER = 0.045      # RAP 中旧沥青含量
BASE_LIFE = {"轻": 10.0, "中等": 9.0, "重": 8.0, "特重": 7.0, "极重": 6.0}

# 寿命模型中各指标裕度的归一化尺度（模型空间）
MARGIN_SCALE = {"ds": 0.2, "eps": 500.0, "tsr": 8.0, "fatigue": 0.4, "modulus": 3000.0, "td": 0.3}


def _fractions(mix: Mix) -> tuple[float, float]:
    binder_frac = mix.oil_ratio / (100.0 + mix.oil_ratio)
    rap = mix.rap / 100.0
    virgin_binder = max(binder_frac - rap * RAP_BINDER, 0.0)
    virgin_agg = max(1.0 - binder_frac - rap * (1 - RAP_BINDER), 0.0)
    return virgin_binder, virgin_agg


def cost_per_t(mix: Mix) -> float:
    mats = M()
    g = mats["gradations"][mix.gradation]
    add = mats["additives"]
    vb, va = _fractions(mix)
    c = vb * binder_price(mix) + va * g["agg_price"] + mats["process"]["production_cost"]
    c += mix.rap / 100.0 * 60 + (mix.rap / 10.0) * 2.0      # RAP 处理与再生剂
    if g["fiber"]:
        c += add["fiber"]["price_per_t_mix"]
    c += mix.anti_strip * add["anti_strip"]["price_per_t_mix"]
    c += mix.anti_rut * add["anti_rut"]["price_per_t_mix"]
    c += mix.warm_mix * add["warm_mix"]["price_per_t_mix"]
    return round(c, 1)


def carbon_per_t(mix: Mix) -> float:
    """kgCO2e / t 混合料（原材料 + 拌和能耗，A1-A3 阶段）。"""
    mats = M()
    g = mats["gradations"][mix.gradation]
    add = mats["additives"]
    p = mats["process"]
    vb, va = _fractions(mix)
    e = vb * binder_carbon(mix) + va * p["aggregate_carbon"]
    t_lo, t_hi = mixing_temperature(mix)
    temp_factor = 1 + ((t_lo + t_hi) / 2 - 155) / 100.0      # 拌和温度每升高10℃能耗约+10%
    e += p["plant_energy_carbon"] * temp_factor
    e += mix.rap / 100.0 * 2.0
    if g["fiber"]:
        e += add["fiber"]["carbon_per_t_mix"]
    e += mix.anti_strip * add["anti_strip"]["carbon_per_t_mix"]
    e += mix.anti_rut * add["anti_rut"]["carbon_per_t_mix"]
    e += mix.warm_mix * add["warm_mix"]["carbon_per_t_mix"]
    return round(e, 2)


def per_m2(mix: Mix, thickness_cm: float, per_t: float) -> float:
    dens = 2.05 if mix.family == "OGFC" else DENSITY
    return per_t * dens * thickness_cm / 100.0


def expected_life(traffic: str, margins: dict[str, float], weights: dict[str, float], factor: float = 1.0) -> float:
    """预期使用寿命（年）：基准寿命 × exp(加权裕度)。裕度为负（不达标）会显著缩短寿命。"""
    perf = {k: w for k, w in weights.items() if k in MARGIN_SCALE and w > 0}
    tot = sum(perf.values()) or 1.0
    s = 0.0
    for k, w in perf.items():
        m = max(-1.5, min(0.5, margins.get(k, 0.0)))   # 富余性能对寿命的增益有上限
        s += w / tot * (m if m >= 0 else 1.6 * m)       # 不达标惩罚更重
    return round(BASE_LIFE[traffic] * factor * math.exp(0.45 * s), 1)
