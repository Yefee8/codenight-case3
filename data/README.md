# Veri ve Model Artifact'leri

`synthetic/` sabit seed `2026` ile üretilen, PII içermeyen eğitim veri setini ve manifestini;
`model-artifacts/` yeniden üretilebilir model manifestini barındırır.

Ham gerçek müşteri verisi bu repository'ye girmez. Dataset üretimi deterministik olmalı;
manifest satır sayısı, sınıf dağılımı, schema sürümü, seed ve SHA-256 hash içermelidir.
Train/validation/holdout ayrımı customer ID bazında yapılır; aynı müşteri iki split'e düşmez.

Binary/model dosyaları varsayılan olarak commit edilmez. CI modeli yeniden eğitir, hash ve
metrik kapılarını doğrular; sürümlü manifest modelin hangi veri ve dependency'lerle
üretildiğini kanıtlar.

