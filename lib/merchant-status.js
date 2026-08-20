// lib/merchant-status.js — دورة حياة الشريك التجاري (P1-05).
//
// «الشريك التجاري» هنا هو merchant: العلامة التي تبيع عبر موقع الشريك
// المضيف. وهو **ليس** الشريك المستضيف (partners)، ولذلك لا يُدار بنفس
// lib/partner-status.js: إغلاق الشريك المضيف قرار تعاقدي مع النادل، وإغلاق
// شريك تجاري داخل موقعه قرار تشغيلي يتخذه المضيف نفسه. خلطهما كان سيعني أن
// إيقاف علامة واحدة يُسقط الموقع كله.
// النموذج محايد قطاعيًا: يصلح لشركة أو مجمّع أو موقع فعاليات أو أي نموذج
// تشغيلي آخر بلا تغيير.
//
// العمود status موجود في جدول merchants منذ Phase 3 وبقيمة 'Active'
// افتراضية، لكن لم تكن هناك أي نقطة تُغيّره ولا أي قاعدة تقرأه غير فلتر
// واحد في الكتالوج. أي: الحالة كانت موجودة على الورق ومعطّلة عمليًا.
//
// المبدأ الحاكم -- المنقول عمدًا من partner-status.js لأنه صحيح هنا أيضًا:
//   الإيقاف إجراء تجاري ضد الشريك التجاري، لا عقوبة على ضيف يقف بطلبه
//   في يده، ولا إسقاط لعمولة مُستحقة عن بيع تمّ فعلًا.
'use strict';
const { db } = require('../db.js');

const STATUSES = ['Active', 'Inactive', 'Closed'];

/* مصفوفة القدرات. كل صف قرار مقصود، لا افتراض. */
const CAPABILITIES = {
  Active: {
    visibleInCatalog: true,
    acceptNewOrderItems: true,
    fulfilOpenOrders: true,
    catalogManage: true,
    revenueAccrual: true,
  },
  Inactive: {
    // إيقاف مؤقت: يختفي من الكتالوج فورًا فلا يطلب منه ضيف جديد.
    visibleInCatalog: false,
    acceptNewOrderItems: false,
    // لكن ما بِيع فعلًا يُكمَل: إسقاط الطلبات المفتوحة يُنشئ التزام استرجاع
    // ويضرّ ضيفًا لا ذنب له.
    fulfilOpenOrders: true,
    // تحرير القائمة يبقى مفتوحًا: الإيقاف المؤقت غالبًا سببه تجهيز أو
    // موسم، والعودة تحتاج قائمة جاهزة.
    catalogManage: true,
    // العمولة عن بيع تمّ قبل الإيقاف حق مُستحق، لا تُمسّ.
    revenueAccrual: true,
  },
  Closed: {
    visibleInCatalog: false,
    acceptNewOrderItems: false,
    fulfilOpenOrders: true,   // حتى إغلاق آخر طلب قائم
    catalogManage: false,     // لا تحرير بعد الإغلاق
    revenueAccrual: true,     // Closed ليس Delete: التاريخ المالي يبقى كاملًا
  },
};

/* Closed تُعكَس بقرار SuperAdmin صريح ومُدقَّق فقط -- نفس قاعدة الشريك
   المستضيف، لأن العودة من الإغلاق قرار تعاقدي لا تشغيلي. */
const TRANSITIONS = {
  Active:   ['Inactive', 'Closed'],
  Inactive: ['Active', 'Closed'],
  Closed:   ['Active'],
};
const REOPEN_REQUIRES_SUPERADMIN = true;

/* الحالات النهائية للطلب -- تُقرأ من نموذج الشريك المستضيف بدل نسخها،
   فلا تتباعد النسختان عند إضافة حالة جديدة لاحقًا. */
const { TERMINAL_ORDER_STATES } = require('./partner-status.js');

/** عدّ الطلبات المفتوحة التي تحوي أصنافًا من هذا الشريك التجاري.
    يفحص الطلب الأصل والفرعي معًا: طلب أصل قد يكون منتهيًا بينما فرع أحد
    المنافذ ما زال قيد التجهيز. */
function countOpenOrders(merchantId) {
  const ph = TERMINAL_ORDER_STATES.map(() => '?').join(',');
  const parents = db.prepare(
    `SELECT COUNT(DISTINCT o.id) c FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     WHERE oi.merchant_id = ? AND o.status NOT IN (${ph})`
  ).get(merchantId, ...TERMINAL_ORDER_STATES).c;
  const children = db.prepare(
    `SELECT COUNT(DISTINCT co.id) c FROM child_orders co
     JOIN order_items oi ON oi.child_order_id = co.id
     WHERE oi.merchant_id = ? AND co.status NOT IN (${ph})`
  ).get(merchantId, ...TERMINAL_ORDER_STATES).c;
  return parents + children;
}

function getMerchant(merchantId) {
  if (!merchantId) return null;
  return db.prepare('SELECT * FROM merchants WHERE id = ?').get(merchantId) || null;
}

function getStatus(merchantId) {
  const m = getMerchant(merchantId);
  if (!m) return null;
  // قيمة غير معروفة تُعامَل كـActive حفاظًا على التوافق الخلفي: لا نُوقف
  // بيعًا قائمًا بسبب قيمة قديمة غير متوقعة.
  return STATUSES.includes(m.status) ? m.status : 'Active';
}

/** السؤال الوحيد الذي تطرحه كل نقطة. */
function can(merchantId, capability) {
  const status = getStatus(merchantId);
  if (!status) return false;
  const caps = CAPABILITIES[status];
  if (!caps || !(capability in caps)) return true;
  return caps[capability] === true;
}

/* الرسالة للضيف محايدة: لا يُكشف أن السبب تجاري ولا أن الشريك موقوف --
   نفس قاعدة الشريك المستضيف. */
const GUEST_ITEM_UNAVAILABLE_AR = 'هذا الصنف غير متاح حاليًا.';
const GUEST_ITEM_UNAVAILABLE_EN = 'This item is not available right now.';

function assertCan(merchantId, capability, opts) {
  if (can(merchantId, capability)) return;
  const guestFacing = opts && opts.guestFacing;
  const e = new Error(guestFacing ? GUEST_ITEM_UNAVAILABLE_EN : `Merchant status does not permit: ${capability}`);
  e.status = guestFacing ? 409 : 403;
  e.code = 'MERCHANT_STATUS';
  if (guestFacing) e.messageAr = GUEST_ITEM_UNAVAILABLE_AR;
  throw e;
}

/* شرط حاكم على الإغلاق -- نفس منطق الشريك المستضيف، وللسبب نفسه:
   الإغلاق مع طلبات مفتوحة يترك أصنافًا مباعة بلا مسار إتمام.
   المسار الصحيح: Active → Inactive → إكمال المفتوح → Closed. */
function checkTransitionPreconditions(merchantId, from, to) {
  if (to !== 'Closed') return { ok: true };
  const openOrders = countOpenOrders(merchantId);
  if (openOrders > 0) {
    return {
      ok: false,
      code: 'MERCHANT_HAS_OPEN_ORDERS',
      openOrders,
      remedy: from === 'Active'
        ? 'Set the merchant Inactive first, let the open orders finish, then close.'
        : 'Let the open orders finish, then close.',
    };
  }
  return { ok: true };
}

function canTransition(from, to) {
  return STATUSES.includes(to) && (TRANSITIONS[from] || []).includes(to);
}

/** ملخص للواجهة: الحالة، الانتقالات المتاحة **فعليًا الآن**، وسبب المحجوب. */
function statusSummary(merchantId) {
  const status = getStatus(merchantId);
  if (!status) return null;
  const all = TRANSITIONS[status] || [];
  return {
    merchantId,
    status,
    capabilities: CAPABILITIES[status],
    openOrders: countOpenOrders(merchantId),
    allowedTransitions: all.filter(to => checkTransitionPreconditions(merchantId, status, to).ok),
    blockedTransitions: all
      .filter(to => !checkTransitionPreconditions(merchantId, status, to).ok)
      .map(to => ({ to, ...checkTransitionPreconditions(merchantId, status, to) })),
    reopenRequiresSuperAdmin: status === 'Closed' && REOPEN_REQUIRES_SUPERADMIN,
  };
}

module.exports = {
  STATUSES, CAPABILITIES, TRANSITIONS, REOPEN_REQUIRES_SUPERADMIN,
  getMerchant, getStatus, can, assertCan, canTransition, statusSummary,
  countOpenOrders, checkTransitionPreconditions,
  GUEST_ITEM_UNAVAILABLE_AR, GUEST_ITEM_UNAVAILABLE_EN,
};
