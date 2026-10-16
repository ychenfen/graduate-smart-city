"""养护决策系统 ⇄ 材料推荐引擎 标准数据格式（接口规范）。

养护决策系统只需输出 `MaintenanceScenario`（场景参数），推荐引擎返回 `RecommendResponse`（方案参数）。
两侧通过 HTTP/JSON 松耦合集成，可独立开发、独立迭代；完整 OpenAPI 文档见服务的 /docs。
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class Climate(BaseModel):
    hot_month_max: float = Field(..., description="最热月平均最高气温 ℃（高温分区）", examples=[33.5])
    extreme_min: float = Field(..., description="年极端最低气温 ℃（低温分区）", examples=[6.0])
    annual_rain: float = Field(..., description="年降雨量 mm（雨量分区）", examples=[1150])


class Distress(BaseModel):
    type: Literal["rutting", "thermal_crack", "fatigue_crack", "reflective_crack", "water_damage", "skid", "none"] = Field(
        ..., description="病害类型：车辙/低温横向裂缝/疲劳龟裂/反射裂缝/水损害/抗滑不足/无（预防性养护）")
    severity: Literal["轻", "中", "重"] = "中"


class Constraints(BaseModel):
    cost_priority: Literal["低", "中", "高"] = Field("中", description="成本敏感度（高=预算紧张）")
    carbon_priority: Literal["低", "中", "高"] = Field("中", description="环保/低碳优先级")
    allow_rap: bool = Field(True, description="是否允许掺加 RAP 回收料")
    budget_max: Optional[float] = Field(None, description="混合料单价上限 元/t")


class MaintenanceScenario(BaseModel):
    """养护决策系统输出的场景参数。气候可给原始气象参数（climate），也可直接给分区编号。"""
    name: Optional[str] = None
    climate: Optional[Climate] = None
    high_zone: Optional[int] = Field(None, ge=1, le=3, description="JTG F40 高温分区 1夏炎热/2夏热/3夏凉")
    low_zone: Optional[int] = Field(None, ge=1, le=4, description="低温分区 1冬严寒/2冬寒/3冬冷/4冬温")
    rain_zone: Optional[int] = Field(None, ge=1, le=4, description="雨量分区 1潮湿/2湿润/3半干/4干旱")
    traffic: Literal["轻", "中等", "重", "特重", "极重"] = Field("中等", description="设计交通荷载等级")
    layer: Literal["上面层", "中面层", "下面层"] = "上面层"
    thickness_cm: Optional[float] = Field(None, description="铺筑厚度 cm（约束可用级配）")
    structure: Literal["semi_rigid", "flexible", "bridge_deck"] = Field("semi_rigid", description="半刚性基层/柔性基层/桥面铺装")
    special: Literal["none", "long_grade", "intersection"] = Field("none", description="一般路段/长大纵坡/交叉口")
    distress: list[Distress] = Field(default_factory=lambda: [Distress(type="none", severity="轻")])
    method: Optional[str] = Field(None, description="养护决策系统给出的工法，如“铣刨重铺上面层”（记录用）")
    constraints: Constraints = Field(default_factory=Constraints)


class MixSpec(BaseModel):
    """材料方案参数（推荐引擎输出 / 人工微调输入）。"""
    base: Literal["50#", "70#", "90#", "110#"] = "70#"
    modifier: Literal["none", "SBS", "CR", "HVA"] = "none"
    dose: float = Field(0.0, description="改性剂掺量 %（占沥青质量）")
    gradation: str = Field("AC-13", description="级配：AC-10/13/16/20/25、SMA-10/13、OGFC-13、SUP-12.5")
    oil_offset: float = Field(0.0, ge=-0.6, le=0.6, description="相对典型最佳油石比的偏移 %")
    anti_strip: int = Field(0, ge=0, le=1)
    anti_rut: int = Field(0, ge=0, le=1)
    warm_mix: int = Field(0, ge=0, le=1)
    rap: int = Field(0, ge=0, le=40, description="RAP 掺量 %")
    compaction: float = Field(98.0, ge=94, le=100, description="压实度 %")
    aging: int = Field(0, ge=0, le=1)


class RecommendRequest(BaseModel):
    scenario: MaintenanceScenario
    top_k: int = Field(5, ge=1, le=10)
    baselines: list[MixSpec] = Field(default_factory=list, description="可选：需要同台对比的经验方案")
    explain: bool = True


class EvaluateRequest(BaseModel):
    scenario: MaintenanceScenario
    mix: MixSpec


class PredictRequest(BaseModel):
    mixes: list[MixSpec]


class LabRecord(BaseModel):
    mix: MixSpec
    measured: dict[str, Optional[float]] = Field(..., description="实测指标：ds/eps/tsr/fatigue/modulus/td，可部分缺测")
    note: str = ""


class LabFeedback(BaseModel):
    records: list[LabRecord]
    retrain: bool = True


class FieldFeedback(BaseModel):
    case_id: str
    predicted_life: float
    observed_life: float
    mix: Optional[MixSpec] = None
    scenario_tags: list[str] = Field(default_factory=list)
