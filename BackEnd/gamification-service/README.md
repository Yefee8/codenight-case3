# Gamification Service

Sorumluluk: puan, rozet, seviye, liderlik tablosu, kullanıcı bildirimi. Event tabanlı (Transaction Service HTTP webhook çağırır — REST üzerinden event mesajı).

## Environment
- `PORT` (3004)
- `SERVICE_TOKEN`
- `JWT_SECRET`
- `DB_PATH`

## Event Endpoints (internal — X-Service-Token)
- `POST /events/case-decided`  `{ analyst_id, decision, fraud_type, risk_level, decision_ms, sla_ms, customer_confirmed_fraud, case_id }`
- `POST /events/wrong-block` `{ analyst_id, case_id }`
- `POST /events/sla-exceeded` `{ analyst_id, case_id }`

## Public
- `GET /leaderboard?period=daily|weekly`
- `GET /badges`
- `GET /profile` — kendi profilim (JWT)
- `GET /profile/:userId` — supervisor/admin veya kendi kullanıcı
- `GET /notifications` — rozet toast'ları
