// lib/payment-policy.js — P1-04.
//
// مُحلِّل مركزي واحد. السبب نفسه الذي دعا لمُحلِّلي حالة الشريك والعلامة:
// نثر شروط الدفع على النقاط يعني أن أول نقطة تُضاف لاحقًا وتنسى الفحص تصبح
// ثغرة -- وهنا الثغرة **مالية**: طلب يُحصَّل حيث لا يجوز، أو يُسجَّل مدفوعًا
// وهو لم يُدفع.
//
// الترتيب: Outlet → Property → Partner → ONLINE (الافتراضي التاريخي).
// المنفذ هو الأدق والحاسم: الشريك الواحد قد يملك منفذًا يُحصِّل أونلاين وآخر
// يُحصِّل عند التسليم ومنفذًا داخليًا لا يُحصِّل إطلاقًا.
'use strict';
const { db } = require('../db.js');

const POLICIES = ['ONLINE', 'POS_ON_DELIVERY', 'CORPORATE_WALLET', 'NO_GUEST_PAYMENT', 'MIXED'];

/* الوسائل التي تقبلها كل سياسة. المصدر الوحيد لهذا القرار. */
const METHODS_BY_POLICY = {
  ONLINE:            ['card', 'applepay', 'mada'],
  POS_ON_DELIVERY:   ['pos', 'cash'],
  CORPORATE_WALLET:  ['wallet'],
  // لا وسيلة إطلاقًا: الضيف لا يرى خطوة تحصيل.
  NO_GUEST_PAYMENT:  [],
  // MIXED تُقرأ من allowed_methods_json، وبلا قائمة تُعطي الاتحاد الآمن.
  MIXED:             ['card', 'applepay', 'mada', 'pos', 'cash', 'wallet'],
};

/* حالات التحصيل. NOT_REQUIRED ليست Paid وليست مجانية:
   الطلب له قيمة حقيقية تدخل التقارير والتكلفة والتسويات، لكنها **لا تُحصَّل
   من الضيف**. تسجيلها Paid تزوير محاسبي يُفسد كل تقرير إيراد لاحقًا. */
const COLLECTION_STATES = ['PENDING', 'COLLECTED', 'NOT_REQUIRED', 'REFUNDED', 'FAILED'];

function getOverride(scopeType, scopeId) {
  if (!scopeId) return null;
  return db.prepare('SELECT * FROM payment_policy_overrides WHERE scope_type = ? AND scope_id = ?')
    .get(scopeType, scopeId) || null;
}

/**
 * يحلّ السياسة الفعّالة.
 * @returns {{policy, allowedMethods, source, requiresGuestPayment, chain}}
 */
function resolvePaymentPolicy(ctx) {
  const { partnerId, propertyId, outletId } = ctx || {};
  let policy = 'ONLINE';          // الافتراضي التاريخي: كل طلب كان يُحصَّل
  let source = 'default';
  let allowedJson = null;
  const chain = [];

  for (const [type, id] of [['partner', partnerId], ['property', propertyId], ['outlet', outletId]]) {
    if (!id) continue;
    const ov = getOverride(type, id);
    if (!ov) { chain.push({ scope: type, id, policy: null }); continue; }
    chain.push({ scope: type, id, policy: ov.policy || null });
    if (ov.policy && POLICIES.includes(ov.policy)) {
      policy = ov.policy; source = type;
      allowedJson = ov.allowed_methods_json || null;
    }
  }

  let allowedMethods = METHODS_BY_POLICY[policy] || [];
  if (policy === 'MIXED' && allowedJson) {
    try {
      const parsed = JSON.parse(allowedJson);
      if (Array.isArray(parsed) && parsed.length) {
        // التقاطع لا الاستبدال: قائمة مضبوطة لا تستطيع منح وسيلة خارج
        // ما يعرفه النظام أصلًا.
        allowedMethods = parsed.filter(m => METHODS_BY_POLICY.MIXED.includes(m));
      }
    } catch (e) { /* قائمة تالفة تسقط للاتحاد الآمن */ }
  }

  return {
    policy, source, allowedMethods, chain,
    // السؤال الوحيد الذي تحتاجه رحلة الضيف
    requiresGuestPayment: policy !== 'NO_GUEST_PAYMENT',
  };
}

/** يرمي 400 إن كانت الوسيلة غير مصرّح بها. الإنفاذ على الخادم حصرًا:
    إخفاء زر من الواجهة لا يمنع طلبًا مصنوعًا يدويًا. */
function assertMethodAllowed(ctx, method) {
  const r = resolvePaymentPolicy(ctx);
  if (!r.requiresGuestPayment) {
    const e = new Error('This location does not collect payment from guests');
    e.status = 409; e.code = 'NO_GUEST_PAYMENT';
    throw e;
  }
  if (!method || !r.allowedMethods.includes(String(method))) {
    const e = new Error(`Payment method not permitted here. Allowed: ${r.allowedMethods.join(', ') || 'none'}`);
    e.status = 400; e.code = 'METHOD_NOT_ALLOWED';
    throw e;
  }
  return r;
}

function validatePolicyPayload(body) {
  const policy = body && body.policy;
  if (!POLICIES.includes(policy)) {
    return { ok: false, reason: `policy must be one of ${POLICIES.join(', ')}` };
  }
  let allowed = null;
  if (policy === 'MIXED') {
    const list = body.allowedMethods;
    if (!Array.isArray(list) || !list.length) {
      return { ok: false, reason: 'MIXED requires a non-empty allowedMethods list' };
    }
    const clean = list.filter(m => METHODS_BY_POLICY.MIXED.includes(m));
    if (!clean.length) return { ok: false, reason: 'allowedMethods contains no recognised method' };
    allowed = JSON.stringify(clean);
  }
  return { ok: true, policy, allowedJson: allowed };
}

module.exports = {
  POLICIES, COLLECTION_STATES, METHODS_BY_POLICY,
  resolvePaymentPolicy, assertMethodAllowed, validatePolicyPayload, getOverride,
};
