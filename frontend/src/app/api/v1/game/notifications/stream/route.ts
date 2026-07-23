import { apiError } from "@/lib/api-response";
import { authorizeApi } from "@/lib/server/api-auth";
import { getAccessToken } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const gatewayUrl = (process.env.GATEWAY_URL ?? "http://localhost:8080").replace(/\/$/, "");

export async function GET() {
  const user = await authorizeApi(["ANALYST", "SUPERVISOR", "ADMIN"]);
  if (user instanceof Response) return user;
  const token = await getAccessToken();
  if (!token) return apiError(401, "Oturum açmanız gerekiyor");

  const response = await fetch(`${gatewayUrl}/api/v1/game/notifications/stream`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => null);

  if (!response?.ok || !response.body) return apiError(response?.status ?? 503, "Bildirim akışı açılamadı");
  return new Response(response.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
