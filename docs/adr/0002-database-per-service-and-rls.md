# ADR-0002 — Fiziksel Database-per-Service ve RLS

- Durum: Kabul edildi
- Tarih: 2026-07-22

## Karar

Dört ayrı PostgreSQL container/volume/network/credential kullanılacak. Actor verili her tablo
`ENABLE` + `FORCE RLS` ve transaction-local trusted context kullanacak. Migration/runtime
hesapları ayrılacak; runtime `NOBYPASSRLS` olacaktır.

## Reddedilenler

- Tek PostgreSQL içinde dört schema: yanlış credential/ağ ile çapraz erişimi fiziksel olarak
  engellemez ve case'in DB-per-service kanıtını zayıflatır.
- Yalnız repository filter: unutulan predicate IDOR'a dönüşür.
- Runtime migration owner: least privilege ve RLS bypass riskini artırır.

## Sonuç

Cross-service join/FK yoktur; projection/eventual consistency gerekir. Testcontainers gerçek
PostgreSQL ile policy ve pooling sızıntısı test edilir.

