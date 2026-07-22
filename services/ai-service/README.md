# FraudCell AI Service

Bu servis gerçek, kalibre edilmiş iki model üretir ve çalıştırır: binary fraud risk modeli ile beş sınıflı fraud-type modeli. Ayrıca uygun analyst adaylarını `0.50 expertise + 0.30 availability + 0.20 performance` formülüyle sıralar. İç inference endpoint'i gateway üzerinden yayınlanmaz.

## Çalışma akışı

1. `app.cli generate`, seed `2026` ile en az 10.000 satırlık, customer bazında train/validation/holdout ayrılmış sentetik veri üretir.
2. `app.cli train`, risk modelini validation setinde sigmoid calibration ile kalibre eder; holdout metric gate'leri başarısızsa artifact üretimini reddeder.
3. Artifact SHA-256, dataset SHA-256, kod hash'i, seed ve dependency sürümleri manifestte saklanır.
4. Container başlangıcında Alembic migration'ları migration rolüyle çalışır. `ensure-model`, mevcut artifact runtime veya kodla uyumsuzsa yeniden eğitim yapar.
5. Score, prediction ve assignment recommendation aynı PostgreSQL transaction'ında iki outbox eventiyle kalıcılaştırılır.

## PostgreSQL ve RLS

AI verisi yalnız AI PostgreSQL'inde tutulur. Bütün tablolar `ENABLE ROW LEVEL SECURITY` ve `FORCE ROW LEVEL SECURITY` kullanır. Runtime rolü tablo sahibi, superuser veya `BYPASSRLS` olmamalıdır. Her DB transaction'ı `app.actor_id`, `app.actor_role` ve `app.service_name` değerlerini `set_config(..., true)` ile transaction-local kurar; context yoksa policy fail-closed davranır. Consumer/outbox yalnız HTTP tokenından üretilemeyen `SYSTEM` rolüyle çalışır.

`classification_feedback` append-only'dir. Aynı prediction için etkin gerçeklik sırası `SUPERVISOR_QA > CUSTOMER > ANALYST`, ardından aggregate version ve event zamanıdır. `/api/v1/ai/metrics` eğitim ve canlı doğruluk/false-positive değerlerini birlikte verir; kategori endpoint'i canlı veri varsa etkin feedback'i kullanır.

## RabbitMQ güvenilirliği

- Outbox publisher yalnız mandatory route ve publisher confirm sonrasında `published_at` yazar.
- Geçici yayın hataları `5s, 30s, 2m, 10m, 30m` bütçesiyle ertelenir; bütçe bitince satır `failed_at/failure_code` ile terminal olur ve operatör replay'i bekler.
- Consumer manual ACK kullanır. Retry publish, servise özel `fraudcell.ai.retry.v1` exchange'inde confirm edilmeden kaynak mesaj ACK edilmez.
- Inbox, canonical payload hash'iyle idempotency sağlar; aynı event ID farklı içerikle gelirse poison event olarak DLQ'ya ilerler.
- Staff ve case projection'larında alan-bazlı version kolonları ters sıradaki eventlerin güncel state'i geri almasını önler.

RabbitMQ veya AI consumer kesintisi request-path tahminini bozmaz; outbox PostgreSQL'de birikir. PostgreSQL veya doğrulanmış model yoksa inference `503` ile fail-closed olur.

## Yerel doğrulama

```bash
uv sync --frozen --extra dev
python -m app.cli generate --rows 12000
python -m app.cli train
pytest
ruff check app tests alembic
```

Entegrasyon ortamında runtime ve migration DB kullanıcıları ayrıdır. Secret değerleri source code'a veya image'a yazılmaz; Compose/CI secret sağlayıcısından geçirilir.
