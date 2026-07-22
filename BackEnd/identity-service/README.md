# Identity Service

Sorumluluk: kimlik doğrulama, JWT (access 15dk / refresh 7g + rotation + reuse tespiti), rol/yetki, personel hesabı oluşturma, audit log.

## Environment
- `PORT` (default 3001)
- `JWT_SECRET`
- `SERVICE_TOKEN` — servisler arası internal endpoint doğrulama
- `DB_PATH` — SQLite dosya yolu

## Seed Kullanıcılar
| Rol | E-posta / GSM | Şifre |
|---|---|---|
| ADMIN | admin@fraudcell.com | Admin!234 |
| SUPERVISOR | supervisor@fraudcell.com | Super!234 |
| ANALYST | analyst1@fraudcell.com | Analyst!234 |
| ANALYST | analyst2@fraudcell.com | Analyst!234 |
| CUSTOMER | GSM 5551112233 | OTP 1234 |

## Endpointler
- `POST /auth/register` — Müşteri kaydı (gsm + OTP=1234)
- `POST /auth/login` — `{ email, password }` veya `{ gsm, otp }`
- `POST /auth/refresh` — refresh token rotation
- `POST /auth/logout`
- `GET /users/me` — kimlik doğrulamalı
- `POST /users/staff` — sadece ADMIN, analist/supervisor oluşturur
- `GET /audit-logs` — sadece ADMIN
- `GET /internal/analysts` — internal (X-Service-Token gerekli)
- `GET /internal/users/:id` — internal (X-Service-Token gerekli)

## Güvenlik
- bcrypt hashleme
- 5 hatalı girişte 15 dk hesap kilidi
- Şifre politikası: min 8, büyük harf, rakam, özel karakter
- Refresh reuse tespit → tüm oturumlar sonlandırılır
