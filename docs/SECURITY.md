# FraudCell güvenlik kontrolleri

Bu belge yalnız çalışan kodda bulunan kontrolleri ve bilinen sınırları listeler.

## Uygulanan kontroller

### Parola ve login

- Parolalar Python `bcrypt` ile salt'lı hash olarak saklanır; düz parola DB veya response'a yazılmaz.
- Login hem kullanıcı adı hem normalize edilmiş GSM kabul eder.
- Bir hesapta 5 ardışık hatalı parola 15 dakikalık DB tabanlı kilit oluşturur.
- Başarılı giriş sayacı ve kilidi sıfırlar.
- Bilinmeyen kullanıcı ve yanlış parola aynı genel `401` mesajını alır.
- Başarılı, başarısız, kilitli login; hesap kilitleme ve logout audit tablosuna yazılır.
- BFF hafif per-IP/identifier rate limit uygular; kalıcı lockout Identity DB'dedir.

### Token ve browser session

- Identity access JWT süresi 15 dakika, refresh JWT süresi 7 gündür.
- Decode işlemi sabit `HS256` algoritma allowlist'i kullanır; token içindeki key/alg seçimine güvenmez.
- Refresh token `jti` kaydı Identity DB'de tutulur, her refresh işleminde eski kayıt revoke edilip yeni token üretilir.
- Logout, Identity erişilebilir ve refresh geçerliyken refresh kaydını revoke eder; BFF her durumda yerel cookie'leri siler.
- Next.js BFF access/refresh JWT'lerini response JSON'una veya React state'ine koymaz.
- `fraudcell_access`, `fraudcell_refresh` ve imzalı `fraudcell_session` cookie'leri `HttpOnly`dir.
- Refresh cookie `SameSite=Strict` ve yalnız `/api/v1/auth` path'ine bağlıdır.
- Session/access cookie `SameSite=Lax`tir; tümü production TLS ortamında `COOKIE_SECURE=true` ile Secure olur.
- Access süresi dolunca protected page yönlendirmesi veya browser'ın ilk `401` cevabı refresh rotation yapar; eşzamanlı client istekleri tek refresh promise'ini paylaşır.
- BFF session payload'ı HMAC-SHA256 ile imzalanır ve `timingSafeEqual` ile doğrulanır.
- Proxy erken anonim redirect yapar; kesin rol kontrolü ayrıca her protected page ve BFF Route Handler başında çalışır.

### BFF sınırı

- Browser mikroservis hostname'lerini veya tokenları bilmez; yalnız aynı-origin Next.js endpointlerini çağırır.
- Mutation body'leri BFF'de runtime kontrolünden geçer.
- `customer_id`, `analyst_id` ve `analyst_name` browser body’sinden değil imzalı session'dan eklenir.
- Analyst yalnız kendisine atanmış case'i BFF üzerinden okuyabilir/karara götürebilir.
- Customer işlem/feedback; Supervisor atama/risk override; Analyst inceleme/karar; Supervisor/Admin metrik ve Analyst/Supervisor/Admin read allowlist'leri vardır. Admin case ekranı salt okunurdur.
- Backend hataları normalize edilir; bağlantı/parse detayları browser'a sızdırılmaz.
- Backend fetch çağrıları 5 saniye timeout ve `cache: no-store` kullanır.

### Veri ve mesajlaşma

- SQLAlchemy bind parametreleri kullanır; raw kullanıcı girdili SQL yoktur.
- Transaction PostgreSQL `transactions` ve `risk_cases` tablolarında `ENABLE/FORCE ROW LEVEL SECURITY` aktiftir; her istek `app.user_id` ve `app.role` session değişkenlerini set eder.
- Pydantic request modelleri amount, string uzunluğu ve enum kontrolleri yapar; AI skor isteğinde NaN/Infinity ayrıca reddedilir.
- Her mikroservisin PostgreSQL database'i ayrı container ve volume'dadır; çapraz DB bağlantısı yoktur.
- State geçişleri tek `ALLOWED_TRANSITIONS` haritasından doğrulanır.
- Blok kararı boş notla kabul edilmez.
- RabbitMQ mesajı persistent (`delivery_mode=2`), exchange ve queue durable'dır.
- Gamification ledger `event_id` primary key'iyle duplicate teslimatı idempotent işler.
- Nginx istek body limitini 64 KiB ile sınırlar.

## Secret ve production ayarları

Compose varsayılanları yalnız demo içindir. En az şu değerleri dışarıdan verin:

```bash
export JWT_SECRET="$(openssl rand -base64 48)"
export AUTH_SECRET="$(openssl rand -base64 48)"
export COOKIE_SECURE=true
docker compose up --build
```

Production'da ayrıca:

- TLS termination kullanın; HTTP üzerinde `COOKIE_SECURE=true` login cookie'lerini browser'a göndermeyecektir.
- RabbitMQ demo parolasını secret store'dan verin.
- Gateway ve RabbitMQ yönetim portunu public internete açmayın.
- PostgreSQL volume'larını şifreli disk ve düzenli snapshot ile koruyun.
- Loglarda token/parola/request body yazmayın.

## Bilinen sınırlar

### Gateway doğrudan erişimi

`localhost:8080` hackathon API demosu için host'a açıktır. Transaction ve Gamification servisleri de JWT imzası ve rol doğrulaması yapar; BFF kontrolleri backend'de tekrar uygulanır.

Production seçenekleri:

1. Gateway'i yalnız internal networkte bırakıp dışarı yalnız frontend'i yayınlamak; veya
2. Gateway seviyesinde ek WAF/rate-limit katmanı kullanmak.

Dokümantasyon bu sürümü zero-trust veya tam production authorization olarak nitelemez.

### Session revocation

BFF session cookie'si 7 gün HMAC imzalıdır. Access JWT 15 dakikada biter; refresh endpointi tokenı rotate eder. Kullanıcı rolü Identity DB'de session sırasında değiştirilirse mevcut BFF session rolü anında yenilenmez. Production'da session epoch/revocation kontrolü eklenmelidir.

### Event teslimatı

Transaction önce DB kararını commit eder, sonra RabbitMQ publish dener. Broker tam bu arada kesilirse `event_published=false` döner ve puan oluşmaz. Finansal karar kaybolmaz ancak event için transactional outbox yoktur. Hackathon kapsamı dışında production upgrade'i outbox + retry + DLQ'dur.

### Depolama ve ölçek

- PostgreSQL container'ları demo için tek node çalışır.
- Compose tek Next.js instance çalıştırır; yatay ölçeklemede tüm replica'lar aynı `AUTH_SECRET` değerini paylaşmalıdır.
- RabbitMQ tek node'dur.
- Rate limiting gateway seviyesinde dağıtık değildir; hesap lockout Identity DB'dedir.
- TLS, WAF, secret manager, backup automation ve merkezi observability Compose demosuna dahil değildir.

## Güvenlik testi örnekleri

```bash
# Yetkisiz BFF vakaları
curl -i http://localhost:3000/api/v1/cases

# Bozuk login body
curl -i -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{}'

# Illegal state transition backend tarafından 422
curl -i -X POST http://localhost:8080/api/v1/cases/CASE_ID/actions/start-review

# Yerleşik güvenlik scriptleri
node security-idor-test.mjs
node security-unauthorized-test.mjs
node security-token-manipulation-test.mjs
node security-bruteforce-test.mjs
node security-input-hardening-test.mjs
```
