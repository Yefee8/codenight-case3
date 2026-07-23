import { NextRequest, NextResponse } from "next/server";
import { decodeSession } from "@/lib/server/session-token";

/** Rejects anonymous page navigation before a loading shell starts streaming. */
export function proxy(request: NextRequest) {
  const session = decodeSession(request.cookies.get("fraudcell_session")?.value);
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  if (!request.cookies.has("fraudcell_access")) {
    const refresh = new URL("/api/v1/auth/refresh", request.url);
    refresh.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(refresh);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/analyst/:path*", "/supervisor/:path*", "/customer/:path*", "/leaderboard/:path*"],
};
