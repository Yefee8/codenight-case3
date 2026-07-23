import { apiError, apiSuccess } from "@/lib/api-response";
import { authorizeApi } from "@/lib/server/api-auth";
import { backendApiError } from "@/lib/server/backend";
import { decideCase, findCaseFor } from "@/lib/server/fraud-service";
import { stripScriptTags } from "@/lib/server/sanitize";
import type { DecisionRequest } from "@/types/domain";

function isDecision(value: unknown): value is DecisionRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<DecisionRequest>;
  return (body.decision === "ONAYLANDI" || body.decision === "BLOKLANDI") && typeof body.note === "string" && body.note.trim().length > 0;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authorizeApi(["ANALYST", "SUPERVISOR"]);
  if (user instanceof Response) return user;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Geçerli bir JSON gövdesi gönderin");
  }
  if (!isDecision(body)) return apiError(422, "Karar ve analist notu zorunludur");

  const { id } = await context.params;
  try {
    const found = await findCaseFor(id, user);
    if (!found) return apiError(404, "Vaka bulunamadı");
    if (found.status !== "INCELENIYOR") return apiError(422, "Karar vermeden önce incelemeyi başlatın");
    return apiSuccess(await decideCase(id, { ...body, note: stripScriptTags(body.note) }, user));
  } catch (error) {
    return backendApiError(error);
  }
}
