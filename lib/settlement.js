// lib/settlement.js — Revenue-share settlement engine.
// Formula transparency + versioning per Screen Spec §P04:
//   Eligible Base = Gross Sales - Discounts - Refunds
//   Partner Share = Eligible Base * contractual share_rate
// The share_rate is stored per computed settlement row (never overwritten
// retroactively) so a future rate change never rewrites a past statement.
'use strict';
const { db, uid } = require('../db.js');

const DEFAULT_SHARE_RATE = 0.30; // Model B placeholder — real value comes from the partner contract

function periodBounds(period) {
  // period like "2026-08"
  const [y, m] = period.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)).getTime();
  const end = new Date(Date.UTC(y, m, 1)).getTime();
  return { start, end };
}

function computeSettlement(partnerId, period, shareRate = DEFAULT_SHARE_RATE) {
  const { start, end } = periodBounds(period);
  const orders = db.prepare(
    `SELECT * FROM orders WHERE partner_id = ? AND created_at >= ? AND created_at < ? AND status IN ('Delivered','Refunded')`
  ).all(partnerId, start, end);

  const gross = orders.reduce((s, o) => s + (o.total || 0), 0);
  const refunds = orders.filter(o => o.status === 'Refunded').reduce((s, o) => s + (o.total || 0), 0);
  const discounts = 0; // promo engine not yet in MVP scope (A04 promotion is Phase 2)
  const eligibleBase = Math.max(0, gross - discounts - refunds);
  const partnerShare = eligibleBase * shareRate;

  return {
    partnerId, period, ordersCount: orders.length,
    gross: round2(gross), discounts: round2(discounts), refunds: round2(refunds),
    eligibleBase: round2(eligibleBase), shareRate, partnerShare: round2(partnerShare),
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

function saveSettlement(calc) {
  const id = uid('stl');
  db.prepare(`INSERT INTO settlements (id,partner_id,period,gross,discounts,refunds,eligible_base,share_rate,partner_share,status,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, calc.partnerId, calc.period, calc.gross, calc.discounts, calc.refunds, calc.eligibleBase, calc.shareRate, calc.partnerShare, 'Draft', Date.now());
  return id;
}

module.exports = { computeSettlement, saveSettlement, DEFAULT_SHARE_RATE };
