import math
import os
import re
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import uuid4

import bcrypt
import jwt
from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from database import Base, SessionLocal, engine, get_db
from models import AuditLog, RefreshToken, Role, User, utcnow


JWT_SECRET = os.getenv("JWT_SECRET", "fraudcell-demo-secret-change-me")
JWT_ALGORITHM = "HS256"
ACCESS_TTL = timedelta(minutes=15)
REFRESH_TTL = timedelta(days=7)
LOCK_TTL = timedelta(minutes=15)
MAX_FAILED_ATTEMPTS = 5
security = HTTPBearer(auto_error=False)
limiter = Limiter(key_func=get_remote_address)
SCRIPT_RE = re.compile(r"</?script\b[^>]*>", re.IGNORECASE)


def clean_text(value: str | None) -> str | None:
    return SCRIPT_RE.sub("", value).strip() if isinstance(value, str) else value


class RegisterRequest(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=80)
    gsm: str = Field(min_length=10, max_length=24)
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username", "gsm", "full_name", mode="before")
    @classmethod
    def sanitize_text(cls, value: str | None) -> str | None:
        return clean_text(value)


class LoginRequest(BaseModel):
    identifier: str | None = Field(default=None, max_length=80)
    username: str | None = Field(default=None, max_length=80)
    gsm: str | None = Field(default=None, max_length=24)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("identifier", "username", "gsm", mode="before")
    @classmethod
    def sanitize_text(cls, value: str | None) -> str | None:
        return clean_text(value)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=20)


class LogoutRequest(RefreshRequest):
    pass


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    username: str
    gsm: str
    full_name: str
    role: Role

    @classmethod
    def from_user(cls, user: User):
        return cls(
            user_id=user.id,
            username=user.username,
            gsm=user.gsm,
            full_name=user.full_name,
            role=user.role,
        )


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = int(ACCESS_TTL.total_seconds())
    user: UserOut
    redirect_to: str


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: str | None
    identifier: str
    action: str
    success: bool
    detail: str | None
    created_at: datetime


def api_success(data, status_code: int = 200) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder({"success": True, "data": data, "error": None}),
    )


def api_error(status_code: int, detail) -> JSONResponse:
    message = detail.get("message") if isinstance(detail, dict) else str(detail)
    return JSONResponse(
        status_code=status_code,
        content={"success": False, "data": None, "error": message},
    )


def normalize_gsm(value: str) -> str:
    digits = "".join(character for character in value if character.isdigit())
    if digits.startswith("0090"):
        digits = "0" + digits[4:]
    elif digits.startswith("90"):
        digits = "0" + digits[2:]
    if len(digits) != 11 or not digits.startswith("0"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Geçerli bir GSM numarası girin")
    return digits


def hash_password(password: str) -> str:
    encoded = password.encode()
    if len(encoded) > 72:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Parola en fazla 72 byte olabilir")
    return bcrypt.hashpw(encoded, bcrypt.gensalt()).decode()


def password_matches(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except (ValueError, TypeError):
        return False


def masked(identifier: str) -> str:
    digits = "".join(character for character in identifier if character.isdigit())
    return f"***{digits[-4:]}" if len(digits) >= 4 else identifier[:1] + "***"


def audit(
    db: Session,
    action: str,
    success: bool,
    identifier: str,
    user: User | None = None,
    detail: str | None = None,
) -> None:
    db.add(
        AuditLog(
            user_id=user.id if user else None,
            identifier=user.username if user else masked(identifier),
            action=action,
            success=success,
            detail=detail,
        )
    )


def redirect_for(role: Role) -> str:
    if role == Role.CUSTOMER:
        return "/customer"
    if role in {Role.SUPERVISOR, Role.ADMIN}:
        return "/supervisor"
    return "/analyst"


def issue_tokens(user: User, db: Session) -> TokenResponse:
    now = datetime.now(UTC)
    access_jti, refresh_jti = str(uuid4()), str(uuid4())
    common = {
        "sub": user.id,
        "user_id": user.id,
        "role": user.role.value,
        "full_name": user.full_name,
        "iat": now,
    }
    access_token = jwt.encode(
        {**common, "jti": access_jti, "type": "access", "exp": now + ACCESS_TTL},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
    refresh_token = jwt.encode(
        {**common, "jti": refresh_jti, "type": "refresh", "exp": now + REFRESH_TTL},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
    db.add(RefreshToken(jti=refresh_jti, user_id=user.id, expires_at=utcnow() + REFRESH_TTL))
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserOut.from_user(user),
        redirect_to=redirect_for(user.role),
    )


def decode_token(token: str, expected_type: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except InvalidTokenError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Geçersiz veya süresi dolmuş token") from exc
    if payload.get("type") != expected_type or not payload.get("sub") or not payload.get("jti"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Geçersiz token türü")
    return payload


def seed_demo_users(db: Session) -> None:
    accounts = (
        ("usr_customer_1", "customer", "05320000001", "Deniz Yılmaz", Role.CUSTOMER),
        ("usr_analyst_1", "analyst", "05321112026", "Selin Kaya", Role.ANALYST),
        ("usr_supervisor_1", "supervisor", "05320000003", "Ozan Acar", Role.SUPERVISOR),
        ("usr_admin_1", "admin", "05320000004", "FraudCell Admin", Role.ADMIN),
    )
    password_hash = hash_password("Demo123!")
    for user_id, username, gsm, full_name, role in accounts:
        exists = db.scalar(select(User.id).where(or_(User.id == user_id, User.username == username, User.gsm == gsm)))
        if not exists:
            db.add(
                User(
                    id=user_id,
                    username=username,
                    gsm=gsm,
                    full_name=full_name,
                    role=role,
                    password_hash=password_hash,
                )
            )
    db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed_demo_users(db)
    yield


app = FastAPI(title="FraudCell Identity Service", version="1.0.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)


@app.exception_handler(HTTPException)
def http_error(_: Request, exc: HTTPException):
    return api_error(exc.status_code, exc.detail)


@app.exception_handler(RequestValidationError)
def validation_error(_: Request, exc: RequestValidationError):
    return api_error(422, exc.errors()[0]["msg"])


@app.exception_handler(RateLimitExceeded)
def rate_limit_error(_: Request, __: RateLimitExceeded):
    return api_error(429, "Çok fazla giriş denemesi. Biraz bekleyin")


def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    if not credentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bearer token gerekli")
    payload = decode_token(credentials.credentials, "access")
    user = db.get(User, payload["sub"])
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Kullanıcı bulunamadı veya pasif")
    return user


def admin_user(user: Annotated[User, Depends(current_user)]) -> User:
    if user.role != Role.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu işlem için ADMIN rolü gerekli")
    return user


def staff_reader(user: Annotated[User, Depends(current_user)]) -> User:
    if user.role not in {Role.SUPERVISOR, Role.ADMIN}:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Bu işlem için SUPERVISOR veya ADMIN rolü gerekli")
    return user


@app.get("/health")
def health(db: Annotated[Session, Depends(get_db)]):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "service": "identity-service"}


@app.post("/api/v1/auth/customers/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@app.post("/api/v1/auth/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, db: Annotated[Session, Depends(get_db)]):
    gsm = normalize_gsm(body.gsm)
    full_name = body.full_name.strip()
    username = body.username.strip().lower() if body.username else gsm
    if len(full_name) < 2 or len(username) < 3:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Kullanıcı adı ve ad soyad boş olamaz")
    if db.scalar(select(User.id).where(or_(User.username == username, User.gsm == gsm))):
        raise HTTPException(status.HTTP_409_CONFLICT, "Kullanıcı adı veya GSM zaten kayıtlı")
    user = User(
        id=str(uuid4()),
        username=username,
        gsm=gsm,
        full_name=full_name,
        role=Role.CUSTOMER,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Kullanıcı adı veya GSM zaten kayıtlı") from exc
    db.refresh(user)
    return api_success(UserOut.from_user(user), status.HTTP_201_CREATED)


@app.post("/api/v1/auth/staff/login", response_model=TokenResponse)
@app.post("/api/v1/auth/customers/login", response_model=TokenResponse)
@app.post("/api/v1/auth/login", response_model=TokenResponse)
@limiter.limit("20/minute")
def login(request: Request, body: LoginRequest, db: Annotated[Session, Depends(get_db)]):
    identifier = (body.username or body.gsm or body.identifier or "").strip()
    if not identifier:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "username, gsm veya identifier zorunludur")

    if body.gsm:
        gsm = normalize_gsm(body.gsm)
        user = db.scalar(select(User).where(User.gsm == gsm))
    else:
        normalized = identifier.lower()
        digits = "".join(character for character in identifier if character.isdigit())
        if len(digits) >= 10:
            try:
                normalized_gsm = normalize_gsm(identifier)
            except HTTPException:
                normalized_gsm = ""
            user = db.scalar(select(User).where(or_(User.username == normalized, User.gsm == normalized_gsm)))
        else:
            user = db.scalar(select(User).where(User.username == normalized))

    now = utcnow()
    if user and user.locked_until and user.locked_until > now:
        retry_after = math.ceil((user.locked_until - now).total_seconds())
        audit(db, "LOGIN_BLOCKED", False, identifier, user, f"retry_after_seconds={retry_after}")
        db.commit()
        raise HTTPException(
            status.HTTP_423_LOCKED,
            {"message": "Hesap geçici olarak kilitli", "retry_after_seconds": retry_after},
        )

    if user and user.locked_until:
        user.locked_until = None
        user.failed_attempts = 0

    if not user or not user.is_active or not password_matches(body.password, user.password_hash):
        audit(db, "LOGIN_FAILURE", False, identifier, user, "invalid_credentials")
        if user:
            user.failed_attempts += 1
            if user.failed_attempts >= MAX_FAILED_ATTEMPTS:
                user.locked_until = now + LOCK_TTL
                audit(db, "ACCOUNT_LOCKED", False, identifier, user, "five_failed_attempts")
        db.commit()
        if user and user.locked_until:
            raise HTTPException(
                status.HTTP_423_LOCKED,
                {"message": "Hesap 15 dakika kilitlendi", "retry_after_seconds": int(LOCK_TTL.total_seconds())},
            )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Kullanıcı bilgileri hatalı")

    user.failed_attempts = 0
    user.locked_until = None
    audit(db, "LOGIN_SUCCESS", True, identifier, user)
    tokens = issue_tokens(user, db)
    db.commit()
    return api_success(tokens)


@app.post("/api/v1/auth/refresh", response_model=TokenResponse)
def refresh(body: RefreshRequest, db: Annotated[Session, Depends(get_db)]):
    payload = decode_token(body.refresh_token, "refresh")
    stored = db.get(RefreshToken, payload["jti"])
    user = db.get(User, payload["sub"])
    if (
        not stored
        or stored.revoked
        or stored.user_id != payload["sub"]
        or stored.expires_at <= utcnow()
        or not user
        or not user.is_active
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token geçersiz")
    stored.revoked = True
    tokens = issue_tokens(user, db)
    db.commit()
    return api_success(tokens)


@app.post("/api/v1/auth/logout")
def logout(body: LogoutRequest, db: Annotated[Session, Depends(get_db)]):
    payload = decode_token(body.refresh_token, "refresh")
    stored = db.get(RefreshToken, payload["jti"])
    user = db.get(User, payload["sub"])
    if not stored or stored.user_id != payload["sub"] or stored.revoked:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token geçersiz")
    stored.revoked = True
    audit(db, "LOGOUT", True, user.username if user else payload["sub"], user)
    db.commit()
    return api_success({"logged_out": True})


@app.get("/api/v1/auth/me", response_model=UserOut)
@app.get("/api/v1/users/me", response_model=UserOut)
def me(user: Annotated[User, Depends(current_user)]):
    return api_success(UserOut.from_user(user))


@app.get("/api/v1/staff", response_model=list[UserOut])
def staff(
    _: Annotated[User, Depends(staff_reader)],
    db: Annotated[Session, Depends(get_db)],
):
    users = db.scalars(select(User).where(User.role == Role.ANALYST, User.is_active.is_(True)))
    return api_success([UserOut.from_user(user) for user in users])


@app.get("/api/v1/audit-logs", response_model=list[AuditOut])
@app.get("/api/v1/admin/audit-logs", response_model=list[AuditOut])
def audit_logs(
    _: Annotated[User, Depends(admin_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
):
    return api_success(list(db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(limit))))
