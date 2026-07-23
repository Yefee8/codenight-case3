# FraudCell

FraudCell; Next.js BFF, Nginx API Gateway, dört FastAPI mikroservisi, servis başına bağımsız PostgreSQL veritabanı ve RabbitMQ event akışından oluşan demo-ready fraud inceleme sistemidir.

## Tek Komut

```bash
docker compose up --build
```

| Bileşen | Adres |
|---|---|
| Next.js BFF/UI | <http://localhost:3000> |
| API Gateway | <http://localhost:8080> |
| RabbitMQ Management | <http://localhost:15672> (`fraudcell` / `fraudcell`) |

Swagger/OpenAPI:

| Servis | Swagger |
|---|---|
| Identity | <http://localhost:8001/docs> |
| Transaction | <http://localhost:8002/docs> |
| AI | <http://localhost:8003/docs> |
| Gamification | <http://localhost:8004/docs> |

Gateway dış dünyaya şu route'ları verir:

```text
/api/v1/auth/**          -> identity-service
/api/v1/transactions/**  -> transaction-service
/api/v1/cases/**         -> transaction-service
/api/v1/ai/**            -> ai-service
/api/v1/game/**          -> gamification-service
```

## Demo Kullanıcıları

Ortak parola: `Demo123!`

| Rol | Kullanıcı | User ID |
|---|---|---|
| Müşteri | `customer` | `usr_customer_1` |
| Analist | `analyst` | `usr_analyst_1` |
| Süpervizör | `supervisor` | `usr_supervisor_1` |
| Admin | `admin` | `usr_admin_1` |

## Servis Bağımsızlığı

Her mikroservisin kendi PostgreSQL konteyneri ve SQLAlchemy modeli vardır:

| Servis | DB |
|---|---|
| Identity | `identity-db` / `identity` |
| Transaction | `transaction-db` / `transactions` |
| AI | `ai-db` / `ai` |
| Gamification | `gamification-db` / `gamification` |

Transaction servisi AI kapalıyken de `prediction_status=UNAVAILABLE`, `fraud_type=BELIRSIZ`, `recommended_decision=INCELEME` ile manuel inceleme kuyruğu üretir. Analist `BLOKLANDI` kararı verdiğinde `transaction.blocked` event'i RabbitMQ'ya basılır; Gamification bunu dinleyip analiste +10 puan yazar ve `/api/v1/game/notifications/stream` SSE akışıyla UI leaderboard/profil cache'ini yeniler.

## Zorunlu Demo Akışı

1. `customer` ile giriş yap.
2. Yüksek tutarlı/gece işlem oluştur: `amount=125000`, `type=ODEME`, `hour=2`.
3. AI `CALINTI_KART` ve `INCELEME` döndürür.
4. `supervisor` vakayı `usr_analyst_1` analistine atar.
5. `analyst` incelemeyi başlatır ve kararı `BLOKLANDI` verir.
6. `GET /api/v1/game/leaderboard?period=daily` analistin puanını gösterir; açık staff ekranı SSE ile puan değişimini otomatik yeniler.

## Güvenlik Testleri

Gateway ayaktayken:

```bash
node security-idor-test.mjs
node security-unauthorized-test.mjs
node security-token-manipulation-test.mjs
node security-bruteforce-test.mjs
node security-input-hardening-test.mjs
```

Uygulanan kontroller:

- SQL Injection: ORM sorguları SQLAlchemy `select()` ve bind parametreleriyle çalışır; SQLi login denemesi scriptte vardır.
- IDOR: Backend transaction/case owner kontrolü yapar; müşteri başka kullanıcı kaydında HTTP 403 alır.
- Yetkisiz erişim: Supervisor/Analyst endpointleri FastAPI dependency ve PostgreSQL RLS ile rol kontrolü yapar.
- Token manipülasyonu: Access JWT imza/expiry kontrol edilir; refresh token tek kullanımlık DB kaydıdır, logout ve refresh rotation eski tokenı revoke eder.
- XSS: Next.js BFF ve Pydantic validator'lar `<script>` etiketlerini temizler.
- Brute force: Identity login `slowapi` rate limit kullanır; 5 hatalı denemede hesap 15 dk DB'de kilitlenir.

## Sıfırlama

```bash
docker compose down -v
```

Bu komut PostgreSQL ve RabbitMQ volume'larını siler.
