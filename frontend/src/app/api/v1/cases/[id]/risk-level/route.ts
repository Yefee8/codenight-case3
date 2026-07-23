import { apiError, apiSuccess } from "@/lib/api-response";
import { authorizeApi } from "@/lib/server/api-auth";
import { backendApiError } from "@/lib/server/backend";
import { overrideRiskLevel } from "@/lib/server/fraud-service";
import { stripScriptTags } from "@/lib/server/sanitize";
import type { RiskLevel, RiskOverrideRequest } from "@/types/domain";

const riskLevels: RiskLevel[] = ["DUSUK", "ORTA", "YUKSEK", "KRITIK"];

function isRiskOverride(value: unknown): value is RiskOverrideRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<RiskOverrideRequest>;
  return riskLevels.includes(body.risk_level as RiskLevel) && typeof body.reason === "string" && body.reason.trim().length >= 3;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authorizeApi(["SUPERVISOR"]);
  if (user instanceof Response) return user;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Geçerli bir JSON gövdesi gönderin");
  }
  if (!isRiskOverride(body)) return apiError(422, "Risk seviyesi ve gerekçe zorunludur");
  const { id } = await context.params;
  try {
    return apiSuccess(await overrideRiskLevel(id, { ...body, reason: stripScriptTags(body.reason) }));
  } catch (error) {
    return backendApiError(error);
  }
}
