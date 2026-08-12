// lib/wallet.js — Corporate Wallet (concept doc §8 "الشركات الكبرى", §14 "Split Payment").
// A wallet covers up to a policy-capped amount per order from a shared
// monthly budget; anything above that is charged to the employee's own
// payment method — this is the literal "Split Payment" line from the spec.
'use strict';
const { db, uid } = require('../db.js');

function getWallet(walletId) {
  const w = db.prepare('SELECT * FROM wallet_accounts WHERE id = ?').get(walletId);
  if (w) w.policy = JSON.parse(w.policy_json || '{}');
  return w;
}

/** How much of `orderTotal` can this wallet legally cover right now? */
function quoteCoverage(walletId, orderTotal) {
  const w = getWallet(walletId);
  if (!w || w.status !== 'Active') return { covered: 0, remainder: orderTotal, wallet: null };
  const remainingBudget = Math.max(0, w.monthly_budget - w.spent_this_period);
  const perOrderCap = w.policy.perOrderCap != null ? w.policy.perOrderCap : Infinity;
  const covered = Math.min(orderTotal, remainingBudget, perOrderCap);
  return { covered: Math.round(covered * 100) / 100, remainder: Math.round((orderTotal - covered) * 100) / 100, wallet: w };
}

function commitSpend(walletId, orderId, amount) {
  if (!walletId || amount <= 0) return;
  db.prepare('UPDATE wallet_accounts SET spent_this_period = spent_this_period + ? WHERE id = ?').run(amount, walletId);
  db.prepare('INSERT INTO wallet_transactions (id,wallet_id,order_id,amount,type,created_at) VALUES (?,?,?,?,?,?)')
    .run(uid('wt'), walletId, orderId, amount, 'order_charge', Date.now());
}

module.exports = { getWallet, quoteCoverage, commitSpend };
