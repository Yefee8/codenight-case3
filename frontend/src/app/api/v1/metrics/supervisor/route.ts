import { apiSuccess } from "@/lib/api-response";
import { authorizeApi } from "@/lib/server/api-auth";
import { getSupervisorMetrics } from "@/lib/server/fraud-service";

export async function GET() {
  const user = await authorizeApi(["SUPERVISOR", "ADMIN"]);
  if (user instanceof Response) return user;
  return apiSuccess(await getSupervisorMetrics());
}
