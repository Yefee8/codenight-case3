# Outbox, Inbox ve RabbitMQ Notları

DB commit ile broker publish tek yerel transaction değildir. “DB'yi yaz, sonra publish et”
arasında crash event kaybettirir; “önce publish, sonra DB” hayalet event yaratır. Transactional
outbox domain değişikliğiyle event taslağını aynı DB commit'ine koyar.

At-least-once publisher/consumer crash noktalarında duplicate normaldir. Inbox unique event ID
iş etkisini effectively-once yapar; “exactly once broker” iddiası business transaction'ı tek
başına çözmez.

Ordering global değil aggregate bazında önemlidir. `aggregate_version` eski projection update'ini
reddeder. Poison message sınırsız retry ile kuyruğu kilitlememeli; bounded backoff + DLQ gerekir.

FraudCell Rabbit topic exchange, persistent confirm/mandatory, quorum queue, manual ack,
5s/30s/2m/10m/30m retry kullanır. Broker down domain yazımını durdurmaz; outbox yaş alarmı olur.

Kaynak: [RabbitMQ Reliability](https://www.rabbitmq.com/docs/reliability),
[ADR-0003](../docs/adr/0003-rabbitmq-outbox-inbox.md).

