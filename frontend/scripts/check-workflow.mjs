import assert from "node:assert/strict";

const base = process.env.AUTH_BASE_URL ?? "http://localhost:3000";

function setCookies(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*fraudcell_)/) : [];
}

async function login(identifier) {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier, password: "Demo123!" }),
  });
  assert.equal(response.status, 200, `${identifier} login failed`);
  return setCookies(response.headers).map((row) => row.split(";", 1)[0]).join("; ");
}

async function call(cookie, path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { cookie, "content-type": "application/json", ...init.headers },
  });
  return { response, body: await response.json() };
}

const customer = await login("customer");
const created = await call(customer, "/api/v1/transactions/simulate", {
  method: "POST",
  body: JSON.stringify({ amount: 150000, type: "TRANSFER", receiver: "Global Trade", device: "Yeni cihaz", location: "Amsterdam, NL" }),
});
assert.equal(created.response.status, 201);
assert.equal(created.body.data.case.status, "YENI");
assert.equal(created.body.data.case.ai_analysis.recommended_decision, "BLOK");
const caseId = created.body.data.case.case_id;

const admin = await login("admin");
const denied = await call(admin, `/api/v1/cases/${caseId}/assignment`, {
  method: "PATCH",
  body: JSON.stringify({ analyst_id: "usr_analyst_1" }),
});
assert.equal(denied.response.status, 403, "admin case mutation must stay read-only");

const supervisor = await login("supervisor");
const assigned = await call(supervisor, `/api/v1/cases/${caseId}/assignment`, {
  method: "PATCH",
  body: JSON.stringify({ analyst_id: "usr_analyst_1" }),
});
assert.equal(assigned.response.status, 200);
assert.equal(assigned.body.data.status, "ATANDI");

const analyst = await login("analyst");
const before = await call(analyst, "/api/v1/game/profile/usr_analyst_1");
assert.equal(before.response.status, 200);

const review = await call(analyst, `/api/v1/cases/${caseId}/actions/start-review`, { method: "POST" });
assert.equal(review.response.status, 200);
assert.equal(review.body.data.status, "INCELENIYOR");

const decided = await call(analyst, `/api/v1/cases/${caseId}/decision`, {
  method: "PATCH",
  body: JSON.stringify({ decision: "BLOKLANDI", note: "Uçtan uca demo kararı" }),
});
assert.equal(decided.response.status, 200);
assert.equal(decided.body.data.status, "BLOKLANDI");
assert.equal(decided.body.data.event_published, true);

const expectedPoints = before.body.data.total_points + 10;
let points = before.body.data.total_points;
for (let attempt = 0; attempt < 20 && points < expectedPoints; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const profile = await call(analyst, "/api/v1/game/profile/usr_analyst_1");
  points = profile.body.data.total_points;
}
assert.ok(points >= expectedPoints, "RabbitMQ decision points were not consumed");

const leaderboard = await call(analyst, "/api/v1/game/leaderboard");
assert.equal(leaderboard.response.status, 200);
assert.ok(leaderboard.body.data.some((entry) => entry.analyst.user_id === "usr_analyst_1"));
console.log(`Workflow passed: ${caseId}, analyst points ${before.body.data.total_points} → ${points}`);
