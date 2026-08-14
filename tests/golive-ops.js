// tests/golive-ops.js — Go-Live P0-6 (public rate limiting) and P1 §4.1
// (health/readiness). Proves 429 actually fires on the buckets that matter,
// that a normal guest is never caught by it, and that the ops endpoints
// report honestly without leaking internals.
'use strict';
const { startServer, stopServer, api, assert, assertEqual, summary, resetCounts, BASE, getDataPath } = require('./helpers.js');

function openDb() {
  process.env.SQLITE_PATH = getDataPath();
  delete require.cache[require.resolve('../db.js')];
  return require('../db.js');
}

async function raw(method, path, body) {
  const res = await fetch(BASE() + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data, retryAfter: res.headers.get('retry-after') };
}

async function run() {
  resetCounts();
  await startServer();
  console.log('=== Go-Live Suite: Public Rate Limiting & Ops Endpoints ===');

  try {
    const { db } = openDb();
    const limiter = require('../lib/rate-limit.js');

    // ================= P1 §4.1 health & readiness =================
    const health = await raw('GET', '/health');
    assertEqual(health.status, 200, '§4.1 /health returns 200 while the process is alive');
    assertEqual(health.data.status, 'ok', '§4.1 /health reports ok');
    assert(typeof health.data.uptimeSec === 'number', '§4.1 /health reports uptime');

    const ready = await raw('GET', '/ready');
    assertEqual(ready.status, 200, '§4.1 /ready returns 200 when the database is reachable');
    assertEqual(ready.data.checks.database, 'ok', '§4.1 /ready genuinely exercises the database, not just the process');

    // §4.1 "لا تكشف endpoints أسرارًا" — no secrets or internals in either
    const opsBlob = JSON.stringify(health.data) + JSON.stringify(ready.data);
    for (const leak of ['SESSION_SECRET', 'password', 'token', 'sqlite', '/home/', 'Error:', 'at Object']) {
      assert(!opsBlob.toLowerCase().includes(leak.toLowerCase()),
        `§4.1 the ops endpoints never expose "${leak}"`);
    }

    // ================= P0-6 rate limiting =================
    assertEqual(limiter.storeName(), 'memory',
      'P0-6 the active store is the in-memory limiter (single-instance safe; Redis required for multi-instance, documented)');

    // --- verification bucket: the strictest, and the classic abuse target
    limiter.resetAll();
    let firstBlockAt = null;
    for (let i = 1; i <= 8; i++) {
      const r = await raw('POST', '/api/loyalty/verify/start', { t: 'no-such-token', phone: '0500000000' });
      if (r.status === 429) { firstBlockAt = i; break; }
    }
    assert(firstBlockAt !== null,
      `P0-6 the OTP/verification endpoint IS rate limited — 429 fired on request #${firstBlockAt}`);
    assert(firstBlockAt > 1, 'P0-6 the very first legitimate call is never blocked');

    const blocked = await raw('POST', '/api/loyalty/verify/start', { t: 'no-such-token', phone: '0500000000' });
    assertEqual(blocked.status, 429, 'P0-6 subsequent calls stay blocked within the window');
    assert(!!blocked.retryAfter && parseInt(blocked.retryAfter, 10) > 0,
      'P0-6 a Retry-After header tells the caller when to come back, rather than failing opaquely');
    assert(!/stack|at Object|sqlite/i.test(JSON.stringify(blocked.data)),
      'P0-6 the 429 body carries no internal detail');

    // --- loyalty lookup: phone-number enumeration surface
    limiter.resetAll();
    let loyaltyBlocked = false;
    for (let i = 0; i < 40; i++) {
      const r = await raw('GET', `/api/loyalty/05000000${String(i).padStart(2, '0')}?t=x`);
      if (r.status === 429) { loyaltyBlocked = true; break; }
    }
    assert(loyaltyBlocked, 'P0-6 loyalty lookup is rate limited — an unthrottled one is a phone-number enumeration oracle');

    // --- engage pass discovery: capability-token guessing surface
    limiter.resetAll();
    let engageBlocked = false;
    for (let i = 0; i < 50; i++) {
      const r = await raw('GET', `/api/orders/ORD-${1800 + i}/engage-pass?paymentRef=guess`);
      if (r.status === 429) { engageBlocked = true; break; }
    }
    assert(engageBlocked, 'P0-6 Engage pass discovery is rate limited, blunting offline guessing against paymentRef');

    // --- order creation: the expensive, state-changing path
    limiter.resetAll();
    const prod = db.prepare('SELECT id FROM products LIMIT 1').get();
    let orderBlocked = false, ordersAccepted = 0;
    for (let i = 0; i < 20; i++) {
      const r = await raw('POST', '/api/orders', { pointId: 'PT-021', items: [{ productId: prod.id, qty: 1 }] });
      if (r.status === 429) { orderBlocked = true; break; }
      if (r.status === 201) ordersAccepted++;
    }
    assert(orderBlocked, 'P0-6 order creation is rate limited');
    assert(ordersAccepted >= 5,
      `P0-6 a normal guest placing a handful of orders is NOT caught by the limit (${ordersAccepted} accepted before throttling)`);

    // --- the limiter must NOT throttle the payment webhook: the provider
    //     retries legitimately and dropping those breaks reconciliation
    limiter.resetAll();
    let webhookThrottled = false;
    for (let i = 0; i < 30; i++) {
      const r = await raw('POST', '/api/payments/webhook', { event: 'noop' });
      if (r.status === 429) { webhookThrottled = true; break; }
    }
    assertEqual(webhookThrottled, false,
      'P0-6 the payment webhook is deliberately NOT throttled — provider retries must not be dropped or reconciliation breaks');

    // --- authenticated staff routes are not throttled by this layer
    limiter.resetAll();
    const { loginAs } = require('./helpers.js');
    const opToken = await loginAs('operator');
    let kdsThrottled = false;
    for (let i = 0; i < 40; i++) {
      const r = await api('GET', '/api/ops/queue', null, opToken);
      if (r.status === 429) { kdsThrottled = true; break; }
    }
    assertEqual(kdsThrottled, false,
      'P0-6 an authenticated KDS polling its queue is never throttled by the public limiter — that would be an operational hazard, not a safeguard');

    // --- isolation between buckets: exhausting one must not block another
    limiter.resetAll();
    for (let i = 0; i < 10; i++) await raw('POST', '/api/loyalty/verify/start', { t: 'x', phone: '0500000000' });
    const otherBucket = await raw('GET', '/api/env');
    assert(otherBucket.status !== 429,
      'P0-6 exhausting the verification bucket does not block unrelated public endpoints — buckets are independent');

    limiter.resetAll();
  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
