// tests/partner-dashboard.js — UX-3 Partner Decision Dashboard (spec §8)
//
// Focus of this suite is the corrective round's specific concerns:
//   * multi-outlet orders must NOT be silently mis-measured against one
//     arbitrary outlet's SLA budget — they must be excluded and counted
//   * single-outlet SLA must use the SLOWEST item budget, not a random row
//   * refunds must only raise an attention item when genuinely elevated
//   * "today" figures must genuinely mean today, with all-time reported
//     separately rather than one masquerading as the other
//   * bottom zone and next settlement must be present when computable
'use strict';
const { startServer, stopServer, api, loginAs, assert, assertEqual, summary, resetCounts, getDataPath } = require('./helpers.js');

function openDirectDb() {
  process.env.SQLITE_PATH = getDataPath();
  delete require.cache[require.resolve('../db.js')];
  return require('../db.js');
}

async function run() {
  resetCounts();
  await startServer();
  console.log('=== UX-3 Suite: Partner Decision Dashboard ===');

  try {
    const adminToken = await loginAs('admin');
    const { db, uid } = openDirectDb();
    const now = Date.now();
    const PARTNER = 'pt_nova';
    const PROPERTY = 'prop_nova_main';

    const overview = () => api('GET', `/api/partner/overview?partnerId=${PARTNER}`, null, adminToken);

    // Two outlets with deliberately DIFFERENT prep budgets — this is what
    // makes the multi-outlet SLA question meaningful at all.
    const fastOutlet = uid('out');
    const slowOutlet = uid('out');
    db.prepare(`INSERT INTO outlets (id,property_id,name_ar,name_en,type,operator,station_id,delivery_mode,sla_prep_min,sla_delivery_min,commission_rate,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(fastOutlet, PROPERTY, 'سريع', 'Fast Bar', 'coffee', 'partner', null, 'runner', 4, 10, 0, 'Active', now);
    db.prepare(`INSERT INTO outlets (id,property_id,name_ar,name_en,type,operator,station_id,delivery_mode,sla_prep_min,sla_delivery_min,commission_rate,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(slowOutlet, PROPERTY, 'بطيء', 'Slow Kitchen', 'restaurant', 'partner', null, 'runner', 30, 10, 0, 'Active', now);

    // Helper: build a delivered order with given items/outlets and a real
    // fulfillment timing, optionally split into child orders.
    let seq = 0;
    function makeOrder({ outletIds, prepMinutes, split, createdAt }) {
      seq++;
      const orderId = `TEST-UX3-${seq}`;
      const created = createdAt != null ? createdAt : now - 60 * 60000;
      db.prepare(`INSERT INTO orders (id,partner_id,property_id,zone_id,point_id,status,subtotal,vat,total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(orderId, PARTNER, PROPERTY, 'z_pool', 'PT-021', 'Delivered', 100, 15, 115, created, created);
      outletIds.forEach((oid, i) => {
        db.prepare(`INSERT INTO order_items (id,order_id,product_id,outlet_id,name_ar,name_en,qty,unit_price,line_total) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(uid('oi'), orderId, 'p_latte', oid, 'صنف', 'Item', 1, 100 / outletIds.length, 100 / outletIds.length);
      });
      if (split) {
        outletIds.forEach(oid => {
          db.prepare(`INSERT INTO child_orders (id,parent_order_id,outlet_id,status,subtotal,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
            .run(uid('CHD'), orderId, oid, 'Delivered', 50, created, created);
        });
      }
      // Real recorded timing: accepted -> ready took exactly prepMinutes
      db.prepare(`INSERT OR REPLACE INTO fulfillment (order_id, accepted_at, ready_at) VALUES (?,?,?)`)
        .run(orderId, created, created + prepMinutes * 60000);
      return orderId;
    }

    // ================================================================
    // 1) MULTI-OUTLET SLA — the corrective round's central concern
    // ================================================================
    const baseline = await overview();
    const baseMeasured = baseline.data.allTime.slaMeasured;
    const baseExcluded = baseline.data.allTime.slaExcludedMultiOutlet;

    // A split order spanning BOTH a 4-minute and a 30-minute outlet, ready
    // in 10 minutes. Under the old LIMIT-1 logic this would have been
    // scored against whichever outlet's budget came back first — either a
    // false breach (vs 4 min) or a false pass (vs 30 min), decided by row
    // order rather than by anything real.
    makeOrder({ outletIds: [fastOutlet, slowOutlet], prepMinutes: 10, split: true });
    const afterSplit = await overview();
    assertEqual(afterSplit.data.allTime.slaMeasured, baseMeasured,
      'MULTI-OUTLET SLA: a split order does NOT change slaMeasured — it is excluded from the percentage, not scored against an arbitrary outlet budget');
    assertEqual(afterSplit.data.allTime.slaExcludedMultiOutlet, baseExcluded + 1,
      'MULTI-OUTLET SLA: the split order is counted in slaExcludedMultiOutlet so the exclusion is visible, not silent');

    // ================================================================
    // 2) SINGLE-OUTLET SLA uses the SLOWEST budget, not an arbitrary row
    // ================================================================
    // Items from BOTH outlets but NOT split into child orders. Ready in
    // 10 minutes: breaches the 4-minute budget, meets the 30-minute one.
    // Correct behaviour is to judge against the slowest (30) -> a PASS.
    makeOrder({ outletIds: [fastOutlet, slowOutlet], prepMinutes: 10, split: false });
    const afterMixed = await overview();
    assertEqual(afterMixed.data.allTime.slaMeasured, baseMeasured + 1,
      'SINGLE-OUTLET SLA: a non-split order IS measured');
    assert(afterMixed.data.allTime.slaPercent === 100,
      `SINGLE-OUTLET SLA: judged against the SLOWEST item budget (30 min), a 10-minute prep is a pass — got ${afterMixed.data.allTime.slaPercent}% (a LIMIT-1 lookup could have scored this against the 4-minute budget instead)`);

    // A genuine breach: 40 minutes against the same 30-minute slowest budget
    makeOrder({ outletIds: [slowOutlet], prepMinutes: 40, split: false });
    const afterBreach = await overview();
    assertEqual(afterBreach.data.allTime.slaMeasured, baseMeasured + 2, 'SLA: the breaching order is measured too');
    assert(afterBreach.data.allTime.slaPercent === 50,
      `SLA: one pass + one genuine breach = 50% — got ${afterBreach.data.allTime.slaPercent}%`);

    // ================================================================
    // 3) TODAY vs ALL-TIME are genuinely different windows
    // ================================================================
    // Everything above was created ~1 hour ago (today). Add an order from
    // 10 days ago that breaches, and confirm it moves all-time but NOT today.
    const tenDaysAgo = now - 10 * 86400000;
    makeOrder({ outletIds: [slowOutlet], prepMinutes: 90, split: false, createdAt: tenDaysAgo });
    const afterOld = await overview();
    assertEqual(afterOld.data.today.slaMeasured, baseMeasured + 2,
      'TODAY WINDOW: a 10-day-old order does NOT appear in today.slaMeasured');
    assertEqual(afterOld.data.allTime.slaMeasured, baseMeasured + 3,
      'ALL-TIME WINDOW: the same 10-day-old order DOES appear in allTime.slaMeasured');
    assert(afterOld.data.today.slaPercent !== afterOld.data.allTime.slaPercent,
      `TODAY vs ALL-TIME: the two figures genuinely differ (today ${afterOld.data.today.slaPercent}% vs all-time ${afterOld.data.allTime.slaPercent}%) — proving "today" is no longer all-time data wearing a today label`);

    // Ratings follow the same windowing
    const todayOrderForRating = afterOld.data.today.orders;
    assert(typeof afterOld.data.today.ratingCount === 'number' && typeof afterOld.data.allTime.ratingCount === 'number',
      'RATING WINDOW: today and all-time rating counts are both reported separately');

    // ================================================================
    // 4) REFUNDS: only flagged when genuinely elevated
    // ================================================================
    const preRefund = await overview();
    assert(!preRefund.data.attention.some(a => a.kind === 'refunds_elevated'),
      'REFUNDS: no refund attention item before any refund exists');

    // A tiny refund well under the threshold must NOT raise an item.
    const anyOrder = db.prepare(`SELECT id FROM orders WHERE partner_id = ? AND status='Delivered' LIMIT 1`).get(PARTNER);
    db.prepare(`INSERT INTO refunds (id,order_id,amount,type,reason,status,actor,actor_role,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(uid('rf'), anyOrder.id, 1, 'partial', 'tiny', 'Completed', 'finance', 'AlnadlFinance', now);
    const afterTinyRefund = await overview();
    assert(!afterTinyRefund.data.attention.some(a => a.kind === 'refunds_elevated'),
      'REFUNDS: a trivial refund (well under the configured rate) does NOT raise an attention item — this is the specific "any refund is an incident" behaviour the corrective round removed');

    // A large refund above the threshold MUST raise one, and must explain why.
    db.prepare(`INSERT INTO refunds (id,order_id,amount,type,reason,status,actor,actor_role,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(uid('rf'), anyOrder.id, 400, 'partial', 'large', 'Completed', 'finance', 'AlnadlFinance', now);
    const afterBigRefund = await overview();
    const refundItem = afterBigRefund.data.attention.find(a => a.kind === 'refunds_elevated');
    assert(!!refundItem, 'REFUNDS: a genuinely elevated refund rate DOES raise an attention item');
    assert(refundItem.ratePercent >= refundItem.thresholdPercent,
      `REFUNDS: the item reports the real rate (${refundItem.ratePercent}%) against the configured threshold (${refundItem.thresholdPercent}%) so the UI can explain WHY it fired`);

    // ================================================================
    // 5) BOTTOM ZONE + NEXT SETTLEMENT (corrective round additions)
    // ================================================================
    const perf = afterBigRefund.data.performance;
    assert(perf.topZone && perf.topZone.zone, 'PERFORMANCE: topZone is reported');
    assert(perf.bottomZone && perf.bottomZone.zone, 'PERFORMANCE: bottomZone is now reported (spec asks for "top/bottom zone")');
    assert(perf.topZone.count >= perf.bottomZone.count, 'PERFORMANCE: topZone genuinely ranks at or above bottomZone by real order count');

    assertEqual(afterBigRefund.data.money.nextSettlement, null,
      'NEXT SETTLEMENT: null when the partner genuinely has no outstanding settlement — not a fabricated placeholder');

    db.prepare(`INSERT INTO settlements (id,partner_id,period,gross,discounts,refunds,eligible_base,share_rate,partner_share,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(uid('st'), PARTNER, '2026-07', 5000, 0, 0, 5000, 0.7, 3500, 'Reviewed', now - 86400000);
    db.prepare(`INSERT INTO settlements (id,partner_id,period,gross,discounts,refunds,eligible_base,share_rate,partner_share,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(uid('st'), PARTNER, '2026-08', 6000, 0, 0, 6000, 0.7, 4200, 'Draft', now);
    const afterSettlements = await overview();
    const next = afterSettlements.data.money.nextSettlement;
    assert(!!next, 'NEXT SETTLEMENT: reported once an outstanding settlement exists');
    assertEqual(next.period, '2026-07',
      'NEXT SETTLEMENT: the OLDEST outstanding settlement is the next one due, not the newest');
    assertEqual(next.status, 'Reviewed', 'NEXT SETTLEMENT: carries its real workflow status');
    assert(next.amount === 3500, `NEXT SETTLEMENT: carries the real partner share (got ${next.amount})`);

    // ================================================================
    // 6) Partner privacy still holds on the enriched payload
    // ================================================================
    const raw = JSON.stringify(afterSettlements.data).toLowerCase();
    for (const term of ['prompt', 'mechanic', 'selection_reason', 'embedding', 'rendered_payload']) {
      assert(!raw.includes(term), `PRIVACY: the enriched partner payload never contains "${term}"`);
    }

    // Tenant isolation: a partner-scoped user cannot read another tenant
    const partnerToken = await loginAs('partner');
    const crossTenant = await api('GET', '/api/partner/overview?partnerId=pt_alrowad', null, partnerToken);
    assertEqual(crossTenant.status, 403, 'PRIVACY: a partner-scoped user is refused another tenant\'s overview');

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
