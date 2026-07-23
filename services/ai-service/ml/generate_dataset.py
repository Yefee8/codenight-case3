import csv
import random
from pathlib import Path

SEED = 42
ROWS = 1600
OUT = Path(__file__).resolve().parents[1] / "data" / "fraud_transactions.csv"

TR_CITIES = ["Ankara, TR", "İstanbul, TR", "İzmir, TR", "Bursa, TR", "Eskişehir, TR", "Manisa, TR"]
FOREIGN_CITIES = ["Amsterdam, NL", "Berlin, DE", "Paris, FR", "London, UK", "Dubai, AE", "Tbilisi, GE"]
KNOWN_DEVICES = ["iPhone 13 bilinen cihaz", "Android bilinen cihaz", "Web güvenilir tarayıcı", "Paycell kayıtlı cihaz"]
NEW_DEVICES = ["Yeni cihaz", "Unknown Android", "Yeni web oturumu", "Bilinmeyen iPhone"]
KNOWN_RECEIVERS = ["Elektrik Fatura", "Telekom Fatura", "Market Harcama", "Okul Ödemesi", "Sigorta Fatura"]
NORMAL_RECEIVERS = ["Aile Transferi", "Kira Ödemesi", "E-Ticaret", "Restoran", "Ulaşım"]
RISK_RECEIVERS = ["Global Trade", "Kripto Exchange", "Offshore Services", "Yeni Alıcı", "New Recipient Ltd"]


def amount(rng: random.Random, low: int, high: int) -> float:
    return round(rng.uniform(low, high), 2)


def hour(rng: random.Random, night_bias: float) -> int:
    if rng.random() < night_bias:
        return rng.choice([0, 1, 2, 3, 4, 5, 23])
    return rng.randint(8, 21)


def pick(rng: random.Random, values: list[str]) -> str:
    return rng.choice(values)


def row_for(label: str, rng: random.Random) -> dict[str, object]:
    if label == "TEMIZ":
        noisy = rng.random() < 0.10
        return {
            "amount": amount(rng, 35, 8_500 if noisy else 4_500),
            "transaction_type": pick(rng, ["FATURA", "ODEME", "TRANSFER" if noisy else "FATURA"]),
            "location": pick(rng, TR_CITIES),
            "receiver": pick(rng, KNOWN_RECEIVERS if not noisy else KNOWN_RECEIVERS + NORMAL_RECEIVERS),
            "device": pick(rng, KNOWN_DEVICES),
            "country_code": "TR",
            "hour": hour(rng, 0.03 if not noisy else 0.18),
            "is_new_device": int(noisy and rng.random() < 0.08),
            "is_new_recipient": int(noisy and rng.random() < 0.12),
            "label": label,
        }
    if label == "CALINTI_KART":
        return {
            "amount": amount(rng, 7_500, 120_000),
            "transaction_type": pick(rng, ["ODEME", "CEKIM", "ODEME", "FATURA"]),
            "location": pick(rng, FOREIGN_CITIES if rng.random() < 0.62 else TR_CITIES),
            "receiver": pick(rng, NORMAL_RECEIVERS + RISK_RECEIVERS),
            "device": pick(rng, NEW_DEVICES if rng.random() < 0.72 else KNOWN_DEVICES),
            "country_code": "TR" if rng.random() < 0.35 else "",
            "hour": hour(rng, 0.58),
            "is_new_device": int(rng.random() < 0.74),
            "is_new_recipient": int(rng.random() < 0.38),
            "label": label,
        }
    if label == "HESAP_ELE_GECIRME":
        return {
            "amount": amount(rng, 3_000, 95_000),
            "transaction_type": pick(rng, ["TRANSFER", "ODEME", "TRANSFER"]),
            "location": pick(rng, FOREIGN_CITIES if rng.random() < 0.55 else TR_CITIES),
            "receiver": pick(rng, RISK_RECEIVERS + NORMAL_RECEIVERS),
            "device": pick(rng, NEW_DEVICES),
            "country_code": "TR" if rng.random() < 0.45 else "",
            "hour": hour(rng, 0.44),
            "is_new_device": int(rng.random() < 0.92),
            "is_new_recipient": int(rng.random() < 0.68),
            "label": label,
        }
    if label == "PARA_AKLAMA":
        return {
            "amount": amount(rng, 35_000, 260_000),
            "transaction_type": "TRANSFER",
            "location": pick(rng, FOREIGN_CITIES if rng.random() < 0.48 else TR_CITIES),
            "receiver": pick(rng, RISK_RECEIVERS),
            "device": pick(rng, KNOWN_DEVICES if rng.random() < 0.55 else NEW_DEVICES),
            "country_code": "TR" if rng.random() < 0.55 else "",
            "hour": hour(rng, 0.30),
            "is_new_device": int(rng.random() < 0.36),
            "is_new_recipient": int(rng.random() < 0.84),
            "label": label,
        }
    return {
        "amount": amount(rng, 6_000, 45_000),
        "transaction_type": pick(rng, ["ODEME", "TRANSFER", "CEKIM"]),
        "location": pick(rng, TR_CITIES + FOREIGN_CITIES),
        "receiver": pick(rng, NORMAL_RECEIVERS + RISK_RECEIVERS + KNOWN_RECEIVERS),
        "device": pick(rng, KNOWN_DEVICES + NEW_DEVICES),
        "country_code": "TR" if rng.random() < 0.70 else "",
        "hour": hour(rng, 0.28),
        "is_new_device": int(rng.random() < 0.42),
        "is_new_recipient": int(rng.random() < 0.40),
        "label": label,
    }


def main() -> None:
    rng = random.Random(SEED)
    labels = ["TEMIZ"] * 800 + ["CALINTI_KART"] * 200 + ["HESAP_ELE_GECIRME"] * 200 + ["PARA_AKLAMA"] * 200 + ["SUPHELI_DAVRANIS"] * 200
    rng.shuffle(labels)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(row_for("TEMIZ", rng).keys()))
        writer.writeheader()
        for label in labels[:ROWS]:
            writer.writerow(row_for(label, rng))
    print(f"wrote {ROWS} rows to {OUT}")


if __name__ == "__main__":
    main()
