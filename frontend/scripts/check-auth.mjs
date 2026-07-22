import assert from "node:assert/strict";

const base = (process.env.AUTH_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const identifier = process.env.AUTH_TEST_IDENTIFIER ?? "analyst1@fraudcell.local";
const secret = process.env.AUTH_TEST_SECRET ?? "Analyst123!";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function json(response) {
  const body = await response.json();
  assert.equal(typeof body.success, "boolean");
  assert.match(body.request_id, uuid);
  return body;
}

function cookiesFrom(response) {
  const values = response.headers.getSetCookie();
  return {
    raw: values,
    header: values.map((value) => value.split(";", 1)[0]).join("; "),
  };
}

const malformed = await fetch(`${base}/api/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ identifier: "", secret: "" }),
});
assert.equal(malformed.status, 422);
assert.equal((await json(malformed)).success, false);

const login = await fetch(`${base}/api/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ identifier, secret }),
});
assert.equal(login.status, 200);
assert.match(login.headers.get("cache-control") ?? "", /no-store/i);
const loginBody = await json(login);
assert.equal(loginBody.success, true);
assert.equal(loginBody.error, null);
assert.equal(loginBody.data.user.role, "ANALYST");
assert.equal(typeof loginBody.data.access_token, "string");

const session = cookiesFrom(login);
assert.ok(session.raw.some((value) => value.startsWith("fraudcell_session=")), "login must issue the signed UI session cookie");
assert.ok(session.raw.some((value) => value.startsWith("fraudcell_refresh=")), "login must forward the HttpOnly refresh cookie");

const authorization = { Authorization: `Bearer ${loginBody.data.access_token}`, Cookie: session.header };
const casesResponse = await fetch(`${base}/api/v1/cases?page=0&size=10`, { headers: authorization });
assert.equal(casesResponse.status, 200);
const cases = await json(casesResponse);
assert.equal(cases.success, true);
assert.ok(Array.isArray(cases.data.items));
assert.ok(cases.data.items.every((item) => item.assigned_analyst_id === loginBody.data.user.id));

const forbidden = await fetch(`${base}/api/v1/dashboard/operations`, { headers: authorization });
assert.equal(forbidden.status, 403);
assert.equal((await json(forbidden)).success, false);

const anonymousPage = await fetch(`${base}/analyst`, { redirect: "manual" });
assert.equal(anonymousPage.status, 307);
assert.equal(new URL(anonymousPage.headers.get("location"), base).pathname, "/login");

const analystPage = await fetch(`${base}/analyst`, { headers: { Cookie: session.header } });
assert.equal(analystPage.status, 200);
assert.match(await analystPage.text(), /Vaka komuta ekranı/);

const wrongRolePage = await fetch(`${base}/supervisor`, { headers: { Cookie: session.header }, redirect: "manual" });
assert.equal(wrongRolePage.status, 307);
assert.equal(new URL(wrongRolePage.headers.get("location"), base).pathname, "/analyst");

const logout = await fetch(`${base}/api/v1/auth/logout`, {
  method: "POST",
  headers: { Cookie: session.header },
});
assert.equal(logout.status, 200);
assert.equal((await json(logout)).data.logged_out, true);
const cleared = cookiesFrom(logout).raw;
assert.ok(cleared.some((value) => value.startsWith("fraudcell_session=") && /Expires=Thu, 01 Jan 1970|Max-Age=0/i.test(value)), "logout must clear the UI session cookie");
assert.ok(cleared.some((value) => value.startsWith("fraudcell_refresh=") && /Expires=Thu, 01 Jan 1970|Max-Age=0/i.test(value)), "logout must clear the refresh cookie");

const revoked = await fetch(`${base}/api/v1/auth/refresh`, {
  method: "POST",
  headers: { Cookie: session.header },
});
assert.equal(revoked.status, 401, "the pre-logout refresh token must be revoked");

console.log("Live auth, RBAC, refresh-cookie, and logout checks passed.");
