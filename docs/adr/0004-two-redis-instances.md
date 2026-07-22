# ADR-0004 — İki Fiziksel Redis

- Durum: Kabul edildi
- Tarih: 2026-07-22

## Karar

Gateway revocation/rate-limit projection'ı AOF + `noeviction` Redis; Gamification türetilmiş
cache'i `allkeys-lru` ayrı Redis kullanır.

## Gerekçe

Revocation güvenlik state'idir ve eviction kabul etmez. Leaderboard kaybedilebilir/rebuild
edilebilir ve eviction ister. Aynı memory pool iki zıt failure semantiğini güvenle sağlayamaz.

## Sonuç

Gateway Redis kesintisinde auth fail-closed `503`; Game cache kesintisinde DB fallback. Token,
OTP, auth kararı ve domain state hiçbirine yazılmaz.

