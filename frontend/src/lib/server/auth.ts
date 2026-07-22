import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { analysts } from "@/lib/mock-data";
import { decodeSession, encodeSession } from "@/lib/server/session-token";
import type { Role, SessionUser, User } from "@/types/domain";

const COOKIE_NAME = "fraudcell_session";
const SESSION_SECONDS = 8 * 60 * 60;
interface DemoAccount {
  user: User;
  otp: string;
}

const accounts: DemoAccount[] = [
  { user: { user_id: "usr_customer_1", full_name: "Deniz Yılmaz", role: "CUSTOMER", gsm: "05320000001" }, otp: "1234" },
  { user: analysts[0], otp: "2468" },
  { user: { user_id: "usr_supervisor_1", full_name: "Ozan Acar", role: "SUPERVISOR", gsm: "05320000003" }, otp: "8642" },
];

function normalizeGsm(value: string) {
  return value.replace(/\D/g, "").replace(/^90/, "0");
}

export function authenticate(gsm: string, otp: string): SessionUser | null {
  const normalized = normalizeGsm(gsm);
  const account = accounts.find((item) => normalizeGsm(item.user.gsm) === normalized && item.otp === otp);
  return account ? { user_id: account.user.user_id, full_name: account.user.full_name, role: account.user.role } : null;
}

export async function createSession(user: SessionUser) {
  const token = encodeSession({ user_id: user.user_id, expires_at: Date.now() + SESSION_SECONDS * 1000 });
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_SECONDS,
    path: "/",
  });
}

export async function deleteSession() {
  (await cookies()).delete(COOKIE_NAME);
}

async function readSession(): Promise<SessionUser | null> {
  const payload = decodeSession((await cookies()).get(COOKIE_NAME)?.value);
  if (!payload) return null;
  const user = accounts.find((item) => item.user.user_id === payload.user_id)?.user;
  return user ? { user_id: user.user_id, full_name: user.full_name, role: user.role } : null;
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
