# +20 Bonus Durumu

| Bonus | Puan | Durum | Mevcut kanıt | Tamamlanma kapısı |
|---|---:|---|---|---|
| Kendi ML modeli | +8 | tested | 12.000 sentetik kayıt, RF artifact/manifest, model-load ve metrik testleri | container içinde canlı inference |
| RabbitMQ | +5 | implemented-unverified | topology, outbox/inbox, retry/DLQ, ACL ve statik testler | real producer→consumer + outage/DLQ |
| Kategori accuracy | +3 | tested | ground-truth projection, kategori API/metrikleri ve UI grafiği | canlı event sonrası dashboard smoke |
| SSE | +2 | implemented-unverified | Transaction/Game SSE endpointleri ve React canlı güncelleme istemcisi | browser reconnect/live toast smoke |
| GitHub Actions | +2 | implemented-unverified | workflow YAML | remote green workflow/artifacts |
| Toplam kapsam | +20 kodlandı | runtime kanıt bekliyor | Yerel build/test/model yükleme yeşil | Docker ortamında canlı demo |

Amaç +20'dir; Docker bulunmadığı için broker/SSE/CI puanı canlı kanıt tamamlanana kadar
“jüriye kanıtlandı” olarak işaretlenmez.
