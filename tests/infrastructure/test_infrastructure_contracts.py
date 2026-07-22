from __future__ import annotations

import json
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
SERVICES = ("identity", "transaction", "ai", "gamification")
RETRY_DELAYS = {"5s": 5_000, "30s": 30_000, "2m": 120_000, "10m": 600_000, "30m": 1_800_000}


def test_rabbitmq_topology_has_durable_quorum_retry_chain_and_dlq() -> None:
    topology = json.loads(
        (ROOT / "infrastructure" / "rabbitmq" / "definitions.json").read_text(encoding="utf-8")
    )
    exchanges = {exchange["name"]: exchange for exchange in topology["exchanges"]}
    queues = {queue["name"]: queue for queue in topology["queues"]}

    assert exchanges["fraudcell.events.v1"]["type"] == "topic"
    assert exchanges["fraudcell.retry.v1"]["type"] == "direct"
    assert exchanges["fraudcell.dlx.v1"]["type"] == "direct"
    assert all(exchange["durable"] for exchange in exchanges.values())

    for service in SERVICES:
        main = queues[f"fraudcell.{service}.events.v1"]
        dlq = queues[f"fraudcell.{service}.dlq.v1"]
        assert main["arguments"]["x-queue-type"] == "quorum"
        assert dlq["arguments"]["x-queue-type"] == "quorum"
        assert main["arguments"]["x-dead-letter-exchange"] == "fraudcell.dlx.v1"
        for label, milliseconds in RETRY_DELAYS.items():
            retry = queues[f"fraudcell.{service}.retry.{label}.v1"]
            assert retry["durable"] is True
            assert retry["arguments"]["x-queue-type"] == "quorum"
            assert retry["arguments"]["x-message-ttl"] == milliseconds


def test_redis_security_and_cache_instances_are_not_interchangeable() -> None:
    gateway = (ROOT / "infrastructure" / "redis" / "gateway-security.conf").read_text()
    game = (ROOT / "infrastructure" / "redis" / "gamification-cache.conf").read_text()
    gateway_acl = (ROOT / "infrastructure" / "redis" / "start-gateway-redis.sh").read_text()

    assert "appendonly yes" in gateway
    assert "maxmemory-policy noeviction" in gateway
    assert "user default off ~fraudcell:gateway:* +@read +@write +@connection +@transaction" in gateway_acl
    assert "~fraudcell:gateway:*" in gateway_acl
    assert "+eval" in gateway_acl and "+evalsha" in gateway_acl
    assert "appendonly no" in game
    assert "maxmemory-policy allkeys-lru" in game


def test_postgres_bootstrap_forbids_privileged_runtime_roles() -> None:
    bootstrap = (ROOT / "infrastructure" / "postgres" / "bootstrap-service-db.sh").read_text()

    assert bootstrap.count("NOBYPASSRLS") >= 2
    assert bootstrap.count("NOSUPERUSER") >= 2
    assert "REVOKE CREATE ON SCHEMA public FROM PUBLIC" in bootstrap
    assert "GRANT SELECT, INSERT, UPDATE, DELETE" in bootstrap


def test_compose_has_physical_data_plane_separation() -> None:
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    services = compose["services"]

    for service in SERVICES:
        db_name = f"{service}-db"
        app_name = f"{service}-service"
        network = f"{service}-db-net"
        assert set(services[db_name]["networks"]) == {network}
        assert network in services[app_name]["networks"]
        for other in SERVICES:
            if other != service:
                assert network not in services[f"{other}-service"]["networks"]

    assert set(services["gateway-redis"]["networks"]) == {"gateway-security-net"}
    assert "gateway-security-net" in services["gateway"]["networks"]
    assert "gateway-security-net" not in services["gamification-service"]["networks"]
    assert set(services["gamification-redis"]["networks"]) == {"gamification-cache-net"}


def test_postgres_18_uses_version_aware_volume_root() -> None:
    services = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))["services"]
    for name in ("identity-db", "transaction-db", "ai-db", "gamification-db"):
        assert any(mount.endswith(":/var/lib/postgresql") for mount in services[name]["volumes"])


def test_databases_use_distinct_bootstrap_secret_variables() -> None:
    text = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")

    for service in SERVICES:
        assert f"${{{service.upper()}_DB_BOOTSTRAP_PASSWORD:?" in text
    assert "${POSTGRES_BOOTSTRAP_PASSWORD:" not in text


def test_only_ui_and_gateway_ports_are_published() -> None:
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    published = {name for name, service in compose["services"].items() if service.get("ports")}

    assert published == {"frontend", "gateway"}
    assert compose["services"]["frontend"]["ports"] == ["${FRONTEND_PORT:-3000}:3000"]
    assert "healthcheck" in compose["services"]["frontend"]
