import { apiError, apiSuccess } from "@/lib/api-response";
import { authenticate, createSession, homeForRole } from "@/lib/server/auth";
import type { LoginRequest, LoginResult } from "@/types/domain";

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

function clientKey(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function isRateLimited(key: string) {
  const now = Date.now();
  const state = attempts.get(key);
  if (!state || state.resetAt <= now) {
    attempts.set(key, { count: 0, resetAt: now + WINDOW_MS });
    return false;
  }
  return state.count >= MAX_ATTEMPTS;
}

function recordFailure(key: string) {
  const state = attempts.get(key);
  if (state) state.count += 1;
}

/** Validates mock credentials server-side and issues a signed HttpOnly session cookie. */
export async function POST(request: Request) {
  const key = clientKey(request);
  if (isRateLimited(key)) return apiError(429, "Çok fazla deneme. Bir dakika sonra tekrar deneyin");

  let body: Partial<LoginRequest>;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Geçerli bir JSON gövdesi gönderin");
  }
  if (typeof body.gsm !== "string" || typeof body.otp !== "string" || body.otp.length !== 4) {
    return apiError(422, "GSM ve dört haneli OTP zorunludur");
  }

  const user = authenticate(body.gsm, body.otp);
  if (!user) {
    recordFailure(key);
    return apiError(401, "GSM veya OTP hatalı");
  }

  attempts.delete(key);
  await createSession(user);
  const result: LoginResult = { user, redirect_to: homeForRole(user.role) };
  return apiSuccess(result);
}

// ponytail: process-local throttling is enough for mocks; use a shared store when instances scale out.
