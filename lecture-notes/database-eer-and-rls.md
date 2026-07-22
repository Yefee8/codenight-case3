# DB, EER, Aggregate ve RLS Notları

## Kavramlar

EER entity/relationship kadar cardinality, optionality, subtype, constraint ve iş invariant'ını
gösterir. Aggregate, tek transaction'da tutarlı kalması gereken nesne kümesidir; mikroservis
sınırı aggregate'dan büyük olabilir ama başka servisin aggregate'ına SQL transaction açmaz.

Database-per-service veri teknolojisi seçiminden önce ownership kararıdır. Ayrı schema mantıksal,
ayrı server/user/network fiziksel isolation sağlar. Cross-service rapor join'i event projection
veya API composition ile çözülür.

RLS satır görünürlüğünü DB'de policy haline getirir. Table owner ve superuser varsayılan bypass,
`FORCE RLS` owner bypass'ını kapatır; superuser uygulamada hiç kullanılmamalıdır. Connection pool
nedeniyle authorization context transaction-local olmalıdır.

## FraudCell etkisi

Identity/Transaction/AI/Game dört DB'dir. UUID dış referans FK değildir. Money numeric, audit/
ledger/history append-only, state/score/rating check constraint'tir. Customer/analyst scope hem
repository hem RLS ile korunur.

## Seçenekler

- Kabul: ayrı PostgreSQL, Flyway/Alembic, runtime/migrator ayrımı, FORCE RLS.
- Red: ortak DB/schema, `ddl-auto=update`, runtime owner, yalnız UUID'ye güvenme.

Kaynak: [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html),
[ADR-0002](../docs/adr/0002-database-per-service-and-rls.md).

