import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decodeSession, encodeSession } from "@/lib/server/session-token";
import type { Role, SessionUser } from "@/types/domain";

const SESSION_COOKIE = "fraudcell_session";
const ACCESS_COOKIE = "fraudcell_access";
const REFRESH_COOKIE = "fraudcell_refresh";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const secureCookies = process.env.COOKIE_SECURE === "true";
const roles: Role[] = ["CUSTOMER", "ANALYST", "SUPERVISOR", "ADMIN"];

export interface IdentityTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: SessionUser;
}

/** Rejects malformed upstream auth responses before they become trusted cookies. */
export function isIdentityTokens(value: unknown): value is IdentityTokens {
  if (!value || typeof value !== "object") return false;
  const tokens = value as Partial<IdentityTokens>;
  const user = tokens.user as Partial<SessionUser> | undefined;
  return typeof tokens.access_token === "string" && typeof tokens.refresh_token === "string" &&
    typeof tokens.expires_in === "number" && Number.isFinite(tokens.expires_in) && tokens.expires_in > 0 &&
    typeof user?.user_id === "string" && typeof user.full_name === "string" && roles.includes(user.role as Role);
}

/** Keeps backend tokens server-only while exposing only a signed minimal identity to SSR. */
export async function createSession(tokens: IdentityTokens) {
  const store = await cookies();
  const session = encodeSession({
    user_id: tokens.user.user_id,
    full_name: tokens.user.full_name,
    role: tokens.user.role,
    expires_at: Date.now() + SESSION_SECONDS * 1000,
  });
  store.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    maxAge: SESSION_SECONDS,
    path: "/",
  });
  store.set(ACCESS_COOKIE, tokens.access_token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    maxAge: tokens.expires_in,
    path: "/",
  });
  store.set(REFRESH_COOKIE, tokens.refresh_token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "strict",
    maxAge: SESSION_SECONDS,
    path: "/api/v1/auth",
  });
}

export async function deleteSession() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { httpOnly: true, secure: secureCookies, sameSite: "lax", maxAge: 0, path: "/" });
  store.set(ACCESS_COOKIE, "", { httpOnly: true, secure: secureCookies, sameSite: "lax", maxAge: 0, path: "/" });
  store.set(REFRESH_COOKIE, "", { httpOnly: true, secure: secureCookies, sameSite: "strict", maxAge: 0, path: "/api/v1/auth" });
}

export async function getAccessToken() {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

export async function getRefreshToken() {
  return (await cookies()).get(REFRESH_COOKIE)?.value ?? null;
}

async function readSession(): Promise<SessionUser | null> {
  const payload = decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  return { user_id: payload.user_id, full_name: payload.full_name, role: payload.role };
}

// React cache deduplicates the header/page cookie check within one server render.
export const getSession = cache(readSession);

export const homeForRole = (role: Role) => role === "CUSTOMER" ? "/customer" : role === "SUPERVISOR" || role === "ADMIN" ? "/supervisor" : "/analyst";

/** Pages call this close to their data so partial navigation cannot bypass role checks. */
export async function requireRole(allowed: Role[]) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!allowed.includes(session.role)) redirect(homeForRole(session.role));
  return session;
}
