# Gamification Ledger ve Correction Notları

Mutable total duplicate event ve geriye dönük ground truth düzeltmesinde audit edilemez. Ledger her
puan kuralını kaynak event ile immutable entry yapar; total türetilir. `(event, rule)` unique çift
puanı engeller.

Yanlış block sonradan kesinleşirse eski +puanlar silinmez; −8 correction eklenir. Rozet motivasyon
ödülüdür ve geri alınmaz, fakat toplam/seviye minimum sıfırdan yeniden hesaplanır.

Daily/weekly rank timezone boundary ve tie-break ister. FraudCell Europe/Istanbul, Pazartesi 00:00,
eşit puanda puana daha erken ulaşan sonra UUID sırasını kullanır.

Kaynak karar: [ADR-0007](../docs/adr/0007-ledger-based-gamification.md).

