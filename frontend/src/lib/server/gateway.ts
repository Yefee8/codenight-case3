import { randomUUID } from "node:crypto";
import type { ApiResponse } from "@/types/domain";

const REQUEST_HEADERS = [
  "accept",
  "authorization",
  "cache-control",
  "content-type",
  "idempotency-key",
  "last-event-id",
  "pragma",
  "x-request-id",
] as const;

const RESPONSE_HEADERS = [
  "cache-control",
  "content-type",
  "etag",
  "retry-after",
  "x-request-id",
] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONNECT_TIMEOUT_MS = 10_000;

interface GatewayRequestInit {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
}

export function requestIdFor(request: Request) {
  const candidate = request.headers.get("x-request-id");
  return candidate && UUID_PATTERN.test(candidate) ? candidate.toLowerCase() : randomUUID();
}

export function gatewayError(
  status: number,
  code: string,
  message: string,
  requestId: string = randomUUID(),
) {
  const body: ApiResponse<never> = {
    success: false,
    data: null,
    error: { code, message },
    request_id: UUID_PATTERN.test(requestId) ? requestId : randomUUID(),
  };
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Request-ID": body.request_id,
    },
  });
}

function upstreamUrl(path: string) {
  const configured = process.env.GATEWAY_INTERNAL_URL;
  if (!configured) throw new Error("GATEWAY_INTERNAL_URL is not configured");

  const queryAt = path.indexOf("?");
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  if (pathname !== "/api/v1" && !pathname.startsWith("/api/v1/")) {
    throw new Error("Only API Gateway v1 paths may be proxied");
  }

  const target = new URL(configured);
  target.pathname = pathname;
  target.search = queryAt === -1 ? "" : path.slice(queryAt);
  target.hash = "";
  return target;
}

function refreshCookie(cookieHeader: string | null) {
  return cookieHeader
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith("fraudcell_refresh="));
}

function forwardedRequestHeaders(request: Request, extra?: HeadersInit) {
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const cookie = refreshCookie(request.headers.get("cookie"));
  if (cookie) headers.set("cookie", cookie);

  const overrides = new Headers(extra);
  for (const name of REQUEST_HEADERS) {
    const value = overrides.get(name);
    if (value) headers.set(name, value);
  }
  const overrideCookie = refreshCookie(overrides.get("cookie"));
  if (overrideCookie) headers.set("cookie", overrideCookie);

  if (!headers.has("x-request-id")) headers.set("x-request-id", requestIdFor(request));
  return headers;
}

function forwardedResponseHeaders(upstream: Response) {
  const headers = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  const source = upstream.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = source.getSetCookie?.() ?? [];
  if (setCookies.length) {
    for (const cookie of setCookies) headers.append("set-cookie", cookie);
  } else {
    const cookie = upstream.headers.get("set-cookie");
    if (cookie) headers.append("set-cookie", cookie);
  }
  return headers;
}

/** Calls only the configured API Gateway and returns its raw response. */
export async function gatewayFetch(
  request: Request,
  path: string,
  init: GatewayRequestInit = {},
) {
  const requestId = requestIdFor(request);
  try {
    const method = (init.method ?? request.method).toUpperCase();
    const hasBodyOverride = Object.prototype.hasOwnProperty.call(init, "body");
    let body = hasBodyOverride ? init.body : undefined;
    if (!hasBodyOverride && request.body && method !== "GET" && method !== "HEAD") {
      body = await request.arrayBuffer();
    }
    if (method === "GET" || method === "HEAD") body = undefined;

    const headers = forwardedRequestHeaders(request, init.headers);
    headers.set("x-request-id", requestId);
    const controller = new AbortController();
    const abort = () => controller.abort(request.signal.reason);
    if (request.signal.aborted) abort();
    else request.signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    try {
      return await fetch(upstreamUrl(path), {
        method,
        headers,
        body,
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abort);
    }
  } catch {
    return gatewayError(
      503,
      "GATEWAY_UNAVAILABLE",
      "API Gateway'e geçici olarak ulaşılamıyor.",
      requestId,
    );
  }
}

/** Preserves status and approved headers; an untouched body remains a live stream for SSE. */
export function gatewayResponse(upstream: Response, body: BodyInit | null = upstream.body) {
  const bodyForbidden = upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
  return new Response(bodyForbidden ? null : body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: forwardedResponseHeaders(upstream),
  });
}

export async function readGatewayEnvelope<T>(response: Response) {
  const body = await response.text();
  try {
    return { body, envelope: JSON.parse(body) as ApiResponse<T> };
  } catch {
    return { body, envelope: null };
  }
}

export async function proxyGateway(request: Request, path: string) {
  return gatewayResponse(await gatewayFetch(request, path));
}
