# Service Outage Runbook

## Ortak ilk adımlar

1. Correlation/request ID ve başlayan zamanı kaydet.
2. `docker compose ps` ve ilgili readiness/metrics kontrol et.
3. Secret/PII içeren logları kopyalama; structured safe log kullan.
4. Veri silme/purge/replay yapmadan önce root cause ve kesin hedefi doğrula.

## AI unavailable

Beklenen: Transaction `201`, `prediction_status=UNAVAILABLE`, `BELIRSIZ/INCELEME`, manual
queue. AI readiness ve artifact manifest/hash'i kontrol et. AI düzeldikten sonra 30s/2m/10m
re-score yalnız untouched/unassigned case'i etkiler; insan state'i karşılaştırılır.

## RabbitMQ unavailable

Beklenen: domain write sürer, outbox unpublished count/oldest age artar. Broker disk/memory/
quorum ve credential kontrol edilir. Dönüşte publisher confirm/catch-up izlenir. DLQ purge yok.

## Security Redis unavailable

Beklenen: authenticated Gateway trafiği `503`; login bypass edilmez. AOF/memory/noeviction/
ACL ve connection kontrol edilir. Recovery sonrası revocation projection Identity DB/event ile
reconcile edilmeden trafik açılmaz.

## Game Redis unavailable

Beklenen: leaderboard/profile DB fallback; point event/ledger devam. Redis dönüşte yalnız DB'den
cache rebuild; eski Redis dump source-of-truth kabul edilmez.

## Domain DB unavailable

Yalnız ilgili servis readiness false. Başka servisleri restart etme. Recovery sonrası migration
checksum, RLS role/policy ve outbox/inbox reconciliation kontrol edilir.

## DLQ

Event/schema/error/correlation incelenir; fix+regression test deploy edilir; aynı event ID kontrollü
replay. İş etkisi unique kaldığı doğrulanır.

