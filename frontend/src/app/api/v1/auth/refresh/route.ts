import { apiSuccess } from "@/lib/api-response";
import { createSession, deleteSession, getRefreshToken, homeForRole, isIdentityTokens } from "@/lib/server/auth";
import { BackendError, backendApiError, backendRequest } from "@/lib/server/backend";
import type { LoginResult } from "@/types/domain";

async function rotateSession(): Promise<LoginResult> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) throw new BackendError(401, "Oturum yenileme bilgisi bulunamadı");

  const tokens: unknown = await backendRequest("/api/v1/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!isIdentityTokens(tokens)) throw new BackendError(502, "Identity servisi geçersiz bir yanıt döndürdü");

  await createSession(tokens);
  const user = { user_id: tokens.user.user_id, full_name: tokens.user.full_name, role: tokens.user.role };
  return { user, redirect_to: homeForRole(user.role) };
}

/** Rotates provider tokens without ever returning them to browser JavaScript. */
export async function POST() {
  try {
    return apiSuccess(await rotateSession());
  } catch (error) {
    const response = backendApiError(error);
    if (response.status === 401) await deleteSession();
    return response;
  }
}

/** Protected page navigation lands here when the short-lived access cookie expires. */
export async function GET(request: Request) {
  try {
    const result = await rotateSession();
    const requested = new URL(request.url).searchParams.get("next");
    const destination = requested?.startsWith("/") && !requested.startsWith("//") ? requested : result.redirect_to;
    return new Response(null, { status: 303, headers: { Location: destination } });
  } catch {
    await deleteSession();
    return new Response(null, { status: 303, headers: { Location: "/login" } });
  }
}
