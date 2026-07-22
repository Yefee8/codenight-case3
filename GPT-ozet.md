Evet. Hatta bu case'i okuduktan sonra şunu söyleyebilirim: **jüri aslında CRUD istemiyor, distributed system tasarlamanızı istiyor.** PDF'deki gereksinimler aslında event-driven architecture, DDD, CQRS'e çok yakın. 

Ben olsam bu projeyi aşağıdaki gibi tasarlardım.

---

# Genel Mimari

```
                Next.js Frontend
                      |
                 API Gateway
                      |
 -----------------------------------------------------
 |           |             |             |
Identity   Transaction     AI       Gamification
Service      Service      Service      Service
 |             |             |             |
Postgres    Postgres     Postgres     Postgres+Redis
 |             |             |             |
 ---------------- Kafka / RabbitMQ ---------------
```

Redis burada iki iş yapacak

* cache
* leaderboard

Kafka ise bütün eventleri taşıyacak.

---

# Identity Service

Bu servis tamamen authentication.

Database:

```
users
-----

id
first_name
last_name
gsm
email
password_hash
role
status
created_at
updated_at
```

```
refresh_tokens

id
user_id
token_hash
expires_at
revoked
created_at
```

```
audit_logs

id
user_id
action
resource
success
ip
metadata(json)
created_at
```

```
user_specialties

user_id
specialty
```

---

## JWT

Access Token

```
{
 id
 role
 specialties
 region
}
```

15 dakika.

Refresh Token

DB'de tutulacak.

Rotation yapılacak.

Reuse olursa

```
logout all sessions
```

PDF bunu özellikle istiyor. 

---

# Transaction Service

Bu servis sistemin merkezi.

## transactions

```
id
trx_number
customer_id
amount
type
receiver
device
city
status
risk_score
risk_level
fraud_type
created_at
```

---

## fraud_cases

```
id
transaction_id

assigned_to

status

decision

decision_note

sla_deadline

customer_verified

created_at
updated_at
closed_at
```

---

## customer_feedback

```
id
case_id
rating
created_at
```

---

## case_history

State machine'i tutacak.

```
id

case_id

from

to

performed_by

note

created_at
```

Böylece dashboard geçmişi de görebilir.

---

# AI Service

Bu servis sadece AI.

Database

```
predictions

id

transaction_id

risk_score

fraud_type

decision

model_version

created_at
```

---

Accuracy için

```
prediction_feedback

prediction_id

predicted_type

actual_type

correct
```

Dashboard buradan accuracy hesaplayacak.

---

# Gamification

```
points

id

user_id

point

reason

created_at
```

```
badges

id

name

description
```

```
user_badges

user_id

badge_id

created_at
```

Redis

```
leaderboard:daily

leaderboard:weekly
```

Sorted Set.

```
ZADD leaderboard ...
```

---

# Event Driven

Kafka topicleri

```
transaction.created

transaction.updated

transaction.blocked

transaction.closed

customer.verified

customer.feedback

ai.predicted

ai.corrected

badge.earned

points.changed

user.created

user.locked

audit.created
```

Bunların hepsi ayrı consumerlar.

---

# Frontend

Ben kesinlikle

```
Next.js

TanStack Query

Zustand

Tailwind

Shadcn

Recharts
```

kullanırım.

---

# Cache Stratejisi

## Static

Badge listesi

```
24 saat
```

cache.

---

## User

```
/me
```

5 dakika.

---

## Dashboard

Supervisor

```
15 saniye
```

stale.

TanStack

```
staleTime

refetchInterval
```

---

## Leaderboard

Redis

Frontend

```
30 sn
```

cache.

---

## Transactions

Pagination.

```
50

100

200
```

Sayfalı.

Infinite Query.

---

# Optimistic Update

Analist

```
Case

↓

BLOCK
```

Frontend direkt

```
BLOCKED
```

gösterir.

Backend başarısız olursa rollback.

---

# Realtime

Bence WebSocket.

Sebebi

Dashboard

Analist

Müşteri

üçü de canlı değişiyor.

Örneğin

```
badge.earned

↓

toast
```

```
transaction.assigned

↓

yeni kart ekleniyor
```

```
customer verified

↓

case refresh
```

---

# API

```
POST /auth/login

POST /auth/register

POST /auth/refresh

GET /users/me
```

---

```
POST /transactions

GET /transactions

GET /transactions/:id
```

---

```
PATCH /cases/:id/status

PATCH /cases/:id/decision

PATCH /cases/:id/assign
```

---

```
GET /dashboard

GET /dashboard/sla

GET /dashboard/analytics
```

---

```
GET /leaderboard

GET /profile

GET /badges
```

---

# RLS (Row Level Security)

Bu kısmı çok kritik.

Aslında siz PostgreSQL kullanacağınız için **RLS'yi veritabanında değil, servis katmanında uygulamanız daha doğru olur.** Çünkü her mikroservisin kendi veritabanı var ve servisler arası erişim API/Gateway üzerinden yapılmalı. 

Yine de PostgreSQL RLS kullanacak olsaydım kurallar şöyle olurdu:

### Customer

```
customer_id = auth.uid()
```

Sadece kendi transactionlarını görebilir.

---

Analist

```
assigned_to = auth.uid()
```

Sadece kendisine atanmış caseleri görebilir.

---

Supervisor

```
TRUE
```

Hepsini görebilir.

---

Admin

```
TRUE
```

Hepsini görebilir.

---

Audit

```
role = admin
```

Sadece admin.

---

# Authorization

Gateway sadece

JWT doğrular.

Servis içinde

```
@Roles()

@Permission()
```

şeklinde ikinci kontrol yapılır.

Yani

```
Gateway

↓

JWT doğrulandı

↓

Transaction Service

↓

Role kontrolü

↓

Business Rule

↓

Response
```

---

# State Machine

Ben bunu enum yerine tabloyla yönetirdim.

```
case_status

NEW

ASSIGNED

INVESTIGATING

CUSTOMER_VERIFICATION

APPROVED

BLOCKED

CLOSED
```

Transition tablosu

```
NEW
↓

ASSIGNED

✔
```

```
BLOCKED

↓

NEW

❌
```

Böylece geçişleri dinamik doğrulamak kolay olur ve PDF'deki durum geçiş kurallarını (422 döndürme gibi) merkezi bir yapıdan yönetebilirsiniz. 

---

# Güvenlik

PDF'deki canlı güvenlik testleri düşünüldüğünde şu önlemleri mutlaka eklerdim: 

* API Gateway'de rate limiting
* Helmet/CSP
* CORS whitelist
* Zod veya Valibot ile tüm request validation
* Parametreli SQL sorguları (ORM/Query Builder)
* HTTPOnly + Secure refresh token cookie
* CSRF koruması (cookie tabanlı akışta)
* XSS sanitization (özellikle analist notları)
* Audit log middleware
* Idempotency-Key desteği (işlem oluşturma endpoint'i için)
* Correlation ID ile istek takibi
* Retry + Dead Letter Queue (Kafka/RabbitMQ)
* Circuit Breaker (AI servisi ulaşılamazsa işlemi `BELIRSIZ` olarak manuel kuyruğa alma)

---

## Jüriyi en çok etkileyecek mimari

Bence ödül alabilecek seviyede bir teknoloji seçimi şöyle olurdu:

* **Frontend:** Next.js 15 + React + TanStack Query + Zustand + Tailwind + shadcn/ui + Recharts
* **API Gateway:** Kong veya Traefik
* **Identity Service:** NestJS + PostgreSQL
* **Transaction Service:** NestJS + PostgreSQL
* **AI Service:** FastAPI + scikit-learn (veya hibrit kural tabanlı + ML)
* **Gamification Service:** NestJS + PostgreSQL + Redis (leaderboard için Sorted Sets)
* **Event Bus:** Kafka (bonus puan için de avantaj sağlar)
* **Realtime:** WebSocket (Socket.IO) veya SSE
* **Observability:** OpenTelemetry + Prometheus + Grafana (bonus olmasa da sunumda büyük etki bırakır)
* **Containerization:** Docker Compose (gateway + servisler + veritabanları + Kafka + Redis)

Bu mimari, PDF'deki zorunlu gereksinimlerin (database-per-service, event tabanlı iletişim, servis bağımsızlığı, AI servisi kapalıyken sistemin çalışmaya devam etmesi, gerçek zamanlı bildirimler ve güvenlik testleri) tamamını karşılayacak şekilde ölçeklenebilir ve sunum sırasında teknik kararlarınızı rahatça savunabileceğiniz profesyonel bir yapı oluşturur.   
