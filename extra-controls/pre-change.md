# Pre-change Kontrolü

Son kontrol: 2026-07-22

| ID | Başlamadan önce soru | Beklenen kanıt |
|---|---|---|
| CTRL-001 | Değişikliğin tek sahibi servis belli mi? | Servis sınırı/ADR linki |
| CTRL-002 | Başka DB'ye erişim veya cross-service FK oluşuyor mu? | Compose network + migration review |
| CTRL-003 | PDF requirement/bonus/edge-case ID'si belli mi? | Traceability satırı |
| CTRL-004 | Actor, RBAC ve object ownership etkisi belirlendi mi? | Positive/negative rol matrisi |
| CTRL-005 | RLS table/policy/context/index etkisi var mı? | RLS checklist |
| CTRL-006 | Cache'e girecek veri sınıflandırıldı mı? | Cache allow/deny kararı |
| CTRL-007 | Event gerekiyor mu; producer tek sahibi mi? | Schema/catalog/outbox/inbox planı |
| CTRL-008 | Idempotency/concurrency/ordering sınırı var mı? | Unique/version/lock tasarımı |
| CTRL-009 | Dependency timeout/malformed/outage davranışı var mı? | Dört-path test planı |
| CTRL-010 | Log/event/cache PII/secret riski var mı? | Alan allowlist/masking testi |
| CTRL-011 | Aynı değişiklikte hangi testler yazılacak? | Test isimleri/katmanı |
| CTRL-012 | Doküman/ai-memory hangi dosyada güncellenecek? | Yol listesi |

