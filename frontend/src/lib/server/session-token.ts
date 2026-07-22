import { createHmac, timingSafeEqual } from "node:crypto";
import type { SessionUser } from "@/types/domain";

export interface SessionPayload {
  user: SessionUser;
  expires_at: number;
}

function secret() {
  const value = process.env.AUTH_SECRET;
  if (value && (process.env.NODE_ENV !== "production" || value.length >= 32)) return value;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is required");
  return "fraudcell-local-session-secret-change-before-production";
}

function signature(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

/** Signs the smallest useful session payload so browser cookies cannot change identity. */
export function encodeSession(payload: SessionPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signature(body)}`;
}

/** Verifies signature and expiry before pages or APIs trust the cookie. */
export function decodeSession(token?: string): SessionPayload | null {
  if (!token) return null;
  const [body, supplied] = token.split(".");
  if (!body || !supplied) return null;
  const expectedBuffer = Buffer.from(signature(body));
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    return payload.expires_at > Date.now()
      && typeof payload.user?.user_id === "string"
      && typeof payload.user?.full_name === "string"
      && ["CUSTOMER", "ANALYST", "SUPERVISOR", "ADMIN"].includes(payload.user?.role)
      ? payload
      : null;
  } catch {
    return null;
  }
}
