# Pre-merge Kontrolü

Son kontrol: 2026-07-22

| ID | Kapanış kapısı | Kabul |
|---|---|---|
| CTRL-101 | Build/type/lint | Değişen bütün bileşenler yeşil |
| CTRL-102 | Immediate tests | Success/negative/boundary aynı değişiklikte |
| CTRL-103 | Coverage | Genel/çekirdek/değişen satır eşiği geçildi |
| CTRL-104 | DB isolation | Servis yalnız kendi DB URL/network/credential'ını bilir |
| CTRL-105 | RLS | ENABLE+FORCE, policy, context, no-bypass runtime testi |
| CTRL-106 | RBAC/IDOR | Her endpoint role ± ve başka actor testi |
| CTRL-107 | Idempotency/race | Duplicate/different payload/concurrent test |
| CTRL-108 | Event | Schema + outbox + inbox + duplicate + ordering + DLQ |
| CTRL-109 | Cache | Yasak veri yok; TTL/invalidation/failure semantic testli |
| CTRL-110 | AI | Gerçek artifact; sabit/mock fallback yolu yok |
| CTRL-111 | Resilience | Timeout/malformed/outage ve recovery testli |
| CTRL-112 | Security | SQLi/JWT/XSS/header/log-secret regression yeşil |
| CTRL-113 | OpenAPI/EVENTS | Snapshot/catalog güncel ve uyumlu |
| CTRL-114 | README/edge/ai-memory | Uygulanmış ve açık iş dürüstçe güncel |
| CTRL-115 | Compose | Config/build/health/clean seed/service-stop kanıtı |
| CTRL-116 | Bonus/diskalifiye | Bonus kanıtı; dört diskalifiye riski sıfır |

