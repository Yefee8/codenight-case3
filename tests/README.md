# Test Katmanları

Her davranış aynı değişiklikte test edilir. Test dizinleri sorumluluklarına göre ayrılır:

- `contract/`: response zarfı, OpenAPI ve event producer/consumer uyumu.
- `infrastructure/`: Compose network/port ayrımı, Redis politikası, Rabbit topology/ACL.
- `security/`: RBAC, IDOR, JWT, RLS, SQLi, XSS ve secret/log sızıntısı.
- `resilience/`: AI/Rabbit/Redis/DB kesintisi, retry/DLQ ve fallback.
- `e2e/`: dört rolün gerçek Gateway üzerinden kullanıcı akışları.
- `performance/`: rate limit, kritik endpoint ve queue catch-up bütçeleri.

SQLite/H2 entegrasyon DB'si olarak kullanılmaz. DB/Rabbit/Redis davranışı gerçek container
ile Testcontainers üzerinde doğrulanır. Unit testlerde gerçek `sleep` yerine fake clock
kullanılır.

