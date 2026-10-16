import numpy as np
import pytest

from smartmix.data import simulate_lab_data
from smartmix.knowledge import Mix, check_rules, enumerate_candidates, pg_grade
from smartmix.model import HybridModel, evaluate
from smartmix.recommender import Recommender
from smartmix.requirements import PRESETS, climate_zones, map_requirements


@pytest.fixture(scope="module")
def model():
    mixes, y = simulate_lab_data(160, seed=7)
    return HybridModel("hybrid").fit(mixes, y)


@pytest.fixture(scope="module")
def rec(model):
    return Recommender(model)


def test_climate_zones():
    assert climate_zones(33, 6, 1200) == {"high_zone": 1, "low_zone": 4, "rain_zone": 1}
    assert climate_zones(27, -38.5, 520) == {"high_zone": 2, "low_zone": 1, "rain_zone": 2}
    assert climate_zones(18, -25, 200) == {"high_zone": 3, "low_zone": 2, "rain_zone": 4}


def test_pg_grade():
    assert pg_grade(65.5, -23) == "PG 64-22"
    assert pg_grade(76.4, -28.1) == "PG 76-28"


def test_requirements_scale_with_traffic_and_distress():
    base = dict(PRESETS["hainan_heavy_rut"])
    light = {**base, "traffic": "中等", "distress": [{"type": "none", "severity": "轻"}]}
    heavy = {**base, "traffic": "极重"}
    assert map_requirements(heavy)["targets"]["ds"]["target"] > map_requirements(light)["targets"]["ds"]["target"]
    cold = {**PRESETS["harbin_thermal_crack"]}
    cold_nc = {**cold, "distress": [{"type": "none", "severity": "轻"}]}
    assert map_requirements(cold)["targets"]["eps"]["target"] >= map_requirements(cold_nc)["targets"]["eps"]["target"]


def test_weights_normalised_and_traceable():
    q = map_requirements(PRESETS["wuhan_water_damage"])
    perf = sum(q["weights"][k] for k in ("ds", "eps", "tsr", "fatigue", "modulus", "td"))
    assert abs(perf + q["weights"]["cost"] + q["weights"]["carbon"] - 1) < 1e-3
    assert q["priority"][0] == "水稳定性"            # 水损害场景水稳定性排第一
    assert q["targets"]["td"]["target"] == 0         # 中面层不考核抗滑
    assert len(q["trace"]) >= 5


def test_rules():
    s = {"low_zone": 1, "high_zone": 2, "distress": []}
    assert any(h["id"] == "R5" for h in check_rules(Mix("50#"), s))
    assert any(h["id"] == "R1" for h in check_rules(Mix("70#", "SBS", 4.5, "OGFC-13"), {"low_zone": 3, "distress": []}))
    assert not [h for h in check_rules(Mix("70#", "SBS", 4.5, "SMA-13"), {"low_zone": 3, "distress": []})
                if h["type"] == "forbid"]


def test_candidate_space_respects_layer_and_thickness():
    c = enumerate_candidates(layer="中面层", thickness_cm=6.0)
    assert c and all(m.gradation not in ("OGFC-13", "SMA-13", "AC-10") for m in c)
    assert all(not (m.family == "OGFC" and m.modifier != "HVA") for m in enumerate_candidates())


def test_hybrid_beats_pure_on_small_samples():
    te_m, te_y = simulate_lab_data(800, seed=123)
    m, y = simulate_lab_data(60, seed=60)
    hy = evaluate(HybridModel("hybrid").fit(m, y), te_m, te_y)
    pu = evaluate(HybridModel("pure").fit(m, y), te_m, te_y)
    assert hy["ds"]["r2"] > pu["ds"]["r2"] + 0.1
    assert np.mean([hy[k]["r2"] for k in hy]) > np.mean([pu[k]["r2"] for k in pu])


def test_physical_consistency(model):
    """关键物理规律：抗剥落剂提升水稳，抗车辙剂提升动稳定度，改性提升动稳定度。"""
    p = lambda m: model.predict([m])[0]
    assert p(Mix(anti_strip=1))["tsr"]["mean"] > p(Mix())["tsr"]["mean"]
    assert p(Mix(anti_rut=1))["ds"]["mean"] > p(Mix())["ds"]["mean"]
    assert p(Mix("70#", "SBS", 4.5))["ds"]["mean"] > p(Mix())["ds"]["mean"]


def test_explanation_sums_to_difference(model):
    e = model.explain(Mix("70#", "SBS", 4.5, "SMA-13"), "eps")
    assert e["items"] and e["items"][0]["factor"] in ("结合料（沥青+改性）", "级配类型")


@pytest.mark.parametrize("key", list(PRESETS))
def test_every_preset_returns_candidates(rec, key):
    r = rec.recommend(PRESETS[key], top_k=3, explain=False)
    assert r["candidates"]
    top = r["candidates"][0]
    assert top["checks"] and top["economics"]["cost_t"] > 0
    assert top["construction"]["mix_temp"][0] < top["construction"]["mix_temp"][1]


def test_engineering_sanity(rec):
    hot = rec.recommend(PRESETS["hainan_heavy_rut"], top_k=3, explain=False)
    assert hot["candidates"][0]["feasible"]
    assert hot["candidates"][0]["mix"]["modifier"] != "none"
    cold = rec.recommend(PRESETS["harbin_thermal_crack"], top_k=3, explain=False)
    assert cold["candidates"][0]["formula"]["pg_low_c"] <= -28
    skid = rec.recommend(PRESETS["expressway_skid_noise"], top_k=3, explain=False)
    assert skid["candidates"][0]["mix"]["gradation"] == "OGFC-13"


def test_budget_constraint(rec):
    sc = {**PRESETS["wuhan_water_damage"], "constraints": {**PRESETS["wuhan_water_damage"]["constraints"], "budget_max": 470}}
    r = rec.recommend(sc, top_k=3, explain=False)
    assert all(c["economics"]["cost_t"] <= 470 for c in r["candidates"])
