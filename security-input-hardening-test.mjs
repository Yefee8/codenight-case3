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

const injection = await call("POST", "/api/v1/auth/login", {
  identifier: "customer' OR 1=1 --",
  password: "not-the-password",
});
expectStatus(injection, 401, "SQL injection login bypass rejected");

const customer = data(await call("POST", "/api/v1/auth/login", {
  identifier: "customer",
  password: "Demo123!",
}), "login customer");
const supervisor = data(await call("POST", "/api/v1/auth/login", {
  identifier: "supervisor",
  password: "Demo123!",
}), "login supervisor");
const analyst = data(await call("POST", "/api/v1/auth/login", {
  identifier: "analyst",
  password: "Demo123!",
}), "login analyst");

const created = data(await call("POST", "/api/v1/transactions", {
  amount: 125000,
  type: "ODEME",
  location: "<script>alert(1)</script>Istanbul, TR",
  receiver: "<script>alert(1)</script>Demo POS",
  device: "Web",
  hour: 2,
}, customer.access_token), "create transaction with xss input");

if (created.case.transaction_details.receiver.includes("<script>") || created.case.transaction_details.location.includes("<script>")) {
  throw new Error(`script tag was not stripped: ${JSON.stringify(created.case.transaction_details)}`);
}

const caseId = created.case.case_id;
const overridden = data(await call("PATCH", `/api/v1/cases/${caseId}/risk-level`, {
  risk_level: "KRITIK",
  reason: "<script>x()</script>Manuel risk",
}, supervisor.access_token), "risk override strips script tags");
if (overridden.risk_override.reason.includes("<script>")) throw new Error("risk override reason kept script tag");

expectStatus(await call("PATCH", `/api/v1/cases/${caseId}/assignment`, { analyst_id: "usr_analyst_1" }, supervisor.access_token), 200, "assign case");
expectStatus(await call("POST", `/api/v1/cases/${caseId}/actions/start-review`, null, analyst.access_token), 200, "start review");
expectStatus(await call("PATCH", `/api/v1/cases/${caseId}/decision`, {
  decision: "BLOKLANDI",
  note: "Blok kararı",
}, analyst.access_token), 200, "decide case");
const feedback = data(await call("POST", `/api/v1/cases/${caseId}/feedback`, {
  rating: 5,
  note: "<script>alert(1)</script>Teşekkürler",
}, customer.access_token), "feedback strips script tags");
if (feedback.customer_feedback.note.includes("<script>")) throw new Error("feedback note kept script tag");

console.log("PASS security-input-hardening-test");
