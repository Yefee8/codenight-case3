import { cookies } from "next/headers";
import { deleteSession } from "@/lib/server/auth";
import {
  gatewayError,
  gatewayFetch,
  gatewayResponse,
  requestIdFor,
} from "@/lib/server/gateway";

async function clearLocalCookies() {
  await deleteSession();
  (await cookies()).set("fraudcell_refresh", "", {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "strict",
    maxAge: 0,
    path: "/api/v1/auth",
  });
}

/** Attempts server-side revocation, then clears browser auth state even when upstream is down. */
export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const upstream = await gatewayFetch(request, "/api/v1/auth/logout", {
      method: "POST",
      body: null,
    });
    await clearLocalCookies();
    return gatewayResponse(upstream);
  } catch {
    return gatewayError(
      503,
      "LOGOUT_UNAVAILABLE",
      "Oturum kapatma tamamlanamadı.",
      requestId,
    );
  }
}
