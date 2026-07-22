import { apiError } from "@/lib/api-response";
import { getSession } from "@/lib/server/auth";
import type { Role, SessionUser } from "@/types/domain";

/** Route handlers use the same role gate as pages and preserve the ApiResponse envelope on denial. */
export async function authorizeApi(allowed: Role[]): Promise<SessionUser | Response> {
  const session = await getSession();
  if (!session) return apiError(401, "Oturum açmanız gerekiyor");
  return allowed.includes(session.role) ? session : apiError(403, "Bu işlem için yetkiniz yok");
}
