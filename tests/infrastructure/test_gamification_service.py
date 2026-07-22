from pathlib import Path
import re

import yaml


ROOT = Path(__file__).resolve().parents[2]
SERVICE = ROOT / "services" / "gamification-service"


def test_gamification_schema_has_immutable_ledger_and_effectively_once_keys() -> None:
    schema = (SERVICE / "src/main/resources/db/migration/V1__gamification_schema.sql").read_text("utf-8")
    refinement = (SERVICE / "src/main/resources/db/migration/V3__out_of_order_and_leaderboard_rls.sql").read_text("utf-8")

    assert "point_ledger_append_only" in schema
    assert "earned_badges_append_only" in schema
    assert "UNIQUE (event_id, reason)" in schema
    assert "uq_point_ledger_case_reason" in refinement
    assert "ground_truth" in refinement


def test_every_gamification_table_has_enable_and_force_rls() -> None:
    schema = (SERVICE / "src/main/resources/db/migration/V1__gamification_schema.sql").read_text("utf-8")
    rls = (SERVICE / "src/main/resources/db/migration/V2__gamification_rls.sql").read_text("utf-8")
    tables = re.findall(r"CREATE TABLE\s+([a-z_]+)", schema, re.IGNORECASE)

    assert tables
    for table in tables:
        assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in rls
        assert f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY" in rls
    assert "set_config('app.user_id'" in (
        SERVICE / "src/main/java/com/fraudcell/gamification/security/RlsContext.java"
    ).read_text("utf-8")
    assert "true)" in (
        SERVICE / "src/main/java/com/fraudcell/gamification/security/RlsContext.java"
    ).read_text("utf-8")


def test_gamification_cache_is_short_lived_and_database_fallback_exists() -> None:
    query_service = (
        SERVICE / "src/main/java/com/fraudcell/gamification/application/GameQueryService.java"
    ).read_text("utf-8")

    assert "Duration.ofSeconds(30)" in query_service
    assert "database fallback is active" in query_service
    forbidden = ("refresh", "password", "otp", "transaction:", "case:")
    cache_key_lines = [
        line.lower() for line in query_service.splitlines() if '"fraudcell:game:' in line
    ]
    assert cache_key_lines
    assert not any(word in line for word in forbidden for line in cache_key_lines)


def test_gamification_openapi_and_compose_are_wired() -> None:
    contract = yaml.safe_load((ROOT / "contracts/openapi/gamification-service.yaml").read_text("utf-8"))
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text("utf-8"))

    assert contract["openapi"] == "3.1.0"
    assert "/api/v1/game/notifications/stream" in contract["paths"]
    service = compose["services"]["gamification-service"]
    assert "gamification-db-net" in service["networks"]
    assert "gamification-cache-net" in service["networks"]
    assert "identity-db-net" not in service["networks"]
