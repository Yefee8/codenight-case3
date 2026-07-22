# Cache Güvenlik Politikası

## İzin verilen

| Veri | Yer | TTL/kalıcılık | Invalidation |
|---|---|---|---|
| Rate counter | Gateway Security Redis | pencere kadar | expire |
| Session epoch/revocation | Gateway Security Redis | token/session süresi; AOF | Identity event |
| Leaderboard | Game Cache Redis | 30 sn | point/badge event |
| Profil özeti | Game Cache Redis | 30 sn | point/badge/level event |
| JWKS | Gateway process memory | kısa | kid miss/TTL |
| Model artifact | AI process memory | model version | atomic activation |
| Hash'li frontend asset | browser/CDN | uzun immutable | dosya hash'i |

## Yasak

Access/refresh token, OTP, parola/hash, authorization kararı, ham transaction/case, müşteri
cevabı, analyst note, audit, AI score/override/ground truth, SLA/state/manual queue ve kişisel
dashboard response cache'e yazılmaz.

`401/403`, mutation ve hata response'u cache'lenmez. Auth ve domain cevapları `Cache-Control:
no-store`; public statik asset dışındaki Vary/ETag davranışı OpenAPI testinde kontrol edilir.

Security Redis kesintisi fail-closed, Gamification cache kesintisi PostgreSQL fallback ile
fail-open'dır. Bu iki semantik aynı Redis instance'ında güvenli biçimde birleştirilemez.

