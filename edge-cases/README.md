# Edge-case Kataloğu

Her kayıt tetikleyici, beklenen davranış, requirement, otomatik test ve durum içerir. Durumlar:
`planned / implemented / tested`.

| ID | Domain | Tetikleyici | Beklenen | Test | Durum |
|---|---|---|---|---|---|
| EC-001 | AI | score `0.3999` | ONAY/DUSUK | risk boundary | planned |
| EC-002 | AI | score tam `0.40` | INCELEME/ORTA | risk boundary | planned |
| EC-003 | AI | score tam `0.90` | INCELEME/YUKSEK | risk boundary | planned |
| EC-004 | AI | score `0.9001` | BLOK/KRITIK/temp hold | risk boundary | planned |
| EC-005 | AI | NaN/−/1+ response | malformed say, BELIRSIZ | client contract | planned |
| EC-006 | AI | timeout/5xx/readiness | transaction 201/manual queue | outage integration | planned |
| EC-007 | AI | geç cevap + insan başladı | state'i ezme | late response | planned |
| EC-008 | Event | duplicate event | tek iş etkisi | inbox unique | planned |
| EC-009 | Event | out-of-order version | eski state no-op | aggregate version | planned |
| EC-010 | Event | poison payload | bounded retry + DLQ | DLQ integration | planned |
| EC-011 | Auth | concurrent refresh same token | biri kazanır, reuse revoke | concurrency | planned |
| EC-012 | Auth | 4/5/6 wrong login | açık/lock/kalan süre | fake clock | planned |
| EC-013 | Assignment | capacity 9/10 | bir reservation →10 | DB concurrency | planned |
| EC-014 | Assignment | capacity 10/10 | auto skip/manual reason override | assignment | planned |
| EC-015 | Assignment | iki concurrent case | capacity asla 11 olmaz | race | planned |
| EC-016 | Case | iki decision aynı version | biri commit, biri 409 | optimistic lock | planned |
| EC-017 | Case | block note boş | 422 | state guard | planned |
| EC-018 | SLA | tam deadline | within SLA | injected Clock | planned |
| EC-019 | SLA | restart/reassignment | due_at değişmez | scheduler integration | planned |
| EC-020 | Verify | terminal sonrası cevap | karar değişmez/409-422 | state guard | planned |
| EC-021 | Feedback | 0/6/duplicate/erken | validation/409/422 | feedback | planned |
| EC-022 | Game | duplicate/out-of-order | çift puan/rozet yok | ledger | planned |
| EC-023 | Game | false block correction | −8 entry; badge kalır | correction | planned |
| EC-024 | Game | 499/500/1499/1500/2999/3000 | doğru level | boundary | planned |
| EC-025 | Time | Istanbul gün/hafta/DST | doğru bucket | timezone | planned |
| EC-026 | Rank | aynı puan | daha erken, sonra UUID | tie-break | planned |
| EC-027 | DB | year/sequence concurrency | unique TRX number | sequence | planned |
| EC-028 | RLS | context yok/pool reuse | zero access/no leak | PostgreSQL | planned |
| EC-029 | Security | IDOR/JWT/header spoof | 404/401/header ignore | security | planned |
| EC-030 | Dashboard | projection partial/stale | timestamp+indicator | API/UI | planned |

