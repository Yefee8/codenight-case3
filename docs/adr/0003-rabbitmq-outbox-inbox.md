# ADR-0003 — RabbitMQ + Transactional Outbox/Inbox

- Durum: Kabul edildi
- Tarih: 2026-07-22

## Karar

Servisler arası kalıcı olaylar durable topic exchange ve quorum queue ile RabbitMQ üzerinden
at-least-once taşınacak. DB değişikliği/outbox aynı transaction; consumer etkisi/inbox aynı
transaction olacaktır.

## Gerekçe

Doğrudan REST fan-out servis bağımsızlığını azaltır. DB transaction ile broker publish'i atomik
yapılamadığından outbox zorunludur. Inbox unique event ID duplicate teslimatı etkisiz kılar.

## Sonuç

Projection'lar eventual consistency'dir. Retry/DLQ/replay operasyonu ve aggregate version
ordering gerekir. Tek-node Compose HA değildir; production üç node ister.

