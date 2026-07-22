# Sistem Mimarisi ve Servis Sınırları

## C4 — Container görünümü

```mermaid
flowchart TB
  PersonCustomer["Müşteri"] --> UI["React Web"]
  PersonStaff["Analist / Süpervizör / Admin"] --> UI
  UI --> GW["Spring Cloud Gateway"]
  GW --> ID["Identity Service"]
  GW --> TX["Transaction Service"]
  GW --> AI["AI Service public metrics"]
  GW --> GAME["Gamification Service"]
  TX -->|"1.5s internal score"| AI
  ID --> IDDB[("Identity PostgreSQL")]
  TX --> TXDB[("Transaction PostgreSQL")]
  AI --> AIDB[("AI PostgreSQL")]
  GAME --> GDB[("Gamification PostgreSQL")]
  GW --> GWR[("Gateway Security Redis")]
  GAME --> GR[("Gamification Cache Redis")]
  ID <--> MQ["RabbitMQ"]
  TX <--> MQ
  AI <--> MQ
  GAME <--> MQ
```

## Bounded context ve sahiplik

| Context | Tek yazma sahibi | Sınır dışı |
|---|---|---|
| Identity | Hesap, OTP, parola, token session/family, rol/profil, auth audit | Case, model, puan |
| Transaction | Finansal işlem, risk case/state/SLA, assignment reservation, verification, feedback, ground truth | Parola, model eğitimi, point ledger |
| AI | Dataset/model lifecycle, immutable prediction, recommendation ve accuracy | Case state, kesin kapasite, auth |
| Gamification | Append-only point ledger, badge, level, leaderboard/profile projection | Case mutation, auth, model |
| Gateway | Route/JWT/rate-limit/revocation/security header | Domain aggregation veya persistent kullanıcı verisi |

Servisler arasında Java entity/ortak domain kütüphanesi yoktur. Paylaşılan tek bağlayıcı
OpenAPI/JSON Schema'dır. Başka servisin ID'si UUID olarak tutulabilir fakat çapraz DB foreign
key ve doğrudan DB bağlantısı yasaktır.

## Ana yazma akışı

```mermaid
sequenceDiagram
  participant C as Customer UI
  participant G as Gateway
  participant T as Transaction
  participant A as AI
  participant D as Transaction DB
  participant Q as RabbitMQ
  C->>G: POST /transactions + JWT + Idempotency-Key
  G->>G: JWT/revocation/rate/body kontrolü
  G->>T: Temizlenmiş request + bearer token
  T->>D: BEGIN + transaction-local RLS context
  T->>A: POST /internal/v1/score (timeout 1.5s)
  alt AI geçerli cevap
    A-->>T: score/type/decision/ranked candidates/model version
  else timeout/5xx/malformed/readiness
    T->>T: BELIRSIZ + INCELEME + manual queue
  end
  T->>D: transaction + case + capacity reservation + outbox
  D-->>T: COMMIT
  T-->>C: 201 canonical envelope
  T->>Q: Outbox publisher + confirm
```

AI cevabı state'in sahibi değildir. AI yalnız öneri üretir; Transaction kapasiteyi atomik
rezerve eder ve case state'ini yazar. Geç gelen re-score, insan işlemi başlamış/manuel karar
verilmiş case'i ezmez.

## Tutarlılık modeli

- Servis içi invariant: tek ACID transaction.
- Servisler arası: eventual consistency + outbox/inbox.
- Kimlik ve authorization: Gateway kontrolüne ek her domain servisi JWT ve resource
  ownership doğrular; DB RLS son savunmadır.
- Dashboard: projection üretim zamanını döner; partial/stale işareti gizlenmez.
- Gamification: PostgreSQL ledger source-of-truth, Redis yalnız yeniden üretilebilir cache.

## Failure domains

| Kesinti | Beklenen davranış |
|---|---|
| AI | Transaction `201`; `BELIRSIZ/INCELEME`; manual queue; güvenli re-score |
| RabbitMQ | Domain yazımı sürer; outbox büyür; projection sonradan yetişir |
| Game Redis | DB fallback; leaderboard daha yavaş; point kaybı yok |
| Gateway Security Redis | Authenticated istek `503`; revocation fail-closed |
| Tek domain DB | Yalnız o context unavailable; diğer servis health/read işlemleri sürer |
| Identity | JWKS process cache süresince mevcut access tokenlar doğrulanabilir; login/refresh yok |

## Deployment invariant'ları

- Dış port yalnız UI ve Gateway.
- DB başına ayrı network/volume/credential.
- Container non-root, read-only mümkün olan filesystem, `no-new-privileges`.
- Health “process ayakta”, readiness gerekli dependency ve model/migration hazır ayrımını
  korur.
- Image tag/digest pinli; deploy edilen SHA gözlemlenebilir.
