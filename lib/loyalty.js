// lib/loyalty.js — Loyalty & Rewards, partner-scoped (Go-Live P0 §3.4–§3.8).
//
// WHAT CHANGED AND WHY
// Before this round a loyalty account was keyed on the phone number ALONE.
// There was no partner_id anywhere in this file, which meant points earned
// at Partner A were spendable at Partner B -- and B absorbed the discount
// for a sale it never made. Every other subsystem here is tenant-isolated
// (Engage even keeps separate identities for the same phone across
// partners); loyalty was the single exception. It now matches.
//
// The scope is always derived SERVER-SIDE from the order's own property ->
// partner chain. A partner_id sent by a client is never trusted or used.
'use strict';
const { db, uid } = require('../db.js');

const POINT_VALUE = 0.05; // 1 point = 0.05 SAR when redeemed (20 points = 1 SAR)
const EARN_RATE = 1;      // points earned per 1 SAR spent

/* ---------------------------------------------------------------------------
   §3.4 / §3.7 — Entitlements, not hardcoded plan names.
   The old gate was `sub.features.loyalty`, effectively tied to the PLATFORM
   plan by name. Plan names are a commercial artifact and change; capability
   flags do not. These resolve from the subscription's own feature set, with
   a documented fallback to the legacy `loyalty` flag so existing plans keep
   working through the transition rather than silently losing the feature.
--------------------------------------------------------------------------- */
function partnerFeatures(partnerId) {
  const sub = db.prepare(`
    SELECT p.features_json FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.partner_id = ? AND s.status = 'Active'`).get(partnerId);
  if (!sub) return {};
  try { return JSON.parse(sub.features_json) || {}; } catch (e) { return {}; }
}

/** Can this partner accrue points at all? */
function isLoyaltyEnabled(partnerId) {
  const f = partnerFeatures(partnerId);
  if (f.loyalty_enabled !== undefined) return f.loyalty_enabled === true;
  return f.loyalty === true; // legacy flag, kept working deliberately
}

/** Can points be redeemed for money off? Separate lever on purpose (§3.8):
 *  a partner may want accrual live while redemption stays closed until a
 *  verification provider exists. */
function isRedeemEnabled(partnerId) {
  const f = partnerFeatures(partnerId);
  if (f.loyalty_redeem_enabled !== undefined) return f.loyalty_redeem_enabled === true;
  return isLoyaltyEnabled(partnerId); // legacy plans: redemption followed accrual
}

/* ---------------------------------------------------------------------------
   §3.8 — Redemption policy while no verification provider is connected.
   A phone number typed at checkout is an IDENTIFIER, not PROOF of ownership.
   Treating it as proof would mean anyone who knows a guest's number could
   spend their balance -- real money. LOYALTY_REDEEM_POLICY controls this:
     'verified_only' (default, safest) — self-service redemption requires a
                     verified account. With no provider connected nothing is
                     verified, so self-service redemption is simply closed
                     while accrual keeps working normally.
     'open'          — redemption on phone alone. Only appropriate where an
                     operator confirms identity out of band; must be a
                     deliberate, documented choice, never the default.
--------------------------------------------------------------------------- */
function redeemPolicy() {
  return process.env.LOYALTY_REDEEM_POLICY || 'verified_only';
}

function normalizeCustomerKey(raw) {
  if (!raw) return null;
  // Digits only, so "+966 50 123 4567" and "0501234567" cannot become two
  // separate balances for the same person at the same partner.
  const digits = String(raw).replace(/\D/g, '');
  return digits.length ? digits : null;
}

/** Accounts are ALWAYS looked up within a partner. A quarantined row
 *  (partner_id NULL, see migration 015) can never be returned here. */
function getOrCreateAccount(partnerId, rawCustomerKey) {
  const customerKey = normalizeCustomerKey(rawCustomerKey);
  if (!partnerId || !customerKey) return null;
  let acct = db.prepare('SELECT * FROM loyalty_accounts WHERE partner_id = ? AND customer_key = ?')
    .get(partnerId, customerKey);
  if (!acct) {
    const id = uid('loy');
    db.prepare(`INSERT INTO loyalty_accounts (id,customer_key,partner_id,points_balance,created_at,migration_status,verification_status)
                VALUES (?,?,?,0,?,'active','unverified')`).run(id, customerKey, partnerId, Date.now());
    acct = db.prepare('SELECT * FROM loyalty_accounts WHERE id = ?').get(id);
  }
  return acct;
}

/** Read-only lookup — never creates. Used by balance/history endpoints so
 *  merely asking about a number does not materialise an account for it. */
function findAccount(partnerId, rawCustomerKey) {
  const customerKey = normalizeCustomerKey(rawCustomerKey);
  if (!partnerId || !customerKey) return null;
  return db.prepare('SELECT * FROM loyalty_accounts WHERE partner_id = ? AND customer_key = ?')
    .get(partnerId, customerKey) || null;
}

function earnPoints(partnerId, rawCustomerKey, orderId, orderTotal) {
  if (!partnerId || !rawCustomerKey) return null;
  if (!isLoyaltyEnabled(partnerId)) return null; // disabled must never break the order
  const acct = getOrCreateAccount(partnerId, rawCustomerKey);
  if (!acct) return null;
  const points = Math.floor(orderTotal * EARN_RATE);
  if (points <= 0) return acct;
  db.prepare('UPDATE loyalty_accounts SET points_balance = points_balance + ? WHERE id = ?').run(points, acct.id);
  db.prepare('INSERT INTO loyalty_transactions (id,account_id,order_id,points_delta,reason,created_at) VALUES (?,?,?,?,?,?)')
    .run(uid('lt'), acct.id, orderId, points, 'earn_on_delivery', Date.now());
  return db.prepare('SELECT * FROM loyalty_accounts WHERE id = ?').get(acct.id);
}

/**
 * Returns { discount, pointsUsed, accountId, blockedReason }.
 * Caps at the available balance AND at the order subtotal. Redemption is
 * refused (with a machine-readable reason for the caller to log) when the
 * partner has it disabled or when policy requires verification the account
 * does not have.
 */
function quoteRedemption(partnerId, rawCustomerKey, requestedPoints, subtotal) {
  if (!partnerId || !requestedPoints) return { discount: 0, pointsUsed: 0 };
  if (!isLoyaltyEnabled(partnerId)) return { discount: 0, pointsUsed: 0, blockedReason: 'loyalty_disabled' };
  if (!isRedeemEnabled(partnerId)) return { discount: 0, pointsUsed: 0, blockedReason: 'redeem_disabled' };

  const acct = findAccount(partnerId, rawCustomerKey);
  if (!acct) return { discount: 0, pointsUsed: 0 };

  if (redeemPolicy() === 'verified_only' && acct.verification_status !== 'verified') {
    return { discount: 0, pointsUsed: 0, blockedReason: 'verification_required' };
  }

  const pointsUsed = Math.max(0, Math.min(requestedPoints, acct.points_balance));
  const discount = Math.min(pointsUsed * POINT_VALUE, subtotal);
  return { discount, pointsUsed, accountId: acct.id };
}

/** Commits a redemption. Re-checks the balance still covers it, so a stale
 *  or replayed commit can never drive a balance negative. */
function commitRedemption(accountId, pointsUsed, orderId) {
  if (!accountId || !pointsUsed) return;
  const acct = db.prepare('SELECT points_balance FROM loyalty_accounts WHERE id = ?').get(accountId);
  if (!acct || acct.points_balance < pointsUsed) return;
  db.prepare('UPDATE loyalty_accounts SET points_balance = points_balance - ? WHERE id = ?').run(pointsUsed, accountId);
  db.prepare('INSERT INTO loyalty_transactions (id,account_id,order_id,points_delta,reason,created_at) VALUES (?,?,?,?,?,?)')
    .run(uid('lt'), accountId, orderId, -pointsUsed, 'redeem_at_checkout', Date.now());
}

function getHistory(accountId, limit = 50) {
  return db.prepare('SELECT * FROM loyalty_transactions WHERE account_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(accountId, limit);
}

module.exports = {
  getOrCreateAccount, findAccount, earnPoints, quoteRedemption, commitRedemption,
  getHistory, isLoyaltyEnabled, isRedeemEnabled, redeemPolicy, normalizeCustomerKey,
  POINT_VALUE,
};
