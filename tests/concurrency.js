// tests/concurrency.js — race condition checks (Q17, partial: this covers
// actual concurrent-write correctness, NOT production-scale load/p95/p99
// benchmarking, which requires real production infrastructure to be
// meaningful — see docs/GAP_REGISTER.md Q17 for the honest split.
'use strict';
const { startServer, stopServer, api, loginAs, assert, assertEqual, summary, resetCounts } = require('./helpers.js');

async function run() {
  resetCounts();
  await startServer();
  console.log('=== Concurrency Suite (race conditions, not production load) ===');

  try {
    // --- Concurrent payment attempts on the SAME order: must not double-capture ---
    const order = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }] });
    const [r1, r2, r3] = await Promise.all([
      api('POST', `/api/orders/${order.data.id}/pay`, { method: 'card' }),
      api('POST', `/api/orders/${order.data.id}/pay`, { method: 'card' }),
      api('POST', `/api/orders/${order.data.id}/pay`, { method: 'card' }),
    ]);
    const succeeded = [r1, r2, r3].filter(r => r.data.status === 'Paid' && !r.data.idempotent);
    assert(succeeded.length <= 1, `3 simultaneous payment calls on 1 order produce at most 1 real capture (got ${succeeded.length})`);

    // --- Concurrent KDS transitions on the SAME order ---
    await api('POST', `/api/orders/${order.data.id}/pay`, { method: 'card' });
    const opToken = await loginAs('operator');
    const [t1, t2] = await Promise.all([
      api('POST', `/api/orders/${order.data.id}/transition`, { to: 'Accepted' }, opToken),
      api('POST', `/api/orders/${order.data.id}/transition`, { to: 'Accepted' }, opToken),
    ]);
    const okCount = [t1, t2].filter(r => r.status === 200).length;
    assert(okCount >= 1, 'at least one concurrent Accepted transition succeeds');
    const finalOrder = await api('GET', `/api/orders/${order.data.id}`);
    assertEqual(finalOrder.data.status, 'Accepted', 'order settles into a single consistent state (Accepted), not a corrupted one');

    // --- Wallet spend sanity check ---
    const adminToken = await loginAs('admin');
    const wallets = await api('GET', '/api/admin/wallets', null, adminToken);
    if (wallets.data.length > 0) {
      const w = wallets.data[0];
      assert(w.spent_this_period <= w.monthly_budget, 'wallet spend never exceeds its monthly budget (baseline check)');
    }

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
