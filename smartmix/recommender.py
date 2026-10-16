"""沥青混合料材料方案智能推荐引擎。

流程：场景 → 性能需求（requirements）→ 候选空间枚举 + 知识规则过滤 → 多性能预测（含不确定性）
     → 保守校核硬性指标 → 多目标评分（性能裕度 / 年均成本 / 年均碳排）→ Pareto 前沿 + 多样化 Top-K
     → 每个方案输出：配方、预测值与区间、达标表、成本碳排寿命、推荐理由、知识图谱推理路径、施工工艺建议。

候选空间约 3×10³ 量级，原型采用“全枚举 + 代理模型批量预测”，严格优于随机/贝叶斯搜索的召回；
当引入连续掺量、多种集料等使空间增至 10⁶ 以上时，替换为贝叶斯优化或 NSGA-II（接口不变）。
"""
from __future__ import annotations

from dataclasses import replace

import numpy as np
import pandas as pd

from . import economics as eco
from .data import TARGETS, featurize, to_model_space
from .knowledge import Mix, binder_props, check_rules, enumerate_candidates, explain_path, mixing_temperature
from .model import HybridModel
from .requirements import DISTRESS, IND_NAME, map_requirements

Z = 0.67         # 保守系数：均值 - Z·σ，约 75% 单侧置信
UNITS = {"ds": "次/mm", "eps": "με", "tsr": "%", "fatigue": "lg次", "modulus": "MPa", "td": "mm"}


def _margins(mu: pd.DataFrame, sd: pd.DataFrame, targets: dict) -> tuple[pd.DataFrame, pd.DataFrame]:
    """返回 (保守值裕度[归一化], 是否达标)。"""
    marg, ok = {}, {}
    for t in TARGETS:
        tgt = targets[t]["target"]
        if tgt <= 0:
            marg[t] = np.zeros(len(mu))
            ok[t] = np.ones(len(mu), dtype=bool)
            continue
        cons = mu[t] - Z * sd[t]
        tgt_m = float(to_model_space(t, tgt))
        marg[t] = ((cons - tgt_m) / eco.MARGIN_SCALE[t]).to_numpy()
        ok[t] = (cons >= tgt_m).to_numpy()
    return pd.DataFrame(marg, index=mu.index), pd.DataFrame(ok, index=mu.index)


def _fmt(t: str, v: float) -> str:
    return {"ds": f"{v:,.0f}", "eps": f"{v:,.0f}", "tsr": f"{v:.1f}", "fatigue": f"{v:.2f}",
            "modulus": f"{v:,.0f}", "td": f"{v:.2f}"}[t]


class Recommender:
    def __init__(self, model: HybridModel, life_factor: float = 1.0):
        self.model = model
        self.life_factor = life_factor     # 来自路用性能反馈的寿命校正系数

    # -------------------------------------------------------------- 打分
    def score_mixes(self, mixes: list[Mix], req: dict) -> pd.DataFrame:
        s = req["scenario"]
        w = req["weights"]
        X = featurize(mixes)
        mu, sd = self.model.predict_X(X)
        marg, ok = _margins(mu, sd, req["targets"])
        hard = [t for t in TARGETS if req["targets"][t]["hard"] and req["targets"][t]["target"] > 0]
        df = pd.DataFrame(index=X.index)
        df["mix_idx"] = range(len(mixes))
        df["feasible"] = ok[hard].all(axis=1) if hard else True
        short = np.clip(-marg[hard], 0, None).sum(axis=1) if hard else 0
        df["shortfall"] = short
        perf_w = {t: w[t] for t in TARGETS if w[t] > 0}
        util = sum(w_ * np.tanh(1.5 * marg[t]) for t, w_ in perf_w.items())
        df["perf_score"] = util / sum(perf_w.values())
        df["cost_t"] = [eco.cost_per_t(m) for m in mixes]
        df["carbon_t"] = [eco.carbon_per_t(m) for m in mixes]
        df["life"] = [eco.expected_life(s["traffic"], marg.iloc[i].to_dict(), w, self.life_factor)
                      for i in range(len(mixes))]
        th = s["thickness_cm"]
        df["cost_m2"] = [eco.per_m2(m, th, c) for m, c in zip(mixes, df["cost_t"])]
        df["carbon_m2"] = [eco.per_m2(m, th, c) for m, c in zip(mixes, df["carbon_t"])]
        df["cost_m2_yr"] = df["cost_m2"] / df["life"]
        df["carbon_m2_yr"] = df["carbon_m2"] / df["life"]
        self._cache = (mu, sd, marg, ok)
        return df

    def _total(self, df: pd.DataFrame, w: dict) -> pd.Series:
        def norm(col):
            lo, hi = df[col].min(), df[col].max()
            return (df[col] - lo) / (hi - lo) if hi > lo else df[col] * 0
        perf_share = 1 - w["cost"] - w["carbon"]
        # 成本 = 一次性投入与全寿命年均成本的加权；预算越紧越看重一次性投入
        a = w.get("upfront_share", 0.3)
        cost = a * norm("cost_m2") + (1 - a) * norm("cost_m2_yr")
        return perf_share * df["perf_score"] - w["cost"] * cost - w["carbon"] * norm("carbon_m2_yr") \
            - 0.05 * df["prefer_violation"]

    # -------------------------------------------------------------- 主流程
    def recommend(self, scenario: dict, top_k: int = 5, baselines: list[Mix] | None = None,
                  explain: bool = True) -> dict:
        req = map_requirements(scenario)
        s = req["scenario"]
        cands = enumerate_candidates(layer=s["layer"], thickness_cm=s["thickness_cm"],
                                     allow_rap=s["constraints"]["allow_rap"])
        n_space = len(cands)
        kept, excluded = [], {}
        prefer_flags = []
        for m in cands:
            hits = check_rules(m, s)
            forb = [h for h in hits if h["type"] == "forbid"]
            if forb:
                for h in forb:
                    excluded[h["id"]] = excluded.get(h["id"], {"reason": h["reason"], "count": 0})
                    excluded[h["id"]]["count"] += 1
                continue
            kept.append(m)
            prefer_flags.append(int(any(h["type"] == "prefer" for h in hits)))
        df = self.score_mixes(kept, req)
        df["prefer_violation"] = prefer_flags
        budget = s["constraints"].get("budget_max")
        if budget:
            over = df["cost_t"] > budget
            excluded["BUDGET"] = {"reason": f"单价超过预算上限 {budget} 元/t", "count": int(over.sum())}
            df = df[~over]
        mu, sd, marg, ok = self._cache
        feasible = df[df["feasible"]]
        relaxed = False
        pool = feasible
        if len(pool) == 0:
            relaxed = True
            pool = df.nsmallest(max(top_k * 10, 50), "shortfall")
        pool = pool.assign(total=self._total(pool, req["weights"]))
        pool = pool.sort_values("total", ascending=False)

        # Pareto 前沿（性能↑、年均成本↓、年均碳排↓）
        P = pool[["perf_score", "cost_m2_yr", "carbon_m2_yr"]].to_numpy()
        is_pareto = np.ones(len(P), dtype=bool)
        for i in range(len(P)):
            dom = (P[:, 0] >= P[i, 0]) & (P[:, 1] <= P[i, 1]) & (P[:, 2] <= P[i, 2]) & \
                  ((P[:, 0] > P[i, 0]) | (P[:, 1] < P[i, 1]) | (P[:, 2] < P[i, 2]))
            if dom.any():
                is_pareto[i] = False
        pool = pool.assign(pareto=is_pareto)

        # 多样化 Top-K：同一“改性剂类型+级配”只取最优一个
        chosen, fams = [], set()
        for idx, r in pool.iterrows():
            m = kept[int(r["mix_idx"])]
            fam = (m.modifier, m.gradation)
            if fam in fams:
                continue
            fams.add(fam)
            chosen.append(idx)
            if len(chosen) >= top_k:
                break

        # 可行方案族不足 Top-K 时，补充“接近达标”的其他方案族作为对比参考
        near = []
        if not relaxed and len(chosen) < top_k:
            others = df[~df["feasible"]].nsmallest(max(top_k * 20, 100), "shortfall")
            others = others.assign(total=self._total(others, req["weights"]), pareto=False)
            others = others.sort_values(["shortfall", "total"], ascending=[True, False])
            for idx, r in others.iterrows():
                m = kept[int(r["mix_idx"])]
                fam = (m.modifier, m.gradation)
                if fam in fams:
                    continue
                fams.add(fam)
                near.append((idx, r))
                if len(chosen) + len(near) >= top_k:
                    break

        results = [self._detail(kept[int(pool.loc[i, "mix_idx"])], pool.loc[i], req, rank + 1, explain)
                   for rank, i in enumerate(chosen)]
        for j, (idx, r) in enumerate(near):
            d = self._detail(kept[int(r["mix_idx"])], r, req, len(chosen) + j + 1, explain)
            d["near_feasible"] = True
            results.append(d)
        base_out = []
        for b in baselines or []:
            bdf = self.score_mixes([b], req)
            bdf["prefer_violation"] = [int(any(h["type"] == "prefer" for h in check_rules(b, s)))]
            row = bdf.iloc[0].copy()
            row["pareto"] = False
            rules = check_rules(b, s)
            d = self._detail(b, row, req, 0, explain=False)
            d["rule_violations"] = [h["reason"] for h in rules if h["type"] == "forbid"]
            base_out.append(d)
        pareto_pts = pool[pool["pareto"]][["perf_score", "cost_m2_yr", "carbon_m2_yr"]].head(200)
        return {
            "requirements": req,
            "search": {"space_size": n_space, "after_rules": len(kept), "feasible": int(len(feasible)),
                       "excluded_by_rules": excluded, "relaxed": relaxed,
                       "note": "无候选方案满足全部硬性指标，已按缺口最小排序并放宽" if relaxed else ""},
            "candidates": results,
            "baselines": base_out,
            "pareto": [{"perf": float(a), "cost_m2_yr": float(b), "carbon_m2_yr": float(c)}
                       for a, b, c in pareto_pts.to_numpy()],
        }

    # -------------------------------------------------------------- 单方案详情
    def evaluate_mix(self, mix: Mix, scenario: dict) -> dict:
        req = map_requirements(scenario)
        df = self.score_mixes([mix], req)
        df["prefer_violation"] = [int(any(h["type"] == "prefer" for h in check_rules(mix, req["scenario"])))]
        row = df.iloc[0].copy()
        row["pareto"] = False
        d = self._detail(mix, row, req, 0, explain=True)
        d["rule_violations"] = [h["reason"] for h in check_rules(mix, req["scenario"]) if h["type"] == "forbid"]
        return d

    def _detail(self, mix: Mix, row: pd.Series, req: dict, rank: int, explain: bool) -> dict:
        s = req["scenario"]
        preds = self.model.predict([mix])[0]
        X = featurize([mix])
        mu, sd = self.model.predict_X(X)
        marg, ok = _margins(mu, sd, req["targets"])
        checks = []
        for t in TARGETS:
            tg = req["targets"][t]
            if tg["target"] <= 0:
                continue
            p = preds[t]
            cons_m = float(mu[t].iloc[0] - Z * sd[t].iloc[0])
            cons = 10 ** cons_m if t == "ds" else cons_m
            checks.append({"conservative": round(cons, 3), "indicator": t, "name": IND_NAME[t], "unit": UNITS[t], "target": tg["target"],
                           "hard": tg["hard"], "pred": round(p["mean"], 3), "low": round(p["low"], 3),
                           "high": round(p["high"], 3), "pass": bool(ok[t].iloc[0]),
                           "margin": round(float(marg[t].iloc[0]), 3)})
        bp = binder_props(mix.base, mix.modifier, mix.dose)
        t_lo, t_hi = mixing_temperature(mix)
        out = {
            "rank": rank,
            "mix": mix.to_dict(),
            "label": mix.label(),
            "formula": {"binder": bp["pg_grade"], "pg_high_c": bp["pg_high_c"], "pg_low_c": bp["pg_low_c"],
                        "gradation": mix.gradation, "oil_ratio": mix.oil_ratio, "modifier": mix.modifier,
                        "dose": mix.dose, "anti_strip": mix.anti_strip, "anti_rut": mix.anti_rut,
                        "warm_mix": mix.warm_mix, "rap": mix.rap},
            "predictions": preds,
            "checks": checks,
            "feasible": bool(row["feasible"]),
            "scores": {"total": float(row.get("total", np.nan)) if "total" in row else None,
                       "perf": float(row["perf_score"]), "pareto": bool(row["pareto"])},
            "economics": {"cost_t": float(row["cost_t"]), "cost_m2": round(float(row["cost_m2"]), 2),
                          "carbon_t": float(row["carbon_t"]), "carbon_m2": round(float(row["carbon_m2"]), 2),
                          "life_years": float(row["life"]), "cost_m2_yr": round(float(row["cost_m2_yr"]), 2),
                          "carbon_m2_yr": round(float(row["carbon_m2_yr"]), 2)},
            "construction": self._construction(mix, req, t_lo, t_hi),
        }
        out["reasons"] = self._reasons(mix, checks, out["economics"], req)
        out["kg_paths"] = {DISTRESS[d["type"]]: explain_path(mix, d["type"])
                           for d in s["distress"] if d["type"] != "none"}
        if explain:
            top = [t for t in sorted(TARGETS, key=lambda k: -req["weights"][k]) if req["targets"][t]["target"] > 0][:3]
            out["explanations"] = {t: self.model.explain(mix, t) for t in top}
        return out

    def _construction(self, mix: Mix, req: dict, t_lo: int, t_hi: int) -> dict:
        """材料-工艺协同：压实度敏感性 + 满足硬性指标所需的最低压实度。"""
        hard = [t for t in TARGETS if req["targets"][t]["hard"] and req["targets"][t]["target"] > 0]
        levels = [96.0, 97.0, 98.0, 99.0]
        mixes = [replace(mix, compaction=c) for c in levels]
        mu, sd = self.model.predict_X(featurize(mixes))
        marg, ok = _margins(mu, sd, req["targets"])
        sens = []
        for i, c in enumerate(levels):
            sens.append({"compaction": c, "ds": float(10 ** mu["ds"].iloc[i]), "tsr": float(mu["tsr"].iloc[i]),
                         "all_hard_pass": bool(ok[hard].iloc[i].all()) if hard else True})
        min_c = next((x["compaction"] for x in sens if x["all_hard_pass"]), None)
        ds96, ds98 = sens[0]["ds"], sens[2]["ds"]
        notes = [f"拌和温度 {t_lo}–{t_hi}℃，出料温度不低于 {t_lo - 5}℃",
                 f"压实度由98%降至96%时，预测动稳定度下降约 {(1 - ds96 / ds98) * 100:.0f}%"]
        if mix.family == "SMA":
            notes.append("SMA 需钢轮压路机紧跟碾压，禁用胶轮，防止泛油")
        if mix.family == "OGFC":
            notes.append("OGFC 不宜过度碾压以免堵塞空隙，下承层需完好防水")
        if mix.warm_mix:
            notes.append("温拌工艺可在气温 ≥5℃ 时施工，并可提前开放交通")
        if mix.rap:
            notes.append(f"RAP 需分级预处理并检测旧料沥青含量，控制掺量 {mix.rap}%")
        dtypes = {d["type"] for d in req["scenario"]["distress"]}
        if "reflective_crack" in dtypes:
            notes.append("反射裂缝处治建议在新铺层下设置应力吸收层（橡胶沥青/SBS 同步碎石封层）或抗裂土工格栅")
        if "water_damage" in dtypes:
            notes.append("水损害路段铣刨后应排查下承层积水与基层松散，必要时增设防水粘结层")
        return {"mix_temp": [t_lo, t_hi], "min_compaction": min_c,
                "recommended_compaction": max(98.0, min_c or 98.0), "sensitivity": sens, "notes": notes}

    def _reasons(self, mix: Mix, checks: list, eco_: dict, req: dict) -> list[str]:
        r = []
        failed = [c for c in checks if c["hard"] and not c["pass"]]
        if not failed:
            r.append("在75%单侧置信的保守预测下满足全部硬性性能指标")
        else:
            r.append("未满足：" + "、".join(f"{c['name']}（预测均值{_fmt(c['indicator'], c['pred'])}，"
                                        f"75%保守值{_fmt(c['indicator'], c['conservative'])}，目标{c['target']}）"
                                        for c in failed))
        top = sorted([c for c in checks if c["pass"]], key=lambda c: -req["weights"][c["indicator"]])[:3]
        for c in top:
            r.append(f"{c['name']}：预测 {_fmt(c['indicator'], c['pred'])}{c['unit']}，目标 ≥{c['target']}，"
                     f"权重 {req['weights'][c['indicator']]:.2f}")
        r.append(f"单价约 {eco_['cost_t']:.0f} 元/t，预期寿命 {eco_['life_years']} 年，"
                 f"年均 {eco_['cost_m2_yr']:.2f} 元/m²·年，碳排 {eco_['carbon_t']:.1f} kgCO₂e/t")
        return r
