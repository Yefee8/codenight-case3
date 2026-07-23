import { apiError, apiSuccess } from "@/lib/api-response";
import { createSession, homeForRole, isIdentityTokens } from "@/lib/server/auth";
import { backendApiError, backendRequest } from "@/lib/server/backend";
import { stripScriptTags } from "@/lib/server/sanitize";
import type { LoginRequest, LoginResult } from "@/types/domain";

const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(request: Request, identifier: string) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${ip}:${identifier.toLowerCase()}`;
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > 20;
}

/** Proxies credentials to Identity and keeps every returned token out of browser JavaScript. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Geçerli bir JSON gövdesi gönderin");
  }
  if (!body || typeof body !== "object") return apiError(422, "Kullanıcı adı veya GSM ile parola zorunludur");
  const input = body as Partial<LoginRequest>;
  const identifier = typeof input.identifier === "string" ? stripScriptTags(input.identifier) : "";
  if (!identifier || typeof input.password !== "string" || !input.password) {
    return apiError(422, "Kullanıcı adı veya GSM ile parola zorunludur");
  }
  // ponytail: in-memory per process, switch to Redis if the BFF runs multiple replicas.
  if (rateLimited(request, identifier)) return apiError(429, "Çok fazla giriş denemesi. Biraz bekleyin");

  try {
    const tokens: unknown = await backendRequest("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password: input.password }),
    });
    if (!isIdentityTokens(tokens)) return apiError(502, "Identity servisi geçersiz bir yanıt döndürdü");

    await createSession(tokens);
    const user = { user_id: tokens.user.user_id, full_name: tokens.user.full_name, role: tokens.user.role };
    const result: LoginResult = { user, redirect_to: homeForRole(user.role) };
    return apiSuccess(result);
  } catch (error) {
    return backendApiError(error);
  }
}
