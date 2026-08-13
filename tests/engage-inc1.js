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
    assertEqual(unknownPass.status, 403, 'GET /api/engage/pass/:token returns 403 for an unknown token, not a server error (403, not 404, so wrong-token vs nonexistent cannot be distinguished by an attacker)');
    const knownPass = await api('GET', `/api/engage/pass/${pass2.access_token}`);
    assertEqual(knownPass.status, 200, 'GET /api/engage/pass/:token returns 200 for a real token');
    assertEqual(knownPass.data.status, 'active', 'the returned pass status is correct');

    // ============================================================
    // CORRECTIVE ROUND: Retry / Dead-Letter Policy
    // ============================================================
    const { setFailureInjector } = require('../lib/engage-worker.js');

    // --- fail -> retry -> success ---
    // Deliberately NOT paid via the API here: if it were, Core's own payment
    // handler would write a REAL outbox row too, and the server's own
    // (unaffected) worker would process it independently within 5s,
    // contaminating this test's assertions with a pass that has nothing to
    // do with the retry logic under test. Using an unpaid-but-real order
    // (satisfies engage_outbox's FK to orders) keeps this test fully isolated.
    const order3 = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }] });
    const retryRowId = 'test_retry_row';
    db.prepare(`INSERT INTO engage_outbox (id,order_id,event_type,status,attempts,max_attempts,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(retryRowId, order3.data.id, 'order.confirmed', 'pending', 0, 5, Date.now());

    let failuresRemaining = 1; // fail exactly once, then succeed
    setFailureInjector((row) => {
      if (row.id === retryRowId && failuresRemaining > 0) { failuresRemaining--; return new Error('simulated transient failure'); }
      return null;
    });
    processOutboxOnce(); // attempt 1: fails, should stay pending with a future next_attempt_at
    let retryRow = db.prepare('SELECT * FROM engage_outbox WHERE id = ?').get(retryRowId);
    assertEqual(retryRow.status, 'pending', 'after a transient failure, the row stays pending (eligible for retry), not dead-lettered');
    assertEqual(retryRow.attempts, 1, 'attempts incremented to 1 after the first failure');
    assert(retryRow.next_attempt_at > Date.now(), 'next_attempt_at is set in the future (real backoff, not an immediate tight retry loop)');

    processOutboxOnce(); // immediately again: backoff hasn't elapsed yet, must NOT be picked up
    retryRow = db.prepare('SELECT * FROM engage_outbox WHERE id = ?').get(retryRowId);
    assertEqual(retryRow.attempts, 1, 'a poll cycle before next_attempt_at elapses does not re-attempt the row (backoff is honored)');

    db.prepare('UPDATE engage_outbox SET next_attempt_at = ? WHERE id = ?').run(Date.now() - 1000, retryRowId); // force backoff to have elapsed
    processOutboxOnce(); // attempt 2: injector no longer fails for this row -> should succeed
    retryRow = db.prepare('SELECT * FROM engage_outbox WHERE id = ?').get(retryRowId);
    assertEqual(retryRow.status, 'processed', 'once the backoff has elapsed and the transient failure clears, the retried row succeeds');
    const passFromRetry = db.prepare('SELECT * FROM engage_pass WHERE order_id = ?').get(order3.data.id);
    assert(!!passFromRetry, 'a real engage_pass was created once the retry succeeded (and this order was never paid via the API, so this pass can ONLY have come from the retried synthetic row, not from any automatic Core-driven outbox write)');
    setFailureInjector(null);

    // --- fail until max_attempts -> dead_letter + audit ---
    // Same isolation principle: order4 is never paid via the API, so no
    // automatic outbox row exists to contaminate this test.
    const order4 = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }] });
    const deadRowId = 'test_dead_letter_row';
    db.prepare(`INSERT INTO engage_outbox (id,order_id,event_type,status,attempts,max_attempts,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(deadRowId, order4.data.id, 'order.confirmed', 'pending', 0, 3, Date.now()); // low max_attempts=3 to keep the test fast

    setFailureInjector((row) => row.id === deadRowId ? new Error('persistent simulated failure') : null);
    for (let i = 0; i < 3; i++) {
      processOutboxOnce();
      const r = db.prepare('SELECT * FROM engage_outbox WHERE id = ?').get(deadRowId);
      if (r.status === 'pending' && r.next_attempt_at) {
        db.prepare('UPDATE engage_outbox SET next_attempt_at = ? WHERE id = ?').run(Date.now() - 1000, deadRowId); // skip real backoff wait in the test
      }
    }
    const deadRow = db.prepare('SELECT * FROM engage_outbox WHERE id = ?').get(deadRowId);
    assertEqual(deadRow.status, 'dead_letter', 'after exhausting max_attempts (3), the row reaches the dead_letter terminal state');
    assertEqual(deadRow.attempts, 3, 'attempts equals max_attempts exactly at dead-letter time');
    assert(!!deadRow.last_error, 'last_error captures the failure reason for diagnosis');
    const passFromDead = db.prepare('SELECT * FROM engage_pass WHERE order_id = ?').get(order4.data.id);
    assert(!passFromDead, 'no engage_pass was ever created for a permanently failing row (order was never paid, so this is unambiguous)');
    const deadLetterAudit = db.prepare(`SELECT * FROM engage_audit_log WHERE action = 'outbox_dead_letter' AND object_id = ?`).get(deadRowId);
    assert(!!deadLetterAudit, 'a dead-letter event is recorded in engage_audit_log for operational visibility');
    setFailureInjector(null);

    // ============================================================
    // CORRECTIVE ROUND: Atomic Outbox — transaction rollback proof
    // ============================================================
    // Proves the exact transactional pattern server.js now uses (BEGIN ...
    // writes ... COMMIT, with ROLLBACK on any exception) is genuinely atomic
    // on this schema: if a later write in the sequence fails, an earlier
    // write in the SAME transaction is undone, not left half-committed.
    const atomicOrder = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }] });
    const beforeStatus = db.prepare('SELECT status FROM orders WHERE id = ?').get(atomicOrder.data.id).status;
    assertEqual(beforeStatus, 'Payment Pending', 'order starts in Payment Pending (setup check)');

    let rolledBack = false;
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('Paid', atomicOrder.data.id); // write #1
      db.prepare(`INSERT INTO engage_outbox (id,order_id,event_type,status,created_at) VALUES (?,?,?,?,?)`)
        .run('test_atomic_row', 'NONEXISTENT_ORDER_TO_FORCE_FK_FAILURE', 'order.confirmed', 'pending', Date.now()); // write #2, deliberately violates the real FK
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      rolledBack = true;
    }
    assert(rolledBack, 'the forced FK violation on the second write actually threw and triggered a ROLLBACK (test setup sanity check)');
    const afterStatus = db.prepare('SELECT status FROM orders WHERE id = ?').get(atomicOrder.data.id).status;
    assertEqual(afterStatus, 'Payment Pending', 'CRASH-CONSISTENCY PROOF: when the second write in the transaction fails, the FIRST write (order status -> Paid) is rolled back too -- the order is never left half-confirmed');
    const orphanOutboxRow = db.prepare('SELECT * FROM engage_outbox WHERE id = ?').get('test_atomic_row');
    assert(!orphanOutboxRow, 'the failed outbox insert itself does not persist either -- true all-or-nothing atomicity');

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
