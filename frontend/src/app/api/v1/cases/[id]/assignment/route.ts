import { apiError, apiSuccess } from "@/lib/api-response";
import { analysts, mockCases } from "@/lib/mock-data";
import { authorizeApi } from "@/lib/server/api-auth";
import type { AssignmentRequest } from "@/types/domain";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authorizeApi(["SUPERVISOR", "ADMIN"]);
  if (user instanceof Response) return user;
  let body: Partial<AssignmentRequest>;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Geçerli bir JSON gövdesi gönderin");
  }
  if (!body.analyst_id || !analysts.some((item) => item.user_id === body.analyst_id)) {
    return apiError(422, "Geçerli bir analist seçin");
  }

  const { id } = await context.params;
  const found = mockCases.find((item) => item.case_id === id);
  if (!found) return apiError(404, "Vaka bulunamadı");

  found.assigned_analyst_id = body.analyst_id;
  found.status = "ATANDI";
  return apiSuccess(found);
}
