"use client";

import type { ApiEnvelope, AuthResult } from "@/types/domain";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
let accessToken: string | null = null;
let refreshPromise: Promise<AuthResult> | null = null;

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId: string | null,
    public readonly fieldErrors: Record<string, string[]> = {},
    public readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function setAuthResult(result: AuthResult | null) {
  setAccessToken(result?.access_token ?? null);
}

export function getAccessToken() {
  return accessToken;
}

function url(path: string) {
  return `${API_BASE_URL}${path}`;
}

function retryAfterSeconds(value: string | null) {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - Date.now()) / 1_000));
}

function fallbackMessage(status: number) {
  return ({
    400: "İstek geçersiz.",
    401: "Oturumunuz sona erdi. Lütfen yeniden giriş yapın.",
    403: "Bu işlem için yetkiniz yok.",
    404: "Kaynak bulunamadı.",
    409: "Veri başka bir işlem tarafından güncellendi. Lütfen yenileyin.",
    422: "İstek alanları geçersiz.",
    423: "Hesap geçici olarak kilitli.",
    429: "Çok fazla istek gönderildi.",
    503: "Hizmet geçici olarak kullanılamıyor.",
  } as Record<number, string>)[status] ?? "İstek tamamlanamadı.";
}

async function envelopeFrom<T>(response: Response): Promise<ApiEnvelope<T> | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    return null;
  }
}

async function responseError(response: Response) {
  const envelope = await envelopeFrom<never>(response);
  const retryAfter = retryAfterSeconds(response.headers.get("Retry-After"));
  let message = envelope?.error?.message ?? fallbackMessage(response.status);
  if (response.status === 429 && retryAfter !== null) {
    message = `${message} ${retryAfter} saniye sonra tekrar deneyin.`;
  }
  return new ApiClientError(
    response.status,
    envelope?.error?.code ?? "UNEXPECTED_RESPONSE",
    message,
    envelope?.request_id ?? response.headers.get("X-Request-ID"),
    envelope?.error?.field_errors ?? {},
    retryAfter,
  );
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    let response: Response;
    try {
      response = await fetch(url("/api/v1/auth/refresh"), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json", "X-Request-ID": crypto.randomUUID() },
      });
    } catch {
      throw new ApiClientError(0, "NETWORK_ERROR", "Sunucuya ulaşılamadı.", null);
    }
    if (!response.ok) throw await responseError(response);
    const envelope = await envelopeFrom<AuthResult>(response);
    if (!envelope?.success || !envelope.data) {
      throw new ApiClientError(
        response.status,
        envelope?.error?.code ?? "UNEXPECTED_RESPONSE",
        envelope?.error?.message ?? "Oturum yenilenemedi.",
        envelope?.request_id ?? response.headers.get("X-Request-ID"),
        envelope?.error?.field_errors ?? {},
      );
    }
    setAuthResult(envelope.data);
    return envelope.data;
  })().catch((error) => {
    setAuthResult(null);
    throw error;
  }).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export interface ApiFetchInit extends RequestInit {
  auth?: boolean;
}

/** Adds the in-memory bearer token and retries once through the HttpOnly refresh cookie. */
export async function apiFetch(path: string, init: ApiFetchInit = {}): Promise<Response> {
  const { auth = true, ...requestInit } = init;
  let token = auth ? accessToken : null;
  if (auth && !token) token = (await refreshAccessToken()).access_token;

  async function send(bearer: string | null) {
    const headers = new Headers(requestInit.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    if (!headers.has("X-Request-ID")) headers.set("X-Request-ID", crypto.randomUUID());
    if (requestInit.body && !(requestInit.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
    try {
      return await fetch(url(path), { ...requestInit, headers, credentials: "include" });
    } catch {
      throw new ApiClientError(0, "NETWORK_ERROR", "Sunucuya ulaşılamadı.", null);
    }
  }

  let response = await send(token);
  if (auth && response.status === 401) {
    const refreshed = accessToken && accessToken !== token
      ? accessToken
      : (await refreshAccessToken()).access_token;
    response = await send(refreshed);
  }
  if (!response.ok) {
    if (response.status === 401) setAuthResult(null);
    throw await responseError(response);
  }
  return response;
}

export async function apiRequest<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  const envelope = await envelopeFrom<T>(response);
  if (!envelope?.success || envelope.data === null || envelope.data === undefined) {
    throw new ApiClientError(
      response.status,
      envelope?.error?.code ?? "UNEXPECTED_RESPONSE",
      envelope?.error?.message ?? "Sunucudan geçersiz bir yanıt alındı.",
      envelope?.request_id ?? response.headers.get("X-Request-ID"),
      envelope?.error?.field_errors ?? {},
    );
  }
  return envelope.data;
}
