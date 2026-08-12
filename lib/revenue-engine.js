// lib/revenue-engine.js — Revenue Model Engine + Allocation Ledger (Phase 4 §9, §10)
//
// Four configurable calculation types, set PER OUTLET (not per partner --
// that's what lib/settlement.js still does for partner-level settlement,
// which this file does not replace or duplicate; see server.js comments):
//   share      — partner gets eligibleBase * share_rate, Alnadl gets the rest
//   commission — Alnadl takes eligibleBase * commission_rate, partner gets the rest
//   fixed      — Alnadl takes a flat fixed_amount per order regardless of size
//   hybrid     — commission + a flat fixed_amount, both to Alnadl
//
// An outlet with no revenue_models row falls back to an IMPLICIT commission
// model built from outlets.commission_rate — this is what makes every
// outlet migrated in Increment 1 (which only ever had a commission_rate,
// never a full model) keep earning correctly with zero new configuration.
'use strict';
const { db, uid } = require('../db.js');

function getActiveModel(outletId) {
  const m = db.prepare(`SELECT * FROM revenue_models WHERE outlet_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1`).get(outletId);
  if (m) return m;
  const outlet = db.prepare('SELECT * FROM outlets WHERE id = ?').get(outletId);
  return {
    id: null, outlet_id: outletId, type: 'commission',
    commission_rate: outlet ? outlet.commission_rate : 0,
    share_rate: null, fixed_amount: null, fixed_cycle: null,
    calculation_base: 'gross', implicit: true, // marks this as a fallback, not a saved row
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

function computeAmounts(model, eligibleBase) {
  switch (model.type) {
    case 'share': {
      const rate = model.share_rate || 0;
      return { partnerAmount: round2(eligibleBase * rate), alnadlAmount: round2(eligibleBase * (1 - rate)) };
    }
    case 'commission': {
      const alnadl = eligibleBase * (model.commission_rate || 0);
      return { partnerAmount: round2(eligibleBase - alnadl), alnadlAmount: round2(alnadl) };
    }
    case 'fixed': {
      const fee = model.fixed_amount || 0;
      return { partnerAmount: round2(eligibleBase - fee), alnadlAmount: round2(fee) };
    }
    case 'hybrid': {
      const commissionPart = eligibleBase * (model.commission_rate || 0);
      const alnadl = commissionPart + (model.fixed_amount || 0);
      return { partnerAmount: round2(eligibleBase - alnadl), alnadlAmount: round2(alnadl) };
    }
    default:
      return { partnerAmount: round2(eligibleBase), alnadlAmount: 0 };
  }
}

/** Records one revenue_ledger row per outlet represented in this order's
 * items, at the moment payment succeeds. Idempotent: calling this twice for
 * the same order (e.g. a retried webhook) does nothing the second time. */
function recordOrderRevenue(orderId) {
  const already = db.prepare('SELECT COUNT(*) c FROM revenue_ledger WHERE order_id = ?').get(orderId).c;
  if (already > 0) return [];

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return [];
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);

  const byOutlet = {};
  for (const it of items) {
    if (!it.outlet_id) continue; // no outlet resolved for this line — nothing to allocate, doesn't block the order
    byOutlet[it.outlet_id] = (byOutlet[it.outlet_id] || 0) + it.line_total;
  }
  const grossSubtotal = Object.values(byOutlet).reduce((s, v) => s + v, 0);
  if (grossSubtotal <= 0) return [];

  const discountTotal = order.discount_amount || 0;
  const now = Date.now();
  const written = [];
  for (const [outletId, outletGross] of Object.entries(byOutlet)) {
    const proportion = outletGross / grossSubtotal; // discounts/promos allocated proportionally across outlets
    const outletDiscount = discountTotal * proportion;
    const eligibleBase = Math.max(0, outletGross - outletDiscount);
    const model = getActiveModel(outletId);
    const { partnerAmount, alnadlAmount } = computeAmounts(model, eligibleBase);
    const id = uid('rl');
    db.prepare(`INSERT INTO revenue_ledger (id,order_id,outlet_id,gross_amount,discount_amount,eligible_base,partner_amount,alnadl_amount,model_snapshot_json,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, orderId, outletId, round2(outletGross), round2(outletDiscount), round2(eligibleBase), partnerAmount, alnadlAmount, JSON.stringify(model), now);
    written.push({ id, outletId, eligibleBase: round2(eligibleBase), partnerAmount, alnadlAmount });
  }
  return written;
}

module.exports = { getActiveModel, computeAmounts, recordOrderRevenue };
