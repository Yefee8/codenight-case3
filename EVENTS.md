# FraudCell Events

RabbitMQ exchange: `fraudcell.events.v1`  
Exchange type: `topic`

## `transaction.blocked`

Analist veya süpervizör bir vakayı `BLOKLANDI` durumuna çektiğinde Transaction servisi yayınlar. Gamification servisi bu routing key'i dinler ve analiste +10 puan yazar.

```json
{
  "event_id": "01JY9Q6S3T0S5M7H4K3N2P1Q8A",
  "event_type": "transaction.blocked",
  "event_version": 1,
  "producer": "transaction-service",
  "occurred_at": "2026-07-23T19:15:21.312000+00:00",
  "aggregate_id": "TRX-2026-A1B2C3D4",
  "aggregate_version": 4,
  "case_id": "TRX-2026-A1B2C3D4",
  "analyst_id": "usr_analyst_1",
  "decision": "BLOKLANDI",
  "fraud_type": "CALINTI_KART",
  "risk_level": "YUKSEK",
  "sla_breached": false,
  "payload": {
    "case_id": "TRX-2026-A1B2C3D4",
    "transaction_id": "4d9a0e98-d72f-44fd-b585-80faabf6f5db",
    "analyst_id": "usr_analyst_1",
    "analyst_name": "Selin Kaya",
    "decision": "BLOKLANDI",
    "fraud_type": "CALINTI_KART",
    "risk_level": "YUKSEK",
    "sla_breached": false
  }
}
```

## `transaction.decided`

Blok dışı kararlar için aynı şema kullanılır; Gamification puanı yalnız `transaction.blocked` event'inden üretir.

```json
{
  "event_id": "01JY9Q8G4E5R6T7Y8U9I0O1P2A",
  "event_type": "transaction.decided",
  "event_version": 1,
  "producer": "transaction-service",
  "occurred_at": "2026-07-23T19:18:02.100000+00:00",
  "aggregate_id": "TRX-2026-B2C3D4E5",
  "aggregate_version": 4,
  "case_id": "TRX-2026-B2C3D4E5",
  "analyst_id": "usr_analyst_1",
  "decision": "ONAYLANDI",
  "fraud_type": "TEMIZ",
  "risk_level": "DUSUK",
  "sla_breached": false,
  "payload": {
    "case_id": "TRX-2026-B2C3D4E5",
    "transaction_id": "91a6dbd4-941a-4b3f-a35a-6c4c850d77e9",
    "analyst_id": "usr_analyst_1",
    "analyst_name": "Selin Kaya",
    "decision": "ONAYLANDI",
    "fraud_type": "TEMIZ",
    "risk_level": "DUSUK",
    "sla_breached": false
  }
}
```
