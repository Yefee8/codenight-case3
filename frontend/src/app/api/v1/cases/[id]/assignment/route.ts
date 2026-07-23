import { apiError, apiSuccess } from "@/lib/api-response";
import { authorizeApi } from "@/lib/server/api-auth";
import { backendApiError } from "@/lib/server/backend";
import { assignCase, getStaff } from "@/lib/server/fraud-service";
import { stripScriptTags } from "@/lib/server/sanitize";
import type { AssignmentRequest } from "@/types/domain";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authorizeApi(["SUPERVISOR"]);
  if (user instanceof Response) return user;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Geçerli bir JSON gövdesi gönderin");
  }
  if (!body || typeof body !== "object") return apiError(422, "Geçerli bir analist seçin");
  const rawAnalystId = (body as Partial<AssignmentRequest>).analyst_id;
  const analystId = typeof rawAnalystId === "string" ? stripScriptTags(rawAnalystId) : rawAnalystId;
  if (typeof analystId !== "string" || !analystId) return apiError(422, "Geçerli bir analist seçin");

  const { id } = await context.params;
  try {
    const staff = await getStaff();
    if (!staff.some((item) => item.user_id === analystId)) return apiError(422, "Geçerli bir analist seçin");
    return apiSuccess(await assignCase(id, analystId));
  } catch (error) {
    return backendApiError(error);
  }
}
