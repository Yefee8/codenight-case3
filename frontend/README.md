# FraudCell frontend

This directory contains the React 19 / Next.js frontend built by Docker Compose.

## Run with the platform

From the repository root:

```sh
cp .env.example .env
# Replace every CHANGE_ME value in .env with a unique secret.
docker compose up --build --wait
```

Open `http://localhost:3000`. Browser API traffic stays on the same origin under `/api/v1`;
Next.js forwards it to the private API Gateway container. The Gateway is also exposed at
`http://localhost:8080` for API diagnostics.

The login screen lists local seed credentials. They exist only when `DEMO_MODE=true`; the
customer OTP is read from `DEMO_OTP_CODE` and defaults to `1234` in `.env.example`.

## Run only the frontend

Keep the Docker backend running, then start Next.js outside Docker:

```sh
pnpm install --frozen-lockfile
GATEWAY_INTERNAL_URL=http://localhost:8080 \
AUTH_SECRET="$(openssl rand -hex 32)" \
COOKIE_SECURE=false \
pnpm dev
```

## Checks

```sh
pnpm lint
pnpm build
pnpm check:auth # requires the running demo stack
pnpm check:sse
pnpm check:pwa
```

`check:auth` uses the seeded analyst by default. Override it with `AUTH_TEST_IDENTIFIER` and
`AUTH_TEST_SECRET` when the demo credentials differ.

The browser holds access tokens only in module memory. Refresh tokens are opaque,
`HttpOnly`, `SameSite=Strict` cookies and are never exposed to JavaScript or local storage.
See `docs/AUTHENTICATION.md` and `docs/ARCHITECTURE.md` for the request flow.
