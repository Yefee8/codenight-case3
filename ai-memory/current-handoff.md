# Current Handoff

Son güncelleme: 2026-07-22

## Çalışan/kanıtlanan

- 18 sayfa case analizinden eksiksiz `FRAUDCELL_PLAN.md`.
- Compose, dört DB/iki Redis/Rabbit topology/observability statik olarak parse/test edildi.
- Event/API contract ve machine-readable catalog.
- Hardened Rabbit per-service retry/DLX + HTTP API user/ACL bootstrap.
- Identity, Gateway, Transaction ve Gamification Java artifact'leri paketlendi.
- AI modeli `ready=True` olarak artifact/manifest bütünlük kontrolünden geçti.
- React production build tamamlandı; kök test 59/59 geçti.
- CORS/preflight, Redis Lua ACL/port, PostgreSQL 18 volume, Rabbit tekrar-start,
  Transaction RLS/JDBC ve Gamification JDBC runtime blokajları statik olarak düzeltildi.
- Mimari/DB/RLS/Redis/Rabbit/Docker/AI/test/demo doküman seti.

## Şu an yürüyen

- Kod tarafında açık P0 geliştirme yok.
- Çalışan container ortamında uçtan uca smoke kanıtı bekleniyor.

## Sonraki sıra

1. `.env.example` dosyasını `.env` olarak kopyala ve bütün `CHANGE_ME` secret'larını değiştir.
2. Docker bulunan ortamda `docker compose up --build --wait` çalıştır.
3. `docs/demo/live-demo.md` akışını ve bir servis durdurma drill'ini uygula.
4. Gerçek PostgreSQL RLS, Redis fail-closed ve Rabbit retry/DLQ smoke sonuçlarını kaydet.

## Komutlar

```powershell
.\.venv\Scripts\python.exe -m pytest tests/contract tests/infrastructure -q
.\.venv\Scripts\ruff.exe check infrastructure/rabbitmq/*.py tests
```

Docker/Podman sistemde yoktur. Java 21/Node/Python vardır; Java servisleri indirilen Maven
3.9.11 ile doğrulandı. Docker runtime doğrulaması araç sağlanana kadar “unverified” kalır.
