from types import SimpleNamespace

import jwt
import pytest
from fastapi import HTTPException

from app import security


class FakeJwkClient:
    def get_signing_key_from_jwt(self, _: str):
        return SimpleNamespace(key="public-key")


def test_internal_service_token_is_constant_contract() -> None:
    security.require_internal_token("change-me")
    with pytest.raises(HTTPException) as missing:
        security.require_internal_token(None)
    with pytest.raises(HTTPException) as wrong:
        security.require_internal_token("wrong")
    assert missing.value.status_code == 401
    assert wrong.value.status_code == 401


def test_staff_jwt_accepts_canonical_role_and_rejects_wrong_role(monkeypatch) -> None:
    monkeypatch.setattr(security, "_jwk_client", lambda: FakeJwkClient())
    monkeypatch.setattr(
        security.jwt,
        "decode",
        lambda *args, **kwargs: {"sub": "user-1", "role": "SUPERVISOR"},
    )
    assert security.require_staff("Bearer token").role == "SUPERVISOR"

    monkeypatch.setattr(
        security.jwt,
        "decode",
        lambda *args, **kwargs: {"sub": "user-1", "role": "CUSTOMER"},
    )
    with pytest.raises(HTTPException) as forbidden:
        security.require_staff("Bearer token")
    assert forbidden.value.status_code == 403


def test_staff_jwt_rejects_missing_and_invalid_tokens(monkeypatch) -> None:
    with pytest.raises(HTTPException) as missing:
        security.require_staff(None)
    assert missing.value.status_code == 401

    monkeypatch.setattr(security, "_jwk_client", lambda: FakeJwkClient())

    def invalid(*args, **kwargs):
        raise jwt.InvalidTokenError("bad")

    monkeypatch.setattr(security.jwt, "decode", invalid)
    with pytest.raises(HTTPException) as rejected:
        security.require_staff("Bearer invalid")
    assert rejected.value.status_code == 401
