# Database-per-Service ve EER Tasarımı

## Identity EER

```mermaid
erDiagram
  USERS ||--o| CUSTOMER_PROFILES : has
  USERS ||--o| STAFF_PROFILES : has
  USERS ||--o{ USER_ROLES : granted
  USERS ||--o{ REFRESH_SESSIONS : owns
  REFRESH_SESSIONS ||--o{ REFRESH_TOKENS : rotates
  USERS ||--o{ OTP_CHALLENGES : requests
  USERS ||--o{ AUDIT_LOGS : actor
  STAFF_PROFILES ||--o{ USER_SPECIALTIES : has
  STAFF_PROFILES ||--o{ USER_REGIONS : has
```

GSM normalized ve unique; e-posta case-insensitive unique. Refresh DB'de yalnız SHA-256
hash'tir. Audit `prev_hash/entry_hash` zinciri append-only'dir.

## Transaction EER

```mermaid
erDiagram
  TRANSACTIONS ||--o| RISK_CASES : creates
  RISK_CASES ||--o{ CASE_STATUS_HISTORY : records
  RISK_CASES ||--o{ CASE_ASSIGNMENTS : assigned
  RISK_CASES ||--o{ CASE_NOTES : contains
  RISK_CASES ||--o{ CUSTOMER_VERIFICATIONS : asks
  RISK_CASES ||--o| CASE_FEEDBACK : receives
  RISK_CASES ||--o{ GROUND_TRUTH_LABELS : evaluated
  STAFF_PROJECTION ||--|| ANALYST_WORKLOAD : capacity
  TRANSACTIONS ||--o{ IDEMPOTENCY_RECORDS : protects
```

`NUMERIC(19,2)` + ISO currency, UUIDv7 internal ID, sequence tabanlı görünür
`TRX-YYYY-NNNNNNNN`. `risk_cases.version` optimistic lock'tur. Assignment reservation
`UPDATE ... WHERE active_count < 10 RETURNING` veya row-lock ile atomiktir.

## AI EER

```mermaid
erDiagram
  MODEL_VERSIONS ||--o{ TRAINING_RUNS : produced_by
  MODEL_VERSIONS ||--o{ PREDICTIONS : scores
  PREDICTIONS ||--o{ CLASSIFICATION_FEEDBACK : evaluated
  PREDICTIONS ||--o{ ASSIGNMENT_RECOMMENDATIONS : recommends
  ANALYST_PROJECTION ||--o{ ASSIGNMENT_RECOMMENDATIONS : ranked
  MODEL_VERSIONS ||--o{ ACCURACY_SNAPSHOTS : measured
```

Prediction immutable; override/ground truth ayrı feedback kaydıdır. Model manifest dataset
hash, feature schema, dependency, seed ve metric içerir.

## Gamification EER

```mermaid
erDiagram
  ANALYST_PROFILES ||--o{ POINT_LEDGER : owns
  ANALYST_PROFILES ||--o{ EARNED_BADGES : earns
  BADGES ||--o{ EARNED_BADGES : defines
  ANALYST_PROFILES ||--o{ CASE_FACTS : projects
  ANALYST_PROFILES ||--o{ DAILY_STATS : aggregates
  ANALYST_PROFILES ||--o{ WEEKLY_STATS : aggregates
```

Ledger `(source_event_id, rule_code)` unique ve append-only'dir. Correction negatif entry
ekler; geçmiş entry güncellenmez. Gösterilen toplam `max(sum(delta),0)`. Earned badge geri
alınmaz.

## Ortak teknik tablolar

Her DB kendi `outbox_events` ve `inbox_events` tablolarına sahiptir. Cross-service FK yoktur.
Outbox `published_at`, attempt, next-attempt ve lease; inbox unique event ID, producer,
aggregate version ve processed timestamp taşır.

## Index/constraint ilkeleri

- Sorgu + RLS predicate birlikte indexlenir: örneğin `(customer_id, created_at desc)` ve
  `(assigned_analyst_id, status, due_at)`.
- Enum/check constraint geçersiz state/risk/tip/puanı DB'de de reddeder.
- Partial index aktif case/SLA/outbox kuyruklarını küçük tutar.
- UTC `timestamptz`; leaderboard gün/hafta projection'ı `Europe/Istanbul` sınırıyla üretilir.
- `created_at` immutable; audit/ledger/history hard delete yoktur.

