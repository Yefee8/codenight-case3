# Infrastructure

Bu dizin FraudCell'in uygulama dışı çalışma zamanı bileşenlerini barındırır. Kaynak kodu
gibi sürümlenir ve test edilir; çalışan container içinde elle ayar değiştirmek kabul edilmez.

## Bileşenler

- `postgres/`: dört fiziksel PostgreSQL örneğinin güvenli kullanıcı/bootstrap kurulumu.
- `redis/`: Gateway güvenlik projection'ı ile Gamification cache'inin ayrı politikaları.
- `rabbitmq/`: versioned event exchange, quorum queue, retry, DLQ ve servis ACL'leri.
- `observability/`: isteğe bağlı Prometheus ve Grafana profili.

Ana topoloji ve least-privilege RabbitMQ hesapları `docker-compose.yml` dosyasındadır. Yerel
dayanıklılık ayarları `docker-compose.override.yml` tarafından otomatik birleştirilir;
gözlemlenebilirlik için `docker-compose.observability.yml` eklenir.

Yalnız Frontend ve Gateway host'a yayınlanır. DB, Redis, RabbitMQ ve uygulama iç portları
Docker internal network'lerinde kalır. İsteğe bağlı Grafana/Prometheus portları yalnız
`127.0.0.1` üzerinde açılır.

## Statik doğrulama

```powershell
.\.venv\Scripts\python.exe -m pytest tests/infrastructure -q
```

Docker mevcut olduğunda ayrıca:

```powershell
Copy-Item .env.example .env
docker compose config --quiet
docker compose up --build --wait
```

Gerçek secret değerleri repository'ye yazılmaz. `.env*example` yalnız anahtar ve güvensiz
placeholder içerir.
