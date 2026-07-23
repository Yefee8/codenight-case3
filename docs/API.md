# FraudCell API sözleşmesi

## Adresler

| Katman | Base URL | Kullanım |
|---|---|---|
| Next.js BFF | `http://localhost:3000/api/v1` | Browser ve UI için önerilen public API |
| Nginx Gateway | `http://localhost:8080` | Backend demo, curl ve servis entegrasyonu |
| RabbitMQ UI | `http://localhost:15672` | Broker gözlemi |

Browser için BFF kullanılmalıdır. Gateway endpointleri frontend containerından `http://gateway` adıyla çağrılır.

## Yanıt zarfı

BFF ve public backend endpointleri şu zarfı kullanır:

```json
{
  "success": true,
  "data": {},
  "error": null
}
```

```json
{
  "success": false,
  "data": null,
  "error": "Geçersiz istek"
}
```

## Next.js BFF endpointleri (`:3000`)

### Authentication

#### `POST /api/v1/auth/login`

```json
{ "identifier": "analyst", "password": "Demo123!" }
```

Başarılı yanıtta JWT yoktur:

```json
{
  "success": true,
  "data": {
    "user": { "user_id": "usr_analyst_1", "full_name": "Selin Kaya", "role": "ANALYST" },
    "redirect_to": "/analyst"
  },
  "error": null
}
```

Access, refresh ve BFF session değerleri HttpOnly cookie olarak yazılır.

#### `POST/GET /api/v1/auth/refresh`

Body gerekmez. Refresh cookie Identity'ye gönderilir; access/refresh tokenları rotate edilir. Tokenlar response JSON'una eklenmez. `GET` biçimi, access cookie süresi dolan protected page navigation'ını yenileyip güvenli bir relative `next` yoluna geri yönlendirir.

#### `POST /api/v1/auth/logout`

BFF Identity'den refresh kaydını revoke etmesini ister ve üç auth cookie'sini koşulsuz expire eder. Identity erişilemiyorsa local logout yine başarılıdır; uzak refresh kaydı doğal süresine kadar kalabilir.

### Transactions

#### `POST /api/v1/transactions/simulate` — `CUSTOMER`

```json
{
  "amount": 150000,
  "type": "TRANSFER",
  "receiver": "Global Trade",
  "device": "Yeni cihaz",
  "location": "Amsterdam, NL"
}
```

`customer_id` browser'dan kabul edilmez; BFF session'dan eklenir. Yanıt `case` ve `requires_verification` alanlarını taşır.

### Cases

| Method | Path | Roller | Açıklama |
|---|---|---|---|
| `GET` | `/api/v1/cases` | Customer, Analyst, Supervisor, Admin | Customer kendi vakaları; Analyst atanmış vakalar |
| `GET` | `/api/v1/cases/{id}` | Customer, Analyst, Supervisor, Admin | Vaka detayı; sahiplik/atama kontrol edilir |
| `PATCH` | `/api/v1/cases/{id}/assignment` | Supervisor | `{ "analyst_id": "usr_analyst_1" }` |
| `PATCH` | `/api/v1/cases/{id}/risk-level` | Supervisor | `{ "risk_level": "KRITIK", "reason": "Manuel risk artışı" }` |
| `POST` | `/api/v1/cases/{id}/actions/start-review` | Analyst | `ATANDI → INCELENIYOR` |
| `PATCH` | `/api/v1/cases/{id}/decision` | Analyst, Supervisor | Aşağıdaki karar body’si |
| `POST` | `/api/v1/cases/{id}/feedback` | Customer | `{ "rating": 1..5, "note": "opsiyonel" }` |

Karar body’si:

```json
{ "decision": "BLOKLANDI", "note": "Müşteri işlemi reddetti" }
```

BFF güvenilir session'dan `analyst_id` ve `analyst_name` ekler. UI'dan gönderilen analist kimliği kullanılmaz. Supervisor risk override ham AI skorunu değiştirmez; sadece operasyonel `risk_level`, gerekçe ve audit metadata'sı güncellenir.

### Gamification ve dashboard

| Method | Path | Roller | Kaynak |
|---|---|---|---|
| `GET` | `/api/v1/game/leaderboard` | Analyst, Supervisor, Admin | Gamification DB |
| `GET` | `/api/v1/game/profile/{userId}` | Analyst kendi profili; Supervisor/Admin tümü | Gamification DB |
| `GET` | `/api/v1/game/notifications/stream` | Analyst, Supervisor, Admin | `text/event-stream`; `points.changed` event'i |
| `GET` | `/api/v1/metrics/supervisor` | Supervisor, Admin | Case verisinden türetilir |
| `GET` | `/api/v1/analysts/performance` | Supervisor, Admin | Identity staff + case verisi |

`metrics/supervisor` yanıtındaki mevcut `ai_accuracy_rate` alan adı UI sözleşmesi için korunur; değer gerçekte `prediction_status=AVAILABLE` vaka oranıdır. `analysts/performance.accuracy_rate` ise kararların SLA içinde tamamlanma oranıdır.

## Gateway backend endpointleri (`:8080`)

### Health

| Method | Path | Sonuç |
|---|---|---|
| `GET` | `/health` | Gateway health |
| `GET` | `/health/identity` | Identity + DB health |
| `GET` | `/health/transaction` | Transaction health |
| `GET` | `/health/ai` | AI health |
| `GET` | `/health/gamification` | Gamification health |

### Identity Service

| Method | Path | Body / Auth | Açıklama |
|---|---|---|---|
| `POST` | `/api/v1/auth/register` | `username?`, `gsm`, `full_name`, `password` | CUSTOMER kaydı |
| `POST` | `/api/v1/auth/customers/register` | Aynı | Alias |
| `POST` | `/api/v1/auth/login` | `identifier|username|gsm`, `password` | Access + refresh üretir |
| `POST` | `/api/v1/auth/customers/login` | Aynı | Alias |
| `POST` | `/api/v1/auth/staff/login` | Aynı | Alias |
| `POST` | `/api/v1/auth/refresh` | `refresh_token` | Tek kullanımlık rotation |
| `POST` | `/api/v1/auth/logout` | `refresh_token` | Refresh kaydını revoke eder |
| `GET` | `/api/v1/users/me` | Bearer access JWT | Mevcut kullanıcı |
| `GET` | `/api/v1/auth/me` | Bearer access JWT | Alias |
| `GET` | `/api/v1/staff` | Supervisor/Admin Bearer JWT | Aktif analyst listesi |
| `GET` | `/api/v1/admin/audit-logs?limit=100` | Admin Bearer JWT | Login/lockout/logout audit kayıtları |
| `GET` | `/api/v1/audit-logs?limit=100` | Admin Bearer JWT | Alias |

Login örneği:

```bash
curl -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"analyst","password":"Demo123!"}'
```

### Transaction Service

| Method | Path | Açıklama |
|---|---|---|
| `POST` | `/api/v1/transactions` | İşlem ve case oluşturur, AI çağırır |
| `POST` | `/api/v1/transactions/simulate` | UI uyumlu `{case, requires_verification}` döner |
| `GET` | `/api/v1/transactions` | Tüm işlemler |
| `GET` | `/api/v1/transactions/{id}` | İşlem detayı |
| `GET` | `/api/v1/cases` | Tüm case'ler |
| `GET` | `/api/v1/cases/{id}` | Case detayı |
| `POST` | `/api/v1/cases/{id}/assignments` | Atama, canonical path |
| `PATCH` | `/api/v1/cases/{id}/assignment` | Frontend alias |
| `POST` | `/api/v1/cases/{id}/actions/start-review` | İncelemeyi başlatır |
| `POST` | `/api/v1/cases/{id}/actions/request-customer-verification` | Müşteri doğrulaması ister |
| `POST` | `/api/v1/cases/{id}/customer-verification` | `{ "answer": "BEN_YAPTIM|BEN_YAPMADIM" }` |
| `POST/PATCH` | `/api/v1/cases/{id}/decision` | İnsan final kararı ve Rabbit eventi |
| `PATCH` | `/api/v1/cases/{id}/risk-level` | Supervisor risk override |
| `POST` | `/api/v1/cases/{id}/feedback` | Customer 1-5 yıldız feedback |
| `POST` | `/api/v1/cases/{id}/actions/close` | Yalnız `ONAYLANDI → KAPANDI` |

Transaction create body:

```json
{
  "amount": 24500,
  "type": "TRANSFER",
  "location": "Amsterdam, NL",
  "receiver": "Global Trade",
  "device": "Yeni cihaz",
  "currency": "TRY",
  "customer_id": "usr_customer_1"
}
```

### AI Service

`POST /internal/v1/score` Compose ağı içinde Transaction tarafından çağrılır. Jüri/BFF entegrasyonu için aynı skor sözleşmesi `POST /api/v1/ai/score` üzerinden de standart zarfla yayınlanır.

```json
{
  "amount": 150000,
  "type": "TRANSFER",
  "location": "Amsterdam, NL",
  "receiver": "Global Trade",
  "device": "Yeni cihaz"
}
```

Eşikler:

- `[0.00, 0.40)` → `ONAY`
- `[0.40, 0.90]` → `INCELEME`
- `(0.90, 1.00]` → `BLOK`

### Gamification Service

| Method | Path | Açıklama |
|---|---|---|
| `GET` | `/api/v1/game/leaderboard` | Puan azalan, timestamp ve ID tie-break sırası |
| `GET` | `/api/v1/game/profile/me` | `X-User-Id` header'ı ile profil |
| `GET` | `/api/v1/game/profile/{id}` | Profil |
| `GET` | `/api/v1/game/profiles/{id}` | Alias |
| `GET` | `/api/v1/game/notifications/stream` | Profil puanı değişince SSE |

Puanlar: terminal karar `+10`; aynı eventte `sla_breached=true` ise ayrıca `-5` (net `+5`). Aynı `event_id` ikinci kez puan üretmez.

## HTTP hata kodları

| Kod | Anlam |
|---|---|
| `400` | Bozuk JSON/genel istek |
| `401` | Oturum/token yok veya geçersiz |
| `403` | Rol/kaynak yetkisi yok |
| `404` | Kayıt bulunamadı |
| `409` | Duplicate kullanıcı/veri çakışması |
| `422` | Validation veya state-machine ihlali |
| `423` | Hesap 15 dakika kilitli |
| `503` | Gateway/backend ulaşılamıyor |
