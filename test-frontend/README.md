# FraudCell Frontend

React 19 + TypeScript basic test/demo UI'ıdır. İş kuralı veya authorization kararı taşımaz;
Gateway API ve SSE stream'lerini tüketir.

## Ekranlar

- Customer: OTP login, transaction form/risk preset, kendi geçmişi, doğrulama, feedback.
- Analyst: risk/SLA sıralı assigned case, AI açıklaması, state action/type override/decision,
  profile/leaderboard.
- Supervisor: fraud/risk chart, SLA, AI/kategori accuracy, analyst performance, manual queue.
- Admin: staff oluşturma/status/rol profili ve audit log.
- Ortak: loading/error/empty, 401 refresh, 403, 409/422 message, 429 Retry-After ve SSE retry.

Access token yalnız React memory'dedir; local/session storage kullanılmaz. Refresh token server
tarafından `HttpOnly SameSite=Strict Secure` cookie olarak yönetilir. SSE, bearer tokenı URL query
parametresine koymaz; `fetch` stream Authorization header ve `Last-Event-ID` kullanır.

## Komutlar

```powershell
npm ci
npm run typecheck
npm run lint
npm run test:coverage
npm run build
npm run e2e
```

## Environment

| Değişken | Açıklama | Varsayılan |
|---|---|---|
| `VITE_API_BASE_URL` | Gateway public base URL | `http://localhost:8080` |
| `VITE_DEMO_MODE` | Yalnız demo yardımcılarının görünümü | `false` |

Vite değişkenleri public build config'dir; secret konulmaz.

## Güvenlik

React default escaping kullanılır; `dangerouslySetInnerHTML` yoktur. Nginx CSP/frame/nosniff/
referrer/permissions header'ları uygular. Auth/domain response browser cache'e yazılmaz. RoleGuard
yalnız UX katmanıdır; gerçek kontrol Gateway, domain ve DB RLS'tedir.

