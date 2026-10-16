"""特征工程、机理先验模型与模拟数据生成。

重要说明（务必在答辩与文档中如实陈述）：
- 本原型尚无企业实测数据，训练数据由 `simulate_lab_data` 生成。
- 生成器 = 带非线性/交互作用的“虚拟真实材料行为” + 试验噪声，系数参照规范与公开文献的典型量级设定，
  并刻意与机理先验 `prior_predict` 不完全一致，用来检验“机理-数据混合建模”在小样本下的修正能力。
- 接入企业数据后只需替换数据源，模型与推荐流程不变。
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .knowledge import M, Mix, binder_props, enumerate_candidates

TARGETS = ["ds", "eps", "tsr", "fatigue", "modulus", "td"]
# 动稳定度在 log10 空间建模（量级跨度大、误差近似乘性）
MODEL_SPACE = {"ds": "log10"}

FEATURES = ["pg_high", "pg_low", "pen", "sbs", "cr", "hva", "nmas", "design_voids", "is_sma", "is_ogfc",
            "is_sup", "td_base", "oil_ratio", "oil_offset", "anti_strip", "anti_rut", "warm_mix", "rap",
            "compaction", "aging"]

FEATURE_CN = {
    "pg_high": "结合料高温PG温度", "pg_low": "结合料低温PG温度", "pen": "基质沥青标号", "sbs": "SBS掺量",
    "cr": "胶粉掺量", "hva": "高粘剂掺量", "nmas": "公称最大粒径", "design_voids": "设计空隙率",
    "is_sma": "SMA骨架结构", "is_ogfc": "OGFC开级配", "is_sup": "Superpave级配", "td_base": "级配构造特征",
    "oil_ratio": "油石比", "oil_offset": "油石比偏移", "anti_strip": "抗剥落剂", "anti_rut": "抗车辙剂",
    "warm_mix": "温拌剂", "rap": "RAP掺量", "compaction": "压实度", "aging": "长期老化",
}


def featurize(mixes: list[Mix]) -> pd.DataFrame:
    mats = M()
    rows = []
    for m in mixes:
        g = mats["gradations"][m.gradation]
        bp = binder_props(m.base, m.modifier, m.dose)
        rows.append({
            "pg_high": bp["pg_high_c"], "pg_low": bp["pg_low_c"], "pen": mats["base_binders"][m.base]["pen"],
            "sbs": m.dose if m.modifier == "SBS" else 0.0, "cr": m.dose if m.modifier == "CR" else 0.0,
            "hva": m.dose if m.modifier == "HVA" else 0.0,
            "nmas": g["nmas"], "design_voids": g["design_voids"],
            "is_sma": int(g["family"] == "SMA"), "is_ogfc": int(g["family"] == "OGFC"),
            "is_sup": int(g["family"] == "SUP"), "td_base": g["td"],
            "oil_ratio": g["oac"] + m.oil_offset, "oil_offset": m.oil_offset,
            "anti_strip": m.anti_strip, "anti_rut": m.anti_rut, "warm_mix": m.warm_mix, "rap": m.rap,
            "compaction": m.compaction, "aging": m.aging,
        })
    return pd.DataFrame(rows, columns=FEATURES)


# ------------------------------------------------------------------ 机理先验（可加性，便于精确归因）
# 每个指标：baseline + Σ coef * (f(x) - f(ref))；ref = 70#基质 AC-13 最佳油石比 无助剂 压实度98% 未老化
REF = Mix()

PRIOR = {
    "ds": {"_base": 3.08, "pg_high": 0.036, "is_sma": 0.22, "is_ogfc": 0.05, "is_sup": 0.06, "nmas": 0.012,
           "anti_rut": 0.30, "rap": 0.004, "oil_offset": -0.35, "compaction": 0.05, "warm_mix": -0.03,
           "aging": 0.08},
    "eps": {"_base": 2250, "pg_low": -45, "sbs": 70, "cr": 14, "hva": 25, "is_sma": 200, "is_ogfc": 80,
            "is_sup": 30, "nmas": -15, "oil_offset": 400, "anti_rut": -180, "rap": -10, "warm_mix": 40,
            "compaction": 30, "aging": -350},
    "tsr": {"_base": 82.0, "anti_strip": 5.0, "sbs": 0.6, "cr": 0.1, "hva": 0.5, "is_sma": 2.0, "is_ogfc": -6.0,
            "is_sup": 0.5, "compaction": 1.2, "warm_mix": -2.0, "rap": -0.08, "oil_offset": 4.0, "aging": -3.0},
    "fatigue": {"_base": 5.10, "sbs": 0.08, "cr": 0.022, "hva": 0.045, "is_sma": 0.25, "is_ogfc": -0.15,
                "is_sup": 0.05, "nmas": -0.015, "oil_offset": 0.35, "anti_rut": -0.10, "rap": -0.008,
                "compaction": 0.04, "pen": 0.003, "aging": -0.25},
    "modulus": {"_base": 9500, "pen": -80, "sbs": 120, "cr": -15, "hva": 60, "is_sma": -600, "is_ogfc": -3500,
                "is_sup": 200, "nmas": 120, "anti_rut": 1500, "rap": 45, "oil_offset": -1500, "compaction": 250,
                "aging": 1500},
    "td": {"_base": 0.60, "td_base": 1.0, "compaction": -0.02, "oil_offset": -0.15},
}


def _ref_row() -> pd.Series:
    return featurize([REF]).iloc[0]


def prior_contributions(X: pd.DataFrame, target: str) -> pd.DataFrame:
    """先验模型各特征的可加贡献（相对基准混合料）。"""
    ref = _ref_row()
    coefs = PRIOR[target]
    out = pd.DataFrame(0.0, index=X.index, columns=FEATURES)
    for f, c in coefs.items():
        if f == "_base":
            continue
        out[f] = c * (X[f].astype(float) - float(ref[f]))
    return out


def prior_predict(X: pd.DataFrame, target: str) -> np.ndarray:
    return PRIOR[target]["_base"] + prior_contributions(X, target).sum(axis=1).to_numpy()


def to_model_space(target: str, y):
    return np.log10(y) if MODEL_SPACE.get(target) == "log10" else np.asarray(y, dtype=float)


def from_model_space(target: str, y):
    return 10 ** np.asarray(y) if MODEL_SPACE.get(target) == "log10" else np.asarray(y, dtype=float)


# ------------------------------------------------------------------ 虚拟“真实”材料行为（数据生成器）

_TRUE_BASE_HIGH = {"50#": 70.0, "70#": 64.8, "90#": 60.9, "110#": 56.0}
_TRUE_BASE_LOW = {"50#": -16.0, "70#": -22.4, "90#": -26.8, "110#": -30.6}


def _true_binder(base: np.ndarray, sbs, cr, hva):
    high = np.array([_TRUE_BASE_HIGH[b] for b in base])
    low = np.array([_TRUE_BASE_LOW[b] for b in base])
    # 改性效果随掺量饱和（先验是线性的 → 高掺量被先验高估）
    high = high + 14 * (1 - np.exp(-sbs / 3.2)) + 12 * (1 - np.exp(-cr / 14)) + 22 * (1 - np.exp(-hva / 7))
    low = low - 6.5 * (1 - np.exp(-sbs / 3.5)) - 7.0 * (1 - np.exp(-cr / 16)) - 8.0 * (1 - np.exp(-hva / 8))
    return high, low


def true_performance(mixes: list[Mix]) -> pd.DataFrame:
    """无噪声的虚拟真值。"""
    X = featurize(mixes)
    base = np.array([m.base for m in mixes])
    sbs, cr, hva = X["sbs"].to_numpy(), X["cr"].to_numpy(), X["hva"].to_numpy()
    sma, ogfc, sup = X["is_sma"].to_numpy(), X["is_ogfc"].to_numpy(), X["is_sup"].to_numpy()
    oo, c, ag = X["oil_offset"].to_numpy(), X["compaction"].to_numpy(), X["aging"].to_numpy()
    ar, ast, wm, rap = X["anti_rut"].to_numpy(), X["anti_strip"].to_numpy(), X["warm_mix"].to_numpy(), X["rap"].to_numpy()
    nmas = X["nmas"].to_numpy()
    pen = X["pen"].to_numpy()
    high, low = _true_binder(base, sbs, cr, hva)
    dens = 1 - np.exp(-0.7 * (c - 95.0))      # 压实效果非线性饱和

    ds = (3.10 + 0.040 * (high - 65) + 0.25 * sma + 0.02 * ogfc + 0.08 * sup + 0.010 * (nmas - 13.2)
          + ar * 0.27 * (1 - 0.35 * sma) + 0.0045 * rap
          - 0.20 * oo - 1.6 * np.clip(oo, 0, None) ** 2            # 油石比过高急剧失稳
          + 0.18 * (dens - 0.95) / 0.05 * 0.25 - 0.04 * wm + 0.07 * ag
          + 0.05 * (sbs > 0) * sma)                                   # 改性×骨架协同
    eps = (2230 - 42 * (low + 22.4) + 55 * sbs + 11 * cr + 22 * hva + 230 * sma + 60 * ogfc + 20 * sup
           - 12 * (nmas - 13.2) + 520 * oo - 260 * np.clip(oo, 0, None) * 2 - 190 * ar
           - 11 * rap - 3 * np.clip(rap - 20, 0, None) ** 1.5        # 高RAP掺量非线性劣化
           + 60 * wm + 220 * (dens - 0.95) - 380 * ag * (1 - 0.25 * (sbs + cr + hva > 0)))  # 改性减缓老化
    tsr = (81.0 + ast * (4.0 + 3.5 * ogfc + 2.0 * wm) + 0.5 * sbs + 0.12 * cr + 0.55 * hva + 2.3 * sma
           - 7.5 * ogfc + 0.6 * sup + 1.4 * (c - 98) - 2.8 * wm - 0.07 * rap + 5 * oo - 3 * ag)
    fat = (5.05 + 0.32 * (1 - np.exp(-sbs / 3.0)) * 1.2 + 0.09 * cr / 4.5 * (1 - 0.3 * (nmas < 10))
           + 0.04 * hva + 0.27 * sma - 0.18 * ogfc + 0.05 * sup - 0.012 * (nmas - 13.2)
           + 0.45 * oo - 0.6 * np.clip(-oo, 0, None) ** 2 - 0.12 * ar - 0.007 * rap
           + 0.05 * (c - 98) + 0.0035 * (pen - 70) - 0.27 * ag)
    mod = (9400 - 75 * (pen - 70) + 110 * sbs - 20 * cr + 55 * hva - 700 * sma - 3700 * ogfc + 250 * sup
           + 110 * (nmas - 13.2) + 1650 * ar * (1 + 0.2 * (nmas > 15)) + 50 * rap - 1700 * oo
           + 900 * (dens - 0.95) / 0.05 * 0.3 + 1400 * ag)
    td = X["td_base"].to_numpy() + 0.03 * (sma + ogfc) - 0.025 * (c - 98) - 0.18 * oo
    return pd.DataFrame({"ds": 10 ** ds, "eps": eps, "tsr": np.clip(tsr, 40, 99), "fatigue": fat,
                         "modulus": np.clip(mod, 2500, None), "td": np.clip(td, 0.3, None)})


NOISE = {"ds": 0.06, "eps": 0.07, "tsr": 2.5, "fatigue": 0.12, "modulus": 0.07, "td": 0.05}


def simulate_lab_data(n: int, seed: int = 0) -> tuple[list[Mix], pd.DataFrame]:
    """生成 n 条带试验噪声的模拟“室内试验”数据。"""
    rng = np.random.default_rng(seed)
    pool = enumerate_candidates(oil_offsets=(0.0,))
    idx = rng.choice(len(pool), size=n, replace=True)
    mixes = []
    for i in idx:
        m = Mix(**pool[i].to_dict())
        m.oil_offset = round(float(rng.uniform(-0.4, 0.4)), 2)
        m.compaction = round(float(rng.uniform(96.0, 99.5)), 1)
        m.aging = int(rng.random() < 0.25)
        mixes.append(m)
    y = true_performance(mixes)
    y["ds"] = y["ds"] * 10 ** rng.normal(0, NOISE["ds"], n)
    y["eps"] = y["eps"] * (1 + rng.normal(0, NOISE["eps"], n))
    y["tsr"] = np.clip(y["tsr"] + rng.normal(0, NOISE["tsr"], n), 40, 99)
    y["fatigue"] = y["fatigue"] + rng.normal(0, NOISE["fatigue"], n)
    y["modulus"] = y["modulus"] * (1 + rng.normal(0, NOISE["modulus"], n))
    y["td"] = np.clip(y["td"] + rng.normal(0, NOISE["td"], n), 0.2, None)
    return mixes, y.round({"ds": 0, "eps": 0, "tsr": 1, "fatigue": 3, "modulus": 0, "td": 2})
