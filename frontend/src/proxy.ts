import { NextRequest, NextResponse } from "next/server";
import { decodeSession } from "@/lib/server/session-token";
import type { Role } from "@/types/domain";

const protectedRoutes: { path: string; roles: Role[] }[] = [
  { path: "/analyst", roles: ["ANALYST"] },
  { path: "/supervisor", roles: ["SUPERVISOR", "ADMIN"] },
  { path: "/customer", roles: ["CUSTOMER"] },
  { path: "/leaderboard", roles: ["ANALYST", "SUPERVISOR", "ADMIN"] },
];

function homeForRole(role: Role) {
  if (role === "CUSTOMER") return "/customer";
  if (role === "SUPERVISOR" || role === "ADMIN") return "/supervisor";
  return "/analyst";
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const isSecure = process.env.COOKIE_SECURE === "true";
  const csp = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`} https://fonts.cdnfonts.com https://fonts.googleapis.com;
    style-src-attr 'unsafe-inline';
    font-src 'self' data: https://fonts.cdnfonts.com https://fonts.gstatic.com;
    img-src 'self' blob: data:;
    connect-src 'self';
    worker-src 'self' blob:;
    manifest-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    ${isSecure ? "upgrade-insecure-requests;" : ""}
  `.replace(/\s{2,}/g, " ").trim();
  const protectedRoute = protectedRoutes.find(({ path }) =>
    request.nextUrl.pathname === path || request.nextUrl.pathname.startsWith(`${path}/`));
  const session = decodeSession(request.cookies.get("fraudcell_session")?.value);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  let response: NextResponse;
  if (protectedRoute && !session) {
    response = NextResponse.redirect(new URL("/login", request.url));
  } else if (protectedRoute && session && !protectedRoute.roles.includes(session.user.role)) {
    response = NextResponse.redirect(new URL(homeForRole(session.user.role), request.url));
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
