import { apiError, apiSuccess } from "@/lib/api-response";
import { authorizeApi } from "@/lib/server/api-auth";
import { backendApiError } from "@/lib/server/backend";
import { findCaseFor, startCaseReview } from "@/lib/server/fraud-service";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authorizeApi(["ANALYST"]);
  if (user instanceof Response) return user;
  const { id } = await context.params;
  try {
    const found = await findCaseFor(id, user);
    if (!found) return apiError(404, "Vaka bulunamadı");
    if (found.status !== "ATANDI") return apiError(422, "Yalnızca atanmış vaka incelemeye alınabilir");
    return apiSuccess(await startCaseReview(id));
  } catch (error) {
    return backendApiError(error);
  }
}
