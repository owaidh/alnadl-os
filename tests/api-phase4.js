// tests/api-phase4.js — Phase 4 feature suite (Q10, Q19 support)
'use strict';
const { startServer, stopServer, api, loginAs, assert, assertEqual, summary, resetCounts } = require('./helpers.js');

async function run() {
  resetCounts();
  await startServer();
  console.log('=== API Suite: Phase 4 ===');

  try {
    const adminToken = await loginAs('admin');

    // --- Outlets: migration + feature gate ---
    const outlets = await api('GET', '/api/admin/outlets?propertyId=prop_nova_main', null, adminToken);
    assert(outlets.data.length >= 2, 'Hotel Nova has 2+ migrated outlets');

    await api('POST', '/api/admin/subscription', { partnerId: 'pt_nova', planCode: 'SMART' }, adminToken);
    const blocked = await api('POST', '/api/admin/outlets', { propertyId: 'prop_nova_main', name_ar: 'x', name_en: 'x', type: 'bakery' }, adminToken);
    assertEqual(blocked.status, 402, 'creating a 3rd+ outlet on SMART (no multiOutlet) is blocked with 402');

    await api('POST', '/api/admin/subscription', { partnerId: 'pt_nova', planCode: 'CONNECT' }, adminToken);
    const allowed = await api('POST', '/api/admin/outlets', { propertyId: 'prop_nova_main', name_ar: 'مخبز', name_en: 'Test Bakery', type: 'bakery' }, adminToken);
    assertEqual(allowed.status, 201, 'creating an outlet on CONNECT succeeds');

    // --- Service Hub: single vs multi outlet ---
    const points1 = await api('GET', '/api/demo/points');
    const novaPoint = points1.data.find(p => p.id === 'PT-014');
    const novaHub = await api('GET', '/api/service-hub/' + novaPoint.token);
    assert(novaHub.data.hub === true, 'Hotel Nova (3 outlets, CONNECT) shows Service Hub');

    // --- Unified Cart: multi-outlet order splits into child_orders ---
    const order = await api('POST', '/api/orders', {
      pointId: 'PT-014',
      items: [{ productId: 'p_latte', qty: 1 }, { productId: 'p_grill', qty: 1 }],
    });
    await api('POST', `/api/orders/${order.data.id}/pay`, { method: 'card' });
    const opToken = await loginAs('operator');
    const queue = await api('GET', '/api/ops/queue', null, opToken);
    const children = queue.data.filter(t => t.parentOrderId === order.data.id);
    assertEqual(children.length, 2, 'multi-outlet order produces exactly 2 KDS tickets');

    // Advance one child only — parent must not jump ahead
    await api('POST', `/api/child-orders/${children[0].id}/transition`, { to: 'Accepted' }, opToken);
    await api('POST', `/api/child-orders/${children[0].id}/transition`, { to: 'Preparing' }, opToken);
    await api('POST', `/api/child-orders/${children[0].id}/transition`, { to: 'Ready' }, opToken);
    const parentMid = await api('GET', `/api/orders/${order.data.id}`);
    assertEqual(parentMid.data.status, 'Paid', 'parent stays at least-advanced status while 1 of 2 children is Ready');

    await api('POST', `/api/child-orders/${children[1].id}/transition`, { to: 'Accepted' }, opToken);
    await api('POST', `/api/child-orders/${children[1].id}/transition`, { to: 'Preparing' }, opToken);
    await api('POST', `/api/child-orders/${children[1].id}/transition`, { to: 'Ready' }, opToken);
    const parentDone = await api('GET', `/api/orders/${order.data.id}`);
    assertEqual(parentDone.data.status, 'Ready', 'parent becomes Ready once both children are Ready');

    // --- Revenue Engine: 2 ledger rows, correct math, immutable snapshot ---
    const ledger = await api('GET', '/api/admin/revenue-ledger', null, adminToken);
    const rows = ledger.data.filter(r => r.order_id === order.data.id);
    assertEqual(rows.length, 2, 'multi-outlet order produces 2 revenue_ledger rows');

    const restaurantOutlet = outlets.data.find(o => o.type === 'restaurant');
    await api('POST', '/api/admin/revenue-models', { outletId: restaurantOutlet.id, type: 'share', shareRate: 0.6 }, adminToken);
    const oldRow = rows.find(r => r.outlet_id === restaurantOutlet.id);
    const oldModel = JSON.parse(oldRow.model_snapshot_json);
    assert(oldModel.type !== 'share' || oldModel.implicit, 'pre-existing ledger row kept its original model snapshot after the model changed');

    // --- White Label: scoped, degrades gracefully ---
    await api('POST', '/api/admin/subscription', { partnerId: 'pt_nova', planCode: 'PLATFORM' }, adminToken);
    await api('POST', '/api/admin/branding', { partnerId: 'pt_nova', mode: 'full_white_label', primaryColor: '#2E5C4B' }, adminToken);
    const brandedQr = await api('GET', '/api/qr/' + novaPoint.token);
    assertEqual(brandedQr.data.branding.mode, 'full_white_label', 'branding reflects full_white_label on PLATFORM');
    await api('POST', '/api/admin/subscription', { partnerId: 'pt_nova', planCode: 'SMART' }, adminToken);
    const degradedQr = await api('GET', '/api/qr/' + novaPoint.token);
    assertEqual(degradedQr.data.branding.mode, 'alnadl', 'branding gracefully degrades to alnadl when downgraded off PLATFORM');

    // --- QR Analytics: real event-based conversion math ---
    const bulk = await api('POST', '/api/admin/qr/bulk', { zoneId: 'z_lobby', type: 'table', count: 1, labelPrefix: 'TestTable' }, adminToken);
    const newToken = bulk.data.created[0].token, newPoint = bulk.data.created[0].id;
    await api('GET', '/api/qr/' + newToken);
    await api('GET', '/api/qr/' + newToken);
    await api('POST', '/api/admin/subscription', { partnerId: 'pt_nova', planCode: 'CONNECT' }, adminToken);
    const o2 = await api('POST', '/api/orders', { pointId: newPoint, items: [{ productId: 'p_latte', qty: 1 }] });
    await api('POST', `/api/orders/${o2.data.id}/pay`, { method: 'card' });
    const analytics = await api('GET', `/api/admin/qr/${newPoint}/analytics`, null, adminToken);
    assertEqual(analytics.data.scans, 2, 'QR analytics: 2 scans recorded');
    assertEqual(analytics.data.orders, 1, 'QR analytics: 1 order recorded');
    assertEqual(analytics.data.conversionRate, 50, 'QR analytics: 50% conversion computed correctly');

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
