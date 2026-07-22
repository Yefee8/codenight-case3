# Gereksinim İzlenebilirliği

| Req | PDF | Uygulama/sözleşme | Otomatik kanıt | Demo |
|---|---|---|---|---|
| REQ-ARCH-01 | 2.1 dört servis+gateway | `services/*`, Compose | Compose/static network | boot/ps |
| REQ-ARCH-02 | DB-per-service | dört DB/network/credential | infra + RLS tests | DB isolation |
| REQ-ARCH-03 | servis bağımsızlığı | fallback/outbox/cache semantics | resilience suite | AI stop |
| REQ-ARCH-04 | Docker Compose | root compose | config/build/health | single up |
| REQ-ID-01 | GSM+OTP kayıt | Identity auth endpoints | expiry/replay/attempt | customer login |
| REQ-ID-02 | Admin staff/multi-profile | Identity admin endpoints/events | RBAC/validation | admin create |
| REQ-ID-03 | password/Argon2/lock | Identity security | every rule + 4/5/6 | brute drill |
| REQ-ID-04 | JWT/refresh/rotation/reuse | Identity+Gateway+Redis | concurrent/tampered/reuse | refresh theft |
| REQ-ID-05 | rol matrisi/audit | bütün servis security | role ±/403 audit/IDOR | customer→supervisor |
| REQ-TX-01 | transaction alanları/numara | Transaction API/DB | validation/idempotency/sequence | riskli create |
| REQ-TX-02 | AI unavailable fallback | Transaction AI client | timeout/5xx/malformed | AI stop create |
| REQ-TX-03 | case state machine | Transaction domain | all allowed + all denied | analyst decision |
| REQ-TX-04 | fraud/risk override | Transaction + AI feedback event | boundary/override immutability | supervisor |
| REQ-TX-05 | dört SLA | due/scheduler/event | exact/restart/reassign | SLA display |
| REQ-TX-06 | customer verification | case action/notification | owner/state/duplicate | “ben yapmadım” |
| REQ-TX-07 | feedback 1–5 once | feedback endpoint/event | 0/6/early/duplicate | closed rating |
| REQ-AI-01 | gerçek risk modeli | train/inference/artifact | metric/golden/different input | score/version |
| REQ-AI-02 | beş type | multiclass model | macro/per-class metrics | type visual |
| REQ-AI-03 | akıllı assignment | ranked candidates + reservation | formula/tie/capacity/race | correct analyst |
| REQ-AI-04 | accuracy | feedback/snapshot API | denominator/priority | dashboard |
| REQ-GAME-01 | altı puan kuralı | immutable ledger | combinations/duplicate/correction | points |
| REQ-GAME-02 | altı badge | badge evaluator | threshold/once | toast |
| REQ-GAME-03 | dört level | profile projection | 499/500/1499/1500/2999/3000 | profile |
| REQ-GAME-04 | daily/weekly top10 | DB+Redis read model | timezone/tie/fallback | leaderboard |
| REQ-DASH-01 | tüm dashboard widget | Transaction+AI projections/UI | empty/partial/stale/RBAC | supervisor |
| REQ-API-01 | REST/envelope/Swagger | contracts/service docs | schema/OpenAPI diff | Swagger |
| REQ-EVT-01 | event architecture | Rabbit/outbox/inbox/EVENTS | duplicate/order/DLQ | live points |
| REQ-SEC-01 | canlı saldırı paketi | threat model/security tests | SQLi/RBAC/IDOR/JWT/XSS/rate | jury drill |
| BONUS-ML | +8 | own dataset/model/docs | deterministic train/gates | live model |
| BONUS-MQ | +5 | RabbitMQ | topology/real delivery | event flow |
| BONUS-CAT | +3 | category accuracy | per-category tests/API/UI | chart |
| BONUS-SSE | +2 | Transaction/Game SSE | reconnect/Last-ID | toast/live queue |
| BONUS-CI | +2 | GitHub Actions | green remote workflow | badge/report |

`planned` bir test adı bu tabloda kanıt sayılmaz; `project-status` runtime durumunu belirler.

