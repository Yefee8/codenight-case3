# Redis Ayrımı

FraudCell iki fiziksel Redis kullanır; farklı amaçlar aynı instance'a veya eviction alanına
konulmaz.

| Instance | İçerik | Kalıcılık | Eviction | Kesinti davranışı |
|---|---|---|---|---|
| Gateway Security | HMAC'li rate-limit sayaçları, session epoch/revocation projection | AOF `everysec` + snapshot | `noeviction` | Authenticated trafik `503`, fail-closed |
| Gamification Cache | Leaderboard sorted-set, kısa ömürlü profil özeti | Yok; DB'den yeniden kurulur | `allkeys-lru` | PostgreSQL fallback, fail-open |

ACL kullanıcıları yalnız kendi `fraudcell:gateway:*` veya `fraudcell:game:*` prefix'ini
görebilir. `KEYS`, `FLUSHDB`, `FLUSHALL` ve `CONFIG` kapalıdır. Gateway rate-limit key'i
GSM/e-posta/IP'yi düz yazmaz; server-side secret ile HMAC'ler.

Redis'e access/refresh token, OTP, parola/hash, authorization sonucu, ham işlem/vaka,
analist notu, müşteri doğrulaması, AI tahmini, audit veya SLA state'i yazılmaz. Gamification
cache source-of-truth değildir; cache kaybı puan ledger'ını değiştiremez.

