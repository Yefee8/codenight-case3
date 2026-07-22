# Sözleşmeler

Servisler runtime domain kütüphanesi paylaşmaz. Dil bağımsız bağlayıcı sınır bu dizindeki
OpenAPI ve JSON Schema dosyalarıdır.

- `common/api-envelope.schema.json`: `{success,data,error,request_id}` zarfı.
- `common/rls-context.schema.json`: yalnız internal trusted actor context biçimi.
- `events/v1/event-envelope.schema.json`: event metadata zarfı.
- `events/v1/catalog.json`: tüm event producer ve zorunlu payload alanları.
- `openapi/conventions.yaml`: ortak security/error/idempotency bileşenleri.

Event ve API değişiklikleri geriye uyumlu ekleme olmalıdır. Alan silme, tür değiştirme veya
anlam değiştirme yeni major contract version gerektirir. Producer/consumer fixture testleri
CI'da çalışır.

