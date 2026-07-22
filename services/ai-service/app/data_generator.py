from __future__ import annotations

import hashlib
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

import numpy as np
import pandas as pd

SEED = 2026
LABELS = (
    "TEMIZ",
    "HESAP_ELE_GECIRME",
    "CALINTI_KART",
    "PARA_AKLAMA",
    "SUPHELI_DAVRANIS",
)
FRAUD_LABELS = LABELS[1:]
CITIES = {
    "MARMARA": ("ISTANBUL", "BURSA", "KOCAELI"),
    "EGE": ("IZMIR", "MANISA", "AYDIN"),
    "AKDENIZ": ("ANTALYA", "ADANA", "MERSIN"),
    "IC_ANADOLU": ("ANKARA", "KONYA", "KAYSERI"),
    "KARADENIZ": ("SAMSUN", "TRABZON", "ORDU"),
    "DOGU_ANADOLU": ("ERZURUM", "MALATYA", "VAN"),
    "GUNEYDOGU_ANADOLU": ("GAZIANTEP", "DIYARBAKIR", "SANLIURFA"),
}
SCENARIOS = {
    "TEMIZ": "Müşterinin olağan davranışına uygun işlem.",
    "HESAP_ELE_GECIRME": "Yeni cihazdan olağandışı alıcıya hesap erişimi.",
    "CALINTI_KART": "Gece saatinde yeni cihaz ve yabancı ülke kart işlemi.",
    "PARA_AKLAMA": "Kısa sürede tekrarlanan yüksek tutarlı transfer.",
    "SUPHELI_DAVRANIS": "Yeni alıcıya yüksek tutarlı olağan dışı işlem.",
}


def customer_split(customer_id: str) -> str:
    bucket = int(hashlib.sha256(customer_id.encode()).hexdigest()[:8], 16) % 100
    if bucket < 70:
        return "train"
    if bucket < 85:
        return "validation"
    return "holdout"


def generate_dataset(output: Path, rows: int = 12_000, seed: int = SEED) -> pd.DataFrame:
    if rows < 10_000:
        raise ValueError("dataset must contain at least 10,000 rows")
    rng = np.random.default_rng(seed)
    fraud_count = max(250, round(rows * 0.15 / len(FRAUD_LABELS)))
    clean_count = rows - fraud_count * len(FRAUD_LABELS)
    labels = np.array(
        ["TEMIZ"] * clean_count + [label for label in FRAUD_LABELS for _ in range(fraud_count)]
    )
    rng.shuffle(labels)

    flat_cities = [(region, city) for region, cities in CITIES.items() for city in cities]
    customer_count = max(2_500, rows // 4)
    records: list[dict[str, object]] = []
    for index, label in enumerate(labels):
        customer_number = index % customer_count
        customer_id = str(uuid5(NAMESPACE_URL, f"fraudcell-customer-{seed}-{customer_number}"))
        region, city = flat_cities[rng.integers(0, len(flat_cities))]
        record = _clean_record(rng)
        if label != "TEMIZ":
            record.update(_fraud_pattern(rng, str(label)))
            if rng.random() < 0.12:
                ordinary = _clean_record(rng)
                for field in rng.choice(tuple(record), size=3, replace=False):
                    record[str(field)] = ordinary[str(field)]
        elif rng.random() < 0.07:
            suspicious = _fraud_pattern(rng, str(rng.choice(FRAUD_LABELS)))
            for field in rng.choice(tuple(record), size=4, replace=False):
                record[str(field)] = suspicious[str(field)]
        # Controlled noise keeps the benchmark realistic without destroying reproducibility.
        if rng.random() < 0.08:
            record["new_device"] = not bool(record["new_device"])
        if rng.random() < 0.04:
            record["new_recipient"] = not bool(record["new_recipient"])
        records.append(
            {
                "transaction_id": str(
                    uuid5(NAMESPACE_URL, f"fraudcell-transaction-{seed}-{index}")
                ),
                "customer_id": customer_id,
                "city": city,
                "region": region,
                **record,
                "scenario_tr": SCENARIOS[str(label)],
                "label": str(label),
                "is_fraud": int(label != "TEMIZ"),
                "split": customer_split(customer_id),
            }
        )
    frame = pd.DataFrame.from_records(records)
    output.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output, index=False, lineterminator="\n")
    return frame


def _clean_record(rng: np.random.Generator) -> dict[str, object]:
    hour = int(np.clip(rng.normal(14, 4), 0, 23))
    return {
        "country_code": "TR" if rng.random() < 0.97 else rng.choice(["DE", "NL", "GB"]),
        "transaction_type": rng.choice(["ODEME", "TRANSFER", "FATURA", "CEKIM"]),
        "amount": round(float(np.clip(rng.lognormal(7.2, 0.8), 10, 40_000)), 2),
        "hour": hour,
        "new_device": bool(rng.random() < 0.05),
        "new_recipient": bool(rng.random() < 0.10),
        "frequency_1h": int(rng.poisson(0.6)),
        "frequency_24h": int(rng.poisson(4)),
        "deviation_score": round(float(np.clip(rng.gamma(1.2, 0.5), 0, 2.8)), 4),
    }


def _fraud_pattern(rng: np.random.Generator, label: str) -> dict[str, object]:
    if label == "HESAP_ELE_GECIRME":
        return {
            "country_code": rng.choice(["DE", "NL", "GB", "US"]),
            "transaction_type": "TRANSFER",
            "amount": round(float(rng.uniform(20_000, 180_000)), 2),
            "hour": int(rng.choice([0, 1, 2, 3, 4, 5, 23])),
            "new_device": bool(rng.random() < 0.92),
            "new_recipient": bool(rng.random() < 0.85),
            "frequency_1h": int(rng.integers(3, 12)),
            "frequency_24h": int(rng.integers(8, 35)),
            "deviation_score": round(float(rng.uniform(4.5, 10)), 4),
        }
    if label == "CALINTI_KART":
        return {
            "country_code": rng.choice(["US", "GB", "FR", "IT"]),
            "transaction_type": "ODEME",
            "amount": round(float(rng.uniform(8_000, 90_000)), 2),
            "hour": int(rng.choice([0, 1, 2, 3, 4, 5, 22, 23])),
            "new_device": bool(rng.random() < 0.75),
            "new_recipient": bool(rng.random() < 0.55),
            "frequency_1h": int(rng.integers(4, 18)),
            "frequency_24h": int(rng.integers(10, 45)),
            "deviation_score": round(float(rng.uniform(3.5, 8.5)), 4),
        }
    if label == "SUPHELI_DAVRANIS":
        return {
            "country_code": "TR",
            "transaction_type": "FATURA",
            "amount": round(float(rng.uniform(70_000, 350_000)), 2),
            "hour": int(rng.integers(8, 20)),
            "new_device": bool(rng.random() < 0.30),
            "new_recipient": bool(rng.random() < 0.95),
            "frequency_1h": int(rng.integers(1, 5)),
            "frequency_24h": int(rng.integers(3, 15)),
            "deviation_score": round(float(rng.uniform(4, 9)), 4),
        }
    if label == "PARA_AKLAMA":
        return {
            "country_code": rng.choice(["TR", "DE", "NL"]),
            "transaction_type": "TRANSFER",
            "amount": round(float(rng.uniform(45_000, 250_000)), 2),
            "hour": int(rng.integers(0, 24)),
            "new_device": bool(rng.random() < 0.45),
            "new_recipient": bool(rng.random() < 0.75),
            "frequency_1h": int(rng.integers(8, 25)),
            "frequency_24h": int(rng.integers(25, 80)),
            "deviation_score": round(float(rng.uniform(3.5, 9.5)), 4),
        }
    raise ValueError(f"unknown fraud label: {label}")
