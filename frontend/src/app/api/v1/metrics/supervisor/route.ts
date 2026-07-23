import { apiSuccess } from "@/lib/api-response";
import { authorizeApi } from "@/lib/server/api-auth";
import { backendApiError } from "@/lib/server/backend";
import { getSupervisorMetrics } from "@/lib/server/fraud-service";

export async function GET() {
  const user = await authorizeApi(["SUPERVISOR", "ADMIN"]);
  if (user instanceof Response) return user;
  try {
    return apiSuccess(await getSupervisorMetrics());
  } catch (error) {
    return backendApiError(error);
  }
}
