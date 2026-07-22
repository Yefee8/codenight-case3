import assert from "node:assert/strict";

const base = process.env.AUTH_BASE_URL ?? "http://localhost:3000";

const invalid = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gsm: "05320000001", otp: "0000" }) });
assert.equal(invalid.status, 401);

const login = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gsm: "05321112026", otp: "2468" }) });
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
assert.ok(cookie, "login must issue a cookie");

const cases = await fetch(`${base}/api/v1/cases`, { headers: { cookie } });
const payload = await cases.json();
assert.equal(payload.success, true);
assert.ok(payload.data.every((item) => item.assigned_analyst_id === "usr_analyst_1"));

const supervisor = await fetch(`${base}/api/v1/metrics/supervisor`, { headers: { cookie } });
assert.equal(supervisor.status, 403);

const anonymousPage = await fetch(`${base}/analyst`, { redirect: "manual" });
assert.equal(anonymousPage.status, 307);
assert.equal(anonymousPage.headers.get("location"), "/login");

const analystHtml = await fetch(`${base}/analyst`, { headers: { cookie } }).then((response) => response.text());
assert.match(analystHtml, /TRX-2026-000125/, "assigned case must exist in SSR HTML");
console.log("Auth and SSR contracts passed");
