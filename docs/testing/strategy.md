# Test Stratejisi ve Kalite Kapıları

## Test piramidi

| Katman | Amaç | Araç |
|---|---|---|
| Unit/property | State/risk/puan/assignment/idempotency sınırları | JUnit/pytest/Hypothesis/Vitest |
| Slice/component | Controller/security/repository/model pipeline | MockMvc/TestClient/MSW |
| Integration | Gerçek PostgreSQL/Rabbit/Redis migration ve failure semantics | Testcontainers |
| Contract | OpenAPI, JSON Schema, producer/consumer fixture | jsonschema/Schemathesis |
| E2E | Dört rol ve SSE | Playwright |
| Security/resilience | OWASP ve service-stop | ZAP/custom/Compose |
| Performance | p95, rate, outbox catch-up | k6 |

Her yeni davranış kodla aynı değişiklikte success + negative + sınır testini getirir. Dış
dependency success/timeout/malformed/outage ayrı testlenir. Gerçek `sleep` yok; Clock/fake timer.

## Coverage

- Backend genel line ≥85%, branch ≥80%.
- State machine/refresh/RBAC/puan/assignment branch ≥95%.
- Frontend line ≥80%, branch ≥75%.
- Değişen satır ≥90%.

Coverage tek başına yeterli değildir. Assertion'sız test, flaky retry, H2/SQLite ile PostgreSQL
semantiği taklidi kabul edilmez.

## Zorunlu sınırlar

- Score `0.3999`, `0.40`, `0.90`, `0.9001`, NaN/out-of-range.
- SLA deadline'dan bir tick önce, tam deadline, bir tick sonra.
- Capacity 9/10, 10/10, iki eşzamanlı reservation.
- Concurrent refresh, case decision, idempotency ve feedback.
- Duplicate/out-of-order/poison event ve commit/ack crash.
- RLS missing context, cross-customer, wrong analyst ve pool reuse.
- Europe/Istanbul gün/hafta/DST ve leaderboard tie.

## CI

PR: lint/type → unit/coverage → Testcontainers/migration → contracts → images → Compose/E2E →
Gitleaks/dependency/Trivy. AI değişikliğinde deterministic train/evaluate; her PR golden
inference. Main ayrıca ZAP, k6 ve service-stop drill çalıştırır.

