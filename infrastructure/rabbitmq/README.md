# RabbitMQ Event Omurgası

Ana topic exchange `fraudcell.events.v1`'dir. Mesajlar persistent, queue'lar durable quorum,
consumer ack'i manual ve teslimat at-least-once'dur. İş etkisi outbox + inbox unique event
ID sayesinde effectively-once olur.

Her servis için ana queue, `5s → 30s → 2m → 10m → 30m` retry queue zinciri ve DLQ
vardır. Poison mesaj son denemeden sonra kaybolmaz; DLQ'da incelenir ve kontrollü replay
edilir. `aggregate_version` eski/out-of-order olayın yeni state'i geri almasını engeller.

`definitions-hardened.json`, broker varsayılan vhost ve tek kullanımlık bootstrap hesabıyla
hazır olduktan sonra `rabbitmq-bootstrap` tarafından içe aktarılır. Her servise özel retry/DLX
exchange üretir. Böylece resource
ACL ile Identity hesabı Transaction retry kuyruğuna mesaj enjekte edemez. Topic permission
ayrıca servis hesabını yalnız üretebildiği event routing key'leriyle sınırlar.

Topoloji deterministik üretilir:

```powershell
.\.venv\Scripts\python.exe infrastructure/rabbitmq/generate_hardened_definitions.py
```

Üretimden sonra test, committed JSON ile yeniden üretilen JSON'un bire bir aynı olduğunu
doğrular. Broker yokken domain transaction devam eder ve outbox birikir; broker geri
geldiğinde publisher confirm ile gönderim sürer.

Tek-node Compose quorum queue veri dayanıklılığı sağlar ama broker HA sağlamaz. Production
için üç RabbitMQ node, ayrı failure domain ve TLS zorunludur.
