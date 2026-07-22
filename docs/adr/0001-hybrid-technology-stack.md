# ADR-0001 — Hibrit Teknoloji Yığını

- Durum: Kabul edildi
- Tarih: 2026-07-22

## Karar

Gateway/Identity/Transaction/Gamification Java 21 + Spring Boot 4.1; AI Python 3.13 +
FastAPI/scikit-learn; UI React 19 + TypeScript olacaktır.

## Gerekçe

Java tarafı transaction, security, state machine ve Rabbit/PostgreSQL ekosisteminde güçlü
compile-time sınırlar sağlar. Python gerçek model eğitimi, feature pipeline ve model metrikleri
için doğal ekosistemdir. React basic dört-rol UI'ı hızla ve test edilebilir kurar.

## Sonuç

Dil bağımsız OpenAPI/JSON Schema zorunludur. Java entity veya Python model sınıfı servisler
arasında paylaşılmaz. İki backend runtime'ı CI ve container build matrisini genişletir.

