import { createHmac, timingSafeEqual } from "node:crypto";
import type { Role } from "@/types/domain";

const secret = process.env.AUTH_SECRET ?? "fraudcell-demo-session-secret-change-before-production";
const roles: Role[] = ["CUSTOMER", "ANALYST", "SUPERVISOR", "ADMIN"];

export interface SessionPayload {
  user_id: string;
  full_name: string;
  role: Role;
  expires_at: number;
}

function signature(value: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

/** Signs the smallest useful session payload so browser cookies cannot change identity. */
export function encodeSession(payload: SessionPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signature(body)}`;
}

/** Verifies signature and expiry before pages or APIs trust the cookie. */
export function decodeSession(token?: string): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, supplied] = parts;
  const expectedBuffer = Buffer.from(signature(body), "base64url");
  const suppliedBuffer = Buffer.from(supplied, "base64url");
  if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    return typeof payload.user_id === "string" && typeof payload.full_name === "string" &&
      roles.includes(payload.role) && Number.isFinite(payload.expires_at) && payload.expires_at > Date.now()
      ? payload
      : null;
  } catch {
    return null;
  }
}
