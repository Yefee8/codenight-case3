# ADR-0006 — AI Senkron Sınırı ve Güvenli Fallback

- Durum: Kabul edildi
- Tarih: 2026-07-22

## Karar

Transaction feature'ları üretip AI internal `/internal/v1/score` endpoint'ini yaklaşık 1.5 sn
timeout ile senkron çağırır. Timeout/5xx/malformed/NaN/out-of-range/model-not-ready halinde
işlem yine `201`; tahmin `UNAVAILABLE`, risk/tür `BELIRSIZ`, karar `INCELEME` olur.

## Gerekçe

Demo anında skor kullanıcıya dönmeli fakat AI failure Transaction availability'yi düşürmemeli.
Hardcoded fallback skor model çıktısı gibi gösterilemez.

## Sonuç

30 sn/2 dk/10 dk idempotent re-score yalnız insan işlemi başlamamış vaka için yapılır. Geç
model cevabı manuel kararı/override'ı ezmez. Operasyon priority AI tahmini olarak etiketlenmez.

