from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType
from urllib.error import HTTPError

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[2]
RABBIT_ROOT = ROOT / "infrastructure" / "rabbitmq"
SERVICES = ("identity", "transaction", "ai", "gamification", "gateway")


def load_bootstrap(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    values = {
        "RABBITMQ_BOOTSTRAP_USER": "bootstrap",
        "RABBITMQ_BOOTSTRAP_PASSWORD": "bootstrap-secret",
        "RABBITMQ_OPERATOR_USER": "operator",
        "RABBITMQ_OPERATOR_PASSWORD": "operator-secret",
        "IDENTITY_RABBITMQ_USER": "identity-user",
        "IDENTITY_RABBITMQ_PASSWORD": "identity-secret",
        "TRANSACTION_RABBITMQ_USER": "transaction-user",
        "TRANSACTION_RABBITMQ_PASSWORD": "transaction-secret",
        "AI_RABBITMQ_USER": "ai-user",
        "AI_RABBITMQ_PASSWORD": "ai-secret",
        "GAMIFICATION_RABBITMQ_USER": "game-user",
        "GAMIFICATION_RABBITMQ_PASSWORD": "game-secret",
        "GATEWAY_RABBITMQ_USER": "gateway-user",
        "GATEWAY_RABBITMQ_PASSWORD": "gateway-secret",
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    spec = importlib.util.spec_from_file_location(
        "rabbit_bootstrap", RABBIT_ROOT / "bootstrap_users.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_hardened_topology_has_private_retry_and_dlx_exchanges() -> None:
    topology = json.loads(
        (RABBIT_ROOT / "definitions-hardened.json").read_text(encoding="utf-8")
    )
    exchange_names = {exchange["name"] for exchange in topology["exchanges"]}

    assert "fraudcell.retry.v1" not in exchange_names
    assert "fraudcell.dlx.v1" not in exchange_names
    for service in SERVICES:
        assert f"fraudcell.{service}.retry.v1" in exchange_names
        assert f"fraudcell.{service}.dlx.v1" in exchange_names
        service_queues = [
            queue for queue in topology["queues"] if f".{service}." in queue["name"]
        ]
        for queue in service_queues:
            dead_letter_exchange = queue["arguments"].get("x-dead-letter-exchange")
            if dead_letter_exchange:
                assert dead_letter_exchange.startswith(f"fraudcell.{service}.")


def test_generated_topology_is_reproducible() -> None:
    spec = importlib.util.spec_from_file_location(
        "rabbit_generator", RABBIT_ROOT / "generate_hardened_definitions.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    committed = json.loads(
        (RABBIT_ROOT / "definitions-hardened.json").read_text(encoding="utf-8")
    )

    assert module.build() == committed


def test_ai_queue_receives_supported_transaction_events() -> None:
    topology = json.loads(
        (RABBIT_ROOT / "definitions-hardened.json").read_text(encoding="utf-8")
    )
    routes = {
        binding["routing_key"]
        for binding in topology["bindings"]
        if binding["source"] == "fraudcell.events.v1"
        and binding["destination"] == "fraudcell.ai.events.v1"
    }

    assert {"staff.#", "transaction.#", "case.#"} <= routes


def test_bootstrap_scopes_resource_and_event_permissions(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_bootstrap(monkeypatch)
    calls: list[tuple[str, str, dict | None]] = []
    monkeypatch.setattr(module, "request", lambda method, path, payload=None: calls.append((method, path, payload)))

    module.configure_service("identity", module.SERVICES["identity"])

    permission = next(payload for _, path, payload in calls if path.startswith("/permissions/"))
    topic = next(payload for _, path, payload in calls if path.startswith("/topic-permissions/"))
    assert permission is not None and topic is not None
    assert "fraudcell\\.identity\\.(retry|dlx)" in permission["write"]
    assert "transaction" not in permission["write"]
    assert topic["exchange"] == "fraudcell.events.v1"
    assert "staff" in topic["write"]
    assert "transaction" not in topic["write"]

    calls.clear()
    module.configure_service("gateway", module.SERVICES["gateway"])
    gateway_permission = next(payload for _, path, payload in calls if path.startswith("/permissions/"))
    gateway_topic = next(payload for _, path, payload in calls if path.startswith("/topic-permissions/"))
    assert gateway_permission is not None and "fraudcell\\.events\\.v1" not in gateway_permission["write"]
    assert gateway_topic == {
        "exchange": "fraudcell.events.v1",
        "write": "^$",
        "read": r"^(sessions\.revoked|role\.changed)$",
        "configure": "^$",
    }


def test_bootstrap_creates_operator_and_can_remove_one_time_admin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_bootstrap(monkeypatch)
    calls: list[tuple[str, str, dict | None]] = []
    monkeypatch.setattr(
        module, "request", lambda method, path, payload=None: calls.append((method, path, payload))
    )
    module.validate_distinct_users()
    module.configure_operator()
    module.request("DELETE", f"/users/{module.BOOTSTRAP_USER}")

    operator = next(payload for _, path, payload in calls if path == "/users/operator")
    assert operator == {"password": "operator-secret", "tags": "administrator"}
    assert ("DELETE", "/users/bootstrap", None) in calls


def test_bootstrap_can_reauthenticate_with_persistent_operator(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_bootstrap(monkeypatch)
    bootstrap_authorization = module.AUTHORIZATION
    attempts: list[str] = []

    def authenticate(method: str, path: str, payload=None) -> None:
        attempts.append(module.AUTHORIZATION)
        if module.AUTHORIZATION != module.OPERATOR_AUTHORIZATION:
            raise HTTPError(path, 401, "unauthorized", {}, None)

    monkeypatch.setattr(module, "request", authenticate)
    monkeypatch.setattr(module.time, "sleep", lambda _: None)
    module.wait_until_ready()

    assert attempts == [bootstrap_authorization, module.OPERATOR_AUTHORIZATION]
    assert module.AUTHORIZATION == module.OPERATOR_AUTHORIZATION


def test_hardened_compose_imports_generated_topology_from_python_bootstrap() -> None:
    compose = yaml.safe_load(
        (ROOT / "docker-compose.rabbitmq-hardened.yml").read_text(encoding="utf-8")
    )["services"]

    assert compose["rabbitmq-bootstrap"]["image"].startswith("python:3.13")
    assert "bootstrap_users.py" in str(compose["rabbitmq-bootstrap"]["volumes"])
    assert "definitions-hardened.json" in str(compose["rabbitmq-bootstrap"]["volumes"])
