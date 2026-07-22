# FraudCell frontend architecture

## Request flow

```text
Browser UI -> same-origin Next.js /api/v1 BFF -> private API Gateway -> domain services
           <- { success, data, error, request_id } envelope <-
```

Docker Compose builds this Next.js application from `frontend/` and exposes it on port 3000.

Client components use TanStack Query hooks in `src/hooks/use-fraudcell.ts`. The shared client
in `src/lib/api-client.ts` unwraps the canonical envelope, adds the in-memory bearer token,
performs one refresh-and-retry on 401, and converts non-success responses into typed errors.
The BFF forwards only an allowlist of request and response headers and only to the configured
Gateway origin; arbitrary proxy targets and browser-supplied identity headers are not accepted.

## Rendering and resilience

- Server pages enforce the signed UI-session role before rendering a protected dashboard.
- Dashboard data comes from the real Gateway after hydration; existing route loading skeletons
  remain the first loading state.
- HTTP failures are contained by Query/mutation handlers and shown with Sonner/shadcn-style
  toasts. 403 and 404 messages do not disclose additional resource information.
- Transaction creation is successful even when AI scoring is unavailable. Nullable scores and
  `UNAVAILABLE` predictions render as `BELIRSIZ` and remain in the manual queue.
- Authenticated SSE uses a fetch stream so the bearer header can be sent. It reconnects with
  exponential backoff, forwards `Last-Event-ID`, and deduplicates notifications by event type
  plus id before invalidating the relevant query.
- The service worker never caches authenticated pages or API data.

## BFF response contract

All JSON responses use the backend envelope unchanged:

```ts
{
  success: boolean;
  data: T | null;
  error: { code: string; message: string; field_errors?: Record<string, string[]> } | null;
  request_id: string;
}
```

SSE responses are streamed without buffering or JSON transformation.
