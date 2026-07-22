# FraudCell Backend

Turkcell CodeNight 2026 finali için minimal-fakat-tam-kurallara-uygun mikroservis backend.

## Mimari
```
                Frontend
                    │
              [API GATEWAY :8080]
                    │
   ┌──────────┬──────┴─────┬──────────────┐
Identity   Transaction     AI       Gamification
 :3001       :3002        :3003        :3004
  DB1         DB2          DB3          DB4
```

- **Identity** — kayıt/giriş, JWT (access 15dk, refresh 7g + rotation + reuse tespiti), rol, audit log.
- **Transaction** — işlem, vaka state machine, SLA, müşteri doğrulama & geri bildirim, dashboard.
- **AI** — kural tabanlı risk skorlama + tür sınıflandırma + akıllı analist atama + doğruluk metriği.
- **Gamification** — puan/rozet/seviye/liderlik + event tabanlı REST webhooks.
- **Gateway** — reverse proxy, JWT verify, rate limit, güvenlik başlıkları, CORS.

Her servis **kendi SQLite dosyasında** DB tutar (database-per-service). Ortak DB yoktur, servisler yalnızca HTTP üzerinden konuşur.

## Ayağa Kaldırma
```
cd BackEnd
docker compose up --build
```

Gateway: http://localhost:8080

Sağlık kontrolü:
```
curl http://localhost:8080/health
curl http://localhost:8080/api/v1/game/badges
```

## Seed Kullanıcılar
| Rol | Kimlik | Şifre / OTP |
|---|---|---|
| ADMIN | admin@fraudcell.com | Admin!234 |
| SUPERVISOR | supervisor@fraudcell.com | Super!234 |
| ANALYST | analyst1@fraudcell.com | Analyst!234 |
| ANALYST | analyst2@fraudcell.com | Analyst!234 |
| CUSTOMER | GSM 5551112233 | OTP 1234 |

## Uçtan Uca Örnek
```bash
# Müşteri girişi
CUST=$(curl -s -X POST localhost:8080/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"gsm":"5551112233","otp":"1234"}' | jq -r .data.access_token)

# Yüksek riskli işlem (gece + tanımadık şehir + yüksek tutar)
curl -X POST localhost:8080/api/v1/transactions \
  -H "Authorization: Bearer $CUST" -H 'content-type: application/json' \
  -d '{"amount":30000,"type":"TRANSFER","receiver":"12345","city":"LAGOS","device":"UNKNOWN"}'

# Analist girişi + atanan vakaları listeleme
ANA=$(curl -s -X POST localhost:8080/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"analyst1@fraudcell.com","password":"Analyst!234"}' | jq -r .data.access_token)
curl -H "Authorization: Bearer $ANA" localhost:8080/api/v1/cases
```

## AI Bağımsızlığı Testi
```
docker compose stop ai
# İşlem oluşturmaya devam edin — risk_level: BELIRSIZ olarak kaydedilir.
docker compose start ai
```

## Güvenlik Notları (case §10 saldırı senaryoları)
| Saldırı | Savunma |
|---|---|
| SQL injection | better-sqlite3 prepared statements — string interpolation yok |
| Yetkisiz endpoint | Gateway JWT + servis içinde RBAC ikinci kontrol |
| IDOR | `customer_id === user.sub` / `assigned_to === user.sub` |
| Token manip. | `jwt.verify` her istekte, kısa TTL (15 dk) |
| Refresh reuse | Tespit → **kullanıcının tüm oturumları** revoke |
| XSS | Sanitize: HTML tag strip, `javascript:` filtre, event handler kaldırma, control char strip; notlar `sanitize()` üzerinden geçer |
| Brute force | Hesap kilidi (5 hata / 15 dk) + gateway rate limit (auth 60/dk, global 300/dk) |
| Input hardening | JSON body limit (32-64 KB), Content-Type enforcement (415), GSM/email format kontrolü, fraud_type enum whitelist, max length |
| Header hardening | CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy — **her serviste + gateway'de** |
| Correlation ID | Her istekte `X-Correlation-Id` üretilir, upstream'e propagate edilir, response'da döner |
| Service-to-service | Internal endpointler `X-Service-Token` ile korunur, gateway `/api/v1/ai/score|assign|feedback|decisions` dışarıya 403 |

## Dokümantasyon
- Her servis kendi README'sini içerir
- Event akışları: [EVENTS.md](./EVENTS.md)
- Swagger/OpenAPI: `http://localhost:8080/api/v1/transactions/docs`, `http://localhost:8080/api/v1/ai/docs`

## Test
Docker compose ayakta iken host'ta:
```bash
node --test --test-reporter=spec tests/e2e.test.js
```
18 integration test: auth flow, transaction+AI, state machine, IDOR, SQLi, XSS, RBAC, idempotency, content-type, AI unavailability, rate limit, swagger.

## CI
`.github/workflows/ci.yml`: build compose stack, run E2E tests, gitleaks secret scan, npm audit (per service).
