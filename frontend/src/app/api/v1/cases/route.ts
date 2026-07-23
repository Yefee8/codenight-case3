import { apiSuccess } from "@/lib/api-response";
import { authorizeApi } from "@/lib/server/api-auth";
import { backendApiError } from "@/lib/server/backend";
import { listCasesFor } from "@/lib/server/fraud-service";

export async function GET() {
  const user = await authorizeApi(["ANALYST", "SUPERVISOR", "ADMIN"]);
  if (user instanceof Response) return user;
  try {
    return apiSuccess(await listCasesFor(user));
  } catch (error) {
    return backendApiError(error);
  }
}
