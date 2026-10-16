"""HTTP 服务：uvicorn smartmix.api:app --port 8000   → 浏览器打开 http://127.0.0.1:8000"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import feedback
from .knowledge import M, Mix, binder_props, build_graph, load_kb
from .model import MODEL_DIR, HybridModel
from .recommender import Recommender
from .requirements import (DISTRESS, HIGH_ZONE_NAME, LOW_ZONE_NAME, PRESETS, RAIN_ZONE_NAME, SPECIALS, STRUCTURES,
                           TRAFFIC_LEVELS, map_requirements)
from .schemas import (EvaluateRequest, FieldFeedback, LabFeedback, MaintenanceScenario, PredictRequest,
                      RecommendRequest)

WEB = Path(__file__).parent / "web"

app = FastAPI(title="数智选材 · 沥青材料方案智能推荐引擎", version="0.1.0",
              description="养护场景 → 性能需求 → 材料方案推荐 → 性能预测验证 → 反馈优化")
app.mount("/static", StaticFiles(directory=WEB / "static"), name="static")


def clean(o):
    """numpy → 原生类型，NaN → None，保证 JSON 可序列化。"""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (float, np.floating)):
        f = float(o)
        return None if math.isnan(f) or math.isinf(f) else f
    return o


class State:
    rec: Recommender | None = None


def get_rec() -> Recommender:
    if State.rec is None:
        path = MODEL_DIR / "hybrid.pkl"
        if path.exists():
            model = HybridModel.load(path)
        else:
            model = feedback.retrain()
        State.rec = Recommender(model, life_factor=feedback.life_calibration()["factor"])
    return State.rec


def _scenario(s: MaintenanceScenario) -> dict:
    d = s.model_dump(exclude_none=True)
    return d


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(WEB / "index.html")


@app.get("/api/v1/meta")
def meta():
    mats = M()
    return clean({
        "traffic": TRAFFIC_LEVELS, "layers": ["上面层", "中面层", "下面层"], "structures": STRUCTURES,
        "specials": SPECIALS, "distress": DISTRESS,
        "zones": {"high": HIGH_ZONE_NAME, "low": LOW_ZONE_NAME, "rain": RAIN_ZONE_NAME},
        "gradations": list(mats["gradations"].keys()),
        "modifiers": {k: {"name": v["name"], "doses": v["doses"], "bases": v["bases"]} for k, v in mats["modifiers"].items()},
        "bases": list(mats["base_binders"].keys()),
        "indicators": mats["performance_indicators"],
        "kb_version": mats["_meta"]["版本"],
    })


@app.get("/api/v1/presets")
def presets():
    return PRESETS


@app.post("/api/v1/requirements")
def requirements(s: MaintenanceScenario):
    return clean(map_requirements(_scenario(s)))


@app.post("/api/v1/recommend")
def recommend(req: RecommendRequest):
    rec = get_rec()
    base = [Mix(**b.model_dump()) for b in req.baselines]
    out = rec.recommend(_scenario(req.scenario), top_k=req.top_k, baselines=base, explain=req.explain)
    out["model"] = rec.model.meta
    out["life_calibration"] = feedback.life_calibration()
    return clean(out)


@app.post("/api/v1/evaluate")
def evaluate_mix(req: EvaluateRequest):
    """人工微调：评估任意方案在该场景下的表现。"""
    rec = get_rec()
    try:
        mix = Mix(**req.mix.model_dump())
        _ = binder_props(mix.base, mix.modifier, mix.dose)
        _ = M()["gradations"][mix.gradation]
    except KeyError as e:
        raise HTTPException(400, f"未知材料：{e}")
    return clean(rec.evaluate_mix(mix, _scenario(req.scenario)))


@app.post("/api/v1/predict")
def predict(req: PredictRequest):
    rec = get_rec()
    mixes = [Mix(**m.model_dump()) for m in req.mixes]
    return clean({"predictions": rec.model.predict(mixes), "labels": [m.label() for m in mixes]})


@app.get("/api/v1/kg")
def kg():
    g = build_graph()
    g["rules"] = load_kb()["kg"]["rules"]
    return g


@app.post("/api/v1/feedback/lab")
def lab_feedback(fb: LabFeedback):
    n = feedback.add_lab_records([r.model_dump() for r in fb.records])
    info = {"total_records": n}
    if fb.retrain:
        model = feedback.retrain()
        State.rec = Recommender(model, life_factor=feedback.life_calibration()["factor"])
        info["model"] = model.meta
    return clean(info)


@app.post("/api/v1/feedback/field")
def field_feedback(fb: FieldFeedback):
    cal = feedback.add_field_record(fb.model_dump())
    rec = get_rec()
    rec.life_factor = cal["factor"]
    return cal


@app.post("/api/v1/model/retrain")
def retrain():
    model = feedback.retrain()
    State.rec = Recommender(model, life_factor=feedback.life_calibration()["factor"])
    return clean(model.meta)


@app.get("/api/v1/model")
def model_info():
    rec = get_rec()
    return clean({"meta": rec.model.meta, "noise": rec.model.noise, "life_calibration": feedback.life_calibration()})
