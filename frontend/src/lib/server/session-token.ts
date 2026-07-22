import { createHmac, timingSafeEqual } from "node:crypto";

const secret = process.env.AUTH_SECRET ?? "fraudcell-mock-session-secret-change-before-production";

export interface SessionPayload {
  user_id: string;
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
  const [body, supplied] = token.split(".");
  if (!body || !supplied) return null;
  const expectedBuffer = Buffer.from(signature(body));
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    return payload.expires_at > Date.now() && typeof payload.user_id === "string" ? payload : null;
  } catch {
    return null;
  }
}
