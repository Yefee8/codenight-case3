import { apiError } from "@/lib/api-response";

const gatewayUrl = (process.env.GATEWAY_URL ?? "http://localhost:8080").replace(/\/$/, "");

export class BackendError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function errorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return "Backend isteği tamamlanamadı";
  const body = payload as { detail?: unknown; error?: unknown };
  if (typeof body.error === "string") return body.error;
  if (body.error && typeof body.error === "object" && "message" in body.error) {
    const message = (body.error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  if (typeof body.detail === "string") return body.detail;
  if (body.detail && typeof body.detail === "object" && "message" in body.detail) {
    const message = (body.detail as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Backend isteği tamamlanamadı";
}

export async function backendRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  try {
    const response = await fetch(`${gatewayUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      signal: init.signal ?? AbortSignal.timeout(5_000),
    });
    const payload: unknown = await response.json().catch(() => null);
    const envelope = payload && typeof payload === "object" && "success" in payload
      ? payload as { success: boolean; data: T | null; error?: string | { message?: string } | null }
      : null;
    if (!response.ok || (envelope && !envelope.success)) {
      throw new BackendError(response.status, errorMessage(payload));
    }
    return (envelope ? envelope.data : payload) as T;
  } catch (error) {
    if (error instanceof BackendError) throw error;
    throw new BackendError(503, "Backend servisine ulaşılamıyor");
  }
}

export function backendApiError(error: unknown) {
  return error instanceof BackendError
    ? apiError(error.status, error.message)
    : apiError(503, "Backend servisine ulaşılamıyor");
}
