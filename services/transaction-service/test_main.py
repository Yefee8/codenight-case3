import os
from datetime import UTC, datetime

os.environ["DATABASE_URL"] = "sqlite:////tmp/fraudcell_transaction_test.db"
os.environ["JWT_SECRET"] = "test-secret"

import jwt
from fastapi.testclient import TestClient

import main
from database import Base, engine


def token(user_id: str, role: str) -> dict[str, str]:
    now = int(datetime.now(UTC).timestamp())
    return {
        "Authorization": "Bearer "
        + jwt.encode(
            {
                "sub": user_id,
                "user_id": user_id,
                "role": role,
                "full_name": user_id,
                "type": "access",
                "iat": now,
                "exp": now + 900,
                "jti": f"test-{user_id}",
            },
            "test-secret",
            algorithm="HS256",
        )
    }


def test_fallback_state_machine_and_decision_event(monkeypatch):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    monkeypatch.setattr(
        main,
        "score_transaction",
        lambda _: {
            "prediction_status": "UNAVAILABLE",
            "risk_score": None,
            "fraud_type": None,
            "recommended_decision": "INCELEME",
            "prediction_reason": "AI_UNAVAILABLE",
        },
    )
    events = []
    monkeypatch.setattr(main, "publish_decision", lambda event: not events.append(event))
    client = TestClient(main.app)
    customer = token("usr_customer_1", "CUSTOMER")
    other_customer = token("usr_customer_2", "CUSTOMER")
    supervisor = token("usr_supervisor_1", "SUPERVISOR")
    analyst = token("usr_analyst_1", "ANALYST")
    admin = token("usr_admin_1", "ADMIN")

    created = client.post(
        "/api/v1/transactions/simulate",
        headers=customer,
        json={
            "amount": 5000,
            "type": "TRANSFER",
            "location": "Istanbul, TR",
            "receiver": "Demo Alici",
            "device": "Web",
        },
    )
    assert created.status_code == 201
    case = created.json()["data"]["case"]
    assert case["status"] == "YENI"
    assert case["ai_analysis"]["fraud_type"] == "BELIRSIZ"

    case_id = case["case_id"]
    assert client.get(f"/api/v1/cases/{case_id}", headers=other_customer).status_code == 403
    assert client.patch(
        f"/api/v1/cases/{case_id}/assignment", headers=admin, json={"analyst_id": "usr_analyst_1"}
    ).status_code == 403
    assert client.patch(
        f"/api/v1/cases/{case_id}/risk-level",
        headers=customer,
        json={"risk_level": "KRITIK", "reason": "denied"},
    ).status_code == 403
    overridden = client.patch(
        f"/api/v1/cases/{case_id}/risk-level",
        headers=supervisor,
        json={"risk_level": "KRITIK", "reason": "<script>alert(1)</script>Manuel risk artışı"},
    )
    assert overridden.status_code == 200
    assert overridden.json()["data"]["risk_level"] == "KRITIK"
    assert overridden.json()["data"]["risk_override"]["reason"] == "alert(1)Manuel risk artışı"
    assert client.patch(
        f"/api/v1/cases/{case_id}/decision",
        headers=customer,
        json={"decision": "BLOKLANDI", "note": "denied"},
    ).status_code == 403
    assert client.patch(
        f"/api/v1/cases/{case_id}/assignment", headers=supervisor, json={"analyst_id": "usr_analyst_1"}
    ).status_code == 200
    assert client.post(f"/api/v1/cases/{case_id}/actions/start-review", headers=analyst).status_code == 200
    assert client.patch(
        f"/api/v1/cases/{case_id}/decision", headers=analyst, json={"decision": "BLOKLANDI"}
    ).status_code == 422
    decided = client.patch(
        f"/api/v1/cases/{case_id}/decision",
        headers=analyst,
        json={"decision": "BLOKLANDI", "note": "Müşteri işlemi reddetti"},
    )
    assert decided.status_code == 200
    assert events[0]["event_type"] == "transaction.blocked"
    assert events[0]["analyst_id"] == "usr_analyst_1"
    feedback = client.post(
        f"/api/v1/cases/{case_id}/feedback",
        headers=customer,
        json={"rating": 5, "note": "<script>x()</script>İyi yönetildi"},
    )
    assert feedback.status_code == 200
    assert feedback.json()["data"]["customer_feedback"]["rating"] == 5
    assert feedback.json()["data"]["customer_feedback"]["note"] == "x()İyi yönetildi"
    assert client.post(
        f"/api/v1/cases/{case_id}/feedback", headers=customer, json={"rating": 4}
    ).status_code == 409
    assert client.post(
        f"/api/v1/cases/{case_id}/feedback", headers=other_customer, json={"rating": 5}
    ).status_code == 403
