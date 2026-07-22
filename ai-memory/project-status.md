# Proje Durumu

Son güncelleme: 2026-07-22

Durumlar: `planned`, `in-progress`, `implemented-unverified`, `tested`, `demo-ready`.

| Alan | Durum | Kanıt | Açık iş |
|---|---|---|---|
| Case PDF 18/18 analiz | tested | `FRAUDCELL_PLAN.md`, tekrar text extraction | yok |
| Mimari/ADR/EER/threat/RLS docs | tested | `docs/**`, servis/altyapı statik kontrolleri | Docker runtime kanıtı |
| API/event contracts | tested | `contracts/**`, 59 root pytest | gerçek broker üzerinde akış smoke |
| Docker/DB network topoloji | tested (static) | infrastructure pytest | Docker Engine ile runtime smoke |
| PostgreSQL role bootstrap | tested (static) | NOBYPASSRLS/static tests | gerçek container role query |
| Redis iki-instance policy | tested (static) | config + tests | runtime outage/ACL smoke |
| Rabbit topology/retry/DLQ/ACL | tested (static) | generated topology + tests | real broker publish/ACL/replay |
| GitHub Actions | implemented-unverified | `.github/workflows/ci.yml` statik sözleşme | remote first green run |
| Identity Service | tested | 2 minimal test + Maven package | PostgreSQL/Rabbit runtime smoke |
| Gateway | tested | 30 test + Maven package | Redis/JWKS runtime smoke |
| Transaction Service | tested | 2 minimal test + Maven package | PostgreSQL/AI/Rabbit runtime smoke |
| AI Service/model | tested | 29 odaklı test + hazır model artifact yükleme | PostgreSQL/Rabbit runtime smoke |
| Gamification Service | tested | 15 test + Maven package | PostgreSQL/Redis/Rabbit runtime smoke |
| React UI | tested | TypeScript + Vite production build, 625 modül | tarayıcıda canlı API smoke |
| Seed/demo verisi | implemented-unverified | Identity idempotent demo seed + sentetik AI verisi | full Compose demo çalıştırması |
| Security doğrulamaları | tested (static/minimal) | JWT/RBAC/rate/RLS contract ve servis testleri | canlı IDOR/RLS/outage drill |
| Full Compose | implemented-unverified | compose YAML parses | Docker yok; build/up bekliyor |
| +20 bonus kapsamı | implemented-unverified | `bonus-status.md` | jüri için canlı runtime evidence |

Son yerel doğrulama: 59/59 contract+infrastructure testi, dört Java artifact paketi, React
production build ve gerçek AI model artifact yüklemesi yeşil. Docker/Podman hostta bulunmadığı
için `docker compose up --build --wait`, gerçek DB/RLS, Redis ve RabbitMQ smoke henüz çalıştırılmadı.
