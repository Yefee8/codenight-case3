import re
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from database import get_db, init_db
from ml.predictor import load_model, predict
from models import Prediction

SCRIPT_RE = re.compile(r"</?script\b[^>]*>", re.IGNORECASE)
logger = logging.getLogger("fraudcell.ai")
logging.basicConfig(level=logging.INFO)
MODEL_ARTIFACT: dict | None = None


def clean_text(value: str | None) -> str | None:
    return SCRIPT_RE.sub("", value).strip() if isinstance(value, str) else value


class ScoreRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore", allow_inf_nan=False)

    amount: float = Field(ge=0)
    transaction_type: str = Field(alias="type", min_length=1, max_length=32)
    location: str = Field(min_length=1, max_length=160)
    receiver: str | None = Field(default=None, max_length=160)
    device: str | None = Field(default=None, max_length=160)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    hour: int | None = Field(default=None, ge=0, le=23)
    is_new_device: bool = False
    is_new_recipient: bool = False

    @field_validator("transaction_type", "location", "receiver", "device", "country_code", mode="before")
    @classmethod
    def sanitize_text(cls, value: str | None) -> str | None:
        return clean_text(value)


class ScoreResponse(BaseModel):
    risk_score: float
    fraud_type: str
    decision: str
    recommended_decision: str
    reason: str
    model_version: str | None = None
    prediction_engine: str


@dataclass(slots=True)
class ScoringResult:
    risk_score: float
    fraud_type: str
    reason: str
    prediction_engine: str = "RULE_BASED_FALLBACK"
    model_version: str | None = None


DOMESTIC_MARKERS = (
    "TÜRKIYE",
    "TURKIYE",
    "TURKEY",
    ", TR",
    "İSTANBUL",
    "ISTANBUL",
    "ANKARA",
    "İZMİR",
    "IZMIR",
    "BURSA",
    "ANTALYA",
    "ADANA",
    "ESKİŞEHİR",
    "ESKISEHIR",
    "MANİSA",
    "MANISA",
)


def decision_for(score: float) -> str:
    if score < 0.40:
        return "ONAY"
    if score <= 0.90:
        return "INCELEME"
    return "BLOK"


def rule_based_score(item: ScoreRequest) -> ScoringResult:
    score = 0.05
    reasons: list[str] = []

    if item.amount >= 100_000:
        score += 0.50
        reasons.append("VERY_HIGH_AMOUNT")
    elif item.amount >= 25_000:
        score += 0.30
        reasons.append("HIGH_AMOUNT")
    elif item.amount >= 10_000:
        score += 0.20
        reasons.append("ELEVATED_AMOUNT")

    transaction_type = item.transaction_type.upper()
    if transaction_type == "TRANSFER":
        score += 0.15
        reasons.append("TRANSFER")
    elif transaction_type == "CEKIM":
        score += 0.10
        reasons.append("CASH_WITHDRAWAL")

    foreign = (
        item.country_code.upper() != "TR"
        if item.country_code
        else not any(marker in item.location.upper() for marker in DOMESTIC_MARKERS)
    )
    if foreign:
        score += 0.25
        reasons.append("FOREIGN_LOCATION")

    device = (item.device or "").upper()
    new_device = item.is_new_device or any(word in device for word in ("NEW", "YENİ", "YENI", "UNKNOWN"))
    if new_device:
        score += 0.15
        reasons.append("NEW_DEVICE")
    if item.is_new_recipient:
        score += 0.10
        reasons.append("NEW_RECIPIENT")
    if item.hour is not None and (item.hour < 6 or item.hour >= 23):
        score += 0.10
        reasons.append("UNUSUAL_HOUR")

    score = round(min(score, 0.99), 2)
    if score < 0.40:
        fraud_type = "TEMIZ"
    elif new_device:
        fraud_type = "HESAP_ELE_GECIRME"
    elif transaction_type == "TRANSFER" and (foreign or item.amount >= 50_000):
        fraud_type = "PARA_AKLAMA"
    elif transaction_type in {"ODEME", "CEKIM"}:
        fraud_type = "CALINTI_KART"
    else:
        fraud_type = "SUPHELI_DAVRANIS"

    return ScoringResult(score, fraud_type, ",".join(reasons) or "NORMAL_PATTERN")


def score_transaction(item: ScoreRequest, artifact: dict | None = None) -> ScoringResult:
    model = artifact if artifact is not None else MODEL_ARTIFACT
    if model:
        try:
            result = predict(model, item)
            logger.info(
                "prediction_engine=%s model_version=%s risk_score=%s fraud_type=%s",
                result["prediction_engine"],
                result["model_version"],
                result["risk_score"],
                result["fraud_type"],
            )
            return ScoringResult(
                risk_score=result["risk_score"],
                fraud_type=result["fraud_type"],
                reason=result["reason"],
                prediction_engine=result["prediction_engine"],
                model_version=result["model_version"],
            )
        except Exception:
            logger.exception("prediction_engine=RULE_BASED_FALLBACK model_version=None reason=ml_prediction_failed")
    result = rule_based_score(item)
    logger.warning("prediction_engine=%s model_version=None risk_score=%s fraud_type=%s", result.prediction_engine, result.risk_score, result.fraud_type)
    return result


@asynccontextmanager
async def lifespan(_: FastAPI):
    global MODEL_ARTIFACT
    init_db()
    MODEL_ARTIFACT = load_model()
    if MODEL_ARTIFACT:
        logger.info("prediction_engine=ML_MODEL model_version=%s loaded=true", MODEL_ARTIFACT.get("model_version"))
    else:
        logger.warning("prediction_engine=RULE_BASED_FALLBACK model_version=None loaded=false")
    yield


app = FastAPI(title="FraudCell AI Service", lifespan=lifespan)


def api_success(data, status_code: int = 200) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder({"success": True, "data": data, "error": None}),
    )


def api_error(status_code: int, detail) -> JSONResponse:
    message = detail.get("message") if isinstance(detail, dict) else str(detail)
    return JSONResponse(status_code=status_code, content={"success": False, "data": None, "error": message})


@app.exception_handler(HTTPException)
def http_error(_: Request, exc: HTTPException):
    return api_error(exc.status_code, exc.detail)


@app.exception_handler(RequestValidationError)
def validation_error(_: Request, exc: RequestValidationError):
    return api_error(422, exc.errors()[0]["msg"])


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "prediction_engine": "ML_MODEL" if MODEL_ARTIFACT else "RULE_BASED_FALLBACK",
        "model_version": str(MODEL_ARTIFACT.get("model_version")) if MODEL_ARTIFACT else "",
    }


@app.post("/internal/v1/score", response_model=ScoreResponse)
def score(item: ScoreRequest, db: Session = Depends(get_db)) -> ScoreResponse:
    result = score_transaction(item)
    decision = decision_for(result.risk_score)
    db.add(
        Prediction(
            amount=item.amount,
            transaction_type=item.transaction_type.upper(),
            location=item.location,
            risk_score=result.risk_score,
            fraud_type=result.fraud_type,
            decision=decision,
            reason=result.reason,
        )
    )
    db.commit()
    return ScoreResponse(
        risk_score=result.risk_score,
        fraud_type=result.fraud_type,
        decision=decision,
        recommended_decision=decision,
        reason=result.reason,
        model_version=result.model_version,
        prediction_engine=result.prediction_engine,
    )


@app.post("/api/v1/ai/score")
def public_score(item: ScoreRequest, db: Session = Depends(get_db)):
    return api_success(score(item, db))
