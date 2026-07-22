# ADR-0007 — Ledger Tabanlı Gamification

- Durum: Kabul edildi
- Tarih: 2026-07-22

## Karar

Puan toplamını overwrite etmek yerine immutable `point_ledger` entry'leri tutulur.
`(source_event_id, rule_code)` unique'tir. False-block gibi geriye dönük düzeltme negatif entry
ekler; badge kazanımı geri alınmaz.

## Sonuç

Duplicate/out-of-order event çift puan yaratmaz. Redis yalnız leaderboard/profil cache'idir.
Gösterilen toplam/seviye minimum sıfırdır; günlük/haftalık sınırlar Europe/Istanbul'dur.

