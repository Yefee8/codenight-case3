const API = (process.env.API_URL ?? "http://localhost:8080").replace(/\/$/, "");

async function call(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function expectStatus(result, status, label) {
  if (result.status !== status) {
    throw new Error(`${label}: expected ${status}, got ${result.status}: ${JSON.stringify(result.body)}`);
  }
}

const suffix = String(Date.now()).slice(-9).padStart(9, "0");
const username = `brute_${suffix}`;
const registered = await call("POST", "/api/v1/auth/register", {
  username,
  gsm: `04${suffix}`,
  full_name: "Brute Force Test User",
  password: "Demo123!",
});
if (![201, 409].includes(registered.status)) throw new Error(`register failed: ${JSON.stringify(registered.body)}`);

for (let i = 1; i <= 4; i += 1) {
  expectStatus(await call("POST", "/api/v1/auth/login", { identifier: username, password: `wrong-${i}` }), 401, `bad password ${i}`);
}
expectStatus(await call("POST", "/api/v1/auth/login", { identifier: username, password: "wrong-5" }), 423, "fifth bad password locks account");
expectStatus(await call("POST", "/api/v1/auth/login", { identifier: username, password: "Demo123!" }), 423, "locked account rejects correct password");

console.log("PASS security-bruteforce-test");
