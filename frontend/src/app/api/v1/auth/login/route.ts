import { createSession, homeForRole } from "@/lib/server/auth";
import {
  gatewayError,
  gatewayFetch,
  gatewayResponse,
  readGatewayEnvelope,
  requestIdFor,
} from "@/lib/server/gateway";
import type {
  AuthResult,
  LoginCredentials,
  LoginResult,
  OtpChallengeResult,
  Role,
  SessionUser,
} from "@/types/domain";

const ROLES = new Set<Role>(["CUSTOMER", "ANALYST", "SUPERVISOR", "ADMIN"]);
const JSON_HEADERS = { Accept: "application/json", "Content-Type": "application/json" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAuthResult(value: unknown): value is AuthResult {
  if (!isRecord(value) || !isRecord(value.user)) return false;
  const user = value.user;
  return typeof value.access_token === "string"
    && typeof value.expires_in === "number"
    && typeof user.id === "string"
    && typeof user.first_name === "string"
    && typeof user.last_name === "string"
    && typeof user.role === "string"
    && ROLES.has(user.role as Role)
    && Array.isArray(user.specialties)
    && Array.isArray(user.regions);
}

function toSessionUser(result: AuthResult): SessionUser {
  return {
    user_id: result.user.id,
    full_name: `${result.user.first_name} ${result.user.last_name}`.trim(),
    role: result.user.role,
  };
}

function normalizeGsm(identifier: string) {
  const compact = identifier.replace(/[\s()-]/g, "");
  if (compact.startsWith("+")) return compact;
  if (/^0[1-9][0-9]{9}$/.test(compact)) return `+90${compact.slice(1)}`;
  return `+${compact}`;
}

/** Translates the shared login card into the Identity Service's exact auth flows. */
export async function POST(request: Request) {
  const requestId = requestIdFor(request);
  let credentials: LoginCredentials;
  try {
    credentials = await request.json() as LoginCredentials;
  } catch {
    return gatewayError(400, "INVALID_JSON", "Geçerli bir JSON gövdesi gönderin.", requestId);
  }

  if (
    typeof credentials?.identifier !== "string"
    || typeof credentials.secret !== "string"
    || !credentials.identifier.trim()
    || !credentials.secret.trim()
  ) {
    return gatewayError(
      422,
      "VALIDATION_ERROR",
      "GSM/e-posta ve OTP/parola zorunludur.",
      requestId,
    );
  }

  try {
    const identifier = credentials.identifier.trim();
    let authPath = "/api/v1/auth/staff/login";
    let authBody: Record<string, unknown> = { email: identifier, password: credentials.secret };

    if (!identifier.includes("@")) {
      const gsm = normalizeGsm(identifier);
      const challengeResponse = await gatewayFetch(request, "/api/v1/auth/otp/challenges", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ gsm }),
      });
      if (!challengeResponse.ok) return gatewayResponse(challengeResponse);

      const challenge = await readGatewayEnvelope<OtpChallengeResult>(challengeResponse);
      if (!challenge.envelope) {
        return gatewayError(
          503,
          "INVALID_GATEWAY_RESPONSE",
          "Kimlik servisi geçersiz bir yanıt döndürdü.",
          requestId,
        );
      }
      if (!challenge.envelope.success) {
        return gatewayResponse(challengeResponse, challenge.body);
      }
      if (typeof challenge.envelope.data?.challenge_id !== "string") {
        return gatewayError(
          503,
          "INVALID_GATEWAY_RESPONSE",
          "Kimlik servisi geçersiz bir yanıt döndürdü.",
          challenge.envelope.request_id,
        );
      }

      authPath = "/api/v1/auth/customers/login";
      authBody = {
        challenge_id: challenge.envelope.data.challenge_id,
        gsm,
        otp_code: credentials.secret,
      };
    }

    const authResponse = await gatewayFetch(request, authPath, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(authBody),
    });
    if (!authResponse.ok) return gatewayResponse(authResponse);

    const parsed = await readGatewayEnvelope<AuthResult>(authResponse);
    if (!parsed.envelope) {
      return gatewayError(
        503,
        "INVALID_GATEWAY_RESPONSE",
        "Kimlik servisi geçersiz bir yanıt döndürdü.",
        requestId,
      );
    }
    if (!parsed.envelope.success) return gatewayResponse(authResponse, parsed.body);
    if (!isAuthResult(parsed.envelope.data)) {
      return gatewayError(
        503,
        "INVALID_GATEWAY_RESPONSE",
        "Kimlik servisi geçersiz bir yanıt döndürdü.",
        parsed.envelope.request_id,
      );
    }

    const sessionUser = toSessionUser(parsed.envelope.data);
    await createSession(sessionUser);
    const result: LoginResult = {
      ...parsed.envelope.data,
      redirect_to: homeForRole(sessionUser.role),
    };
    return gatewayResponse(authResponse, JSON.stringify({ ...parsed.envelope, data: result }));
  } catch {
    return gatewayError(
      503,
      "AUTHENTICATION_UNAVAILABLE",
      "Kimlik doğrulama geçici olarak kullanılamıyor.",
      requestId,
    );
  }
}
