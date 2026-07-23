from datetime import datetime, timezone
from enum import Enum
from uuid import uuid4

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy import Enum as SqlEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TransactionType(str, Enum):
    ODEME = "ODEME"
    TRANSFER = "TRANSFER"
    FATURA = "FATURA"
    CEKIM = "CEKIM"


class CaseStatus(str, Enum):
    YENI = "YENI"
    ATANDI = "ATANDI"
    INCELENIYOR = "INCELENIYOR"
    MUSTERI_DOGRULAMA = "MUSTERI_DOGRULAMA"
    ONAYLANDI = "ONAYLANDI"
    BLOKLANDI = "BLOKLANDI"
    KAPANDI = "KAPANDI"


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid4()))
    customer_id: Mapped[str] = mapped_column(String, default="demo-customer", index=True)
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(3), default="TRY")
    type: Mapped[TransactionType] = mapped_column(SqlEnum(TransactionType))
    receiver: Mapped[str] = mapped_column(String)
    device: Mapped[str] = mapped_column(String)
    location: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    prediction_status: Mapped[str] = mapped_column(String, default="UNAVAILABLE")
    risk_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    fraud_type: Mapped[str | None] = mapped_column(String, nullable=True)
    recommended_decision: Mapped[str] = mapped_column(String, default="INCELEME")
    prediction_reason: Mapped[str] = mapped_column(String, default="AI_UNAVAILABLE")
    case: Mapped["RiskCase"] = relationship(back_populates="transaction", uselist=False)


class RiskCase(Base):
    __tablename__ = "risk_cases"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    transaction_id: Mapped[str] = mapped_column(ForeignKey("transactions.id"), unique=True)
    status: Mapped[CaseStatus] = mapped_column(SqlEnum(CaseStatus), default=CaseStatus.YENI)
    risk_level: Mapped[str] = mapped_column(String)
    hold_status: Mapped[str | None] = mapped_column(String, nullable=True)
    assigned_analyst_id: Mapped[str | None] = mapped_column(String, nullable=True)
    customer_verification: Mapped[str | None] = mapped_column(String, nullable=True)
    decision_note: Mapped[str | None] = mapped_column(String, nullable=True)
    sla_deadline: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    version: Mapped[int] = mapped_column(Integer, default=1)
    transaction: Mapped[Transaction] = relationship(back_populates="case")
