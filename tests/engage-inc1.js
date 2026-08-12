// tests/engage-inc1.js — Phase 5 P5-Inc-1 acceptance tests.
//
// Uses a SECOND connection to the same SQLite file the running server
// subprocess owns (via getDataPath() + a fresh require of db.js pointed at
// it) purely for test setup/verification -- e.g. flipping engage_enabled,
// or confirming a pass exists. All actual behavior under test still goes
// through the real HTTP API against the real running server, exactly like
// every other suite in this project.
'use strict';
const { startServer, stopServer, api, loginAs, assert, assertEqual, summary, resetCounts, getDataPath } = require('./helpers.js');

function openDirectDb() {
  process.env.SQLITE_PATH = getDataPath();
  delete require.cache[require.resolve('../db.js')];
  return require('../db.js').db;
}

async function waitForOutbox(db, orderId, timeoutMs = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = db.prepare('SELECT * FROM engage_outbox WHERE order_id = ?').get(orderId);
    if (row && row.status !== 'pending') return row;
    await new Promise(r => setTimeout(r, 250));
  }
  return db.prepare('SELECT * FROM engage_outbox WHERE order_id = ?').get(orderId);
}

async function run() {
  resetCounts();
  await startServer();
  console.log('=== Phase 5 P5-Inc-1 Suite (Engage Gate + Isolation) ===');

  try {
    const adminToken = await loginAs('admin');
    const db = openDirectDb();

    // --- ENG-GATE-001: no Engage Pass before order.confirmed ---
    const unpaidOrder = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }] });
    await new Promise(r => setTimeout(r, 300));
    const outboxForUnpaid = db.prepare('SELECT * FROM engage_outbox WHERE order_id = ?').get(unpaidOrder.data.id);
    assert(!outboxForUnpaid, 'ENG-GATE-001: an order that is created but never paid produces NO outbox row at all');
    const passForUnpaid = db.prepare('SELECT * FROM engage_pass WHERE order_id = ?').get(unpaidOrder.data.id);
    assert(!passForUnpaid, 'ENG-GATE-001: an order that is created but never paid produces NO engage_pass');

    // --- Flag OFF (the real default state for every plan today): outbox row written, but skipped ---
    const order1 = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }] });
    await api('POST', `/api/orders/${order1.data.id}/pay`, { method: 'card' });
    const outbox1 = await waitForOutbox(db, order1.data.id);
    assert(!!outbox1, 'an outbox row IS written for a paid order (Core -> Engage data flow works)');
    assertEqual(outbox1.status, 'skipped', 'with engage_enabled OFF (true default state), the worker marks the row skipped, not processed');
    const pass1 = db.prepare('SELECT * FROM engage_pass WHERE order_id = ?').get(order1.data.id);
    assert(!pass1, 'no engage_pass is created while the flag is OFF');

    // --- Flag ON: enable engage_enabled directly on the PLATFORM plan (Inc-6 will add an admin UI for this; Inc-1 tests the mechanism itself) ---
    await api('POST', '/api/admin/subscription', { partnerId: 'pt_nova', planCode: 'PLATFORM' }, adminToken);
    const platformPlan = db.prepare(`SELECT * FROM plans WHERE code = 'PLATFORM'`).get();
    const features = JSON.parse(platformPlan.features_json);
    features.engage_enabled = true;
    db.prepare('UPDATE plans SET features_json = ? WHERE id = ?').run(JSON.stringify(features), platformPlan.id);

    const order2 = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }] });
    await api('POST', `/api/orders/${order2.data.id}/pay`, { method: 'card' });
    const outbox2 = await waitForOutbox(db, order2.data.id);
    assertEqual(outbox2.status, 'processed', 'with engage_enabled ON, the worker marks the row processed');
    const pass2 = db.prepare('SELECT * FROM engage_pass WHERE order_id = ?').get(order2.data.id);
    assert(!!pass2, 'a real engage_pass row now exists for this order');
    assertEqual(pass2.status, 'active', 'the new pass has status active');
    const snapshot = JSON.parse(pass2.context_snapshot_json);
    assertEqual(snapshot.orderId, order2.data.id, 'the context snapshot correctly captures the order id');
    assertEqual(snapshot.partnerId, 'pt_nova', 'the context snapshot correctly captures the partner id');

    // --- FK integrity: a direct insert with an invalid order_id is genuinely rejected ---
    let fkRejected = false;
    try {
      db.prepare(`INSERT INTO engage_pass (id,order_id,context_snapshot_json,status,created_at,expires_at) VALUES (?,?,?,?,?,?)`)
        .run('test_bad_fk_pass', 'NONEXISTENT_ORDER_ID_XYZ', '{}', 'active', Date.now(), Date.now() + 1000);
    } catch (e) {
      fkRejected = /FOREIGN KEY/i.test(e.message);
    }
    assert(fkRejected, 'engage_pass.order_id -> orders(id) is a REAL foreign key: a direct insert with an invalid order_id is rejected by SQLite itself');

    // --- Idempotency: re-running the worker over an already-processed row does not create a second pass ---
    const { processOutboxOnce } = require('../lib/engage-worker.js');
    processOutboxOnce();
    const passCountAfterRerun = db.prepare('SELECT COUNT(*) c FROM engage_pass WHERE order_id = ?').get(order2.data.id).c;
    assertEqual(passCountAfterRerun, 1, 'manually re-running the worker over an already-processed outbox row does not create a duplicate pass');

    // --- ENG-ISO-001: ordinary Core flow is provably unaffected, flag on or off, worker running ---
    const isoOrder = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }] });
    const isoPay = await api('POST', `/api/orders/${isoOrder.data.id}/pay`, { method: 'card' });
    assertEqual(isoPay.data.status, 'Paid', 'ENG-ISO-001: ordinary payment flow completes identically with Engage active and its worker running');
    const opToken = await loginAs('operator');
    const queue = await api('GET', '/api/ops/queue', null, opToken);
    assert(queue.data.some(o => o.id === isoOrder.data.id), 'ENG-ISO-001: the order still appears normally in the KDS queue -- Engage never touched it');

    // --- Read-only pass endpoint ---
    const unknownPass = await api('GET', '/api/engage/pass/nonexistent-id-xyz');
    assertEqual(unknownPass.status, 404, 'GET /api/engage/pass/:id returns 404 for an unknown pass, not a server error');
    const knownPass = await api('GET', `/api/engage/pass/${pass2.id}`);
    assertEqual(knownPass.status, 200, 'GET /api/engage/pass/:id returns 200 for a real pass');
    assertEqual(knownPass.data.status, 'active', 'the returned pass status is correct');

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
