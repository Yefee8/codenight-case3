import { apiSuccess } from "@/lib/api-response";
import { deleteSession, getRefreshToken } from "@/lib/server/auth";
import { backendRequest } from "@/lib/server/backend";

export async function POST() {
  const refreshToken = await getRefreshToken();
  try {
    if (refreshToken) {
      await backendRequest("/api/v1/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    }
  } catch {
    // Local logout must still succeed if the token is already invalid or Identity is unavailable.
  } finally {
    await deleteSession();
  }
  return apiSuccess({ logged_out: true });
}
