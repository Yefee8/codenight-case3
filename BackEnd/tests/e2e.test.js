// Integration tests against docker-compose'd stack.
// Run: node --test tests/e2e.test.js (requires BASE=http://localhost:8080/api/v1 running)
const test = require('node:test');
const assert = require('node:assert/strict');

const BASE = process.env.BASE || 'http://localhost:8080/api/v1';

async function req(method, path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const init = { method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const r = await fetch(BASE + path, init);
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch (e) { body = text; }
  return { status: r.status, body, headers: r.headers };
}

async function login(cred) {
  const r = await req('POST', '/auth/login', { body: cred });
  assert.equal(r.status, 200, `login failed: ${JSON.stringify(r.body)}`);
  return r.body.data;
}

test('customer login with GSM+OTP', async () => {
  const s = await login({ gsm: '5551112233', otp: '1234' });
  assert.ok(s.access_token);
  assert.equal(s.user.role, 'CUSTOMER');
});

test('customer login rejects wrong OTP', async () => {
  const r = await req('POST', '/auth/login', { body: { gsm: '5551112233', otp: '9999' } });
  assert.equal(r.status, 401);
});

test('password policy rejects weak passwords', async () => {
  const admin = await login({ email: 'admin@fraudcell.com', password: 'Admin!234' });
  const r = await req('POST', '/users/staff', {
    headers: { Authorization: `Bearer ${admin.access_token}` },
    body: { first_name: 'X', last_name: 'Y', email: `weakpw${Date.now()}@t.com`, password: 'weak', role: 'ANALYST' }
  });
  assert.equal(r.status, 400);
});

test('protected route rejects missing token', async () => {
  const r = await req('GET', '/transactions');
  assert.equal(r.status, 401);
});

test('protected route rejects invalid token', async () => {
  const r = await req('GET', '/transactions', { headers: { Authorization: 'Bearer BOGUS' } });
  assert.equal(r.status, 401);
});

test('customer cannot access supervisor dashboard (RBAC)', async () => {
  const cust = await login({ gsm: '5551112233', otp: '1234' });
  const r = await req('GET', '/dashboard', { headers: { Authorization: `Bearer ${cust.access_token}` } });
  assert.equal(r.status, 403);
});

test('SQL injection in email is safely rejected', async () => {
  const r = await req('POST', '/auth/login', { body: { email: "admin' OR 1=1 --", password: 'x' } });
  assert.equal(r.status, 401);
  assert.equal(r.body.success, false);
});

test('AI internal /score is hidden behind gateway (403)', async () => {
  const cust = await login({ gsm: '5551112233', otp: '1234' });
  const r = await req('POST', '/ai/score', {
    headers: { Authorization: `Bearer ${cust.access_token}` },
    body: { transaction_id: 'x' }
  });
  assert.equal(r.status, 403);
});

test('high-risk transaction triggers AI + case assignment + state machine', async () => {
  const cust = await login({ gsm: '5551112233', otp: '1234' });
  const trx = await req('POST', '/transactions', {
    headers: { Authorization: `Bearer ${cust.access_token}` },
    body: { amount: 30000, type: 'TRANSFER', receiver: '9999', city: 'LAGOS', device: 'UNKNOWN' }
  });
  assert.equal(trx.status, 200);
  assert.ok(trx.body.data.transaction.trx_number.startsWith('TRX-'));
  assert.ok(trx.body.data.transaction.risk_score >= 0.4);
  assert.ok(['KRITIK', 'YUKSEK', 'ORTA'].includes(trx.body.data.transaction.risk_level));
  assert.ok(trx.body.data.case);
  assert.ok(trx.body.data.case.assigned_to || trx.body.data.case.status === 'YENI');
});

test('state machine rejects invalid transition with 422', async () => {
  const cust = await login({ gsm: '5551112233', otp: '1234' });
  const trx = await req('POST', '/transactions', {
    headers: { Authorization: `Bearer ${cust.access_token}` },
    body: { amount: 15000, type: 'TRANSFER', receiver: '5555', city: 'LAGOS', device: 'UNKNOWN' }
  });
  const caseId = trx.body.data.case.id;
  const a1 = await login({ email: 'analyst1@fraudcell.com', password: 'Analyst!234' });
  const a2 = await login({ email: 'analyst2@fraudcell.com', password: 'Analyst!234' });
  const assignedTo = trx.body.data.case.assigned_to;
  const anaToken = assignedTo === a1.user.id ? a1.access_token : a2.access_token;
  // Try YENI -> ONAYLANDI directly, must fail
  const r = await req('PATCH', `/cases/${caseId}/status`, {
    headers: { Authorization: `Bearer ${anaToken}` },
    body: { to: 'ONAYLANDI', note: 'bad' }
  });
  assert.equal(r.status, 422);
});

test('IDOR: customer cannot fetch another customer\'s transaction', async () => {
  const cust = await login({ gsm: '5551112233', otp: '1234' });
  // Try to access an ID that does not belong to us
  const r = await req('GET', '/transactions/00000000-0000-0000-0000-000000000000', {
    headers: { Authorization: `Bearer ${cust.access_token}` }
  });
  assert.ok([403, 404].includes(r.status));
});

test('XSS: script tags stripped from decision note', async () => {
  const cust = await login({ gsm: '5551112233', otp: '1234' });
  const trx = await req('POST', '/transactions', {
    headers: { Authorization: `Bearer ${cust.access_token}` },
    body: { amount: 20000, type: 'TRANSFER', receiver: '1111', city: 'LAGOS', device: 'UNKNOWN' }
  });
  const caseId = trx.body.data.case.id;
  const a1 = await login({ email: 'analyst1@fraudcell.com', password: 'Analyst!234' });
  const a2 = await login({ email: 'analyst2@fraudcell.com', password: 'Analyst!234' });
  const assignedTo = trx.body.data.case.assigned_to;
  const anaToken = assignedTo === a1.user.id ? a1.access_token : a2.access_token;
  await req('PATCH', `/cases/${caseId}/status`, {
    headers: { Authorization: `Bearer ${anaToken}` }, body: { to: 'INCELENIYOR', note: 'ok' }
  });
  const dec = await req('PATCH', `/cases/${caseId}/decision`, {
    headers: { Authorization: `Bearer ${anaToken}` },
    body: { decision: 'BLOKLANDI', note: '<script>alert(1)</script>gerekce budur' }
  });
  assert.equal(dec.status, 200);
  const detail = await req('GET', `/cases/${caseId}`, { headers: { Authorization: `Bearer ${anaToken}` } });
  assert.ok(!detail.body.data.decision_note.includes('<script>'), 'decision_note must not contain <script>');
  assert.ok(!detail.body.data.decision_note.includes('</script>'));
});

test('Idempotency-Key: duplicate POST returns same trx_number', async () => {
  const cust = await login({ gsm: '5551112233', otp: '1234' });
  const key = `idem-${Date.now()}-${Math.random()}`;
  const body = { amount: 1000, type: 'ODEME', receiver: 'TR1234', city: 'ISTANBUL', device: 'KNOWN' };
  const r1 = await req('POST', '/transactions', {
    headers: { Authorization: `Bearer ${cust.access_token}`, 'Idempotency-Key': key }, body
  });
  const r2 = await req('POST', '/transactions', {
    headers: { Authorization: `Bearer ${cust.access_token}`, 'Idempotency-Key': key }, body
  });
  assert.equal(r1.body.data.transaction.trx_number, r2.body.data.transaction.trx_number);
});

test('Content-Type enforcement returns 415', async () => {
  const cust = await login({ gsm: '5551112233', otp: '1234' });
  const r = await fetch(BASE + '/transactions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cust.access_token}` }, // no content-type
    body: '{"amount":1}'
  });
  assert.equal(r.status, 415);
});

test('AI unavailability: transaction still succeeds with BELIRSIZ', async () => {
  const { execSync } = require('node:child_process');
  // Log in first so token is ready before AI goes down
  const cust = await login({ gsm: '5551112233', otp: '1234' });
  execSync('docker compose stop ai', { cwd: __dirname + '/..', stdio: 'ignore' });
  // Wait for compose network to settle
  await new Promise(r => setTimeout(r, 1500));
  try {
    const trx = await req('POST', '/transactions', {
      headers: { Authorization: `Bearer ${cust.access_token}` },
      body: { amount: 5000, type: 'ODEME', receiver: 'x', city: 'ISTANBUL', device: 'MOBILE' }
    });
    assert.equal(trx.status, 200, `expected 200 got ${trx.status}: ${JSON.stringify(trx.body)}`);
    assert.equal(trx.body.data.transaction.risk_level, 'BELIRSIZ');
    assert.equal(trx.body.data.ai_available, false);
    assert.equal(trx.body.data.case.status, 'YENI');
  } finally {
    execSync('docker compose start ai', { cwd: __dirname + '/..', stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 3000));
  }
});

test('Leaderboard is public', async () => {
  const r = await req('GET', '/game/leaderboard?period=daily');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.data.items));
});

test('Swagger docs accessible for transaction and ai', async () => {
  const r1 = await fetch(BASE + '/transactions/docs/');
  const r2 = await fetch(BASE + '/ai/docs/');
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
});

// Kept last: consumes the auth rate limit budget for the rest of the run
test('Auth rate limit triggers 429 during burst', async () => {
  const attempts = 80;
  let sawRateLimit = false;
  for (let i = 0; i < attempts; i++) {
    const r = await req('POST', '/auth/login', { body: { email: 'none@x.com', password: 'x' } });
    if (r.status === 429) { sawRateLimit = true; break; }
  }
  assert.ok(sawRateLimit, 'expected 429 during burst');
});
