# AI Yaklaşımı

AI Service mock/kural sabiti değildir; repodaki deterministik sentetik veriyle eğitilen gerçek
scikit-learn pipeline'ı kullanır.

## Veri

Seed `2026`, en az 10.000 kayıt. Yaklaşık %85 `TEMIZ`; kalan dört fraud sınıfının her biri en
az 250 örnek. Feature'lar: amount/currency/type, şehir/bölge/ülke, saat/gün, device/recipient
yeniliği, 1/24 saat frekans, alışılmış tutar/konum sapması ve Türkçe senaryo açıklaması.

Split customer ID bazında %70 train, %15 validation, %15 immutable holdout'tur; müşteri
leakage'i test edilir. Dataset manifest schema/seed/satır/sınıf/hash taşır.

## Modeller

- Binary risk: preprocessing + tree ensemble + olasılık calibration.
- Type: preprocessing + beş sınıflı tree ensemble.
- Unknown kategori encoder fallback; zorunlu feature eksikliği `422`.
- Artifact yanında model version, feature schema, dataset hash, dependency sürümleri, seed ve
  metrik manifesti.

Artifact/hash/schema yüklenemezse readiness fail eder; hardcoded skor dönülmez.

## Offline kalite kapıları

| Metrik | Minimum |
|---|---:|
| ROC-AUC | 0.90 |
| Fraud recall | 0.85 |
| PR-AUC | 0.80 |
| Brier | en çok 0.15 |
| Type macro-F1 | 0.80 |
| Her fraud type recall | 0.70 |

Threshold'lar case ile sabittir: `<0.40 ONAY`; `0.40–0.90 INCELEME`; `>0.90 BLOK`. Tam
0.90 incelemedir. Risk level: `<.40 DUSUK`, `.40–<.70 ORTA`, `.70–.90 YUKSEK`, `>.90
KRITIK`.

## Açıklanabilirlik

Response model version/schema ve insan okunur sınırlı reason code listesi döner. Reason code
örnekleri `UNUSUAL_AMOUNT`, `NEW_DEVICE`, `FOREIGN_LOCATION`, `NIGHT_ACTIVITY`,
`HIGH_VELOCITY`; ham hassas feature/log veya “kesin fraud” iddiası dönmez.

## Atama

```text
score = expertise_match*0.50 + availability*0.30 + performance*0.20
availability = 1 - active_case_count/10
```

Cold-start performance 0.50. Eşitlik bölge eşleşmesi, en uzun süre atama almayan, sonra UUID.
AI en az üç aday önerir; kesin kapasite rezervasyonu Transaction DB'de yapılır.

## Online doğruluk

Original prediction immutable. İlk type override yanlış sınıflandırma; ground truth önceliği
supervisor QA > müşteri doğrulaması > geçici analyst sonucudur. Çözülmemiş/BELIRSIZ denominator'a
girmez. Risk accuracy, false-positive ve kategori accuracy ayrı snapshot olur.

