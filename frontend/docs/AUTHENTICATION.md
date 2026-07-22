# Authentication and authorization

## Why this shape

Authentication happens in `POST /api/v1/auth/login`; the browser never decides its own role. Correct credentials create an eight-hour, HMAC-signed session in an `HttpOnly`, `SameSite=Lax` cookie. Only the user id is stored in the token, and the server resolves the current role.

Page checks live next to server data reads. API checks live at the start of each public Route Handler. Hiding a header link is therefore presentation, not authorization.

Login and logout clear the browser Query cache so data from one role cannot survive an account switch.

`src/proxy.ts` performs only the cheap optimistic signature check for protected pages. This prevents a loading shell from streaming before an anonymous redirect. Secure role checks still run beside each page/API data read.

## Demo accounts

| Role | GSM | OTP | Allowed areas |
|---|---|---:|---|
| Customer | `0532 000 00 01` | `1234` | Customer simulator |
| Analyst | `0532 111 20 26` | `2468` | Case queue and leaderboard |
| Supervisor | `0532 000 00 03` | `8642` | Operations and leaderboard |

Five failed attempts in one minute return `429`. The limiter is process-local because the current BFF is a mock; use Redis or an API gateway when the app runs on multiple instances.

## Production handoff

Set `AUTH_SECRET` to a random secret. Replace the demo account lookup with the identity provider, keep `SessionUser` minimal, and add refresh/revocation through the provider. The cookie and role-gate call sites do not need to change.
