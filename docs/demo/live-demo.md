# Canlı Demo Akışı (6–7 dakika)

## Hazırlık

- Clean Compose boot ve bütün readiness yeşil.
- Seed iki kez çalıştırılmış, duplicate yok.
- Customer, Analyst, Supervisor, Admin kullanıcıları hazır.
- Gece + yabancı ülke + yüksek tutar preset'i hazır.
- Terminalde service-stop ve health komutları önceden açık.

## Sıra

1. Customer OTP/login olur ve riskli transaction oluşturur.
2. Response'ta gerçek model version, score, fraud type, decision ve reason gösterilir.
3. Case'in doğru uzman analyst'e kapasite rezervasyonuyla atandığı gösterilir.
4. Analyst assigned listede SLA/risk sırasını görür, incelemeyi başlatır.
5. Customer verification istenir; customer “Ben yapmadım” döner.
6. Raw AI score'un değişmediği, effective risk/temporary hold'un yükseldiği gösterilir.
7. Analyst zorunlu notla BLOKLANDI kararı verir.
8. Point/badge SSE toast ve leaderboard güncellemesi gösterilir.
9. `docker compose stop ai-service`.
10. İkinci transaction yine `201`; BELIRSIZ/INCELEME/manual queue gösterilir.
11. Identity/Transaction/Dashboard/Game'in çalıştığı kanıtlanır.
12. AI geri açılır; untouched case güvenli re-score, manual kararın ezilmediği gösterilir.

## Güvenlik drill

- Customer token ile supervisor endpoint → 403 + audit.
- Başka transaction ID → 404/no leak.
- SQLi/XSS payload → çalışmaz, 5xx yok.
- Tampered/expired JWT → 401.
- Refresh reuse → tüm family revoke.
- Login burst → 429/account lock.

## Sunum konuşma payı

Demo 6–7 dk; mimari/DB ownership/event/AI 4 dk; zorluk/çözüm 2 dk; kalan soru/güvenlik.
Hata olursa sonucu gizlemek yerine correlation ID, fallback ve runbook gösterilir.

