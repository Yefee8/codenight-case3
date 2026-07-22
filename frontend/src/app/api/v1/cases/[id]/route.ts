import { apiError, apiSuccess } from "@/lib/api-response";
import { authorizeApi } from "@/lib/server/api-auth";
import { findCaseFor } from "@/lib/server/fraud-service";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await authorizeApi(["ANALYST", "SUPERVISOR", "ADMIN"]);
  if (user instanceof Response) return user;
  const { id } = await context.params;
  const found = await findCaseFor(id, user);
  return found ? apiSuccess(found) : apiError(404, "Vaka bulunamadı");
}
