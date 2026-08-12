// lib/loyalty.js — Loyalty & Rewards (concept doc §15 "Customer Experience & Loyalty").
// Simple, transparent points model: 1 point earned per 1 SAR of a Delivered
// order's total; each point redeemable for POINT_VALUE SAR off a future order.
'use strict';
const { db, uid } = require('../db.js');

const POINT_VALUE = 0.05; // 1 point = 0.05 SAR when redeemed (i.e. 20 points = 1 SAR)
const EARN_RATE = 1; // points earned per 1 SAR spent

function getOrCreateAccount(customerKey) {
  if (!customerKey) return null;
  let acct = db.prepare('SELECT * FROM loyalty_accounts WHERE customer_key = ?').get(customerKey);
  if (!acct) {
    const id = uid('loy');
    db.prepare('INSERT INTO loyalty_accounts (id,customer_key,points_balance,created_at) VALUES (?,?,0,?)').run(id, customerKey, Date.now());
    acct = db.prepare('SELECT * FROM loyalty_accounts WHERE id = ?').get(id);
  }
  return acct;
}

function earnPoints(customerKey, orderId, orderTotal) {
  if (!customerKey) return null;
  const acct = getOrCreateAccount(customerKey);
  const points = Math.floor(orderTotal * EARN_RATE);
  if (points <= 0) return acct;
  db.prepare('UPDATE loyalty_accounts SET points_balance = points_balance + ? WHERE id = ?').run(points, acct.id);
  db.prepare('INSERT INTO loyalty_transactions (id,account_id,order_id,points_delta,reason,created_at) VALUES (?,?,?,?,?,?)')
    .run(uid('lt'), acct.id, orderId, points, 'earn_on_delivery', Date.now());
  return db.prepare('SELECT * FROM loyalty_accounts WHERE id = ?').get(acct.id);
}

/** Returns { discount, pointsUsed } — caps redemption at available balance and at the order subtotal. */
function quoteRedemption(customerKey, requestedPoints, subtotal) {
  const acct = customerKey ? db.prepare('SELECT * FROM loyalty_accounts WHERE customer_key = ?').get(customerKey) : null;
  if (!acct || !requestedPoints) return { discount: 0, pointsUsed: 0 };
  const pointsUsed = Math.max(0, Math.min(requestedPoints, acct.points_balance));
  const discount = Math.min(pointsUsed * POINT_VALUE, subtotal);
  return { discount, pointsUsed, accountId: acct.id };
}

function commitRedemption(accountId, pointsUsed, orderId) {
  if (!accountId || !pointsUsed) return;
  db.prepare('UPDATE loyalty_accounts SET points_balance = points_balance - ? WHERE id = ?').run(pointsUsed, accountId);
  db.prepare('INSERT INTO loyalty_transactions (id,account_id,order_id,points_delta,reason,created_at) VALUES (?,?,?,?,?,?)')
    .run(uid('lt'), accountId, orderId, -pointsUsed, 'redeem_at_checkout', Date.now());
}

module.exports = { getOrCreateAccount, earnPoints, quoteRedemption, commitRedemption, POINT_VALUE };
