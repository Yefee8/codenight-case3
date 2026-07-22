# API ve Gateway Tasarımı

Gateway tek public API girişidir; domain servisi değildir. `X-Request-ID` geçerli UUID değilse
yenisini üretir, client `X-User-*`, `Forwarded` ve güvenilmeyen proxy header'larını siler.

## Route tablosu

| Prefix | Hedef | Public istisna |
|---|---|---|
| `/api/v1/auth/**`, `/api/v1/users/**`, `/api/v1/admin/**` | Identity | login/OTP/register/refresh |
| `/api/v1/transactions/**`, `/api/v1/cases/**`, `/api/v1/dashboard/**` | Transaction | yok |
| `/api/v1/ai/model`, `/api/v1/ai/metrics/**` | AI | role-controlled |
| `/api/v1/game/**` | Gamification | yok |
| `/internal/**` | hiçbir public route | her zaman 404 |

## Response ve hata

```json
{"success":false,"data":null,"error":{"code":"CASE_INVALID_TRANSITION","message":"Geçişe izin verilmiyor."},"request_id":"uuid"}
```

`400` syntax/validation, `401` auth, `403` role, IDOR sızıntısı riskinde `404`, `409`
idempotency/version race, `422` domain state, `429` rate ve `503` güvenli dependency
kesintisidir. Auth/mutation cevapları `Cache-Control: no-store` taşır.

## JWT ve defense in depth

Gateway RS256/JWKS ile signature, sabit algorithm, `kid`, issuer, audience, expiry ve session
epoch/revocation kontrol eder. Domain servisleri bearer tokenı tekrar doğrular; Gateway'den
gelen kullanıcı header'ını authorization gerçeği kabul etmez. Internal AI çağrısı public
Gateway route'u değildir ve ayrı service token/network ile korunur.

## Rate/body/CORS

- OTP GSM 3/5 dk, IP 10/saat.
- Login/verify hesap 5/15 dk, IP 20/15 dk.
- Refresh session 30/15 dk.
- Transaction create müşteri 10/dk.
- Genel auth 120/dk; admin/decision mutation 30/dk.
- JSON body 64 KiB; analyst note 2.000 karakter.
- Origin explicit allowlist; credentialed wildcard CORS yoktur.

Rate key'inde PII düz yazılmaz. Revocation store kesilince authenticated trafik fail-closed
olur; rate limiting ile revocation aynı `noeviction` security Redis üzerinde farklı prefix'tir.

