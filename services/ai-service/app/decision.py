from app.schemas import AnalystCandidate, RankedCandidate


def decision_for(score: float) -> str:
    if not 0 <= score <= 1:
        raise ValueError("risk score must be between 0 and 1")
    if score < 0.40:
        return "ONAY"
    if score <= 0.90:
        return "INCELEME"
    return "BLOK"


def risk_level_for(score: float) -> str:
    if not 0 <= score <= 1:
        raise ValueError("risk score must be between 0 and 1")
    if score < 0.40:
        return "DUSUK"
    if score < 0.70:
        return "ORTA"
    if score <= 0.90:
        return "YUKSEK"
    return "KRITIK"


def rank_candidates(
    candidates: list[AnalystCandidate], fraud_type: str, region: str
) -> list[RankedCandidate]:
    eligible = [
        candidate
        for candidate in candidates
        if candidate.status == "ACTIVE"
        and not candidate.locked
        and candidate.active_case_count < 10
    ]
    ranked: list[tuple[RankedCandidate, bool, float, str]] = []
    for candidate in eligible:
        expertise = 1.0 if fraud_type in {item.upper() for item in candidate.specialties} else 0.0
        availability = 1 - candidate.active_case_count / 10
        performance = 0.50 if candidate.performance is None else candidate.performance
        score = expertise * 0.50 + availability * 0.30 + performance * 0.20
        region_match = region in {item.upper() for item in candidate.regions}
        last_assigned = (
            candidate.last_assigned_at.timestamp()
            if candidate.last_assigned_at is not None
            else float("-inf")
        )
        ranked.append(
            (
                RankedCandidate(
                    analyst_id=candidate.analyst_id,
                    score=round(score, 8),
                    expertise_match=expertise,
                    availability=availability,
                    performance=performance,
                    region_match=region_match,
                ),
                region_match,
                last_assigned,
                str(candidate.analyst_id),
            )
        )
    ranked.sort(key=lambda item: (-item[0].score, -int(item[1]), item[2], item[3]))
    return [item[0] for item in ranked]


def reason_codes(features: dict[str, object]) -> list[str]:
    reasons: list[str] = []
    if float(features["amount"]) >= 50_000:
        reasons.append("HIGH_AMOUNT")
    if int(features["hour"]) <= 5:
        reasons.append("UNUSUAL_HOUR")
    if bool(features["new_device"]):
        reasons.append("NEW_DEVICE")
    if bool(features["new_recipient"]):
        reasons.append("NEW_RECIPIENT")
    if int(features["frequency_1h"]) >= 5 or int(features["frequency_24h"]) >= 20:
        reasons.append("HIGH_FREQUENCY")
    if float(features["deviation_score"]) >= 3:
        reasons.append("BEHAVIOR_DEVIATION")
    if str(features["country_code"]) != "TR":
        reasons.append("FOREIGN_COUNTRY")
    return reasons or ["MODEL_PATTERN"]
