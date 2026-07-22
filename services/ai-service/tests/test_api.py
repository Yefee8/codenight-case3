from datetime import UTC, datetime
from uuid import UUID

from fastapi.testclient import TestClient

from app import main
from app.model import Prediction
from app.security import StaffPrincipal, require_staff


class FakeBundle:
    ready = True
    artifact = {
        "model_version": "fraudcell-test-v1",
        "feature_schema_version": "fraudcell-features-v1",
    }
    manifest = {
        **artifact,
        "artifact_sha256": "a" * 64,
        "dataset_sha256": "b" * 64,
        "trained_at": datetime(2026, 7, 22, tzinfo=UTC).isoformat(),
        "metrics": {
            "risk_roc_auc": 0.98,
            "risk_recall": 0.92,
            "risk_pr_auc": 0.91,
            "risk_brier": 0.04,
            "type_macro_f1": 0.89,
            "category_recall": {"CALINTI_KART": 0.88},
            "category_precision": {"CALINTI_KART": 0.90},
            "holdout_count": 1_500,
        },
        "label_counts": {"CALINTI_KART": 375},
    }

    def load(self) -> None:
        return None

    def predict(self, _: dict[str, object]) -> Prediction:
        return Prediction(risk_score=0.9001, fraud_type="CALINTI_KART")


class FakeRepository:
    ready = True
    last_error = None

    def register_model(self, _: dict[str, object]) -> None:
        return None

    def check(self) -> bool:
        return self.ready

    def persist_prediction(self, *args) -> None:
        self.persisted = args

    def online_metrics(self) -> dict[str, object]:
        return {
            "sample_count": 10,
            "risk_accuracy": 0.8,
            "false_positive_rate": 0.1,
            "type_accuracy": 0.75,
            "categories": [],
        }


class FakeWorker:
    started = False

    def start(self) -> None:
        self.started = True

    def stop(self) -> None:
        self.started = False


class MissingBundle:
    ready = False
    artifact = None
    manifest = None

    def load(self) -> None:
        return None


def request_payload() -> dict[str, object]:
    candidates = []
    for number in range(1, 4):
        candidates.append(
            {
                "analyst_id": str(UUID(int=number)),
                "specialties": ["CALINTI_KART"],
                "regions": ["MARMARA"],
                "active_case_count": number,
                "performance": 0.8,
                "status": "ACTIVE",
                "locked": False,
                "last_assigned_at": f"2026-07-{number:02d}T10:00:00Z",
            }
        )
    return {
        "transaction_id": str(UUID(int=100)),
        "case_id": str(UUID(int=101)),
        "features": {
            "customer_id": str(UUID(int=200)),
            "city": "İstanbul",
            "region": "Marmara",
            "country_code": "DE",
            "transaction_type": "Transfer",
            "amount": 100_000.0,
            "hour": 2,
            "new_device": True,
            "new_recipient": True,
            "frequency_1h": 8,
            "frequency_24h": 30,
            "deviation_score": 6.0,
        },
        "candidates": candidates,
    }


def test_health_readiness_and_request_id(monkeypatch) -> None:
    monkeypatch.setattr(main, "model_bundle", MissingBundle())
    monkeypatch.setattr(main, "repository", FakeRepository())
    monkeypatch.setattr(main, "rabbit_worker", FakeWorker())
    with TestClient(main.app) as client:
        live = client.get("/health/live", headers={"X-Request-ID": "invalid"})
        ready = client.get("/health/ready")

    assert live.status_code == 200
    assert live.json()["success"] is True
    assert UUID(live.headers["X-Request-ID"])
    assert live.headers["Cache-Control"] == "no-store"
    assert ready.status_code == 503
    assert ready.json()["error"]["code"] == "MODEL_NOT_READY"


def test_internal_score_uses_real_bundle_contract_and_assignment(monkeypatch) -> None:
    monkeypatch.setattr(main, "model_bundle", FakeBundle())
    monkeypatch.setattr(main, "repository", FakeRepository())
    monkeypatch.setattr(main, "rabbit_worker", FakeWorker())
    with TestClient(main.app) as client:
        unauthorized = client.post("/internal/v1/score", json=request_payload())
        response = client.post(
            "/internal/v1/score",
            json=request_payload(),
            headers={"X-Internal-Token": "change-me"},
        )

    assert unauthorized.status_code == 401
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["risk_score"] == 0.9001
    assert data["risk_level"] == "KRITIK"
    assert data["decision"] == "BLOK"
    assert data["fraud_type"] == "CALINTI_KART"
    assert len(data["ranked_candidates"]) == 3
    assert len(data["reason_codes"]) >= 1
    assert UUID(data["prediction_id"]).version == 7


def test_prometheus_endpoint_is_internal_and_has_bounded_labels(monkeypatch) -> None:
    monkeypatch.setattr(main, "model_bundle", FakeBundle())
    monkeypatch.setattr(main, "repository", FakeRepository())
    monkeypatch.setattr(main, "rabbit_worker", FakeWorker())
    with TestClient(main.app) as client:
        denied = client.get("/internal/metrics")
        allowed = client.get("/internal/metrics", headers={"X-Internal-Token": "change-me"})

    assert denied.status_code == 401
    assert allowed.status_code == 200
    assert "fraudcell_ai_http_requests_total" in allowed.text
    assert 'route="/internal/metrics"' in allowed.text


def test_missing_required_feature_returns_canonical_422(monkeypatch) -> None:
    monkeypatch.setattr(main, "model_bundle", FakeBundle())
    monkeypatch.setattr(main, "repository", FakeRepository())
    monkeypatch.setattr(main, "rabbit_worker", FakeWorker())
    payload = request_payload()
    del payload["features"]["amount"]  # type: ignore[index]
    with TestClient(main.app) as client:
        response = client.post(
            "/internal/v1/score", json=payload, headers={"X-Internal-Token": "change-me"}
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert "features.amount" in response.json()["error"]["field_errors"]


def test_staff_model_and_metrics_endpoints(monkeypatch) -> None:
    monkeypatch.setattr(main, "model_bundle", FakeBundle())
    monkeypatch.setattr(main, "repository", FakeRepository())
    monkeypatch.setattr(main, "rabbit_worker", FakeWorker())
    main.app.dependency_overrides[require_staff] = lambda: StaffPrincipal("user", "SUPERVISOR")
    try:
        with TestClient(main.app) as client:
            model_response = client.get("/api/v1/ai/model")
            metrics = client.get("/api/v1/ai/metrics")
            categories = client.get("/api/v1/ai/metrics/categories")
    finally:
        main.app.dependency_overrides.clear()

    assert model_response.status_code == 200
    assert model_response.json()["data"]["artifact_sha256"] == "a" * 64
    assert {item["name"] for item in metrics.json()["data"]} == {
        "risk_roc_auc",
        "risk_recall",
        "risk_pr_auc",
        "risk_brier",
        "type_macro_f1",
        "online_risk_accuracy",
        "online_false_positive_rate",
        "online_type_accuracy",
    }
    assert categories.json()["data"][0]["category"] == "CALINTI_KART"
