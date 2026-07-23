# Authentication and authorization

## Request flow

The browser sends credentials only to the Next.js BFF:

```text
Browser → POST /api/v1/auth/login → Next.js BFF → Gateway → Identity Service
Browser ← user + role only          HttpOnly cookies ← access/refresh tokens
```

Identity validates the password, owns the five-failure lockout, and issues a 15-minute access token plus a rotating seven-day refresh token. The BFF never returns either token in JSON and the UI never writes authentication data to local or session storage.

## Cookies

| Cookie | Lifetime | Scope | Purpose |
|---|---:|---|---|
| `fraudcell_session` | 7 days | `/` | HMAC-signed minimal `user_id`, name and role for SSR and BFF role checks |
| `fraudcell_access` | 15 minutes | `/` | Identity access JWT forwarded only by server code |
| `fraudcell_refresh` | 7 days | `/api/v1/auth` | Rotating Identity refresh JWT |

All three cookies are `HttpOnly`. Session/access use `SameSite=Lax`; refresh uses `SameSite=Strict`. `COOKIE_SECURE=false` is required for the local plain-HTTP Compose demo and must be `true` behind production HTTPS. `AUTH_SECRET` signs the BFF session and must be replaced outside the demo.

`POST /api/v1/auth/refresh` rotates access and refresh tokens and renews the signed BFF session. `POST /api/v1/auth/logout` asks Identity to revoke the refresh token, then expires every local cookie even if Identity is unavailable.

When the access cookie expires, protected page navigation is redirected through `GET /api/v1/auth/refresh` and then back to the requested page. Browser data requests perform one shared refresh on their first `401` and retry once, preventing concurrent dashboard queries from racing refresh-token rotation.

## Authorization

Page checks live next to server data reads. API checks live at the start of each public Route Handler. Hiding a header link is presentation, not authorization.

`src/proxy.ts` performs only the cheap optimistic signature check for protected pages. This prevents a loading shell from streaming before an anonymous redirect. Secure role checks still run beside each page/API data read.

Login and logout clear the browser Query cache so data from one role cannot survive an account switch. BFF checks do not replace JWT/role enforcement on any backend endpoint that is exposed directly through the Gateway.

## Demo accounts

All demo accounts use `Demo123!`.

| Role | Username | GSM | Home |
|---|---|---|---|
| Customer | `customer` | `05320000001` | `/customer` |
| Analyst | `analyst` | `05321112026` | `/analyst` |
| Supervisor | `supervisor` | `05320000003` | `/supervisor` |
| Admin | `admin` | `05320000004` | `/supervisor` |

After five consecutive bad passwords, Identity locks that account for 15 minutes and the BFF preserves its `423 Locked` response. Successful login resets the counter. Login, refresh and authenticated data responses are fetched with `cache: "no-store"` on the server.
