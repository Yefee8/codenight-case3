import { apiError, apiSuccess } from "@/lib/api-response";
import { authorizeApi } from "@/lib/server/api-auth";
import { backendApiError } from "@/lib/server/backend";
import { submitCaseFeedback } from "@/lib/server/fraud-service";
import { stripScriptTags } from "@/lib/server/sanitize";
import type { FeedbackRequest } from "@/types/domain";

function isFeedback(value: unknown): value is FeedbackRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<FeedbackRequest>;
  const rating = body.rating;
  return typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5 &&
    (body.note === undefined || typeof body.note === "string");
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authorizeApi(["CUSTOMER"]);
  if (user instanceof Response) return user;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Geçerli bir JSON gövdesi gönderin");
  }
  if (!isFeedback(body)) return apiError(422, "1-5 arası yıldız zorunludur");
  const { id } = await context.params;
  try {
    return apiSuccess(await submitCaseFeedback(id, {
      rating: body.rating,
      note: typeof body.note === "string" ? stripScriptTags(body.note) : undefined,
    }));
  } catch (error) {
    return backendApiError(error);
  }
}
