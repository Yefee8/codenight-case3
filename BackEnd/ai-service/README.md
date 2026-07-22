# AI Service

Sorumluluk: risk skorlama, dolandırıcılık türü sınıflandırma, akıllı analist ataması, doğruluk metriği.

## Yaklaşım
Kural tabanlı (rule-based) hibrit puanlama:
- Tutar sapması (müşteri ortalamasına göre)
- Gece işlemi (00-05 UTC)
- Şehir riski (bilinen risk listesi, müşteri ana şehri sapması)
- Bilinmeyen cihaz / TOR / UNKNOWN
- İşlem tipi (TRANSFER/ÇEKİM daha riskli)
- Alıcı pattern (IBAN dışı)

Her özellik ağırlıklı puana katkı sağlar → toplam [0,1] arası risk skoruna dönüşür.
Karar: `<0.4 ONAY`, `0.4–0.9 INCELEME`, `>0.9 BLOK`.
Fraud türü, en yüksek katkı sağlayan feature'dan türetilir.

## Environment
- `PORT` (3003)
- `SERVICE_TOKEN`
- `IDENTITY_URL`
- `DB_PATH`

## Endpointler (internal — X-Service-Token gerekli)
- `POST /score` — `{ transaction_id, amount, type, city, device, receiver, timestamp, customer_history }`
- `POST /assign` — `{ case_id, fraud_type }` → analist skorla
- `POST /decisions` — analist karar verdi, aktif vaka sayısını düş, performans güncelle
- `POST /feedback` — analist türü değiştirdi (doğruluk feedback)

## Public
- `GET /accuracy` — genel + kategori bazlı doğruluk
- `GET /health`
