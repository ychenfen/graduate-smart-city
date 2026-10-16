"""多性能协同预测模型：机理先验 + 数据驱动残差修正（小样本友好），带不确定性与可解释性。

    y_hat(x) = prior(x) + mean_k r_k(x)
    r_k      = 第 k 个自助采样（bootstrap）训练的梯度提升树，只学习“先验没讲清楚的部分”
    σ(x)     = sqrt(集成离散度² + 试验噪声²)  → 推荐时用保守值（均值 - z·σ）校核是否达标

可解释：先验部分是可加模型，贡献可精确拆分；残差部分用 TreeSHAP。两者相加即每个特征对
“相对基准混合料（70#基质 AC-13）”性能差异的贡献。
"""
from __future__ import annotations

import pickle
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

from .data import (FEATURE_CN, FEATURES, TARGETS, featurize, from_model_space, prior_contributions,
                   prior_predict, to_model_space)
from .knowledge import Mix

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"

FEATURE_GROUPS = {
    "结合料（沥青+改性）": ["pg_high", "pg_low", "pen", "sbs", "cr", "hva"],
    "级配类型": ["nmas", "design_voids", "is_sma", "is_ogfc", "is_sup", "td_base"],
    "油石比": ["oil_ratio", "oil_offset"],
    "抗剥落剂": ["anti_strip"], "抗车辙剂": ["anti_rut"], "温拌剂": ["warm_mix"], "RAP掺量": ["rap"],
    "压实度（施工）": ["compaction"], "老化状态": ["aging"],
}


class HybridModel:
    def __init__(self, mode: str = "hybrid", n_members: int = 8, seed: int = 0):
        assert mode in ("hybrid", "pure", "prior")
        self.mode = mode
        self.n_members = n_members
        self.seed = seed
        self.members: dict[str, list] = {}
        self.noise: dict[str, float] = {}
        self.meta: dict = {}

    # -------------------------------------------------------------- 训练
    def _new_reg(self, n: int, rs: int):
        leaf = max(5, min(20, n // 15))
        return HistGradientBoostingRegressor(max_depth=3, learning_rate=0.06, max_iter=250,
                                             min_samples_leaf=leaf, l2_regularization=1.0, random_state=rs)

    def _base(self, X: pd.DataFrame, t: str) -> np.ndarray:
        return prior_predict(X, t) if self.mode == "hybrid" else np.zeros(len(X))

    def fit(self, mixes: list[Mix], y: pd.DataFrame) -> "HybridModel":
        X = featurize(mixes)
        rng = np.random.default_rng(self.seed)
        n = len(X)
        for t in TARGETS:
            yt = to_model_space(t, y[t].to_numpy())
            if self.mode == "prior":
                res = yt - prior_predict(X, t)
                self.noise[t] = float(np.std(res))
                self.members[t] = []
                continue
            r = yt - self._base(X, t)
            members, oob_err = [], [[] for _ in range(n)]
            for k in range(self.n_members):
                idx = rng.integers(0, n, n)
                reg = self._new_reg(n, int(rng.integers(1e9)))
                reg.fit(X.iloc[idx], r[idx])
                members.append(reg)
                oob = np.setdiff1d(np.arange(n), idx)
                if len(oob):
                    p = reg.predict(X.iloc[oob])
                    for i, e in zip(oob, r[oob] - p):
                        oob_err[i].append(e)
            errs = np.array([np.mean(e) for e in oob_err if e])
            self.members[t] = members
            self.noise[t] = float(np.sqrt(np.mean(errs ** 2))) if len(errs) else float(np.std(r))
        self.meta = {"mode": self.mode, "n_train": n, "trained_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                     "version": self.meta.get("version", 0) + 1}
        return self

    # -------------------------------------------------------------- 预测
    def predict_X(self, X: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
        """返回 (均值, 标准差)，均在“模型空间”（动稳定度为 log10）。"""
        mean, std = {}, {}
        for t in TARGETS:
            base = prior_predict(X, t) if self.mode in ("hybrid", "prior") else np.zeros(len(X))
            if self.members.get(t):
                P = np.stack([m.predict(X) for m in self.members[t]])
                mean[t] = base + P.mean(0)
                ens = P.std(0)
            else:
                mean[t] = base
                ens = np.zeros(len(X))
            # OOB 误差已含部分集成方差，这里取两者的平方和作为保守估计
            std[t] = np.sqrt(ens ** 2 + self.noise.get(t, 0.0) ** 2)
        return pd.DataFrame(mean, index=X.index), pd.DataFrame(std, index=X.index)

    def predict(self, mixes: list[Mix]) -> list[dict]:
        X = featurize(mixes)
        mu, sd = self.predict_X(X)
        out = []
        for i in range(len(X)):
            row = {}
            for t in TARGETS:
                m, s = mu[t].iloc[i], sd[t].iloc[i]
                if t == "ds":
                    row[t] = {"mean": float(10 ** m), "low": float(10 ** (m - s)), "high": float(10 ** (m + s)),
                              "std_log10": float(s)}
                else:
                    row[t] = {"mean": float(m), "low": float(m - s), "high": float(m + s), "std": float(s)}
            out.append(row)
        return out

    # -------------------------------------------------------------- 可解释
    def explain(self, mix: Mix, target: str, grouped: bool = True) -> dict:
        X = featurize([mix])
        contrib = np.zeros(len(FEATURES))
        if self.mode in ("hybrid", "prior"):
            contrib += prior_contributions(X, target).iloc[0].to_numpy()
        if self.members.get(target):
            import shap
            sv = np.zeros(len(FEATURES))
            for reg in self.members[target]:
                sv += shap.TreeExplainer(reg).shap_values(X)[0]
            contrib += sv / len(self.members[target])
        s = pd.Series(contrib, index=FEATURES)
        if grouped:
            s = pd.Series({g: s[fs].sum() for g, fs in FEATURE_GROUPS.items()})
        else:
            s.index = [FEATURE_CN[f] for f in FEATURES]
        mu, _ = self.predict_X(X)
        pred = float(mu[target].iloc[0])
        items = [{"factor": k, "contribution": float(v)} for k, v in s.items() if abs(v) > 1e-9]
        items.sort(key=lambda d: -abs(d["contribution"]))
        unit_note = "log10(次/mm)，+0.1≈提高26%" if target == "ds" else ""
        if target == "ds":
            for it in items:
                it["percent"] = float((10 ** it["contribution"] - 1) * 100)
        return {"target": target, "prediction_model_space": pred, "items": items, "unit_note": unit_note,
                "reference": "相对基准：70#基质沥青 AC-13、最佳油石比、无助剂、压实度98%"}

    # -------------------------------------------------------------- 持久化
    def save(self, path: Path | None = None) -> Path:
        path = path or MODEL_DIR / f"{self.mode}.pkl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as f:
            pickle.dump(self, f)
        return path

    @staticmethod
    def load(path: Path | None = None) -> "HybridModel":
        path = path or MODEL_DIR / "hybrid.pkl"
        with open(path, "rb") as f:
            return pickle.load(f)


def evaluate(model: HybridModel, mixes: list[Mix], y: pd.DataFrame) -> dict:
    """R² 与 MAPE（动稳定度在原始空间计算）。"""
    X = featurize(mixes)
    mu, sd = model.predict_X(X)
    res = {}
    for t in TARGETS:
        yt = y[t].to_numpy()
        pred = from_model_space(t, mu[t].to_numpy())
        ss_res = np.sum((yt - pred) ** 2)
        ss_tot = np.sum((yt - yt.mean()) ** 2)
        lo = from_model_space(t, (mu[t] - sd[t]).to_numpy())
        hi = from_model_space(t, (mu[t] + sd[t]).to_numpy())
        res[t] = {"r2": float(1 - ss_res / ss_tot), "mape": float(np.mean(np.abs(pred - yt) / np.abs(yt)) * 100),
                  "coverage_1sigma": float(np.mean((yt >= lo) & (yt <= hi)))}
    return res
