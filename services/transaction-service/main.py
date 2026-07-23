import os
import re
from datetime import timedelta, timezone
from typing import Annotated, Literal
from uuid import uuid4

import httpx
import jwt
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from database import Base, engine, get_db
from models import CaseStatus, RiskCase, Transaction, TransactionType, utcnow
from rabbitmq import publish_decision


app = FastAPI(title="FraudCell Transaction Service", version="1.0.0")
AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai-service:8000")
JWT_SECRET = os.getenv("JWT_SECRET", "fraudcell-demo-secret")
JWT_ALGORITHM = "HS256"
security = HTTPBearer(auto_error=False)
STAFF_ROLES = {"ANALYST", "SUPERVISOR", "ADMIN"}
SCRIPT_RE = re.compile(r"</?script\b[^>]*>", re.IGNORECASE)

ALLOWED_TRANSITIONS = {
    CaseStatus.YENI: {CaseStatus.ATANDI},
    CaseStatus.ATANDI: {CaseStatus.INCELENIYOR},
    CaseStatus.INCELENIYOR: {
        CaseStatus.MUSTERI_DOGRULAMA,
        CaseStatus.ONAYLANDI,
        CaseStatus.BLOKLANDI,
    },
    CaseStatus.MUSTERI_DOGRULAMA: {CaseStatus.INCELENIYOR},
    CaseStatus.ONAYLANDI: {CaseStatus.KAPANDI},
    CaseStatus.BLOKLANDI: set(),
    CaseStatus.KAPANDI: set(),
}


def clean_text(value: str | None) -> str | None:
    return SCRIPT_RE.sub("", value).strip() if isinstance(value, str) else value


class TransactionCreate(BaseModel):
    amount: float = Field(gt=0)
    type: TransactionType
    location: str = Field(min_length=2)
    receiver: str = Field(min_length=2)
    device: str = Field(min_length=2)
    currency: str = Field(default="TRY", min_length=3, max_length=3)
    customer_id: str = "demo-customer"
    hour: int | None = Field(default=None, ge=0, le=23)

    @field_validator("location", "receiver", "device", "currency", "customer_id", mode="before")
    @classmethod
    def sanitize_text(cls, value: str) -> str:
        return clean_text(value) or ""


class Assignment(BaseModel):
    analyst_id: str = Field(min_length=1)

    @field_validator("analyst_id", mode="before")
    @classmethod
    def sanitize_text(cls, value: str) -> str:
        return clean_text(value) or ""


class Decision(BaseModel):
    decision: Literal[CaseStatus.ONAYLANDI, CaseStatus.BLOKLANDI]
    note: str | None = None
    analyst_id: str | None = None
    analyst_name: str | None = None

    @field_validator("note", "analyst_id", "analyst_name", mode="before")
    @classmethod
    def sanitize_text(cls, value: str | None) -> str | None:
        return clean_text(value)


class Verification(BaseModel):
    answer: str = Field(min_length=1)

    @field_validator("answer", mode="before")
    @classmethod
    def sanitize_text(cls, value: str) -> str:
        return clean_text(value) or ""


def response(data, status_code=200):
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder({"success": True, "data": data, "error": None}),
    )


def error(status_code: int, message: str):
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "data": None,
            "error": message,
        },
    )


@app.exception_handler(HTTPException)
def http_error(_: Request, exc: HTTPException):
    return error(exc.status_code, str(exc.detail))


@app.exception_handler(RequestValidationError)
def validation_error(_: Request, exc: RequestValidationError):
    return error(422, exc.errors()[0]["msg"])


def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
) -> dict:
    if not credentials:
        raise HTTPException(401, "Bearer token gerekli")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except InvalidTokenError as exc:
        raise HTTPException(401, "Geçersiz veya süresi dolmuş token") from exc
    if payload.get("type") != "access" or not payload.get("sub") or not payload.get("role"):
        raise HTTPException(401, "Geçersiz token türü")
    return {
        "user_id": str(payload["sub"]),
        "role": str(payload["role"]),
        "full_name": str(payload.get("full_name") or payload["sub"]),
    }


def staff_user(user: Annotated[dict, Depends(current_user)]) -> dict:
    if user["role"] not in STAFF_ROLES:
        raise HTTPException(403, "Bu işlem için personel yetkisi gerekli")
    return user


def supervisor_user(user: Annotated[dict, Depends(current_user)]) -> dict:
    if user["role"] not in {"SUPERVISOR", "ADMIN"}:
        raise HTTPException(403, "Bu işlem için SUPERVISOR veya ADMIN rolü gerekli")
    return user


def analyst_user(user: Annotated[dict, Depends(current_user)]) -> dict:
    if user["role"] != "ANALYST":
        raise HTTPException(403, "Bu işlem için ANALYST rolü gerekli")
    return user


def ensure_case_access(case: RiskCase, user: dict) -> None:
    if user["role"] == "CUSTOMER" and case.transaction.customer_id != user["user_id"]:
        raise HTTPException(403, "Bu kayıt başka bir kullanıcıya ait")
    if user["role"] == "ANALYST" and case.assigned_analyst_id != user["user_id"]:
        raise HTTPException(403, "Bu vaka başka bir analiste atanmış")


def ensure_assigned_analyst(case: RiskCase, user: dict) -> None:
    if user["role"] == "ANALYST" and case.assigned_analyst_id != user["user_id"]:
        raise HTTPException(403, "Bu vaka size atanmadı")


@app.on_event("startup")
def create_tables():
    Base.metadata.create_all(engine)


def score_transaction(body: TransactionCreate) -> dict:
    try:
        ai_response = httpx.post(
            f"{AI_SERVICE_URL}/internal/v1/score",
            json=body.model_dump(mode="json"),
            timeout=1.5,
        )
        ai_response.raise_for_status()
        result = ai_response.json()
        if "data" in result:
            result = result["data"]
        score = float(result["risk_score"])
        decision = result.get("recommended_decision", result.get("decision"))
        if not 0 <= score <= 1 or decision not in {"ONAY", "INCELEME", "BLOK"}:
            raise ValueError("invalid AI response")
        return {
            "prediction_status": "AVAILABLE",
            "risk_score": score,
            "fraud_type": str(result["fraud_type"]),
            "recommended_decision": decision,
            "prediction_reason": str(result.get("reason", "RULE_BASED")),
        }
    except (httpx.HTTPError, KeyError, TypeError, ValueError):
        return {
            "prediction_status": "UNAVAILABLE",
            "risk_score": None,
            "fraud_type": None,
            "recommended_decision": "INCELEME",
            "prediction_reason": "AI_UNAVAILABLE",
        }


def risk_level(score: float | None) -> str:
    if score is None:
        return "YUKSEK"
    if score > 0.90:
        return "KRITIK"
    if score >= 0.70:
        return "YUKSEK"
    if score >= 0.40:
        return "ORTA"
    return "DUSUK"


def transition(case: RiskCase, target: CaseStatus, note: str | None = None) -> None:
    if target not in ALLOWED_TRANSITIONS[case.status]:
        raise HTTPException(422, f"{case.status.value} -> {target.value} geçişine izin verilmiyor")
    if target is CaseStatus.BLOKLANDI and not (note and note.strip()):
        raise HTTPException(422, "BLOKLANDI kararı için not zorunludur")
    case.status = target
    case.version += 1
    if target in {CaseStatus.ONAYLANDI, CaseStatus.BLOKLANDI}:
        case.decision_note = note.strip() if note else None
        case.decided_at = utcnow()


def sla_breached(case: RiskCase) -> bool:
    decided = case.decided_at
    deadline = case.sla_deadline
    if not decided:
        return False
    if not decided.tzinfo:
        decided = decided.replace(tzinfo=timezone.utc)
    if not deadline.tzinfo:
        deadline = deadline.replace(tzinfo=timezone.utc)
    return decided > deadline


def case_view(case: RiskCase) -> dict:
    transaction = case.transaction
    return {
        "case_id": case.id,
        "transaction_details": {
            "amount": transaction.amount,
            "currency": transaction.currency,
            "type": transaction.type.value,
            "receiver": transaction.receiver,
            "device": transaction.device,
            "location": transaction.location,
            "timestamp": transaction.created_at,
        },
        "ai_analysis": {
            "risk_score": transaction.risk_score,
            "fraud_type": transaction.fraud_type or "BELIRSIZ",
            "recommended_decision": transaction.recommended_decision,
            "prediction_status": transaction.prediction_status,
            "reason": transaction.prediction_reason,
        },
        "status": case.status.value,
        "risk_level": case.risk_level,
        "assigned_analyst_id": case.assigned_analyst_id,
        "sla_deadline": case.sla_deadline,
        "hold_status": case.hold_status,
        "customer_verification": case.customer_verification,
        "version": case.version,
        "created_at": case.created_at,
        "decided_at": case.decided_at,
    }


def transaction_view(transaction: Transaction) -> dict:
    return {
        "transaction_id": transaction.id,
        "customer_id": transaction.customer_id,
        "case": case_view(transaction.case),
    }


def get_case_or_404(db: Session, case_id: str) -> RiskCase:
    case = db.scalar(
        select(RiskCase)
        .options(joinedload(RiskCase.transaction))
        .where(RiskCase.id == case_id)
    )
    if not case:
        raise HTTPException(404, "Vaka bulunamadı")
    return case


def create_transaction_record(body: TransactionCreate, db: Session) -> Transaction:
    assessment = score_transaction(body)
    level = risk_level(assessment["risk_score"])
    now = utcnow()
    transaction = Transaction(
        **body.model_dump(exclude={"hour"}),
        **assessment,
        created_at=now,
    )
    case = RiskCase(
        id=f"TRX-{now.year}-{uuid4().hex[:8].upper()}",
        transaction=transaction,
        risk_level=level,
        hold_status=(
            "TEMPORARY_BLOCKED"
            if assessment["recommended_decision"] == "BLOK" or level == "KRITIK"
            else None
        ),
        sla_deadline=now
        + timedelta(minutes={"KRITIK": 15, "YUKSEK": 60, "ORTA": 240, "DUSUK": 1440}[level]),
    )
    db.add(case)
    db.commit()
    db.refresh(transaction)
    return transaction


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/v1/transactions")
def create_transaction(
    body: TransactionCreate,
    user: Annotated[dict, Depends(current_user)],
    db: Session = Depends(get_db),
):
    if user["role"] == "CUSTOMER":
        body = body.model_copy(update={"customer_id": user["user_id"]})
    return response(transaction_view(create_transaction_record(body, db)), 201)


@app.post("/api/v1/transactions/simulate")
def simulate_transaction(
    body: TransactionCreate,
    user: Annotated[dict, Depends(current_user)],
    db: Session = Depends(get_db),
):
    if user["role"] == "CUSTOMER":
        body = body.model_copy(update={"customer_id": user["user_id"]})
    transaction = create_transaction_record(body, db)
    return response(
        {
            "case": case_view(transaction.case),
            "requires_verification": transaction.recommended_decision != "ONAY",
        },
        201,
    )


@app.get("/api/v1/transactions")
def list_transactions(
    user: Annotated[dict, Depends(current_user)],
    db: Session = Depends(get_db),
):
    query = select(Transaction).options(joinedload(Transaction.case)).order_by(Transaction.created_at.desc())
    if user["role"] == "CUSTOMER":
        query = query.where(Transaction.customer_id == user["user_id"])
    transactions = db.scalars(query).all()
    return response([transaction_view(item) for item in transactions])


@app.get("/api/v1/transactions/{transaction_id}")
def get_transaction(
    transaction_id: str,
    user: Annotated[dict, Depends(current_user)],
    db: Session = Depends(get_db),
):
    transaction = db.scalar(
        select(Transaction)
        .options(joinedload(Transaction.case))
        .where(Transaction.id == transaction_id)
    )
    if not transaction:
        raise HTTPException(404, "İşlem bulunamadı")
    if user["role"] == "CUSTOMER" and transaction.customer_id != user["user_id"]:
        raise HTTPException(403, "Bu kayıt başka bir kullanıcıya ait")
    return response(transaction_view(transaction))


@app.get("/api/v1/cases")
def list_cases(
    user: Annotated[dict, Depends(current_user)],
    db: Session = Depends(get_db),
):
    query = select(RiskCase).options(joinedload(RiskCase.transaction)).order_by(RiskCase.created_at.desc())
    if user["role"] == "CUSTOMER":
        query = query.join(RiskCase.transaction).where(Transaction.customer_id == user["user_id"])
    elif user["role"] == "ANALYST":
        query = query.where(RiskCase.assigned_analyst_id == user["user_id"])
    cases = db.scalars(query).all()
    return response([case_view(item) for item in cases])


@app.get("/api/v1/cases/{case_id}")
def get_case(
    case_id: str,
    user: Annotated[dict, Depends(current_user)],
    db: Session = Depends(get_db),
):
    case = get_case_or_404(db, case_id)
    ensure_case_access(case, user)
    return response(case_view(case))


@app.post("/api/v1/cases/{case_id}/assignments")
@app.patch("/api/v1/cases/{case_id}/assignment")
def assign_case(
    case_id: str,
    body: Assignment,
    _: Annotated[dict, Depends(supervisor_user)],
    db: Session = Depends(get_db),
):
    case = get_case_or_404(db, case_id)
    transition(case, CaseStatus.ATANDI)
    case.assigned_analyst_id = body.analyst_id
    db.commit()
    return response(case_view(case))


@app.post("/api/v1/cases/{case_id}/actions/start-review")
def start_review(
    case_id: str,
    user: Annotated[dict, Depends(analyst_user)],
    db: Session = Depends(get_db),
):
    case = get_case_or_404(db, case_id)
    ensure_assigned_analyst(case, user)
    transition(case, CaseStatus.INCELENIYOR)
    db.commit()
    return response(case_view(case))


@app.post("/api/v1/cases/{case_id}/actions/request-customer-verification")
def request_customer_verification(
    case_id: str,
    user: Annotated[dict, Depends(staff_user)],
    db: Session = Depends(get_db),
):
    case = get_case_or_404(db, case_id)
    ensure_assigned_analyst(case, user)
    transition(case, CaseStatus.MUSTERI_DOGRULAMA)
    db.commit()
    return response(case_view(case))


@app.post("/api/v1/cases/{case_id}/customer-verification")
def customer_verification(
    case_id: str,
    body: Verification,
    user: Annotated[dict, Depends(current_user)],
    db: Session = Depends(get_db),
):
    case = get_case_or_404(db, case_id)
    if user["role"] != "CUSTOMER":
        raise HTTPException(403, "Bu işlem müşteri doğrulaması içindir")
    ensure_case_access(case, user)
    transition(case, CaseStatus.INCELENIYOR)
    case.customer_verification = body.answer.strip()
    if body.answer.strip().upper() == "BEN_YAPMADIM":
        case.hold_status = "TEMPORARY_BLOCKED"
        case.risk_level = "KRITIK"
    db.commit()
    return response(case_view(case))


@app.post("/api/v1/cases/{case_id}/decision")
@app.patch("/api/v1/cases/{case_id}/decision")
def decide_case(
    case_id: str,
    body: Decision,
    user: Annotated[dict, Depends(staff_user)],
    db: Session = Depends(get_db),
):
    case = get_case_or_404(db, case_id)
    ensure_assigned_analyst(case, user)
    transition(case, CaseStatus(body.decision), body.note)
    analyst_id = user["user_id"] if user["role"] == "ANALYST" else body.analyst_id or case.assigned_analyst_id or user["user_id"]
    analyst_name = user["full_name"] if user["role"] == "ANALYST" else body.analyst_name or user["full_name"]
    db.commit()
    event_type = "transaction.blocked" if case.status == CaseStatus.BLOKLANDI else "transaction.decided"
    event = {
        "event_id": str(uuid4()),
        "event_type": event_type,
        "event_version": 1,
        "producer": "transaction-service",
        "occurred_at": utcnow().isoformat(),
        "aggregate_id": case.id,
        "aggregate_version": case.version,
        "analyst_id": analyst_id,
        "decision": case.status.value,
        "case_id": case.id,
        "fraud_type": case.transaction.fraud_type or "BELIRSIZ",
        "risk_level": case.risk_level,
        "sla_breached": sla_breached(case),
        "payload": {
            "case_id": case.id,
            "transaction_id": case.transaction_id,
            "analyst_id": analyst_id,
            "analyst_name": analyst_name,
            "decision": case.status.value,
            "fraud_type": case.transaction.fraud_type or "BELIRSIZ",
            "risk_level": case.risk_level,
            "sla_breached": sla_breached(case),
        },
    }
    published = publish_decision(event)
    data = case_view(case)
    data["event_published"] = published
    return response(data)


@app.post("/api/v1/cases/{case_id}/actions/close")
def close_case(
    case_id: str,
    _: Annotated[dict, Depends(staff_user)],
    db: Session = Depends(get_db),
):
    case = get_case_or_404(db, case_id)
    transition(case, CaseStatus.KAPANDI)
    db.commit()
    return response(case_view(case))
