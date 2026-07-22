import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decodeSession, encodeSession } from "@/lib/server/session-token";
import type { Role, SessionUser } from "@/types/domain";

const COOKIE_NAME = "fraudcell_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export async function createSession(user: SessionUser) {
  const token = encodeSession({ user, expires_at: Date.now() + SESSION_SECONDS * 1000 });
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "strict",
    maxAge: SESSION_SECONDS,
    path: "/",
  });
}

export async function deleteSession() {
  (await cookies()).delete(COOKIE_NAME);
}

async function readSession(): Promise<SessionUser | null> {
  const payload = decodeSession((await cookies()).get(COOKIE_NAME)?.value);
  return payload?.user ?? null;
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
