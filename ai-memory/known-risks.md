# Bilinen Riskler ve Açık Sorular

| ID | Risk | Etki | Mitigation/karar | Durum |
|---|---|---|---|---|
| RISK-001 | Yerel Docker yok | Full Compose runtime doğrulanamıyor | CI/Docker ortamında clean smoke | açık |
| RISK-002 | Sistem Maven yok | Java build yalnız wrapper/network ile | Her serviste Maven Wrapper | açık |
| RISK-003 | Rabbit single node | Broker HA yok | Demo kabul; prod üç node | kabul edildi |
| RISK-004 | Hardened overlays tek-command deneyimi | Yanlış compose kombinasyonu | Ana compose'a final merge + config test | açık |
| RISK-005 | RLS policy/context uyumsuzluğu | 0-row veya veri sızıntısı | Real PG tests + runtime non-owner | açık |
| RISK-006 | Model metric gates sentetik veride geçmeyebilir | +8/demo riski | generator/model iterasyonu, leakage yok | açık |
| RISK-007 | Geç AI re-score insan kararını ezer | kritik domain hatası | version/state guard + tests | açık |
| RISK-008 | Event payload servis implementasyonuyla ayrışır | consumer failure | producer/consumer catalog fixtures | açık |
| RISK-009 | Browser refresh cookie/CORS development farkı | auth akışı bozulur | explicit dev/prod cookie profiles + E2E | açık |
| RISK-010 | PDF'de BLOKLANDI→KAPANDI yok | feedback blocked case'e açılamaz | eklenmedi; mentor doğrulaması gerek | mentor |
| RISK-011 | Demo credential/OTP production'a taşınır | auth bypass | `DEMO_MODE` guard + startup refusal test | açık |
| RISK-012 | Windows shell bind executable bit | container script başlamaz | `sh script`/Python command + CI Compose | açık |

Risk kapatılırken test/commit/runtime kanıtı yazılır; satır sessizce silinmez.

