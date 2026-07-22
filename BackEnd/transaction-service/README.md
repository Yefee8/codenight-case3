# Transaction Service

Sorumluluk: işlem kaydı, risk vakası yaşam döngüsü, SLA takibi, müşteri doğrulama, müşteri geri bildirimi, süpervizör dashboard.

## State Machine (PDF §4.2)
YENI → ATANDI → INCELENIYOR → MUSTERI_DOGRULAMA → INCELENIYOR
INCELENIYOR → ONAYLANDI / BLOKLANDI → KAPANDI (48h sonra otomatik)

Kural dışı geçiş **422** döndürür. Bkz. `src/stateMachine.js`.

## SLA (PDF §4.4)
| Seviye | Süre |
|---|---|
| KRITIK | 15 dk (aşımda geçici blok) |
| YUKSEK | 1 saat |
| ORTA | 4 saat |
| DUSUK | 24 saat |

## Environment
- `PORT` (3002)
- `JWT_SECRET`
- `SERVICE_TOKEN`
- `AI_URL`, `GAMIFICATION_URL`, `IDENTITY_URL`
- `DB_PATH`

## Endpointler
- `POST /transactions` (CUSTOMER, ADMIN)
- `GET /transactions`, `GET /transactions/:id`
- `GET /cases`, `GET /cases/:id`
- `PATCH /cases/:id/status` — state machine transition
- `PATCH /cases/:id/assign` — SUPERVISOR/ADMIN
- `PATCH /cases/:id/decision` — analist kararı (+not zorunlu, AI feedback tetikler)
- `POST /cases/:id/customer-verify` — müşteri "I_DID_IT" / "NOT_ME"
- `POST /cases/:id/feedback` — 1-5 puan (kapanmış vaka)
- `GET /dashboard`, `/dashboard/sla`, `/dashboard/analytics` — SUPERVISOR/ADMIN
- `POST /internal/tick-close` — 48h otomatik kapama (cron için)

## AI Bağımsızlığı
AI servisi kapaliyken işlem oluşturmaya devam edilir: `risk_level = BELIRSIZ`, karar = `INCELEME`, vaka manuel kuyruğa düşer.
