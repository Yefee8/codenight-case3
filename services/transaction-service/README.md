# Transaction Service

FraudCell işlem ve risk-vaka yaşam döngüsünün tek sahibidir. Kendi PostgreSQL'i dışında
hiçbir veritabanına erişmez. İşlem oluştururken AI Service'i kısa timeout ile çağırır;
AI kapalı veya cevabı bozuksa işlem yine `201` ile kaydedilir, vaka `BELIRSIZ / INCELEME`
olarak `AI_UNAVAILABLE` manuel kuyruğuna düşer. Uydurma fallback skoru üretilmez.

## Zorunlu kurallar

- İşlem tipleri: `ODEME`, `TRANSFER`, `FATURA`, `CEKIM`; numara `TRX-YIL-NNNNNNNN`.
- Fraud türleri: `CALINTI_KART`, `HESAP_ELE_GECIRME`, `PARA_AKLAMA`,
  `SUPHELI_DAVRANIS`, `TEMIZ`; AI yokken `BELIRSIZ`.
- Durumlar: `YENI → ATANDI → INCELENIYOR → MUSTERI_DOGRULAMA → INCELENIYOR`
  ve incelemeden `ONAYLANDI/BLOKLANDI`; onaylanan vaka 48 saat sonra `KAPANDI`.
- SLA: kritik 15 dakika, yüksek 1 saat, orta 4 saat, düşük 24 saat.
- Otomatik atama AI sırasını kullanır ve analist kapasitesini atomik olarak `10` altında
  rezerve eder; kapasite yoksa manuel kuyruk korunur.
- Kapanan vakaya müşteri geri bildirimi `1-5` ve yalnız bir kez verilir.

## API

- `POST/GET /api/v1/transactions`, `GET /api/v1/transactions/{id}`
- `GET /api/v1/cases`, `GET /api/v1/cases/{id}`
- `POST /api/v1/cases/{id}/actions/start-review`
- `POST /api/v1/cases/{id}/actions/request-customer-verification`
- `POST /api/v1/cases/{id}/customer-verification`, `/decision`, `/assignments`, `/feedback`, `/ground-truth`
- `PATCH /api/v1/cases/{id}/fraud-type`, `/risk-level`
- `GET /api/v1/dashboard/operations`, `GET /api/v1/notifications/stream`
- OpenAPI: `/openapi.json`, Swagger UI: `/swagger-ui.html`

JSON yanıtları `success/data/error/request_id` zarfındadır. Customer yalnız kendi,
analist yalnız atanan, supervisor/admin ise rol matrisindeki operasyon verilerini görür.

## Veri, RLS, RabbitMQ

Flyway ayrı migration hesabıyla çalışır; runtime hesabı `NOSUPERUSER NOBYPASSRLS` olmalı
ve tablo sahibi olmamalıdır. Actor verisi olan her tabloda `ENABLE` ve `FORCE ROW LEVEL
SECURITY` vardır. JWT'den türetilen `app.actor_id/app.actor_role` her DB transaction'ında
`set_config(..., true)` ile kurulur. History, note ve feedback append-only'dir.

Identity'nin `staff.*` olayları inbox ile deduplicate edilerek yerel aday projection'ına
alınır. Transaction/case olayları aynı domain transaction'ında outbox'a yazılır; publisher
mandatory routing + broker confirm sonrasında işaretler. Retry bütçesi `5s/30s/2m/10m/30m`.

## Environment

`SPRING_DATASOURCE_*`, `SPRING_FLYWAY_*`, `SPRING_RABBITMQ_*`, `JWT_ISSUER`,
`JWT_AUDIENCE`, `JWKS_URI`, `AI_BASE_URL`, `AI_INTERNAL_TOKEN`, `SERVER_PORT`.

Doğrulama: `mvn test`. Kökten çalışma: `docker compose up --build`.
