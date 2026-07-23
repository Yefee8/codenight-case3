# FraudCell operasyon ve demo rehberi

## Gereksinimler

- Docker Engine/Desktop
- Docker Compose v2+
- İlk build için internet erişimi

Host üzerinde Python, Node veya RabbitMQ kurulumu gerekmez.

## Başlatma

```bash
docker compose up
```

İlk çalıştırmada image'lar otomatik build edilir; yerel image varken kaynak kod değiştiyse `docker compose up --build` kullanın.

Compose sırası healthcheck'lerle belirlenir:

```text
RabbitMQ + Identity + AI
       ↓
Transaction + Gamification
       ↓
Gateway
       ↓
Frontend
```

Web uygulaması hazır olduğunda <http://localhost:3000/login> adresini açın.

## Demo hesapları

| Rol | Identifier | Parola | Başlangıç sayfası |
|---|---|---|---|
| Customer | `customer` | `Demo123!` | `/customer` |
| Analyst | `analyst` | `Demo123!` | `/analyst` |
| Supervisor | `supervisor` | `Demo123!` | `/supervisor` |
| Admin | `admin` | `Demo123!` | `/supervisor` (salt okunur case görünümü) |

## Jüri demo akışı

1. `customer` ile giriş yapın.
2. `125000 TRY`, `ODEME`, `hour=2` gece işlemi oluşturun.
3. UI'da `CALINTI_KART` fraud tipi ve AI `INCELEME` önerisini gösterin.
4. Çıkış yapıp `supervisor` ile giriş yapın.
5. `YENI` vakayı Selin Kaya (`usr_analyst_1`) analistine atayın.
6. Çıkış yapıp `analyst` ile giriş yapın.
7. Atanmış vakada “İncelemeyi başlat” ile `ATANDI → INCELENIYOR` geçişini yapın.
8. Analist notu girip onay veya blok kararı verin.
9. Liderlik sayfasında RabbitMQ consumer'ın verdiği `+10` puanı gösterin.

## AI kesintisi demosu

```bash
docker compose stop ai-service
```

Customer ile yeni işlem oluşturun. Beklenen sonuç:

- HTTP `201`
- `risk_score: null`
- `fraud_type: BELIRSIZ`
- `recommended_decision: INCELEME`
- `prediction_status: UNAVAILABLE`
- Vaka `YENI` olarak manuel kuyruğa düşer

AI'ı geri açın:

```bash
docker compose start ai-service
```

## Health ve loglar

```bash
docker compose ps
curl http://localhost:8080/health
curl http://localhost:8080/health/identity
curl http://localhost:8080/health/transaction
curl http://localhost:8080/health/ai
curl http://localhost:8080/health/gamification
curl -I http://localhost:3000/login
docker compose logs --tail=100 frontend gateway identity-service transaction-service ai-service gamification-service
```

RabbitMQ exchange/queue gözlemi: <http://localhost:15672>, kullanıcı/parola `fraudcell`.

## Testler

Aşağıdaki geliştirme komutları host üzerinde ilgili Python/Node bağımlılıkları kuruluysa çalışır; uygulamayı ayağa kaldırmak için bunlar gerekmez.

Backend servis testleri:

```bash
python -m pytest services/identity-service/test_identity.py
python -m pytest services/transaction-service/test_main.py
python -m unittest discover -s services/ai-service -p 'test_*.py'
python -m unittest discover -s services/gamification-service -p 'test_*.py'
```

Frontend kontrolleri:

```bash
cd frontend
pnpm lint
pnpm build
pnpm check:auth
pnpm check:workflow
pnpm check:pwa
```

`check:auth`, `check:workflow` ve `check:pwa` çalışan Compose stack'i bekler. `check:workflow`; müşteri işlemi, Admin salt-okunur kontrolü, Supervisor ataması, Analyst kararı, RabbitMQ puanı ve leaderboard zincirini gerçek BFF üzerinden doğrular.

## Durdurma ve veri sıfırlama

Containerları durdurup DB volume'larını korumak:

```bash
docker compose down
```

Hackathon verilerini tamamen sıfırlamak:

```bash
docker compose down -v
```

`-v` komutu dört PostgreSQL DB volume'unu ve RabbitMQ mesajlarını geri alınamaz biçimde siler. Yalnız demo verisini bilinçli sıfırlarken kullanın.

## Yaygın sorunlar

| Belirti | Kontrol |
|---|---|
| Login sonrası tekrar login sayfası | Compose'da `COOKIE_SECURE=false`; production HTTPS'te `true` |
| Frontend backend'e ulaşamıyor | Frontend container env'i `GATEWAY_URL=http://gateway` olmalı |
| Vaka kararı `422` | Önce supervisor ataması, sonra analyst start-review gerekir |
| Puan hemen görünmüyor | RabbitMQ eventual; leaderboard'u kısa süre sonra yenileyin |
| Gateway healthy değil | `docker compose logs gateway`; health URL `127.0.0.1/health` olmalı |
| AI kapalı işlem | Bu beklenen fallback'tir; Transaction `201` üretmeye devam eder |
