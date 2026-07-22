# FraudCell API Gateway

Gateway, tarayıcıya açık tek backend girişidir. Domain verisi tutmaz ve iş kuralı çalıştırmaz;
sabit route, JWT doğrulama, coarse-grained rol kontrolü, Security Redis tabanlı rate-limit ve
revocation kontrolü uygular. Identity, Transaction, AI ve Gamification servisleri JWT'yi ve
resource-level yetkiyi tekrar doğrular.

## Trafik sınırı

| Dış prefix | Hedef | Gateway politikası |
|---|---|---|
| `/api/v1/auth/**`, `/api/v1/users/**`, `/api/v1/staff/**`, `/api/v1/admin/**` | Identity | yalnız tanımlı login/register/OTP/refresh çağrıları public; admin rolü ayrıdır |
| `/api/v1/transactions/**`, `/api/v1/cases/**`, `/api/v1/dashboard/**`, `/api/v1/notifications/**` | Transaction | authenticated |
| `/api/v1/ai/model`, `/api/v1/ai/metrics/**` | AI | `SUPERVISOR` veya `ADMIN` |
| `/api/v1/game/**` | Gamification | staff rolleri |
| `/internal/**` | hiçbir hedef | her zaman route dışı `404` |

Route hedefleri sabit configuration değerleridir; client URL/host verisi upstream seçiminde
kullanılmaz. Böylece gateway açık proxy veya SSRF aracına dönüşmez.

## JWT ve session revocation

- Yalnız RS256 ve JWKS kabul edilir; issuer ve audience birebir doğrulanır.
- `sub`, `jti`, `session_id`, sayısal `session_epoch`, canonical `role`, `iat` ve `exp`
  zorunludur. Token ömrü en fazla 20 dakika, normal Identity üretimi 15 dakikadır.
- JWT geçerli olsa bile `session_epoch` ve revoked JTI Security Redis'te atomik Lua ile kontrol
  edilir. Redis timeout/kesintisinde authenticated çağrı `503 SECURITY_STATE_UNAVAILABLE` ile
  fail-closed olur.
- Identity'nin `sessions.revoked` ve `role.changed` olayları
  `fraudcell.gateway.events.v1` quorum queue'sundan alınır. Epoch yalnız artar; duplicate veya
  out-of-order event eski değeri geri yazamaz.
- Geçici Redis hatası broker-confirmed `5s → 30s → 2m → 10m → 30m` kuyruğuna taşınır. Retry
  publish doğrulanmadan kaynak mesaj ACK edilmez; bütçe bitince gateway DLQ'ya gider.

Security Redis AOF + `noeviction` kullanır ve Gamification cache Redis'inden fiziksel olarak
ayrıdır. Gateway hiçbir API response, token, profil, vaka veya işlem verisini Redis'e cache'lemez.

## Rate-limit sözleşmesi

| Akış | Boyut | Limit |
|---|---|---|
| OTP challenge | IP | 10/saat |
| OTP challenge | GSM/account | 3/5 dk |
| Login/register | IP | 20/15 dk |
| Login/register | account | 5/15 dk |
| Refresh | refresh session | 30/15 dk |
| Genel authenticated API | user | 120/dk |
| Customer transaction create | user | 10/dk |
| Admin/karar mutation | user | 30/dk |

GSM, e-posta, IP, refresh token, user id ve JTI anahtara düz yazılmaz; server-side
HMAC-SHA256 ile opaklaştırılır. Counter increment + TTL tek Lua işlemidir. Request body rate key
için okunursa aynı byte dizisi downstream'e yeniden sunulur; parola/OTP loglanmaz.

## Edge güvenliği

- Client tarafından gönderilen `Forwarded`, `X-Forwarded-*`, `X-User-*`, `X-Actor-*`,
  `X-Service-*`, internal token ve request-id header'ları kaldırılır.
- Request ID yalnız UUID ise normalize edilir, değilse gateway yeni UUID üretir.
- API cevapları `Cache-Control: no-store`; CSP, frame deny, nosniff, referrer ve permissions
  policy header'ları taşır.
- JSON request body üst sınırı 64 KiB'dir.
- Credentialed CORS yalnız `ALLOWED_ORIGINS` listesini kullanır; wildcard yoktur. Refresh/logout
  için cross-site `Origin` ve `Sec-Fetch-Site` ayrıca reddedilir. Refresh cookie production'da
  Identity tarafından `HttpOnly; Secure; SameSite=Strict` üretilmelidir.
- `/actuator/health/**` public probe'dur; Prometheus endpoint'i `ADMIN` JWT ister.

## Configuration

Zorunlu production değerleri:

```text
IDENTITY_BASE_URL, TRANSACTION_BASE_URL, AI_BASE_URL, GAMIFICATION_BASE_URL
JWT_ISSUER, JWT_AUDIENCE, JWKS_URI
GATEWAY_KEY_HMAC_SECRET (en az 32 byte)
GATEWAY_REDIS_HOST/USERNAME/PASSWORD
SPRING_RABBITMQ_HOST/USERNAME/PASSWORD
ALLOWED_ORIGINS
```

`APP_ENV=production` durumunda placeholder/zayıf Redis, RabbitMQ veya HMAC secret'ı startup'ı
durdurur. JWKS dahili ağda HTTP olabilir; dış issuer HTTPS olmalıdır. Gerçek secret değerleri
repoya veya image layer'a yazılmaz.

## Test ve çalışma

Java 21 ve Maven 3.9+ ile:

```powershell
mvn test
mvn verify
```

Testler claim sözleşmesi, header spoofing, CORS, body replay/limit, HMAC key, atomik Redis karar
eşlemesi, Redis fail-closed, revoked session, rate-limit sonrası route'un devam etmemesi,
Rabbit ACK/retry/DLQ ve `/internal/**` izolasyonunu kapsar. Gerçek Redis/Rabbit entegrasyonu root
Compose smoke aşamasında çalıştırılır; Docker bulunmayan makinede unit/in-process integration
paketi yine deterministik çalışır.
