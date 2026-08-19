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

/* ---------------------------------------------------------------------------
   P1-03 — ربط المحفظة بكيان الشريك.

   الخلل المُصلَح: المحفظة كانت تُستدعى بـowner_ref وحده على مستوى النظام
   كله. owner_ref قيمة يكتبها الشريك نفسه ('dept:engineering' مثلًا)، وليست
   معرّفًا فريدًا عالميًا -- فشركتان مختلفتان تحت شريكين مختلفين قد تستخدمان
   النص نفسه بحسن نيّة. والنتيجة: ضيف في موقع الشريك (أ) يربط محفظة تخصّ
   الشريك (ب)، فتُخصم ميزانية شركة من طلب لا علاقة لها به. هذا ليس تسريب
   بيانات فحسب، بل **خصم مالي عابر للمستأجرين**.

   الإصلاح مبدئي لا ترقيعي: المحفظة لا تُحلّ أبدًا بلا نطاق شريك، والنطاق
   يُشتق على الخادم من رمز QR الخاص بالضيف -- لا من قيمة يرسلها العميل،
   وإلا لعاد الخلل نفسه بصيغة أخرى.
--------------------------------------------------------------------------- */

/** يبحث عن محفظة نشطة بـowner_ref **داخل شريك محدّد**. بلا شريك: لا نتيجة. */
function findWalletForPartner(partnerId, ownerRef) {
  if (!partnerId || !ownerRef) return null;
  const w = db.prepare(
    `SELECT * FROM wallet_accounts WHERE partner_id = ? AND owner_ref = ? AND status = 'Active'`
  ).get(partnerId, ownerRef);
  if (w) w.policy = JSON.parse(w.policy_json || '{}');
  return w || null;
}

/** يتحقق أن المحفظة تخصّ شريك الطلب فعلًا قبل أي خصم.
    فحص ثانٍ مقصود عند الدفع: المحفظة تُحفظ على الطلب عند إنشائه، وبينهما
    زمن -- وقد تكون وصلت بمسار قديم أو بطلب مصنوع يدويًا. */
function assertWalletBelongsToPartner(walletId, partnerId) {
  const w = getWallet(walletId);
  if (!w) { const e = new Error('Wallet unavailable or inactive'); e.status = 409; e.code = 'WALLET_UNAVAILABLE'; throw e; }
  if (w.partner_id !== partnerId) {
    // رسالة محايدة للضيف: لا تُفصح أن المحفظة موجودة لكنها لشريك آخر.
    const e = new Error('Wallet unavailable or inactive');
    e.status = 409; e.code = 'WALLET_PARTNER_MISMATCH';
    throw e;
  }
  return w;
}

function commitSpend(walletId, orderId, amount) {
  if (!walletId || amount <= 0) return;
  db.prepare('UPDATE wallet_accounts SET spent_this_period = spent_this_period + ? WHERE id = ?').run(amount, walletId);
  db.prepare('INSERT INTO wallet_transactions (id,wallet_id,order_id,amount,type,created_at) VALUES (?,?,?,?,?,?)')
    .run(uid('wt'), walletId, orderId, amount, 'order_charge', Date.now());
}

module.exports = { getWallet, quoteCoverage, commitSpend, findWalletForPartner, assertWalletBelongsToPartner };
