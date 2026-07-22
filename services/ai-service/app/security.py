import hmac
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated

import jwt
from fastapi import Header, HTTPException
from jwt import PyJWKClient

from app.config import get_settings


@dataclass(frozen=True)
class StaffPrincipal:
    user_id: str
    role: str


def require_internal_token(x_internal_token: Annotated[str | None, Header()] = None) -> None:
    expected = get_settings().internal_token.get_secret_value()
    if x_internal_token is None or not hmac.compare_digest(x_internal_token, expected):
        raise HTTPException(status_code=401, detail="invalid service credential")


@lru_cache
def _jwk_client() -> PyJWKClient:
    return PyJWKClient(get_settings().jwks_uri, cache_jwk_set=True, lifespan=300)


def require_staff(authorization: Annotated[str | None, Header()] = None) -> StaffPrincipal:
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="bearer token required")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        signing_key = _jwk_client().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=get_settings().jwt_audience,
            issuer=get_settings().jwt_issuer,
            options={"require": ["sub", "role", "iss", "aud", "iat", "exp", "jti"]},
        )
        role = str(claims["role"])
        if role not in {"ANALYST", "SUPERVISOR", "ADMIN"}:
            raise HTTPException(status_code=403, detail="role is not permitted")
        return StaffPrincipal(user_id=str(claims["sub"]), role=role)
    except HTTPException:
        raise
    except jwt.PyJWTError as error:
        raise HTTPException(status_code=401, detail="invalid bearer token") from error
