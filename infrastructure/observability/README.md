# Gözlemlenebilirlik

Core sistem Prometheus/Grafana olmadan çalışır. İsteğe bağlı profil bütün Java actuator
metriklerini ve FastAPI `/metrics` endpoint'ini toplar:

```powershell
docker compose -f docker-compose.yml -f docker-compose.observability.yml --profile observability up
```

Loglar JSON, UTC timestamp, `request_id`, `correlation_id`, `trace_id`, servis ve güvenli
actor ID içerir. Parola, OTP, token, GSM, e-posta, recipient veya müşteri cevabı loglanmaz.
HTTP ve event akışında aynı correlation ID taşınır.

Önerilen alarm sınıfları: yüksek 5xx, AI timeout, outbox yaşı, DLQ derinliği, SLA breach,
Redis `noeviction` yazma hatası, login lockout artışı ve model readiness kaybıdır.

