import { createSession, deleteSession } from "@/lib/server/auth";
import {
  gatewayError,
  gatewayFetch,
  gatewayResponse,
  readGatewayEnvelope,
  requestIdFor,
} from "@/lib/server/gateway";
import type { AuthResult, Role, SessionUser } from "@/types/domain";

const ROLES = new Set<Role>(["CUSTOMER", "ANALYST", "SUPERVISOR", "ADMIN"]);

function sessionUserFrom(result: AuthResult | null): SessionUser | null {
  const user = result?.user;
  if (
    !user
    || typeof user.id !== "string"
    || typeof user.first_name !== "string"
    || typeof user.last_name !== "string"
    || !ROLES.has(user.role)
    || typeof result.access_token !== "string"
    || typeof result.expires_in !== "number"
  ) return null;

  return {
    user_id: user.id,
    full_name: `${user.first_name} ${user.last_name}`.trim(),
    role: user.role,
  };
}

/** Rotates the backend refresh cookie and keeps the signed UI session in sync. */
export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const upstream = await gatewayFetch(request, "/api/v1/auth/refresh", {
      method: "POST",
      body: null,
    });
    if (!upstream.ok) {
      if (upstream.status === 401) {
        try { await deleteSession(); } catch { /* Preserve the Identity response. */ }
      }
      return gatewayResponse(upstream);
    }

    const parsed = await readGatewayEnvelope<AuthResult>(upstream);
    if (!parsed.envelope) {
      return gatewayError(
        503,
        "INVALID_GATEWAY_RESPONSE",
        "Kimlik servisi geçersiz bir yanıt döndürdü.",
        requestId,
      );
    }
    if (!parsed.envelope.success) return gatewayResponse(upstream, parsed.body);

    const sessionUser = sessionUserFrom(parsed.envelope.data);
    if (!sessionUser) {
      return gatewayError(
        503,
        "INVALID_GATEWAY_RESPONSE",
        "Kimlik servisi geçersiz bir yanıt döndürdü.",
        parsed.envelope.request_id,
      );
    }

    await createSession(sessionUser);
    return gatewayResponse(upstream, parsed.body);
  } catch {
    return gatewayError(
      503,
      "REFRESH_UNAVAILABLE",
      "Oturum yenileme geçici olarak kullanılamıyor.",
      requestId,
    );
  }
}
