import crypto from "node:crypto";

const API = (process.env.API_URL ?? "http://localhost:8080").replace(/\/$/, "");

async function call(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function expectStatus(result, status, label) {
  if (result.status !== status) {
    throw new Error(`${label}: expected ${status}, got ${result.status}: ${JSON.stringify(result.body)}`);
  }
}

function data(result, label) {
  if (!result.body?.success) throw new Error(`${label}: ${JSON.stringify(result.body)}`);
  return result.body.data;
}

const tokens = data(await call("POST", "/api/v1/auth/login", {
  identifier: "customer",
  password: "Demo123!",
}), "login customer");

const tamperedAccess = `${tokens.access_token.slice(0, -1)}${tokens.access_token.endsWith("a") ? "b" : "a"}`;
expectStatus(await call("GET", "/api/v1/cases", null, tamperedAccess), 401, "tampered access token rejected");

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(input) {
  return crypto.createHmac("sha256", process.env.JWT_SECRET ?? "fraudcell-demo-secret").update(input).digest("base64url");
}

const now = Math.floor(Date.now() / 1000);
const expiredPayload = b64url({
  sub: "usr_customer_1",
  user_id: "usr_customer_1",
  role: "CUSTOMER",
  type: "access",
  iat: now - 3600,
  exp: now - 60,
  jti: "expired-test",
});
const expiredUnsigned = `${b64url({ alg: "HS256", typ: "JWT" })}.${expiredPayload}`;
expectStatus(await call("GET", "/api/v1/cases", null, `${expiredUnsigned}.${sign(expiredUnsigned)}`), 401, "expired access token rejected");

const tampered = `${tokens.refresh_token.slice(0, -1)}${tokens.refresh_token.endsWith("a") ? "b" : "a"}`;
expectStatus(await call("POST", "/api/v1/auth/refresh", { refresh_token: tampered }), 401, "tampered refresh token rejected");
expectStatus(await call("POST", "/api/v1/auth/logout", { refresh_token: tokens.refresh_token }), 200, "logout revokes refresh token");
expectStatus(await call("POST", "/api/v1/auth/refresh", { refresh_token: tokens.refresh_token }), 401, "revoked refresh token cannot be reused");

console.log("PASS security-token-manipulation-test");
