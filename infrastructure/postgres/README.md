# PostgreSQL ve RLS Bootstrap

FraudCell database-per-service ilkesini schema ile değil, dört ayrı PostgreSQL container,
volume, credential ve Docker network ile uygular. Bir servis diğer DB'nin DNS adına dahi
erişemez.

Her DB'de üç kimlik vardır:

1. `postgres`: yalnız ilk container bootstrap'ında kullanılan yerel superuser.
2. `*_migrator`: DB/schema sahibi, Flyway veya Alembic kullanıcısı; superuser değildir ve
   `NOBYPASSRLS` taşır.
3. `*_app`: runtime uygulama hesabı; yalnız gerekli DML/sequence/function yetkilerine
   sahiptir, `NOSUPERUSER NOBYPASSRLS` kullanır.

Uygulama runtime'da migration hesabıyla açılmamalıdır. Spring servislerinde
`SPRING_DATASOURCE_*` runtime, `SPRING_FLYWAY_*` migration hesabını; AI servisinde
`AI_DATABASE_URL` runtime, `AI_MIGRATION_DATABASE_URL` migration hesabını gösterir.

## RLS sözleşmesi

Actor'a bağlı her tablo için migration şu iki komutu birlikte içermelidir:

```sql
ALTER TABLE example ENABLE ROW LEVEL SECURITY;
ALTER TABLE example FORCE ROW LEVEL SECURITY;
```

Policy'ler `app.actor_id`, `app.actor_role`, `app.service_name` değerlerini okur. Uygulama
bu değerleri doğrulanmış JWT/service kimliğinden, DB transaction'ı başladıktan sonra
`set_config(..., true)` ile ayarlar. `true` değeri ayarı transaction-local yapar; connection
pool'a kullanıcı bağlamı sızmasını önler. Eksik/bozuk bağlam policy'de eşleşmez ve erişim
fail-closed olur.

`SYSTEM` sıradan bir kullanıcı rolü değildir. Yalnız kimliği doğrulanmış scheduler/outbox
işleri açık sistem context'iyle kullanır. Hiçbir uygulama hesabına `BYPASSRLS` verilmez.

## Tehdit kontrolleri

- UUID tek başına yetkilendirme değildir; repository predicate'i ve RLS birlikte uygulanır.
- Table owner normalde RLS'yi aşabilir; bu nedenle `FORCE ROW LEVEL SECURITY` zorunludur.
- Superuser her zaman RLS'yi aşabilir; uygulama hiçbir zaman superuser credential bilmez.
- `SET` session-wide kullanılmaz; pooled connection sızıntısı yaratabilir.
- Outbox/inbox policy'leri kullanıcı PII okumasına izin vermez; yalnız gerekli insert ve
  açık `SYSTEM` publish/consume erişimi tanımlar.

