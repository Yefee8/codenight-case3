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

const tampered = `${tokens.refresh_token.slice(0, -1)}${tokens.refresh_token.endsWith("a") ? "b" : "a"}`;
expectStatus(await call("POST", "/api/v1/auth/refresh", { refresh_token: tampered }), 401, "tampered refresh token rejected");
expectStatus(await call("POST", "/api/v1/auth/logout", { refresh_token: tokens.refresh_token }), 200, "logout revokes refresh token");
expectStatus(await call("POST", "/api/v1/auth/refresh", { refresh_token: tokens.refresh_token }), 401, "revoked refresh token cannot be reused");

console.log("PASS security-token-manipulation-test");
