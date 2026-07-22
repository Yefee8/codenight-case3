import { http, HttpResponse } from "msw";

import { ApiClient, ApiRequestError } from "./client";
import { server } from "../test/server";
import type { AuthResult } from "../types";

const BASE = "http://localhost:8080";
const auth: AuthResult = {
  access_token: "new-access-token",
  expires_in: 900,
  user: { id: "u1", first_name: "Ada", last_name: "Lovelace", role: "ANALYST", specialties: [], regions: [] },
};

describe("ApiClient", () => {
  it("canonical success envelope verisini döndürür ve güvenli header gönderir", async () => {
    server.use(http.get(`${BASE}/api/v1/test`, ({ request }) => {
      expect(request.headers.get("Accept")).toBe("application/json");
      expect(request.headers.get("X-Request-ID")).toBeTruthy();
      expect(request.credentials).toBe("include");
      return HttpResponse.json({ success: true, data: { value: 42 }, error: null, request_id: crypto.randomUUID() });
    }));
    const client = new ApiClient(() => null, () => undefined);

    await expect(client.request<{ value: number }>("/api/v1/test")).resolves.toEqual({ value: 42 });
  });

  it("hata kodu, field error ve Retry-After değerini korur", async () => {
    server.use(http.post(`${BASE}/api/v1/test`, () => HttpResponse.json(
      { success: false, data: null, error: { code: "RATE_LIMITED", message: "Yavaşlayın", field_errors: { amount: ["geçersiz"] } }, request_id: "request-1" },
      { status: 429, headers: { "Retry-After": "30" } },
    )));
    const client = new ApiClient(() => "access", () => undefined);

    const error = await client.request("/api/v1/test", { method: "POST" }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 429, code: "RATE_LIMITED", retryAfter: 30, requestId: "request-1" });
  });

  it("401 sonrası HttpOnly refresh cookie akışını bir kez dener", async () => {
    let token: string | null = "old-token";
    let attempts = 0;
    server.use(
      http.get(`${BASE}/api/v1/protected`, ({ request }) => {
        attempts += 1;
        if (request.headers.get("Authorization") === "Bearer new-access-token") {
          return HttpResponse.json({ success: true, data: "ok", error: null, request_id: crypto.randomUUID() });
        }
        return HttpResponse.json({ success: false, data: null, error: { code: "UNAUTHORIZED", message: "expired" }, request_id: crypto.randomUUID() }, { status: 401 });
      }),
      http.post(`${BASE}/api/v1/auth/refresh`, () => HttpResponse.json({ success: true, data: auth, error: null, request_id: crypto.randomUUID() })),
    );
    const client = new ApiClient(() => token, (result) => { token = result?.access_token ?? null; });

    await expect(client.request("/api/v1/protected")).resolves.toBe("ok");
    expect(attempts).toBe(2);
    expect(token).toBe("new-access-token");
  });

  it("refresh başarısızsa auth memory'yi temizler", async () => {
    let token: string | null = "expired";
    server.use(
      http.get(`${BASE}/api/v1/protected`, () => HttpResponse.json({ success: false, data: null, error: { code: "UNAUTHORIZED", message: "expired" }, request_id: crypto.randomUUID() }, { status: 401 })),
      http.post(`${BASE}/api/v1/auth/refresh`, () => HttpResponse.json({ success: false, data: null, error: { code: "REFRESH_REVOKED", message: "revoked" }, request_id: crypto.randomUUID() }, { status: 401 })),
    );
    const client = new ApiClient(() => token, (result) => { token = result?.access_token ?? null; });

    await expect(client.request("/api/v1/protected")).rejects.toMatchObject({ status: 401 });
    expect(token).toBeNull();
  });
});

