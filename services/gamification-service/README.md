# Gamification Service

FraudCell’in puan, seviye, rozet ve leaderboard bounded context’idir. Transaction
veritabanına erişmez; yalnız version’lı RabbitMQ olaylarından kendi read modelini
üretir. PostgreSQL kaynak gerçek, Redis ise 30 saniyelik ve yeniden kurulabilir
bir hızlandırma katmanıdır.

## İş kuralları

- Terminal karar `+10`, 15 dakikadan kısa inceleme `+5`, doğrulanmış fraud `+15`,
  kritik vakayı SLA içinde sonuçlandırma `+15`, SLA ihlali `-5`, yanlış blok `-8`.
- Seviyeler `BRONZ/GUMUS/ALTIN/PLATIN`, sınırları `0/500/1500/3000`; negatif toplam başlangıç seviyesine normalize
  edilir fakat immutable ledger’daki gerçek toplam korunur.
- Altı rozet `earned_badges(analyst_id, badge_code)` tekilliğiyle yalnız bir kez
  kazanılır. Düzeltmeler eski ledger satırını değiştirmez; yeni satır ekler.
- `point_ledger(case_id, reason)` kısmi unique index’i, aynı olgunun farklı veya
  sıra dışı event’lerle iki kez puanlanmasını engeller.

## API

| Endpoint | Roller | Davranış |
|---|---|---|
| `GET /api/v1/game/profile/me` | Analyst, Supervisor, Admin | JWT subject profili |
| `GET /api/v1/game/profiles/{id}` | Analyst, Supervisor, Admin | Türetilmiş oyun profili |
| `GET /api/v1/game/leaderboard?period=daily|weekly` | Analyst, Supervisor, Admin | İstanbul takvimine göre ilk 10 |
| `GET /api/v1/game/badges` | Analyst, Supervisor, Admin | Rozet kataloğu |
| `GET /api/v1/game/notifications/stream` | Analyst, Supervisor, Admin | Puan/rozet SSE akışı |

Normal JSON cevapları ortak `success/data/error/request_id` zarfını kullanır.
JWT imzası servis içinde de RS256/JWKS ile, ayrıca issuer ve audience ile doğrulanır.

## PostgreSQL ve RLS

Migration sahibi `gamification_migrator`; runtime kullanıcısı `gamification_app`
olmalıdır. Runtime rolü tablo sahibi, superuser veya `BYPASSRLS` olamaz. Her tablo
`ENABLE ROW LEVEL SECURITY` ve `FORCE ROW LEVEL SECURITY` taşır.

Her JDBC transaction’ının ilk sorgusu transaction-local bağlamı kurar:

```sql
SELECT set_config('app.user_id', :jwt_subject, true),
       set_config('app.role', :canonical_role, true);
```

`true` parametresi connection pool’a kimlik sızmasını önler. Analyst yalnız kendi
case fact/ledger detayını görür; leaderboard, oyun profili ve kazanılmış rozetler
personel içinde paylaşılabilen türetilmiş görünüm olduğu için tüm personel rollerine
açıktır. Consumer ve outbox yalnız `SERVICE` bağlamıyla yazabilir.

## RabbitMQ, inbox ve outbox

`fraudcell.gamification.events.v1` manual-ack tüketilir. İş etkisi ile
`inbox_events` aynı DB transaction’ında commit olur. Aynı event ID/farklı içerik
reddedilir. Geçici hata 5 sn, 30 sn, 2 dk, 10 dk ve 30 dk retry kuyruklarına;
beş denemeden sonra DLQ’ya gider.

Puan/rozet/seviye event’leri önce `outbox_events` tablosuna yazılır. Poller yalnız
publisher confirm ve mandatory-return kontrolünden sonra `published_at` işaretler;
crash duplicate üretse bile tüketiciler event ID ile dedup eder.

## Redis ve SSE

Yalnız `fraudcell:game:profile:*` ve `fraudcell:game:leaderboard:*` türetilmiş JSON’ları 30 saniye
tutulur. Token, case, not, ham event veya authorization sonucu Redis’e yazılmaz.
Redis okuma/yazma hatası API’yi düşürmez; PostgreSQL fallback kullanılır. Commit
sonrası profil cache’i invalid edilir ve aynı event ID SSE `id` alanı olur.

## Çalıştırma ve test

```powershell
mvn test
mvn verify
```

Unit testler puan kombinasyonlarını, 15 dakika sınırını, altı rozet eşiğini ve
`499/500/1499/1500/2999/3000` seviyelerini kapsar. Docker bulunan CI ortamında
integration profili gerçek PostgreSQL/RabbitMQ/Redis ile migration, FORCE RLS,
duplicate/out-of-order ve cache fallback kontrollerini çalıştırır.

Servis bağımsız olarak değil, kökteki `docker compose up --build` ile gerekli
DB/Redis/RabbitMQ izolasyonu sağlanarak başlatılmalıdır.
