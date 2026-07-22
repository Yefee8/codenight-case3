from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

FiniteAmount = Annotated[float, Field(gt=0, le=1_000_000_000, allow_inf_nan=False)]
FiniteScore = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]


class TransactionFeatures(BaseModel):
    model_config = ConfigDict(extra="forbid")

    customer_id: UUID
    city: str = Field(min_length=1, max_length=80)
    region: str = Field(min_length=1, max_length=40)
    country_code: str = Field(pattern=r"^[A-Z]{2}$")
    transaction_type: str = Field(min_length=1, max_length=50)
    amount: FiniteAmount
    hour: int = Field(ge=0, le=23)
    new_device: bool
    new_recipient: bool
    frequency_1h: int = Field(ge=0, le=1_000)
    frequency_24h: int = Field(ge=0, le=10_000)
    deviation_score: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]

    @field_validator("city", "region", "transaction_type")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("value cannot be blank")
        return normalized


class AnalystCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analyst_id: UUID
    specialties: list[str] = Field(default_factory=list, max_length=20)
    regions: list[str] = Field(default_factory=list, max_length=7)
    active_case_count: int = Field(ge=0, le=10_000)
    performance: FiniteScore | None = None
    status: Literal["ACTIVE", "INACTIVE", "SUSPENDED"]
    locked: bool = False
    last_assigned_at: datetime | None = None


class ScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    transaction_id: UUID
    case_id: UUID
    features: TransactionFeatures
    candidates: list[AnalystCandidate] = Field(default_factory=list, max_length=1_000)


class RankedCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    analyst_id: UUID
    score: FiniteScore
    expertise_match: FiniteScore
    availability: FiniteScore
    performance: FiniteScore
    region_match: bool


class ScoreResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prediction_id: UUID
    model_version: str
    feature_schema_version: str
    risk_score: FiniteScore
    risk_level: Literal["DUSUK", "ORTA", "YUKSEK", "KRITIK"]
    decision: Literal["ONAY", "INCELEME", "BLOK"]
    fraud_type: str
    reason_codes: list[str]
    ranked_candidates: list[RankedCandidate]


class ModelInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_version: str
    feature_schema_version: str
    artifact_sha256: str
    dataset_sha256: str
    trained_at: datetime
    ready: bool


class MetricValue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    value: float
    sample_count: int = Field(ge=0)


class CategoryMetric(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: str
    recall: FiniteScore
    precision: FiniteScore
    sample_count: int = Field(ge=0)
