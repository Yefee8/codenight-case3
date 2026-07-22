from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from app.decision import decision_for, rank_candidates, reason_codes, risk_level_for
from app.schemas import AnalystCandidate


@pytest.mark.parametrize(
    ("score", "decision", "risk"),
    [
        (0.0, "ONAY", "DUSUK"),
        (0.399999, "ONAY", "DUSUK"),
        (0.40, "INCELEME", "ORTA"),
        (0.699999, "INCELEME", "ORTA"),
        (0.70, "INCELEME", "YUKSEK"),
        (0.90, "INCELEME", "YUKSEK"),
        (0.9001, "BLOK", "KRITIK"),
        (1.0, "BLOK", "KRITIK"),
    ],
)
def test_exact_score_boundaries(score: float, decision: str, risk: str) -> None:
    assert decision_for(score) == decision
    assert risk_level_for(score) == risk


@pytest.mark.parametrize("score", [-0.1, 1.1])
def test_out_of_range_score_is_rejected(score: float) -> None:
    with pytest.raises(ValueError):
        decision_for(score)
    with pytest.raises(ValueError):
        risk_level_for(score)


def candidate(
    identifier: int,
    *,
    expertise: bool = False,
    region: bool = False,
    active: int = 0,
    performance: float | None = None,
    last_days: int = 0,
) -> AnalystCandidate:
    return AnalystCandidate(
        analyst_id=UUID(int=identifier),
        specialties=["CALINTI_KART"] if expertise else [],
        regions=["MARMARA"] if region else [],
        active_case_count=active,
        performance=performance,
        status="ACTIVE",
        locked=False,
        last_assigned_at=datetime(2026, 1, 10, tzinfo=UTC) + timedelta(days=last_days),
    )


def test_assignment_formula_capacity_cold_start_and_tie_breaks() -> None:
    ranked = rank_candidates(
        [
            candidate(4, expertise=True, active=10),
            candidate(3, expertise=True, region=True, active=5, performance=0.7, last_days=2),
            candidate(2, expertise=True, region=True, active=5, performance=0.7, last_days=1),
            candidate(1, expertise=True, active=5, performance=None, last_days=0),
        ],
        "CALINTI_KART",
        "MARMARA",
    )

    assert [item.analyst_id.int for item in ranked] == [2, 3, 1]
    assert ranked[0].score == pytest.approx(0.79)
    assert ranked[-1].performance == 0.5
    assert all(item.analyst_id.int != 4 for item in ranked)


def test_assignment_supports_partial_capacity_and_empty_queue() -> None:
    assert [item.analyst_id.int for item in rank_candidates([candidate(1)], "TEMIZ", "MARMARA")] == [1]
    assert rank_candidates([candidate(2, active=10)], "TEMIZ", "MARMARA") == []


def test_reason_codes_are_explainable_and_never_empty() -> None:
    risky = {
        "amount": 80_000,
        "hour": 2,
        "new_device": True,
        "new_recipient": True,
        "frequency_1h": 7,
        "frequency_24h": 30,
        "deviation_score": 6,
        "country_code": "DE",
    }
    assert set(reason_codes(risky)) == {
        "HIGH_AMOUNT",
        "UNUSUAL_HOUR",
        "NEW_DEVICE",
        "NEW_RECIPIENT",
        "HIGH_FREQUENCY",
        "BEHAVIOR_DEVIATION",
        "FOREIGN_COUNTRY",
    }
    normal = risky | {
        "amount": 100,
        "hour": 12,
        "new_device": False,
        "new_recipient": False,
        "frequency_1h": 0,
        "frequency_24h": 1,
        "deviation_score": 0.2,
        "country_code": "TR",
    }
    assert reason_codes(normal) == ["MODEL_PATTERN"]
