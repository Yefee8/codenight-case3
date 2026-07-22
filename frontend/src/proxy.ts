import { NextRequest, NextResponse } from "next/server";
import { decodeSession } from "@/lib/server/session-token";

/** Rejects anonymous page navigation before a loading shell starts streaming. */
export function proxy(request: NextRequest) {
  const session = decodeSession(request.cookies.get("fraudcell_session")?.value);
  return session ? NextResponse.next() : NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/analyst/:path*", "/supervisor/:path*", "/customer/:path*", "/leaderboard/:path*"],
};
