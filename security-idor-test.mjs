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

async function login(identifier) {
  return data(await call("POST", "/api/v1/auth/login", { identifier, password: "Demo123!" }), `login ${identifier}`);
}

const victim = await login("customer");
const suffix = String(Date.now()).slice(-9).padStart(9, "0");
const username = `idor_${suffix}`;
const registered = await call("POST", "/api/v1/auth/register", {
  username,
  gsm: `05${suffix}`,
  full_name: "IDOR Test User",
  password: "Demo123!",
});
if (![201, 409].includes(registered.status)) throw new Error(`register attacker failed: ${JSON.stringify(registered.body)}`);
const attacker = await login(username);

const created = data(await call("POST", "/api/v1/transactions", {
  amount: 125000,
  type: "ODEME",
  location: "Istanbul, TR",
  receiver: "Demo POS",
  device: "Web",
  hour: 2,
}, victim.access_token), "create victim transaction");

expectStatus(
  await call("GET", `/api/v1/transactions/${created.transaction_id}`, null, attacker.access_token),
  403,
  "customer cannot read another customer's transaction",
);
expectStatus(
  await call("GET", `/api/v1/cases/${created.case.case_id}`, null, attacker.access_token),
  403,
  "customer cannot read another customer's case",
);

console.log("PASS security-idor-test");
