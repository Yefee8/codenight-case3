# RLS ve Veri Değişikliği Kontrolü

Son kontrol: 2026-07-22

| ID | Kontrol | Fail örneği |
|---|---|---|
| CTRL-RLS-001 | Runtime ve migration datasource ayrı | Uygulama table owner ile çalışıyor |
| CTRL-RLS-002 | Runtime `NOSUPERUSER NOBYPASSRLS` | `rolbypassrls=true` |
| CTRL-RLS-003 | Actor table `ENABLE` + `FORCE` | Yalnız ENABLE |
| CTRL-RLS-004 | SELECT policy default-deny | Eksik context tüm satırları görüyor |
| CTRL-RLS-005 | INSERT/UPDATE `WITH CHECK` | Customer body ile owner ID değiştiriyor |
| CTRL-RLS-006 | Context verified claim'den | Client `X-User-ID` kabul ediliyor |
| CTRL-RLS-007 | `set_config(..., true)` transaction-local | Session SET/pool leak |
| CTRL-RLS-008 | CUSTOMER cross-user test | UUID değişince kayıt dönüyor |
| CTRL-RLS-009 | ANALYST assignment test | Başkasının case'i dönüyor |
| CTRL-RLS-010 | SUPERVISOR/ADMIN domain write ayrımı | Admin case kararı verebiliyor |
| CTRL-RLS-011 | SYSTEM yalnız explicit internal job | HTTP rol claim SYSTEM olabiliyor |
| CTRL-RLS-012 | Outbox/inbox policy minimum | User teknik event payload okuyabiliyor |
| CTRL-RLS-013 | Append-only update/delete yok | Ledger/audit güncellenebiliyor |
| CTRL-RLS-014 | Policy predicate indexli | RLS nedeniyle sequential scan regresyonu |
| CTRL-RLS-015 | Pool reuse testi | Actor A context'i Actor B bağlantısında kalıyor |
| CTRL-RLS-016 | Migration rollback/forward planı | Korumayı geçici kaldıran rollout |

