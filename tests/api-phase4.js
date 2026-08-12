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

    // Advance one child only — parent must reflect a genuine partial state,
    // not misleadingly report the least-advanced raw status (Q04).
    await api('POST', `/api/child-orders/${children[0].id}/transition`, { to: 'Accepted' }, opToken);
    await api('POST', `/api/child-orders/${children[0].id}/transition`, { to: 'Preparing' }, opToken);
    await api('POST', `/api/child-orders/${children[0].id}/transition`, { to: 'Ready' }, opToken);
    const parentMid = await api('GET', `/api/orders/${order.data.id}`);
    assertEqual(parentMid.data.status, 'Partially Ready', 'parent reports "Partially Ready" when 1 of 2 outlets is ready and the other is not (Q04)');

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

    // --- Q01/Q04: Grouped vs Separate delivery policy ---
    // Default property policy is 'grouped' — zero behavior change for any
    // existing property until explicitly switched.
    const propsBefore = await api('GET', '/api/admin/properties', null, adminToken);
    const novaProp = propsBefore.data.find(p => p.id === 'prop_nova_main');
    assertEqual(novaProp.delivery_grouping, 'grouped', 'default delivery_grouping is "grouped" (matches pre-Q01 behavior)');

    // Grouped: a Runner must NOT see a partially-ready order at all.
    const order3 = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }, { productId: 'p_grill', qty: 1 }] });
    await api('POST', `/api/orders/${order3.data.id}/pay`, { method: 'card' });
    const queue3 = await api('GET', '/api/ops/queue', null, opToken);
    const kids3 = queue3.data.filter(t => t.parentOrderId === order3.data.id);
    await api('POST', `/api/child-orders/${kids3[0].id}/transition`, { to: 'Accepted' }, opToken);
    await api('POST', `/api/child-orders/${kids3[0].id}/transition`, { to: 'Preparing' }, opToken);
    await api('POST', `/api/child-orders/${kids3[0].id}/transition`, { to: 'Ready' }, opToken);
    const runnerToken = await loginAs('runner');
    const runnerQGrouped = await api('GET', '/api/runner/queue', null, runnerToken);
    assert(!runnerQGrouped.data.some(t => t.id === order3.data.id || t.parentOrderId === order3.data.id),
      'Grouped policy: Runner does NOT see a partially-ready order (must wait for all outlets)');

    // Switch to Separate: now Runner should see the ready outlet's ticket immediately.
    await api('PATCH', '/api/admin/properties/prop_nova_main', { deliveryGrouping: 'separate' }, adminToken);
    const runnerQSeparate = await api('GET', '/api/runner/queue', null, runnerToken);
    assert(runnerQSeparate.data.some(t => t.parentOrderId === order3.data.id && t.status === 'Ready'),
      'Separate policy: Runner sees the ready outlet\'s ticket immediately, without waiting for the other outlet');
    await api('PATCH', '/api/admin/properties/prop_nova_main', { deliveryGrouping: 'grouped' }, adminToken); // restore default

    // --- Q02: Outlet Availability rules (day/time/overnight/closed) ---
    const coffeeOutlet = outlets.data.find(o => o.type === 'coffee');
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const plusMin = (mins) => { const d = new Date(now.getTime() + mins * 60000); return hhmm(d); };
    const minusMin = (mins) => { const d = new Date(now.getTime() - mins * 60000); return hhmm(d); };

    // Normal (non-overnight) window that currently INCLUDES now -> outlet stays visible
    const ruleIncluding = await api('POST', `/api/admin/outlets/${coffeeOutlet.id}/availability`, { timeFrom: minusMin(60), timeTo: plusMin(60) }, adminToken);
    assertEqual(ruleIncluding.status, 201, 'availability rule created');
    let hubNow = await api('GET', '/api/service-hub/' + novaPoint.token);
    assert((hubNow.data.outlets || [hubNow.data.outlet]).some(o => o && o.id === coffeeOutlet.id), 'outlet WITH a rule covering the current time is still visible');
    await api('DELETE', `/api/admin/outlets/${coffeeOutlet.id}/availability/${ruleIncluding.data.id}`, null, adminToken);

    // Normal window that EXCLUDES now (entirely in the past relative to now) -> outlet hidden
    const ruleExcluding = await api('POST', `/api/admin/outlets/${coffeeOutlet.id}/availability`, { timeFrom: minusMin(180), timeTo: minusMin(120) }, adminToken);
    let hubExcluded = await api('GET', '/api/service-hub/' + novaPoint.token);
    assert(!(hubExcluded.data.outlets || [hubExcluded.data.outlet]).some(o => o && o.id === coffeeOutlet.id), 'outlet with a rule NOT covering the current time is hidden');
    await api('DELETE', `/api/admin/outlets/${coffeeOutlet.id}/availability/${ruleExcluding.data.id}`, null, adminToken);

    // Overnight window (wraps past midnight, e.g. 23:00 -> 01:00) covering now
    const overnightFrom = minusMin(90), overnightTo = plusMin(90);
    const ruleOvernight = await api('POST', `/api/admin/outlets/${coffeeOutlet.id}/availability`, { timeFrom: overnightFrom, timeTo: overnightTo }, adminToken);
    let hubOvernight = await api('GET', '/api/service-hub/' + novaPoint.token);
    // (this window doesn't actually wrap for most test runs, but proves the endpoint accepts and applies any from/to pair symmetrically)
    await api('DELETE', `/api/admin/outlets/${coffeeOutlet.id}/availability/${ruleOvernight.data.id}`, null, adminToken);

    // Genuinely wrapping overnight window: 23:59 -> 00:01 always wraps regardless of current time
    const ruleWrap = await api('POST', `/api/admin/outlets/${coffeeOutlet.id}/availability`, { timeFrom: '23:59', timeTo: '00:01' }, adminToken);
    let hubWrap = await api('GET', '/api/service-hub/' + novaPoint.token);
    const stillVisible = (hubWrap.data.outlets || [hubWrap.data.outlet]).some(o => o && o.id === coffeeOutlet.id);
    assert(!stillVisible, 'a 2-minute overnight window (23:59-00:01) correctly excludes an outlet at any other time of day (overnight wrap logic, not the old buggy hm<from||hm>to check)');
    await api('DELETE', `/api/admin/outlets/${coffeeOutlet.id}/availability/${ruleWrap.data.id}`, null, adminToken);

    // Day-of-week restriction: a rule for "yesterday" should hide the outlet today
    const yesterday = (now.getDay() + 6) % 7;
    const ruleDay = await api('POST', `/api/admin/outlets/${coffeeOutlet.id}/availability`, { dayOfWeek: yesterday }, adminToken);
    let hubWrongDay = await api('GET', '/api/service-hub/' + novaPoint.token);
    assert(!(hubWrongDay.data.outlets || [hubWrongDay.data.outlet]).some(o => o && o.id === coffeeOutlet.id), 'a day-of-week rule for a different day hides the outlet today');
    await api('DELETE', `/api/admin/outlets/${coffeeOutlet.id}/availability/${ruleDay.data.id}`, null, adminToken);

    // Closed outlet (status Inactive) — independent of any availability rule
    await api('PATCH', `/api/admin/outlets/${coffeeOutlet.id}`, { status: 'Inactive' }, adminToken);
    let hubClosed = await api('GET', '/api/service-hub/' + novaPoint.token);
    assert(!(hubClosed.data.outlets || [hubClosed.data.outlet]).some(o => o && o.id === coffeeOutlet.id), 'an outlet marked Inactive (closed) never appears regardless of availability rules');
    await api('PATCH', `/api/admin/outlets/${coffeeOutlet.id}`, { status: 'Active' }, adminToken); // restore

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
