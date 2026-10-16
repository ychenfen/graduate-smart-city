"""推荐结果稳健性分析：python scripts/robustness.py  → cases/robustness.json

1. 单价敏感性：改性剂与基质沥青单价 ±20%，首选方案的材料体系是否改变
2. 权重扰动：各指标权重随机 ±30%（20 次），首选材料体系的一致率
3. 训练数据重采样：5 组不同随机种子的 160 条数据分别训练，首选方案一致率与虚拟真值达标率
4. 数据量：40/80/160/400 条数据训练时，首选方案在虚拟真值下满足全部硬性指标的案例数
"""
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from smartmix import recommender as recmod  # noqa: E402
from smartmix.data import TARGETS, simulate_lab_data, true_performance  # noqa: E402
from smartmix.knowledge import M, Mix  # noqa: E402
from smartmix.model import HybridModel  # noqa: E402
from smartmix.requirements import PRESETS, map_requirements  # noqa: E402

CASES = ["hainan_heavy_rut", "harbin_thermal_crack", "wuhan_water_damage", "expressway_skid_noise",
         "northwest_reflective", "intersection_extreme", "rural_low_carbon"]
FAMILY_CN = {"none": "基质", "SBS": "SBS", "CR": "橡胶", "HVA": "高粘"}


def fam(c):
    m = c["mix"]
    return f"{FAMILY_CN[m['modifier']]}·{M()['gradations'][m['gradation']]['family']}"


def truth_ok(c, sc):
    req = map_requirements(sc)
    t = true_performance([Mix(**c["mix"])]).iloc[0]
    return all(t[k] >= req["targets"][k]["target"] for k in TARGETS
               if req["targets"][k]["hard"] and req["targets"][k]["target"] > 0)


def top(rec, key):
    return rec.recommend(PRESETS[key], top_k=1, explain=False)["candidates"][0]


def main():
    model = HybridModel.load()
    rec = recmod.Recommender(model)
    base = {k: top(rec, k) for k in CASES}
    out = {"baseline": {k: {"family": fam(v), "label": v["label"]} for k, v in base.items()}}

    # 1. 单价敏感性
    mats = M()
    orig_mod = {k: v["price"] for k, v in mats["modifiers"].items()}
    orig_base = {k: v["price"] for k, v in mats["base_binders"].items()}
    price = {}
    for name, f_mod, f_base in [("改性剂−20%", 0.8, 1.0), ("改性剂+20%", 1.2, 1.0),
                                ("基质沥青−20%", 1.0, 0.8), ("基质沥青+20%", 1.0, 1.2),
                                ("橡胶粉+50%", None, 1.0)]:
        for k, v in mats["modifiers"].items():
            v["price"] = orig_mod[k] * (f_mod if f_mod else (1.5 if k == "CR" else 1.0))
        for k, v in mats["base_binders"].items():
            v["price"] = orig_base[k] * f_base
        price[name] = {k: fam(top(rec, k)) for k in CASES}
    for k, v in mats["modifiers"].items():
        v["price"] = orig_mod[k]
    for k, v in mats["base_binders"].items():
        v["price"] = orig_base[k]
    out["price"] = price
    print("price done")

    # 2. 权重扰动
    rng = np.random.default_rng(0)
    real_map = recmod.map_requirements
    weight_hits = {k: Counter() for k in CASES}
    for i in range(20):
        noise = {t: float(rng.uniform(0.7, 1.3)) for t in TARGETS}

        def perturbed(sc, noise=noise):
            q = real_map(sc)
            perf = {t: q["weights"][t] * noise[t] for t in TARGETS}
            s = sum(q["weights"][t] for t in TARGETS) / (sum(perf.values()) or 1)
            for t in TARGETS:
                q["weights"][t] = perf[t] * s
            return q
        recmod.map_requirements = perturbed
        for k in CASES:
            weight_hits[k][fam(top(rec, k))] += 1
    recmod.map_requirements = real_map
    out["weights"] = {k: {"same_as_baseline": weight_hits[k][out["baseline"][k]["family"]] / 20,
                          "families": dict(weight_hits[k])} for k in CASES}
    print("weights done")

    # 3. 训练数据重采样
    seeds = {}
    for seed in (11, 22, 33, 44, 55):
        m, y = simulate_lab_data(160, seed=seed)
        r = recmod.Recommender(HybridModel("hybrid", seed=seed).fit(m, y))
        seeds[seed] = {k: (lambda c: {"family": fam(c), "truth_ok": truth_ok(c, PRESETS[k])})(top(r, k)) for k in CASES}
    out["seeds"] = seeds
    print("seeds done")

    # 4. 数据量
    size = {}
    for n in (40, 80, 160, 400):
        m, y = simulate_lab_data(n, seed=1000 + n)
        r = recmod.Recommender(HybridModel("hybrid").fit(m, y))
        size[n] = sum(truth_ok(top(r, k), PRESETS[k]) for k in CASES)
        m2 = recmod.Recommender(HybridModel("pure").fit(m, y))
        size[f"{n}_pure"] = sum(truth_ok(top(m2, k), PRESETS[k]) for k in CASES)
    out["size"] = size
    (ROOT / "cases" / "robustness.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
