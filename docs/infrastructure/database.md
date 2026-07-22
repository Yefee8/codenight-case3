# PostgreSQL Mühendislik Tasarımı

## Neden dört PostgreSQL?

Database-per-service yalnız tablo prefix'i değildir. Ayrı process/volume/user/network,
ownership ve bağımsız migration/backup/restore sağlar. Bir servis diğerinin tutarlılık sınırına
SQL join veya transaction açamaz.

## Hesaplar ve migration

Bootstrap superuser yalnız ilk volume oluşturma anında app DB, migration ve runtime rolünü
yaratır. Application container superuser secret almaz. Flyway/Alembic yalnız migration rolü,
normal connection pool yalnız runtime rolü kullanır.

Migration ilkeleri:

- İleri yönlü, versioned, immutable dosya; production'da elle DDL yok.
- `ddl-auto=validate`, `update/create` yok.
- Expand → backfill → switch → contract; rolling deployment uyumu.
- Actor tablosu aynı migration'da RLS enable/force/policy alır; korumasız ara release yok.
- Constraint/index mümkünse online/non-blocking rollout planıyla.
- Migration tekrar boot'ta no-op; yanlış DB credential fail eder.

## Veri tipleri

- Para `NUMERIC(19,2)` + ISO-4217 `CHAR(3)`; float yok.
- Zaman `timestamptz` UTC; display/grouping Europe/Istanbul.
- Internal UUIDv7; görünen numara sequence ile `TRX-YYYY-NNNNNNNN`.
- Enum/check ile durum, risk, tür, score aralığı, rating ve pozitif amount.
- JSONB yalnız gerçekten esnek metadata; core sorgu alanları typed column.

## Concurrency

- Refresh rotation ve kritik assignment row lock.
- Case `@Version`/version ile lost update `409`.
- Workload reservation `active_count < 10` predicate'iyle atomik.
- SLA/outbox worker `FOR UPDATE SKIP LOCKED`, lease timeout ve idempotency.
- Idempotency key actor+endpoint scope ve canonical payload hash ile unique.

## RLS ve index

Policy predicate'leri access path'e dahil edilir. Customer sorgusu `(customer_id, created_at)`,
analyst sorgusu `(assigned_analyst_id,status,due_at)` index'iyle policy yüzünden full scan
oluşturmaz. `EXPLAIN` PII içermeyen seed üzerinde performans testidir.

## Backup/restore

Her DB ayrı backup/retention/RPO sahibidir. Restore drill yeni izole instance'a yapılır; service
migration checksum ve RLS role/policy denetlenir. Cross-service point-in-time uyumu event
offset/inbox/outbox reconciliation ile sağlanır, dağıtık transaction varsayılmaz.

