import { apiError, apiSuccess } from "@/lib/api-response";
import { mockCases } from "@/lib/mock-data";
import { authorizeApi } from "@/lib/server/api-auth";
import type { DecisionRequest } from "@/types/domain";

function isDecision(value: unknown): value is DecisionRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<DecisionRequest>;
  return (body.decision === "ONAYLANDI" || body.decision === "BLOKLANDI") && typeof body.note === "string" && body.note.trim().length > 0;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authorizeApi(["ANALYST", "ADMIN"]);
  if (user instanceof Response) return user;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Geçerli bir JSON gövdesi gönderin");
  }
  if (!isDecision(body)) return apiError(422, "Karar ve analist notu zorunludur");

  const { id } = await context.params;
  const found = mockCases.find((item) => item.case_id === id);
  if (!found) return apiError(404, "Vaka bulunamadı");
  if (user.role === "ANALYST" && found.assigned_analyst_id !== user.user_id) return apiError(403, "Yalnızca size atanmış vakalarda karar verebilirsiniz");

  found.status = body.decision;
  return apiSuccess(found);
}
