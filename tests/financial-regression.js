// tests/financial-regression.js — Q03 Refund E2E + Q19 Financial Regression
'use strict';
const { startServer, stopServer, api, loginAs, assert, assertEqual, summary, resetCounts } = require('./helpers.js');

async function run() {
  resetCounts();
  await startServer();
  console.log('=== Financial Regression Suite (Q03 Refund + Q19) ===');

  try {
    const adminToken = await loginAs('admin');
    const financeToken = await loginAs('finance');
    const opToken = await loginAs('operator');
    const runnerToken = await loginAs('runner');

    // --- Set up a delivered single-outlet order (the common refund case) ---
    const order = await api('POST', '/api/orders', { pointId: 'PT-014', customerName: 'Refund Test', items: [{ productId: 'p_latte', qty: 2 }] });
    const total = order.data.total;
    await api('POST', `/api/orders/${order.data.id}/pay`, { method: 'card' });
    await api('POST', `/api/orders/${order.data.id}/transition`, { to: 'Accepted' }, opToken);
    await api('POST', `/api/orders/${order.data.id}/transition`, { to: 'Preparing' }, opToken);
    await api('POST', `/api/orders/${order.data.id}/transition`, { to: 'Ready' }, opToken);
    await api('POST', `/api/orders/${order.data.id}/transition`, { to: 'Out for Delivery' }, runnerToken);
    await api('POST', `/api/orders/${order.data.id}/transition`, { to: 'Delivered' }, runnerToken);

    const ledgerBefore = await api('GET', '/api/admin/revenue-ledger', null, adminToken);
    const saleRow = ledgerBefore.data.find(r => r.order_id === order.data.id);
    assert(!!saleRow, 'a revenue_ledger sale row exists for the delivered order');
    assertEqual(saleRow.type, 'sale', 'the original ledger row is tagged type=sale');

    // --- Reject: refund without a reason ---
    const noReason = await api('POST', `/api/orders/${order.data.id}/refund`, { amount: total }, financeToken);
    assertEqual(noReason.status, 400, 'refund without a reason is rejected (audit trail requirement)');

    // --- Reject: refund amount exceeding what was paid ---
    const tooMuch = await api('POST', `/api/orders/${order.data.id}/refund`, { amount: total + 1000, reason: 'test' }, financeToken);
    assertEqual(tooMuch.status, 409, 'refund amount exceeding the paid total is rejected');

    // --- Partial refund ---
    const partialAmount = Math.round(total * 0.4 * 100) / 100;
    const partial = await api('POST', `/api/orders/${order.data.id}/refund`, { amount: partialAmount, reason: 'Customer complaint — partial' }, financeToken);
    assertEqual(partial.status, 200, 'partial refund succeeds');
    assertEqual(partial.data.status, 'Partially Refunded', 'order status becomes Partially Refunded');

    const orderAfterPartial = await api('GET', `/api/orders/${order.data.id}`);
    assertEqual(orderAfterPartial.data.status, 'Partially Refunded', 'GET order reflects Partially Refunded status');

    // --- Reject: a second refund that would exceed the remaining balance ---
    const overRefund = await api('POST', `/api/orders/${order.data.id}/refund`, { amount: total, reason: 'greedy attempt' }, financeToken);
    assertEqual(overRefund.status, 409, 'a second refund exceeding the REMAINING balance is rejected (prevents double-refund)');

    // --- Complete the refund (top-up to full) ---
    const remainingAmount = Math.round((total - partialAmount) * 100) / 100;
    const completion = await api('POST', `/api/orders/${order.data.id}/refund`, { amount: remainingAmount, reason: 'Completing refund' }, financeToken);
    assertEqual(completion.status, 200, 'completing refund to 100% succeeds');
    assertEqual(completion.data.status, 'Refunded', 'order status becomes fully Refunded once cumulative = total');

    // --- Idempotency: same idempotencyKey does not double-process ---
    const order2 = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }] });
    await api('POST', `/api/orders/${order2.data.id}/pay`, { method: 'card' });
    await api('POST', `/api/orders/${order2.data.id}/transition`, { to: 'Accepted' }, opToken);
    await api('POST', `/api/orders/${order2.data.id}/transition`, { to: 'Preparing' }, opToken);
    await api('POST', `/api/orders/${order2.data.id}/transition`, { to: 'Ready' }, opToken);
    await api('POST', `/api/orders/${order2.data.id}/transition`, { to: 'Delivered' }, opToken);
    const idemKey = 'test-key-' + Date.now();
    const rf1 = await api('POST', `/api/orders/${order2.data.id}/refund`, { amount: order2.data.total, reason: 'x', idempotencyKey: idemKey }, financeToken);
    const rf2 = await api('POST', `/api/orders/${order2.data.id}/refund`, { amount: order2.data.total, reason: 'x', idempotencyKey: idemKey }, financeToken);
    assert(rf2.data.idempotent === true, 'repeated refund call with the same idempotencyKey does not double-refund');
    const refundsList = await api('GET', `/api/orders/${order2.data.id}/refunds`, null, financeToken);
    assertEqual(refundsList.data.length, 1, 'exactly 1 refund record exists despite 2 identical calls');

    // --- Q19: Revenue Ledger correctly nets out the refund ---
    const ledgerAfter = await api('GET', '/api/admin/revenue-ledger', null, adminToken);
    const order2Rows = ledgerAfter.data.filter(r => r.order_id === order2.data.id);
    assertEqual(order2Rows.length, 2, 'refunded order has 2 ledger rows: original sale + refund adjustment');
    const netEligible = order2Rows.reduce((s, r) => s + r.eligible_base, 0);
    assert(Math.abs(netEligible) < 0.02, `fully-refunded order nets to ~0 eligible_base across its ledger rows (got ${netEligible})`);

    // --- Role enforcement: Operator cannot process refunds ---
    const orderForRoleTest = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }] });
    await api('POST', `/api/orders/${orderForRoleTest.data.id}/pay`, { method: 'card' });
    const opRefundAttempt = await api('POST', `/api/orders/${orderForRoleTest.data.id}/refund`, { amount: 1, reason: 'x' }, opToken);
    assert([401, 403].includes(opRefundAttempt.status), 'Operator role cannot process refunds (AlnadlFinance/SiteManager/SuperAdmin only)');

    // --- Non-refundable state rejected ---
    const notDelivered = await api('POST', `/api/orders/${orderForRoleTest.data.id}/refund`, { amount: 1, reason: 'x' }, financeToken);
    assertEqual(notDelivered.status, 409, 'refund on a non-Delivered order (still Paid) is rejected');

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
