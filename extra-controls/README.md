# Extra Controls — Her Değişiklikte Zorunlu

Bu dizin normatiftir. İlgili kontrol kanıtı olmadan özellik tamamlanmaz. Her PR/değişiklik önce
`pre-change.md`, sonra `pre-merge.md`; DB değişiyorsa ayrıca `rls-and-data.md` kullanır.

Kontrol formatı:

- Kimlik: `CTRL-*`
- Sonuç: `PASS / FAIL / N/A`
- Kanıt: test, migration, contract veya komut yolu
- Son kontrol: ISO tarih
- N/A ise gerekçe zorunlu

“Kodda görünüyor” kanıt değildir; otomatik test/çıktı gerekir.

