# API Gateway

Reverse proxy + JWT doğrulama + rate limiting + güvenlik başlıkları + CORS.

## Routing
| Prefix | Hedef | Açıklama |
|---|---|---|
| `/api/v1/auth/*` | identity | login/register/refresh/logout — rate limit 20/dk |
| `/api/v1/users/*` | identity | /me, /staff |
| `/api/v1/audit-logs` | identity | admin |
| `/api/v1/transactions/*` | transaction | |
| `/api/v1/cases/*` | transaction | |
| `/api/v1/dashboard/*` | transaction | supervisor/admin |
| `/api/v1/ai/accuracy` | ai | public |
| `/api/v1/game/*` | gamification | leaderboard/profile/badges |

AI'nin `/score /assign /feedback /decisions` endpoint'leri dışarıya kapalıdır — sadece servisler arası çağrı ile kullanılır (X-Service-Token).

## Environment
- `PORT` (8080)
- `JWT_SECRET`
- `*_URL`
