import assert from "node:assert/strict";

const base = process.env.AUTH_BASE_URL ?? "http://localhost:3000";
const jar = new Map();

function setCookies(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*fraudcell_)/) : [];
}

function updateJar(headers) {
  for (const row of setCookies(headers)) {
    const [pair] = row.split(";", 1);
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (/max-age=0/i.test(row)) jar.delete(name);
    else jar.set(name, value);
  }
}

const cookieHeader = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

const malformed = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: "null" });
assert.equal(malformed.status, 422);

const invalid = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: "missing-user", password: "wrong" }) });
assert.equal(invalid.status, 401);

const login = await fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier: "analyst", password: "Demo123!" }) });
assert.equal(login.status, 200);
const loginPayload = await login.json();
assert.equal("access_token" in loginPayload.data || "refresh_token" in loginPayload.data, false, "tokens must stay out of JSON");
const loginCookies = setCookies(login.headers);
updateJar(login.headers);
assert.deepEqual([...jar.keys()].sort(), ["fraudcell_access", "fraudcell_refresh", "fraudcell_session"]);
assert.ok(loginCookies.every((cookie) => /httponly/i.test(cookie)), "all auth cookies must be HttpOnly");

const cases = await fetch(`${base}/api/v1/cases`, { headers: { cookie: cookieHeader() } });
const payload = await cases.json();
assert.equal(payload.success, true);

const supervisor = await fetch(`${base}/api/v1/metrics/supervisor`, { headers: { cookie: cookieHeader() } });
assert.equal(supervisor.status, 403);

const anonymousPage = await fetch(`${base}/analyst`, { redirect: "manual" });
assert.equal(anonymousPage.status, 307);
assert.equal(anonymousPage.headers.get("location"), "/login");

const analystPage = await fetch(`${base}/analyst`, { headers: { cookie: cookieHeader() } });
assert.equal(analystPage.status, 200);

jar.delete("fraudcell_access");
const expiredPage = await fetch(`${base}/analyst`, { headers: { cookie: cookieHeader() }, redirect: "manual" });
assert.equal(expiredPage.status, 307);
assert.match(expiredPage.headers.get("location") ?? "", /^\/api\/v1\/auth\/refresh\?next=/);
const navigationRefresh = await fetch(new URL(expiredPage.headers.get("location"), base), { headers: { cookie: cookieHeader() }, redirect: "manual" });
assert.equal(navigationRefresh.status, 303);
assert.equal(navigationRefresh.headers.get("location"), "/analyst");
updateJar(navigationRefresh.headers);
assert.ok(jar.get("fraudcell_access"), "protected navigation must renew the access cookie");

const previousRefresh = jar.get("fraudcell_refresh");
const refresh = await fetch(`${base}/api/v1/auth/refresh`, { method: "POST", headers: { cookie: cookieHeader() } });
assert.equal(refresh.status, 200);
const refreshPayload = await refresh.json();
assert.equal("access_token" in refreshPayload.data || "refresh_token" in refreshPayload.data, false, "rotated tokens must stay out of JSON");
updateJar(refresh.headers);
assert.notEqual(jar.get("fraudcell_refresh"), previousRefresh, "refresh token must rotate");

const logout = await fetch(`${base}/api/v1/auth/logout`, { method: "POST", headers: { cookie: cookieHeader() } });
assert.equal(logout.status, 200);
updateJar(logout.headers);
assert.equal(jar.size, 0, "logout must expire every auth cookie");

const afterLogout = await fetch(`${base}/api/v1/cases`, { headers: { cookie: cookieHeader() } });
assert.equal(afterLogout.status, 401);
console.log("Auth and SSR contracts passed");
