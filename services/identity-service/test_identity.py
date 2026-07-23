import os
import tempfile

import jwt
from fastapi.testclient import TestClient


test_directory = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = f"sqlite:///{test_directory.name}/identity.db"
os.environ["JWT_SECRET"] = "test-secret"

from main import JWT_ALGORITHM, JWT_SECRET, app  # noqa: E402


def test_login_refresh_me_lockout_and_audit():
    with TestClient(app) as client:
        invalid = client.post(
            "/api/v1/auth/register",
            json={"username": "   ", "gsm": "05320000009", "full_name": "  ", "password": "Demo123!"},
        )
        assert invalid.status_code == 422

        login = client.post(
            "/api/v1/auth/login",
            json={"gsm": "0532 000 00 01", "password": "Demo123!"},
        )
        assert login.status_code == 200
        tokens = login.json()["data"]
        access = jwt.decode(tokens["access_token"], JWT_SECRET, algorithms=[JWT_ALGORITHM])
        refresh = jwt.decode(tokens["refresh_token"], JWT_SECRET, algorithms=[JWT_ALGORITHM])
        assert access["type"] == "access" and access["exp"] - access["iat"] == 15 * 60
        assert refresh["type"] == "refresh" and refresh["exp"] - refresh["iat"] == 7 * 24 * 60 * 60

        me = client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
        assert me.status_code == 200 and me.json()["data"]["user_id"] == "usr_customer_1"

        rotated = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        assert rotated.status_code == 200 and rotated.json()["data"]["refresh_token"] != tokens["refresh_token"]
        assert client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401

        statuses = [
            client.post(
                "/api/v1/auth/login",
                json={"username": "analyst", "password": "wrong"},
            ).status_code
            for _ in range(5)
        ]
        assert statuses == [401, 401, 401, 401, 423]
        assert client.post(
            "/api/v1/auth/login",
            json={"username": "analyst", "password": "Demo123!"},
        ).status_code == 423

        admin = client.post(
            "/api/v1/auth/login",
            json={"username": "admin", "password": "Demo123!"},
        ).json()["data"]
        logs = client.get(
            "/api/v1/admin/audit-logs",
            headers={"Authorization": f"Bearer {admin['access_token']}"},
        )
        assert logs.status_code == 200
        assert {entry["action"] for entry in logs.json()["data"]} >= {"LOGIN_SUCCESS", "LOGIN_FAILURE", "ACCOUNT_LOCKED"}
        staff = client.get(
            "/api/v1/staff",
            headers={"Authorization": f"Bearer {admin['access_token']}"},
        )
        assert staff.status_code == 200 and staff.json()["data"][0]["user_id"] == "usr_analyst_1"
        rotated_tokens = rotated.json()["data"]
        assert client.post(
            "/api/v1/auth/logout",
            json={"refresh_token": rotated_tokens["refresh_token"]},
        ).status_code == 200
        assert client.post(
            "/api/v1/auth/refresh",
            json={"refresh_token": rotated_tokens["refresh_token"]},
        ).status_code == 401
