# Events

Servisler arası iletişim REST tabanlı event webhook'ları ile yapılır. Her event `X-Service-Token` ile korunur.

## transaction.created (sync)
- **Yayınlayan:** Transaction (istek içinde)
- **Dinleyen:** AI (`POST /score`)
- **Payload:**
```json
{ "transaction_id": "uuid", "amount": 30000, "type": "TRANSFER", "city": "LAGOS", "device": "UNKNOWN", "receiver": "12345", "timestamp": "ISO", "customer_history": {"avg_amount":500,"home_city":"ISTANBUL","known_device":false} }
```

## case.assign-requested (sync)
- **Yayınlayan:** Transaction
- **Dinleyen:** AI (`POST /assign`)
- **Payload:** `{ case_id, fraud_type }` → `{ analyst_id, score }`

## case.decided
- **Yayınlayan:** Transaction (analist karar verince)
- **Dinleyen:** Gamification (`POST /events/case-decided`)
- **Payload:**
```json
{
  "case_id": "TRX-2026-000123",
  "analyst_id": "a7f3...",
  "decision": "BLOKLANDI",
  "fraud_type": "CALINTI_KART",
  "risk_level": "KRITIK",
  "decision_ms": 543210,
  "sla_ms": 900000,
  "customer_confirmed_fraud": true
}
```

## case.wrong-block
- **Yayınlayan:** Transaction (yanlış pozitif tespit edildiğinde)
- **Dinleyen:** Gamification (`POST /events/wrong-block`)

## case.sla-exceeded
- **Yayınlayan:** Transaction (SLA aşımı tespit)
- **Dinleyen:** Gamification (`POST /events/sla-exceeded`)

## ai.type-corrected
- **Yayınlayan:** Transaction (analist AI türünü değiştirdiğinde)
- **Dinleyen:** AI (`POST /feedback`)
- **Payload:** `{ prediction_id, actual_type }`

## analyst.decision-reported
- **Yayınlayan:** Transaction
- **Dinleyen:** AI (`POST /decisions`) — aktif vaka sayacını düşür, performansı güncelle

## badge.earned
- **Yayınlayan:** Gamification (internal)
- **Depolama:** `notifications` tablosuna eklenir, kullanıcı `GET /profile` veya `GET /notifications` üzerinden görür.
