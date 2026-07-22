# PostgreSQL Row-Level Security (RLS) Sözleşmesi

RLS, controller/repository authorization'ın yerine geçmez; olası IDOR veya sorgu hatasında
veri satırının DB'den çıkmasını engelleyen son katmandır.

Resmi davranış: [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
ve [CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html).

## Zorunlu invariant'lar

1. Actor/resource verisi taşıyan her tabloda `ENABLE ROW LEVEL SECURITY` ve `FORCE ROW
   LEVEL SECURITY` birlikte bulunur.
2. Runtime rol `NOSUPERUSER NOBYPASSRLS` olur ve hiçbir owner/migration rolüne inherit etmez.
3. Runtime datasource ile Flyway/Alembic datasource farklı credential kullanır.
4. Context yalnız doğrulanmış JWT veya internal service credential'dan türetilir; client
   header/body içindeki actor ID doğrudan kullanılmaz.
5. Context her DB transaction'ın başında, sorgudan önce transaction-local kurulur.
6. Eksik/bozuk/bilinmeyen context hiçbir policy ile eşleşmez: default deny.

## Transaction-local context

```sql
SELECT set_config('app.actor_id', :verified_actor_id, true);
SELECT set_config('app.actor_role', :canonical_role, true);
SELECT set_config('app.service_name', :service_name, true);
SELECT set_config('app.request_id', :request_id, true);
```

Üçüncü argüman `true`, ayarı transaction'a sınırlar. Pooled connection üzerinde session-wide
`SET app.actor_id=...` kullanmak kritik cross-user veri sızıntısıdır. Transaction bittikten
sonra context otomatik kaybolur. Uygulama transaction açmadan repository çağırmamalıdır.

## Policy modeli

```sql
ALTER TABLE risk_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_cases FORCE ROW LEVEL SECURITY;

CREATE POLICY risk_case_read ON risk_cases FOR SELECT USING (
  (current_setting('app.actor_role', true) = 'CUSTOMER'
    AND customer_id = nullif(current_setting('app.actor_id', true), '')::uuid)
  OR
  (current_setting('app.actor_role', true) = 'ANALYST'
    AND assigned_analyst_id = nullif(current_setting('app.actor_id', true), '')::uuid)
  OR current_setting('app.actor_role', true) IN ('SUPERVISOR', 'ADMIN', 'SYSTEM')
);
```

Write policy ayrıca `WITH CHECK` kullanır. Örneğin müşteri `customer_id` değerini body'den
seçemez; insert satırındaki sahip doğrulanmış actor ile eşleşir.

## Rol davranışı

| Rol | RLS kapsamı |
|---|---|
| CUSTOMER | Yalnız kendi transaction/case/verification/feedback satırı |
| ANALYST | Yalnız aktif/geçmiş ataması olan case ve izinli alt kayıt |
| SUPERVISOR | Context DB'sindeki tüm operasyon kayıtları; mutation domain rule'a bağlı |
| ADMIN | Gereksinime göre read-only; case kararı policy/service ile reddedilir |
| SYSTEM | Açık scheduler/outbox/inbox/re-score işi; HTTP kullanıcı tokenından üretilemez |

RLS satır görünürlüğünü çözer, state machine yetkisini değil. Supervisor'ın satırı görmesi
her transition'ı yapabileceği anlamına gelmez.

## Teknik tablo policy'leri

- Outbox: domain actor aynı transaction'da `INSERT`; yalnız `SYSTEM` publish/lease/update.
- Inbox: yalnız authenticated consumer `SYSTEM` insert/read; kullanıcı API'sine görünmez.
- Idempotency: actor kendi key/hash/response kaydını görebilir; başka actor erişemez.
- Audit/ledger/history: izinli insert; update/delete için hiçbir runtime policy yoktur.
- Public model/rozet tanım tabloları: explicit read policy; default açık bırakılmaz.

## Test matrisi

Her servis gerçek PostgreSQL Testcontainer üzerinde şunları kanıtlar:

- Context yokken zero row ve insert/update reddi.
- Customer A, Customer B satırını ID bilse dahi göremez.
- Analyst yalnız atanan case'i görür.
- Supervisor read, Admin read-only, SYSTEM job davranışı.
- `FORCE` nedeniyle table owner ile test bağlantısı da policy'ye uyar (superuser hariç).
- Transaction rollback/commit sonrası connection başka actor'a verildiğinde context sızmaz.
- Runtime rolde `rolsuper=false`, `rolbypassrls=false` ve table ownership yoktur.

Migration lint tek başına yeterli değildir; runtime test policy sonucunu doğrular.

