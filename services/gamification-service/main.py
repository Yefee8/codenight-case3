import os
from contextlib import asynccontextmanager
from threading import Event, Thread
from typing import Annotated, Literal

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db, init_db
from models import AnalystProfile
from rabbitmq import consume_forever

JWT_SECRET = os.getenv("JWT_SECRET", "fraudcell-demo-secret")
JWT_ALGORITHM = "HS256"
security = HTTPBearer(auto_error=False)
STAFF_ROLES = {"ANALYST", "SUPERVISOR", "ADMIN"}


class Analyst(BaseModel):
    user_id: str
    full_name: str
    role: str = "ANALYST"
    gsm: str = ""


class Profile(BaseModel):
    total_points: int
    level: str
    badges: list[str]
    daily_rank: int


class LeaderboardEntry(BaseModel):
    rank: int
    analyst: Analyst
    profile: Profile


def level_for(points: int) -> str:
    if points >= 4500:
        return "Platin"
    if points >= 3200:
        return "Altın"
    if points >= 2300:
        return "Gümüş"
    return "Bronz"


def badges_for(points: int) -> list[str]:
    if points >= 100:
        return ["İlk Karar", "Yüzlük Kulübü"]
    if points >= 10:
        return ["İlk Karar"]
    return []


def profile_for(profile: AnalystProfile | None, rank: int = 0) -> Profile:
    points = max(profile.total_points, 0) if profile else 0
    return Profile(total_points=points, level=level_for(points), badges=badges_for(points), daily_rank=rank)


def ranked_profiles(db: Session) -> list[AnalystProfile]:
    return list(
        db.scalars(
            select(AnalystProfile).order_by(
                AnalystProfile.total_points.desc(),
                AnalystProfile.updated_at.asc(),
                AnalystProfile.analyst_id.asc(),
            )
        ).all()
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    stop = Event()
    consumer = Thread(target=consume_forever, args=(stop,), daemon=True)
    consumer.start()
    yield
    stop.set()
    consumer.join(timeout=2)


app = FastAPI(title="FraudCell Gamification Service", lifespan=lifespan)


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
    }


def game_user(user: Annotated[dict, Depends(current_user)]) -> dict:
    if user["role"] not in STAFF_ROLES:
        raise HTTPException(403, "Bu işlem için personel yetkisi gerekli")
    return user


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/game/leaderboard", response_model=list[LeaderboardEntry])
def leaderboard(
    _: Annotated[dict, Depends(game_user)],
    period: Literal["daily", "weekly", "all"] = "daily",
    db: Session = Depends(get_db),
):
    del period
    return api_success([
        LeaderboardEntry(
            rank=rank,
            analyst=Analyst(
                user_id=item.analyst_id,
                full_name=item.full_name,
                gsm=item.gsm,
            ),
            profile=profile_for(item, rank),
        )
        for rank, item in enumerate(ranked_profiles(db), 1)
    ])


@app.get("/api/v1/game/profile/me", response_model=Profile)
def my_profile(
    user: Annotated[dict, Depends(game_user)],
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
    db: Session = Depends(get_db),
):
    user_id = x_user_id or user["user_id"]
    if user["role"] == "ANALYST" and user_id != user["user_id"]:
        raise HTTPException(403, "Başka bir analistin profilini görüntüleyemezsiniz")
    return api_success(profile_data(user_id, db))


@app.get("/api/v1/game/profile/{user_id}", response_model=Profile)
@app.get("/api/v1/game/profiles/{user_id}", response_model=Profile)
def analyst_profile(
    user_id: str,
    user: Annotated[dict, Depends(game_user)],
    db: Session = Depends(get_db),
):
    if user["role"] == "ANALYST" and user_id != user["user_id"]:
        raise HTTPException(403, "Başka bir analistin profilini görüntüleyemezsiniz")
    return api_success(profile_data(user_id, db))


def profile_data(user_id: str, db: Session) -> Profile:
    profiles = ranked_profiles(db)
    item = next((profile for profile in profiles if profile.analyst_id == user_id), None)
    rank = profiles.index(item) + 1 if item else 0
    return profile_for(item, rank)
