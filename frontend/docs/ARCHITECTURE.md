# FraudCell frontend architecture

## Request flow

```text
Browser → Next.js page/API → session role gate → shared fraud service → mock data
        ← SSR HTML + hydrated TanStack Query cache ←
```

The UI talks only to `/api/v1/...` through custom hooks. Server Components do not call those HTTP endpoints because that would add a second network hop inside the same application. They call `src/lib/server/fraud-service.ts`, the same data layer used by the BFF routes.

When real microservices arrive, replace the mock calls inside the server service and keep component contracts unchanged.

## Rendering and navigation

- Page files verify the role and resolve their first dataset on the server.
- Client dashboards receive that dataset as TanStack Query `initialData`, so the first HTML already contains useful content.
- `app/loading.tsx` provides the prefetched Suspense fallback for dynamic navigation.
- The request-time header cookie lookup is isolated behind its own Suspense boundary. It cannot block the page skeleton.
- Native Next.js `Link` prefetching is retained instead of adding a second router abstraction.
- The manifest, early install-prompt capture and network-first service worker make the responsive shell installable without caching authenticated data offline.

## BFF response contract

Every JSON route returns `ApiResponse<T>`:

```ts
{ success: true, data: value, error: null }
{ success: false, data: null, error: { code, message } }
```

This stable envelope is shared by auth, queries and mutations.
