# FraudCell AI Model

AI Service artık normal çalışmada kural bazlı skor yerine repoda eğitilmiş bir scikit-learn model artifact'i kullanır. Eski kural motoru yalnız model dosyası bulunamazsa veya load edilemezse güvenli fallback olarak çalışır.

## Dataset

Dataset dosyası:

```text
services/ai-service/data/fraud_transactions.csv
```

Üretim scripti:

```bash
cd services/ai-service
python ml/generate_dataset.py
```

Dataset deterministic seed `42` ile üretilir ve **1600 transaction** içerir. Label dağılımı:

| Label | Satır |
|---|---:|
| `TEMIZ` | 800 |
| `CALINTI_KART` | 200 |
| `HESAP_ELE_GECIRME` | 200 |
| `PARA_AKLAMA` | 200 |
| `SUPHELI_DAVRANIS` | 200 |

Kullanılan raw alanlar mevcut AI DTO'suyla uyumludur:

- `amount`
- `transaction_type`
- `location`
- `receiver`
- `device`
- `country_code`
- `hour`
- `is_new_device`
- `is_new_recipient`

API contract'a yeni zorunlu input eklenmedi.

## Label Mantığı

Sentetik veri Türk fintech fraud davranışlarını temsil eder:

- `TEMIZ`: düzenli fatura/ödeme, bilinen cihaz, TR lokasyonu, normal saat ve düşük/olağan tutar.
- `CALINTI_KART`: bilinmeyen cihaz, gece, yüksek ödeme/çekim, yabancı veya alışılmadık lokasyon.
- `HESAP_ELE_GECIRME`: yeni cihaz, yeni alıcı, ani lokasyon değişimi ve normalden farklı transfer/ödeme davranışı.
- `PARA_AKLAMA`: yüksek tutarlı transfer, riskli/yeni alıcı, parçalı transfer davranışını temsil eden transfer ağırlığı.
- `SUPHELI_DAVRANIS`: kesin fraud olmayan ama normalden sapan orta riskli kombinasyonlar.

Her sınıfta kontrollü randomness/noise vardır; model tek bir if/else kuralını ezberlemez.

## Feature Engineering

`ml/features.py` raw DTO alanlarından şu model feature'larını üretir:

| Feature | Tip |
|---|---|
| `amount` | numeric |
| `hour` | numeric |
| `is_night` | numeric |
| `is_foreign` | numeric |
| `is_new_device` | numeric |
| `is_new_recipient` | numeric |
| `log_amount` | numeric |
| `transaction_type` | categorical |
| `location_region` | categorical |
| `device_status` | categorical |
| `receiver_type` | categorical |

## Training

Training script:

```bash
cd services/ai-service
python ml/train_model.py
```

Docker ile container ortamında tekrar üretmek:

```bash
docker compose build ai-service
docker compose run --rm --no-deps -v "$PWD/services/ai-service:/app" ai-service python ml/train_model.py
docker compose build ai-service
```

Pipeline:

```text
ColumnTransformer(
  categorical -> OneHotEncoder(handle_unknown="ignore")
  numeric -> passthrough
)
RandomForestClassifier(
  n_estimators=240,
  class_weight="balanced",
  random_state=42,
  min_samples_leaf=2
)
```

Split:

- Train/test: `80/20`
- `stratify=y`
- `random_state=42`

Artifact:

```text
services/ai-service/ml/fraud_model.joblib
```

Metrics:

```text
services/ai-service/ml/training_metrics.json
```

## Gerçek Test Metrikleri

Son training koşumu:

| Metrik | Değer |
|---|---:|
| Dataset rows | 1600 |
| Train rows | 1280 |
| Test rows | 320 |
| Accuracy | 0.903125 |
| Macro precision | 0.849576 |
| Macro recall | 0.84875 |
| Macro F1 | 0.845107 |

Confusion matrix label sırası:

```text
TEMIZ, CALINTI_KART, HESAP_ELE_GECIRME, PARA_AKLAMA, SUPHELI_DAVRANIS
```

```json
[
  [159, 0, 0, 0, 1],
  [0, 36, 1, 0, 3],
  [0, 9, 24, 1, 6],
  [0, 0, 2, 37, 1],
  [0, 3, 4, 0, 33]
]
```

Classification report:

```text
                   precision    recall  f1-score   support

            TEMIZ       1.00      0.99      1.00       160
     CALINTI_KART       0.75      0.90      0.82        40
HESAP_ELE_GECIRME       0.77      0.60      0.68        40
      PARA_AKLAMA       0.97      0.93      0.95        40
 SUPHELI_DAVRANIS       0.75      0.82      0.79        40

         accuracy                           0.90       320
        macro avg       0.85      0.85      0.85       320
     weighted avg       0.91      0.90      0.90       320
```

## Inference

AI Service startup sırasında `ml/fraud_model.joblib` dosyasını bir kez load eder. Her request'te model yeniden yüklenmez ve yeniden train edilmez.

Inference akışı:

```text
ScoreRequest
 -> features_from_request
 -> pipeline.predict_proba
 -> risk_score = 1 - P(TEMIZ)
 -> fraud_type
 -> decision threshold
 -> ScoreResponse
```

Fraud type:

- `risk_score < 0.40` ise `TEMIZ`
- Aksi halde `TEMIZ` dışındaki sınıflardan probability'si en yüksek olan fraud label

Decision threshold:

- `risk_score < 0.40` -> `ONAY`
- `0.40 <= risk_score <= 0.90` -> `INCELEME`
- `risk_score > 0.90` -> `BLOK`

Response mevcut alanları korur ve geriye uyumlu iki alan ekler:

```json
{
  "risk_score": 0.97,
  "fraud_type": "PARA_AKLAMA",
  "decision": "BLOK",
  "recommended_decision": "BLOK",
  "reason": "VERY_HIGH_AMOUNT,TRANSFER,FOREIGN_LOCATION,NEW_DEVICE",
  "model_version": "fraudcell-rf-v1",
  "prediction_engine": "ML_MODEL"
}
```

Model load edilemezse:

- Service crash olmaz.
- `prediction_engine=RULE_BASED_FALLBACK` loglanır.
- Eski rule-based scoring çalışır.

Normal demo log örneği:

```text
prediction_engine=ML_MODEL model_version=fraudcell-rf-v1 risk_score=0.98 fraud_type=PARA_AKLAMA
```

## Limitasyonlar

- Dataset sentetiktir; gerçek müşteri geçmişi veya chargeback ground-truth içermez.
- `HESAP_ELE_GECIRME` ile `SUPHELI_DAVRANIS` bazı edge case'lerde karışabilir.
- Online model drift, retraining scheduler ve model registry yoktur.
- Bu implementasyon demo/stabilite için tek artifact ve deterministic training akışı kullanır.

## Test

```bash
docker compose run --rm --no-deps ai-service python -m unittest discover -s . -p 'test_*.py'
```

## Compose

```bash
docker compose up --build
```
