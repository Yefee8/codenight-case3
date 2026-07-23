from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AnalystProfile(Base):
    __tablename__ = "analyst_profiles"

    analyst_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    full_name: Mapped[str] = mapped_column(String(120))
    gsm: Mapped[str] = mapped_column(String(32), default="")
    total_points: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PointLedger(Base):
    __tablename__ = "point_ledger"

    event_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    analyst_id: Mapped[str] = mapped_column(ForeignKey("analyst_profiles.analyst_id"), index=True)
    delta: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
