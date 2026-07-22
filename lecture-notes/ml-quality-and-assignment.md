# ML Leakage, Calibration ve Assignment Notları

Random row split aynı müşterinin davranış imzasını train/test'e taşıyıp leakage yaratabilir; split
customer group bazında yapılır. Fraud imbalance'da accuracy yanıltıcıdır; PR-AUC, fraud recall,
category recall ve calibration/Brier gerekir.

Risk score karar olasılığı olarak gösteriliyorsa calibration önemlidir. Threshold boundary testleri
özellikle 0.40/0.90 için açık olmalıdır. Artifact tek başına yetmez; dataset hash, feature schema,
dependency ve seed manifesti gerekir.

Assignment score uygunluğu optimize eder ama kapasite/fairness/starvation etkisi vardır. Cold-start
performansı 0.50, capacity hard guard, deterministic tie-break ve son atama zamanı kullanılır.
AI recommendation kesin rezervasyon değildir.

FraudCell farklı girdiye farklı model çıktısı, serialize/load parity, unknown category fallback ve
immutable holdout metric gates ile mock olmadığını kanıtlar.

