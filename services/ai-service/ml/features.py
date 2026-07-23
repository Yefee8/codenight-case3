import math
from typing import Any, Mapping

MODEL_VERSION = "fraudcell-rf-v1"
LABELS = ["TEMIZ", "CALINTI_KART", "HESAP_ELE_GECIRME", "PARA_AKLAMA", "SUPHELI_DAVRANIS"]
FRAUD_LABELS = [label for label in LABELS if label != "TEMIZ"]
NUMERIC_FEATURES = ["amount", "hour", "is_night", "is_foreign", "is_new_device", "is_new_recipient", "log_amount"]
CATEGORICAL_FEATURES = ["transaction_type", "location_region", "device_status", "receiver_type"]
FEATURE_COLUMNS = NUMERIC_FEATURES + CATEGORICAL_FEATURES

DOMESTIC_MARKERS = (
    "TÜRKIYE", "TURKIYE", "TURKEY", ", TR", "İSTANBUL", "ISTANBUL", "ANKARA",
    "İZMİR", "IZMIR", "BURSA", "ANTALYA", "ADANA", "ESKİŞEHİR", "ESKISEHIR", "MANİSA", "MANISA",
)


def _get(data: Any, key: str, default: Any = None) -> Any:
    if isinstance(data, Mapping):
        return data.get(key, default)
    return getattr(data, key, default)


def as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "evet"}
    return False


def is_foreign_location(location: str, country_code: str | None = None) -> bool:
    if country_code:
        return country_code.upper() != "TR"
    return not any(marker in location.upper() for marker in DOMESTIC_MARKERS)


def location_region(location: str, country_code: str | None = None) -> str:
    if is_foreign_location(location, country_code):
        value = f" {location.upper()} "
        if any(city in value for city in ("AMSTERDAM", "BERLIN", "PARIS", "LONDON", "DUBAI")):
            return "FOREIGN_HIGH_RISK"
        return "FOREIGN_OTHER"
    value = location.upper()
    if any(city in value for city in ("İSTANBUL", "ISTANBUL", "ANKARA", "İZMİR", "IZMIR", "BURSA")):
        return "TR_METRO"
    return "TR_OTHER"


def receiver_type(receiver: str | None) -> str:
    value = (receiver or "").upper()
    if any(word in value for word in ("FATURA", "ELEKTRIK", "DOGALGAZ", "TELEKOM", "MARKET")):
        return "KNOWN_BILLER"
    if any(word in value for word in ("KRIPTO", "EXCHANGE", "GLOBAL", "OFFSHORE", "YENI", "NEW")):
        return "HIGH_RISK_RECIPIENT"
    return "NORMAL_RECIPIENT"


def device_status(device: str | None, is_new_device: bool = False) -> str:
    value = (device or "").upper()
    if is_new_device or any(word in value for word in ("NEW", "YENİ", "YENI", "UNKNOWN", "BILINMEYEN", "BİLİNMEYEN")):
        return "NEW_DEVICE"
    return "KNOWN_DEVICE"


def features_from_request(data: Any) -> dict[str, Any]:
    amount = float(_get(data, "amount", 0) or 0)
    hour_value = _get(data, "hour", None)
    hour = int(hour_value) if hour_value is not None else 12
    tx_type = str(_get(data, "transaction_type", _get(data, "type", "ODEME")) or "ODEME").upper()
    location = str(_get(data, "location", "") or "")
    country_code = _get(data, "country_code", None)
    new_device = as_bool(_get(data, "is_new_device", False))
    new_recipient = as_bool(_get(data, "is_new_recipient", False))
    device = _get(data, "device", None)
    receiver = _get(data, "receiver", None)
    device_bucket = device_status(device, new_device)
    return {
        "amount": amount,
        "hour": hour,
        "is_night": int(hour < 6 or hour >= 23),
        "is_foreign": int(is_foreign_location(location, country_code)),
        "is_new_device": int(device_bucket == "NEW_DEVICE"),
        "is_new_recipient": int(new_recipient),
        "log_amount": round(math.log1p(amount), 6),
        "transaction_type": tx_type,
        "location_region": location_region(location, country_code),
        "device_status": device_bucket,
        "receiver_type": receiver_type(receiver),
    }


def matrix(rows: list[dict[str, Any]]) -> list[list[Any]]:
    return [[row[column] for column in FEATURE_COLUMNS] for row in rows]


def reason_codes(features: dict[str, Any]) -> str:
    reasons: list[str] = []
    amount = float(features["amount"])
    if amount >= 100_000:
        reasons.append("VERY_HIGH_AMOUNT")
    elif amount >= 25_000:
        reasons.append("HIGH_AMOUNT")
    elif amount >= 10_000:
        reasons.append("ELEVATED_AMOUNT")
    if features["transaction_type"] == "TRANSFER":
        reasons.append("TRANSFER")
    elif features["transaction_type"] == "CEKIM":
        reasons.append("CASH_WITHDRAWAL")
    if features["is_foreign"]:
        reasons.append("FOREIGN_LOCATION")
    if features["is_new_device"]:
        reasons.append("NEW_DEVICE")
    if features["is_new_recipient"]:
        reasons.append("NEW_RECIPIENT")
    if features["is_night"]:
        reasons.append("UNUSUAL_HOUR")
    return ",".join(reasons) or "NORMAL_PATTERN"
