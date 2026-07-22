import type { ApiEnvelope, AuthResult } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId: string | null,
    public readonly fieldErrors: Record<string, string[]> = {},
    public readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

type TokenReader = () => string | null;
type TokenWriter = (result: AuthResult | null) => void;

export class ApiClient {
  constructor(
    private readonly readToken: TokenReader,
    private readonly writeAuth: TokenWriter,
  ) {}

  async request<T>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> {
    const token = this.readToken();
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("X-Request-ID", crypto.randomUUID());
    if (init.body && !(init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });

    if (response.status === 401 && allowRefresh && !path.includes("/auth/refresh")) {
      const refreshed = await this.refresh();
      if (refreshed) {
        return this.request<T>(path, init, false);
      }
    }

    const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (!response.ok || !body?.success || body.data === null) {
      const error = body?.error;
      throw new ApiRequestError(
        response.status,
        error?.code ?? "UNEXPECTED_RESPONSE",
        error?.message ?? "Sunucudan geçersiz bir yanıt alındı.",
        body?.request_id ?? response.headers.get("X-Request-ID"),
        error?.field_errors ?? {},
        Number.parseInt(response.headers.get("Retry-After") ?? "", 10) || null,
      );
    }
    return body.data;
  }

  private async refresh(): Promise<boolean> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "X-Request-ID": crypto.randomUUID(), Accept: "application/json" },
      });
      const envelope = (await response.json()) as ApiEnvelope<AuthResult>;
      if (!response.ok || !envelope.success || !envelope.data) {
        this.writeAuth(null);
        return false;
      }
      this.writeAuth(envelope.data);
      return true;
    } catch {
      this.writeAuth(null);
      return false;
    }
  }
}

