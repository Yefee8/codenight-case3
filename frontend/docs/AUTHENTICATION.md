# Authentication and authorization

## Token handling

The login card submits an identifier and secret to the same-origin BFF. The BFF maps a GSM
identifier to the Identity customer challenge/login flow and an email identifier to staff login.
The backend decides the user's role.

The returned access token is kept only in browser module memory. The Identity Service issues the
opaque refresh token as a `HttpOnly`, `SameSite=Strict` cookie scoped to `/api/v1/auth`; the BFF
forwards only that named cookie to the Gateway. Neither token is stored in local storage.

Next.js also creates a signed, HttpOnly UI-session cookie containing only user id, display name,
role, and expiry. It lets Server Components gate pages without putting a bearer token in HTML.
It is updated after refresh and removed after logout. Domain services and the Gateway remain the
authorization authority for every resource and mutation.

## Error and lockout behavior

- A 401 triggers one single-flight refresh and one replay of the original request.
- 403 and 404 are displayed as generic authorization/not-found messages.
- Validation and conflict responses preserve field errors and request ids for diagnostics.
- 423 account lockout and 429 rate limits are shown without crashing; `Retry-After` is converted
  to a remaining-seconds message when the Gateway supplies it.
- Logging out attempts backend refresh-session revocation and always clears browser auth state;
  the UI still returns to login when the Gateway cannot confirm revocation.

Five failed staff attempts lock the backend account for 15 minutes. The frontend does not try to
replicate or bypass that policy.

## Local demo identities

With `DEMO_MODE=true`, use the credentials displayed on the login page:

| Role | Identifier | Secret |
|---|---|---|
| Customer | `+90 555 111 11 11` | `1234` |
| Analyst | `analyst1@fraudcell.local` | `Analyst123!` |
| Supervisor | `supervisor@fraudcell.local` | `Supervisor123!` |

Set `AUTH_SECRET` to at least 32 random bytes and `COOKIE_SECURE=true` behind HTTPS. The frontend
fails startup in production when its signing secret is missing or too short.
