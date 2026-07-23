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

const customer = data(await call("POST", "/api/v1/auth/login", {
  identifier: "customer",
  password: "Demo123!",
}), "login customer");

const created = data(await call("POST", "/api/v1/transactions", {
  amount: 125000,
  type: "ODEME",
  location: "Istanbul, TR",
  receiver: "Demo POS",
  device: "Web",
  hour: 2,
}, customer.access_token), "create customer transaction");

expectStatus(await call("GET", "/api/v1/staff", null, customer.access_token), 403, "customer cannot list staff");
expectStatus(
  await call("PATCH", `/api/v1/cases/${created.case.case_id}/assignment`, { analyst_id: "usr_analyst_1" }, customer.access_token),
  403,
  "customer cannot assign cases",
);
expectStatus(
  await call("PATCH", `/api/v1/cases/${created.case.case_id}/decision`, { decision: "BLOKLANDI", note: "blocked" }, customer.access_token),
  403,
  "customer cannot decide cases",
);
expectStatus(await call("GET", "/api/v1/game/leaderboard?period=daily", null, customer.access_token), 403, "customer cannot read staff leaderboard");

console.log("PASS security-unauthorized-test");
