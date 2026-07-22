# Redis Tasarımı ve Anahtar Sözleşmesi

## Gateway Security Redis

Örnek key'ler (değerler açık PII değil HMAC identifier'dır):

```text
fraudcell:gateway:rl:user:<hmac-user>:<window>
fraudcell:gateway:rl:ip:<hmac-ip>:<window>
fraudcell:gateway:session-epoch:<uuid>
fraudcell:gateway:revoked-jti:<sha256-jti>
```

Rate mutation atomik Lua/Redis command ile increment+expire yapar. Session epoch Identity
event'inden durable projection'dır. AOF `everysec`, `noeviction`, memory alarmı vardır. Redis
error/memory reject authenticated requesti `503` yapar; “eski revocation yokmuş gibi” devam
edilmez.

## Gamification Cache Redis

```text
fraudcell:game:leaderboard:daily:<yyyy-mm-dd>
fraudcell:game:leaderboard:weekly:<iso-year-week>
fraudcell:game:profile:<analyst-uuid>
```

Sorted-set score aynı puan tie-break bilgisini deterministik encode etmezse DB rank sonucu
cache'lenir; Redis tek başına kanonik sıralama üretmez. TTL 30 sn ve event invalidation birlikte
kullanılır. Cache miss/stampede için kısa lock veya request coalescing; lock timeout olursa DB
sonucu yine döner.

## Yasaklar ve gözlem

`KEYS` production yolunda yok; prefix scan operasyonel ve sınırlıdır. Value/log metriğinde key
suffix'i PII sızdırmaz. Hit/miss/fallback/eviction/memory/rejected-write metriği ayrıdır.
Game Redis yeniden kurma scripti yalnız PostgreSQL source-of-truth okur; seed Redis'e doğrudan
yazmaz.

