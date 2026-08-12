// tests/api-regression.js — Phase 1-3 baseline regression (Q10, Q19 support)
'use strict';
const { startServer, stopServer, api, loginAs, assert, assertEqual, summary, resetCounts } = require('./helpers.js');

async function run() {
  resetCounts();
  await startServer();
  console.log('=== API Regression: Phase 1-3 baseline ===');

  try {
    // QR resolve
    const tokenRow = await api('GET', '/api/demo/points');
    assert(tokenRow.status === 200 && tokenRow.data.length > 0, 'demo points seeded');
    const token = tokenRow.data[0].token;
    const qr = await api('GET', '/api/qr/' + token);
    assertEqual(qr.status, 200, 'QR resolve succeeds for a valid token');
    assert(!!qr.data.property, 'QR resolve returns property context');

    // Catalog
    const catalog = await api('GET', '/api/catalog?propertyId=' + qr.data.property.id);
    assertEqual(catalog.status, 200, 'catalog loads');
    assert(catalog.data.products.length > 0, 'catalog has products');

    // Order creation + payment (single outlet — the default, unmodified path)
    const product = catalog.data.products.find(p => p.available);
    const order = await api('POST', '/api/orders', {
      pointId: qr.data.point.id, customerName: 'Test', items: [{ productId: product.id, qty: 1 }],
    });
    assertEqual(order.status, 201, 'order creation succeeds');
    const pay = await api('POST', `/api/orders/${order.data.id}/pay`, { method: 'card' });
    assertEqual(pay.status, 200, 'payment succeeds');
    assertEqual(pay.data.status, 'Paid', 'order status is Paid after payment');

    // Idempotency
    const pay2 = await api('POST', `/api/orders/${order.data.id}/pay`, { method: 'card' });
    assert(pay2.data.idempotent === true, 'repeated payment call is idempotent');

    // KDS + state machine
    const opToken = await loginAs('operator');
    const queue = await api('GET', '/api/ops/queue', null, opToken);
    assert(queue.data.some(o => o.id === order.data.id), 'order appears in KDS queue');
    const badTransition = await api('POST', `/api/orders/${order.data.id}/transition`, { to: 'Delivered' }, opToken);
    assertEqual(badTransition.status, 409, 'illegal state jump (Paid->Delivered) is rejected');
    const goodTransition = await api('POST', `/api/orders/${order.data.id}/transition`, { to: 'Accepted' }, opToken);
    assertEqual(goodTransition.status, 200, 'legal transition (Paid->Accepted) succeeds');

    // Role enforcement
    const runnerToken = await loginAs('runner');
    const wrongRole = await api('POST', `/api/orders/${order.data.id}/transition`, { to: 'Preparing' }, runnerToken);
    assertEqual(wrongRole.status, 403, 'Runner cannot perform an Operator-only transition');

    // Tenant scope isolation
    const partnerToken = await loginAs('partner');
    const scopeViolation = await api('GET', '/api/partner/overview?partnerId=pt_alrowad', null, partnerToken);
    assertEqual(scopeViolation.status, 403, 'PartnerViewer cannot read another partner\'s data');

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
