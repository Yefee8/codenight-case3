# Identity Service

FraudCell müşteri/personel kimliği, oturum ve yetkilendirme kaynağıdır. Java 21 + Spring Boot
4.1 üzerinde çalışır; verisi yalnız `identity-db` PostgreSQL veritabanındadır.

## Sağlanan akışlar

- Müşteri: `POST /api/v1/auth/customers/otp/challenges`, `register`, `login`.
- Personel: `POST /api/v1/auth/staff/login`; parola Argon2id ile saklanır. Beş hatalı deneme
  hesabı 15 dakika kilitler.
- Token: RS256 access token 15 dakika, opaque refresh token 7 gün. Refresh her kullanımda
  döner; eski tokenın tekrar kullanılması tüm kullanıcı oturumlarını iptal eder.
- `GET /.well-known/jwks.json`, `POST /api/v1/auth/refresh`, `logout`, `GET /api/v1/users/me`.
- Admin: personel oluşturma/güncelleme, personel listesi ve append-only audit kayıtları.

Refresh token yalnız `HttpOnly`, `SameSite=Strict` cookie içindedir; DB'de sadece SHA-256 özeti
tutulur. Access token `sub`, `user_id`, `jti`, `session_id`, `session_epoch`, `role`, uzmanlık
ve bölge claim'lerini taşır. Admin rol/statü değişiklikleri oturumları iptal eder.

## PostgreSQL ve RLS

Flyway ayrı migration hesabıyla, uygulama ayrı `NOBYPASSRLS` runtime hesabıyla bağlanır.
`identity_users`, `otp_challenges`, `auth_sessions`, `audit_logs` ve `outbox_events`
tablolarında RLS hem `ENABLE` hem `FORCE` edilir. Her transaction başında `SET LOCAL`
karşılığı `set_config(..., true)` ile `app.actor_id` ve `app.actor_role` atanır. Audit tablosu
DB trigger'ıyla update/delete işlemlerine kapalıdır.

Kimlik değişikliği ile `staff.*`, `role.changed` ve `sessions.revoked` outbox kaydı aynı DB
transaction'ında yazılır. Publisher kalıcı RabbitMQ mesajı ve publisher confirm kullanır;
broker kapalıysa HTTP verisi kaybolmaz, outbox sonraki turda tekrar denenir.

## Demo

`DEMO_MODE=true` iken seed idempotenttir. OTP `1234` olur.

| Rol | Giriş |
|---|---|
| Müşteri | `+905551111111` / `1234` |
| Admin | `admin@fraudcell.local` / `Admin123!` |
| Supervisor | `supervisor@fraudcell.local` / `Supervisor123!` |
| Analist 1-3 | `analyst1@fraudcell.local` … / `Analyst123!` |

Üç analist `ACTIVE` durumunda ve beş fraud uzmanlığının tamamına sahiptir; böylece otomatik
atama demosu boş projection ile başlamaz.

## Doğrulama

```powershell
mvn test
```

Tam sistem için repo kökünde `.env.example` değerlerini güvenli sırlarla doldurup
`docker compose up --build` çalıştırın. Üretimde `COOKIE_SECURE=true` kullanılmalıdır.
