# FraudCell Event Sözleşmesi

Kanonik machine-readable katalog:
[`contracts/events/v1/catalog.json`](contracts/events/v1/catalog.json). Envelope şeması:
[`event-envelope.schema.json`](contracts/events/v1/event-envelope.schema.json).

## Envelope v1

```json
{
  "event_id": "019b2c83-7321-7ad4-9e3c-9ef7dc1d57c3",
  "event_type": "case.decision-recorded",
  "event_version": 1,
  "producer": "transaction-service",
  "occurred_at": "2026-07-22T09:30:00Z",
  "aggregate_id": "019b2c83-8432-7f13-b402-f7764ae17f48",
  "aggregate_version": 4,
  "correlation_id": "019b2c83-8c3b-7136-94d8-36e182393cc8",
  "causation_id": "019b2c83-912c-705e-af85-105750158655",
  "payload": {}
}
```

Kurallar:

- UTC ISO-8601, UUID ve integer aggregate version zorunludur.
- `event_id` global tekildir; consumer `inbox_events(event_id)` ile dedup yapar.
- `correlation_id` ilk HTTP isteğini, `causation_id` tetikleyen event/command'i izler.
- PII yalnız downstream iş kuralı için minimum gerekliyse payload'a girer; token, OTP,
  parola/hash, müşteri notu veya tam ödeme verisi event'e girmez.
- Event immutable'dır. Anlam değiştirme yeni `event_version` gerektirir.

## Güvenilirlik

1. Domain değişikliği ve outbox kaydı aynı DB transaction'ında commit edilir.
2. Publisher persistent mesaj, publisher confirm ve `mandatory` kullanır.
3. Consumer etkisi ve inbox kaydı aynı DB transaction'ında commit edilir.
4. Ack yalnız commit'ten sonra verilir.
5. Retry `5s, 30s, 2m, 10m, 30m`; ardından DLQ.
6. `aggregate_version` eski event'in yeni projection'ı geri almasını engeller.
7. Replay yeni event üretmez; orijinal `event_id` korunur ve tekrar dedup edilir.

Broker kapalıyken HTTP/domain transaction başarısız sayılmaz; outbox birikir. Outbox yaşı
alarm metriğidir.

## Event kataloğu

| Event | Producer | Ana tüketici/etki |
|---|---|---|
| `staff.created` | Identity | Transaction/AI/Game analyst projection |
| `staff.profile-updated` | Identity | Uzmanlık, bölge ve atama projection'ı |
| `staff.status-changed` | Identity | Yeni atamaya uygunluk |
| `role.changed` | Identity | Projection + tüm session revoke |
| `sessions.revoked` | Identity | Gateway security Redis projection |
| `transaction.created` | Transaction | Audit/analytics |
| `transaction.risk-assessed` | Transaction | Dashboard/read model |
| `transaction.analysis-unavailable` | Transaction | Manual queue + operasyon alarmı |
| `case.created` | Transaction | AI accuracy/Game case fact |
| `case.assigned` | Transaction | Workload/read model |
| `case.status-changed` | Transaction | Timeline/read model |
| `case.customer-verification-requested` | Transaction | In-app customer notification |
| `case.customer-verification-responded` | Transaction | Case/accuracy/game fact |
| `case.fraud-type-overridden` | Transaction | AI yanlış sınıflandırma |
| `case.risk-level-overridden` | Transaction | Audit/dashboard; raw score değişmez |
| `case.decision-recorded` | Transaction | Game point/rozet ve AI evaluation |
| `case.sla-breached` | Transaction | Game −5, supervisor alarmı |
| `case.closed` | Transaction | Feedback eligibility/read model |
| `case.feedback-submitted` | Transaction | Analyst profile aggregate |
| `case.ground-truth-set` | Transaction | AI accuracy + false-block correction |
| `ai.prediction-created` | AI | Transaction late re-score/read model |
| `ai.classification-evaluated` | AI | Model/kategori accuracy snapshot |
| `ai.model-activated` | AI | Audit/observability |
| `ai.assignment-recommended` | AI | Transaction kapasite rezervasyonu |
| `points.changed` | Gamification | SSE/profile/leaderboard invalidation |
| `badge.earned` | Gamification | SSE toast; badge geri alınmaz |
| `level.changed` | Gamification | SSE/profile |
| `audit.record-requested` | Her servis | İlgili servis audit zinciri |

Zorunlu payload alanları katalog JSON'unda test edilir. Event örneği
[`fixtures/valid/case-decision-recorded.json`](contracts/events/v1/fixtures/valid/case-decision-recorded.json)
altındadır.

## Retry/DLQ operasyonu

DLQ mesajı düzeltilmeden replay edilmez. Operatör sırası:

1. `event_id`, type, producer, correlation ve son hata incelenir.
2. Consumer bug/eksik projection düzeltilir ve test eklenir.
3. Aynı payload/schema doğrulanır; PII/secret kontrol edilir.
4. Orijinal event aynı `event_id` ile ilgili servis retry exchange'ine yayınlanır.
5. Inbox/iş etkisinin tek kaldığı ve DLQ sayısının düştüğü doğrulanır.

Mesaj silerek “temizleme” kabul edilmez; olay kaybı audit edilir.

