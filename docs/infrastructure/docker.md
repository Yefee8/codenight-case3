# Docker Compose Tasarımı

## Amaç

`docker compose up` sistemi yeniden üretilebilir biçimde ayağa kaldırır; host'a kurulmuş Java,
Python, Node, PostgreSQL, Redis veya RabbitMQ'ya güvenmez.

## Container ve ağ matrisi

| Container | Ağlar | Kalıcı volume | Host port |
|---|---|---|---|
| frontend | edge | yok | 3000 |
| gateway | edge, backend, gateway-security | yok | 8080 |
| identity | backend, messaging, identity-db | yok | yok |
| transaction | backend, messaging, transaction-db | yok | yok |
| ai | backend, messaging, ai-db | model bind | yok |
| gamification | backend, messaging, game-db, game-cache | yok | yok |
| dört PostgreSQL | yalnız kendi db ağı | ayrı volume | yok |
| Security Redis | yalnız gateway-security | AOF volume | yok |
| Game Redis | yalnız game-cache | yok | yok |
| RabbitMQ | messaging | ayrı volume | management loopback |

DB ağları `internal: true` ve birbirinden ayrıdır. Gateway DB veya Game cache ağına, frontend
backend ağına girmez. Ağ ayrımı credential hatasının blast radius'unu küçültür.

## Startup ve readiness

- Uygulama kendi DB migration/readiness'ini bekler.
- Rabbit/AI/Game cache gibi degrade edilebilir dependency'nin health'i domain servisini boot
  aşamasında kilitlemez; client retry/backoff ve runtime fallback çalışır.
- Gateway authenticated trafik için Security Redis'i zorunlu tutar.
- AI readiness model artifact/manifest hash ve feature schema yüklenmeden başarılı olmaz.
- Liveness dependency outage yüzünden process'i restart loop'a sokmaz.

## Image ilkeleri

- Multi-stage build; runtime image compiler/build cache içermez.
- Java JRE, Python virtualenv wheels, React static Nginx katmanı.
- Non-root UID, `no-new-privileges`, minimum package, production debug kapalı.
- Patch tag ve release'te digest pin; Git SHA label/tag.
- Secret image layer, ARG veya committed env içinde değildir.

## Clean boot kabulü

```powershell
docker compose down --volumes --remove-orphans
docker compose build --pull
docker compose up --wait
docker compose ps
```

Bu komut volume sildiği için yalnız disposable demo ortamında kullanılır. Sonrasında migration
bir kez ve tekrar-start idempotent; seed iki kez koşunca duplicate üretmez; yalnız Gateway/UI
portları erişilebilir olmalıdır.

## Service-stop drill

AI container durdurulduğunda Transaction `201 BELIRSIZ`; Rabbit durduğunda outbox; Game
Redis durduğunda DB fallback gözlenir. Container geri geldiğinde manual state ezilmeden catch-up
olmalıdır. Runbook: [`../runbooks/service-outage.md`](../runbooks/service-outage.md).

