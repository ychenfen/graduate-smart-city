import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("store")
    import smartmix.feedback as fb
    import smartmix.model as md
    mp = pytest.MonkeyPatch()
    mp.setattr(fb, "DATA_DIR", tmp)
    mp.setattr(fb, "LAB_CSV", tmp / "lab.csv")
    mp.setattr(fb, "FIELD_JSON", tmp / "field.json")
    mp.setattr(fb, "MODEL_DIR", tmp)
    mp.setattr(md, "MODEL_DIR", tmp)
    from smartmix import api
    api.State.rec = None
    mp.setattr(api, "MODEL_DIR", tmp)
    yield TestClient(api.app)
    api.State.rec = None
    mp.undo()


SC = {"climate": {"hot_month_max": 33.5, "extreme_min": 6, "annual_rain": 1150}, "traffic": "特重",
      "layer": "上面层", "distress": [{"type": "rutting", "severity": "重"}]}


def test_meta_and_index(client):
    assert client.get("/").status_code == 200
    m = client.get("/api/v1/meta").json()
    assert "SMA-13" in m["gradations"]
    assert client.get("/static/echarts.min.js").status_code == 200


def test_recommend_and_evaluate(client):
    r = client.post("/api/v1/recommend", json={"scenario": SC, "top_k": 3,
                                                "baselines": [{"modifier": "SBS", "dose": 4.5, "gradation": "SMA-13"}]})
    assert r.status_code == 200
    d = r.json()
    assert len(d["candidates"]) == 3 and len(d["baselines"]) == 1
    assert d["candidates"][0]["explanations"]
    e = client.post("/api/v1/evaluate", json={"scenario": SC, "mix": d["candidates"][0]["mix"]})
    assert e.status_code == 200 and e.json()["label"] == d["candidates"][0]["label"]
    bad = client.post("/api/v1/evaluate", json={"scenario": SC, "mix": {"gradation": "XX-99"}})
    assert bad.status_code == 400


def test_feedback_loop(client):
    v0 = client.get("/api/v1/model").json()["meta"]["version"]
    rec = {"mix": {"modifier": "SBS", "dose": 4.5, "gradation": "SMA-13", "anti_strip": 1},
           "measured": {"ds": 5200, "eps": 2850, "tsr": 88.5, "fatigue": None, "modulus": None, "td": 0.98}}
    r = client.post("/api/v1/feedback/lab", json={"records": [rec], "retrain": True}).json()
    assert r["total_records"] == 161 and r["model"]["version"] == v0 + 1
    f = client.post("/api/v1/feedback/field", json={"case_id": "T1", "predicted_life": 8, "observed_life": 6}).json()
    assert f["n"] == 1 and f["factor"] < 1
