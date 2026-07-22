# Redis Cache ve Güvenlik State'i Notları

Cache-aside'da DB source-of-truth; miss DB'den doldurur. TTL bounded staleness, event invalidation
hızlı tazelik sağlar; ikisi birlikte kullanılır. Stampede aynı hot key miss olduğunda DB'yi
yükleyebilir; request coalescing/kısa lock gerekir.

Her Redis verisi cache değildir. Revocation projection kaybı aktif çalıntı tokenı tekrar geçerli
gösterebileceğinden güvenlik state'idir. Eviction ve fail-open uygun değildir. Leaderboard ise
DB ledger'dan yeniden üretilebilir.

FraudCell iki instance kullanır: Security AOF+noeviction/fail-closed, Game allkeys-lru/fallback.
PII key'de açık değil HMAC'tir; token/OTP/domain/audit hiçbirine girmez.

Kaynak: [Redis eviction](https://redis.io/docs/latest/develop/reference/eviction/),
[ADR-0004](../docs/adr/0004-two-redis-instances.md).

