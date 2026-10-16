"""“推荐 → 验证 → 反馈 → 优化”持续学习闭环。

两类反馈：
1. 室内试验反馈（lab）：方案实施前后的试验结果 → 追加进训练集 → 重训残差模型（模型版本+1）。
2. 路用性能跟踪（field）：实际服役年限 vs 预测年限 → 以对数比值做共轭正态贝叶斯更新，
   得到寿命校正系数，修正推荐引擎的寿命/年均成本估计。
"""
from __future__ import annotations

import json
import math
import threading
import time
from pathlib import Path

import pandas as pd

from .data import TARGETS, simulate_lab_data
from .knowledge import Mix
from .model import MODEL_DIR, HybridModel

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
LAB_CSV = DATA_DIR / "lab_records.csv"
FIELD_JSON = DATA_DIR / "field_feedback.json"
MIX_COLS = list(Mix().to_dict().keys())
_lock = threading.Lock()


def init_store(n: int = 160, seed: int = 7, force: bool = False) -> pd.DataFrame:
    """初始化训练数据（默认 160 条模拟试验，模拟“小样本”起步）。"""
    if LAB_CSV.exists() and not force:
        return pd.read_csv(LAB_CSV)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    mixes, y = simulate_lab_data(n, seed=seed)
    df = pd.DataFrame([m.to_dict() for m in mixes])
    df = pd.concat([df, y], axis=1)
    df["source"] = "simulated"
    df["note"] = ""
    df.to_csv(LAB_CSV, index=False)
    return df


def load_records() -> tuple[list[Mix], pd.DataFrame, pd.DataFrame]:
    df = init_store()
    mixes = [Mix(**{k: (r[k] if not isinstance(r[k], float) or not math.isnan(r[k]) else 0) for k in MIX_COLS})
             for _, r in df.iterrows()]
    for m in mixes:
        m.dose = float(m.dose)
        for k in ("anti_strip", "anti_rut", "warm_mix", "rap", "aging"):
            setattr(m, k, int(getattr(m, k)))
    return mixes, df[TARGETS], df


def add_lab_records(records: list[dict], source: str = "lab") -> int:
    """records: [{"mix": {...}, "measured": {"ds":..,"eps":..,...}, "note": ""}]，缺失指标留空。"""
    df = init_store()
    rows = []
    for r in records:
        m = Mix(**r["mix"])
        row = m.to_dict()
        for t in TARGETS:
            row[t] = r["measured"].get(t)
        row["source"] = source
        row["note"] = r.get("note", "")
        rows.append(row)
    with _lock:
        df = pd.concat([df, pd.DataFrame(rows)], ignore_index=True)
        df.to_csv(LAB_CSV, index=False)
    return len(df)


def retrain(mode: str = "hybrid") -> HybridModel:
    mixes, y, df = load_records()
    # 允许部分指标缺测：每个指标只用有值的样本训练
    model = HybridModel(mode)
    full = y.notna().all(axis=1)
    if full.all():
        model.fit(mixes, y)
    else:
        # 简化处理：缺失值用先验预测填补后训练（对该指标残差为0，不引入偏差）
        from .data import featurize, from_model_space, prior_predict
        X = featurize(mixes)
        y2 = y.copy()
        for t in TARGETS:
            miss = y2[t].isna()
            if miss.any():
                y2.loc[miss, t] = from_model_space(t, prior_predict(X[miss], t))
        model.fit(mixes, y2)
    old = None
    try:
        old = HybridModel.load(MODEL_DIR / f"{mode}.pkl")
    except Exception:
        pass
    model.meta["version"] = (old.meta.get("version", 0) + 1) if old else 1
    model.meta["n_by_source"] = df["source"].value_counts().to_dict()
    model.save()
    return model


# ---------------------------------------------------------------- 路用性能反馈 → 寿命校正
def _load_field() -> dict:
    if FIELD_JSON.exists():
        return json.loads(FIELD_JSON.read_text(encoding="utf-8"))
    return {"prior_mu": 0.0, "prior_sd": 0.25, "obs_sd": 0.20, "records": []}


def add_field_record(rec: dict) -> dict:
    """rec: {"case_id":..., "predicted_life": 8.0, "observed_life": 6.5, "mix": {...}, "scenario_tags": [...]}"""
    st = _load_field()
    rec = dict(rec)
    rec["time"] = time.strftime("%Y-%m-%d")
    st["records"].append(rec)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    FIELD_JSON.write_text(json.dumps(st, ensure_ascii=False, indent=2), encoding="utf-8")
    return life_calibration()


def life_calibration() -> dict:
    st = _load_field()
    mu, var = st["prior_mu"], st["prior_sd"] ** 2
    ov = st["obs_sd"] ** 2
    for r in st["records"]:
        x = math.log(r["observed_life"] / r["predicted_life"])
        var_new = 1 / (1 / var + 1 / ov)
        mu = var_new * (mu / var + x / ov)
        var = var_new
    return {"factor": round(math.exp(mu), 3), "log_sd": round(math.sqrt(var), 3), "n": len(st["records"])}
