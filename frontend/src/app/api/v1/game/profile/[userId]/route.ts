import { apiError, apiSuccess } from "@/lib/api-response";
import { authorizeApi } from "@/lib/server/api-auth";
import { getGameProfile } from "@/lib/server/fraud-service";

export async function GET(_: Request, context: { params: Promise<{ userId: string }> }) {
  const user = await authorizeApi(["ANALYST", "SUPERVISOR", "ADMIN"]);
  if (user instanceof Response) return user;
  const { userId } = await context.params;
  if (!userId) return apiError(400, "Kullanıcı kimliği zorunludur");
  if (user.role === "ANALYST" && user.user_id !== userId) return apiError(403, "Başka bir analistin profilini görüntüleyemezsiniz");
  return apiSuccess(await getGameProfile());
}
