import { apiSuccess } from "@/lib/api-response";
import { deleteSession } from "@/lib/server/auth";

export async function POST() {
  await deleteSession();
  return apiSuccess({ logged_out: true });
}
