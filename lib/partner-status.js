// lib/partner-status.js — Partner Lifecycle (Role Corrective §4).
//
// لماذا مُحلِّل مركزي واحد (نصّ المطلب صراحةً):
// نثر شروط الحالة على النقاط يعني أن أول نقطة تُضاف لاحقًا وتنسى الفحص
// تصبح ثغرة صامتة -- الشريك موقوف والطلب يمرّ. القرار يُتخذ هنا فقط،
// وكل نقطة تسأل عن **قدرة** لا عن حالة.
//
// المبدأ الحاكم الذي بُني عليه الجدول أدناه:
//   الإيقاف إجراء تجاري ضد الشريك، لا عقوبة على ضيف يقف بطلبه في يده،
//   ولا إسقاط لحق مالي مُستحق لأي طرف.
// لذا تُفصل ثلاث قدرات يخلطها الخلط الشائع:
//   * قبول التزامات جديدة (طلب جديد)      -> يتوقف أولًا
//   * إتمام التزامات قائمة (KDS/Runner)   -> يستمر دائمًا
//   * الحقوق المالية (تسويات/استرجاعات)   -> لا تُمسّ إطلاقًا
//
// Partner Status مستقل عن Subscription Status: الأول قرار تعاقدي/تشغيلي
// من النادل، والثاني حالة اشتراك. كلاهما يُفحص، ولا يُشتق أحدهما من الآخر.
'use strict';
const { db } = require('../db.js');

const STATUSES = ['Draft', 'Active', 'Suspended', 'Closed'];

/* مصفوفة القدرات. القراءة عمودية: ماذا تستطيع في هذه الحالة.
   كل صف قرار مقصود ومُبرَّر، لا افتراض. */
const CAPABILITIES = {
  Draft: {
    userLogin: true,          // فريق الإعداد يحتاج الدخول ليُجهّز
    qrResolves: false,        // لا ضيف يصل قبل الإطلاق
    createOrder: false,
    completeOpenOrders: true, // لا طلبات مفتوحة أصلًا، لكن لا سبب للمنع
    kdsRunner: true,
    engage: false,
    loyaltyEarn: false,
    loyaltyRedeem: false,
    financeAccess: true,
    partnerAdminManage: true, // الإعداد هو الغرض من هذه الحالة
  },
  Active: {
    userLogin: true, qrResolves: true, createOrder: true, completeOpenOrders: true,
    kdsRunner: true, engage: true, loyaltyEarn: true, loyaltyRedeem: true,
    financeAccess: true, partnerAdminManage: true,
  },
  Suspended: {
    // الدخول يبقى: المدير يحتاج رؤية طلباته المفتوحة وتسوياته وسبب الإيقاف.
    // قطعه يجعله أعمى عن التزاماته ويدفعه للاتصال بكم لكل شيء.
    userLogin: true,
    qrResolves: false,        // الباب يُقفل
    createOrder: false,       // لا التزامات جديدة
    completeOpenOrders: true, // لكن من في الداخل يُكمل -- إلغاء طلب مدفوع
                              // تلقائيًا يُنشئ التزام استرجاع ويضرّ ضيفًا لا ذنب له
    kdsRunner: true,          // ولولاهما لبقيت الطلبات المدفوعة عالقة بلا مسار إتمام
    engage: false,
    loyaltyEarn: false,       // تراكم جديد يتوقف مع التوقف التجاري
    // تصحيح معتمد: لا يُفتح استبدال جديد. الاستبدال يقع **داخل** رحلة طلب،
    // وبما أن الطلب الجديد ممنوع فلا مسار تشغيلي صالح له. الأرصدة تُحفظ
    // كاملة ولا تُلغى -- الفرق بين "لا مسار الآن" و"مصادرة القيمة".
    loyaltyRedeem: false,
    financeAccess: true,      // الإيقاف لا يُسقط حقًا مُستحقًا ولا يُستخدم للتهرب من تسوية
    partnerAdminManage: false, // قراءة فقط -- يرى وضعه ولا يُغيّره
  },
  Closed: {
    userLogin: false,
    qrResolves: false, createOrder: false,
    completeOpenOrders: true, // حتى إغلاق آخر طلب قائم
    kdsRunner: true,
    engage: false, loyaltyEarn: false, loyaltyRedeem: false,
    financeAccess: true,      // الأرشيف والتاريخ المالي يبقى كاملًا -- Closed ليس Delete
    partnerAdminManage: false,
  },
};

/* الانتقالات المسموحة. Closed شبه نهائية: تُعكَس بقرار SuperAdmin صريح
   ومُدقَّق فقط، لأن العودة من الإغلاق قرار تعاقدي لا تشغيلي. */
const TRANSITIONS = {
  Draft:     ['Active', 'Closed'],
  Active:    ['Suspended', 'Closed'],
  Suspended: ['Active', 'Closed'],
  Closed:    ['Active'],
};

function getPartnerStatus(partnerId) {
  if (!partnerId) return null;
  const row = db.prepare('SELECT status FROM partners WHERE id = ?').get(partnerId);
  if (!row) return null;
  // شريك بحالة غير معروفة يُعامَل كـActive حفاظًا على التوافق الخلفي:
  // لا نُوقف نظامًا عاملًا بسبب قيمة قديمة غير متوقعة.
  return STATUSES.includes(row.status) ? row.status : 'Active';
}

/** السؤال الوحيد الذي تطرحه كل نقطة: هل هذه القدرة متاحة الآن؟ */
function can(partnerId, capability) {
  const status = getPartnerStatus(partnerId);
  if (!status) return false;               // شريك غير موجود
  const caps = CAPABILITIES[status];
  if (!caps || !(capability in caps)) return true; // قدرة غير محكومة بالحالة
  return caps[capability] === true;
}

/** يرمي خطأ محايد للضيف (§: لا يُكشف أن السبب تجاري أو أن الشريك موقوف). */
const GUEST_UNAVAILABLE_AR = 'الطلب غير متاح حاليًا في هذا المكان.';
const GUEST_UNAVAILABLE_EN = 'Ordering is not available at this location right now.';

function assertCan(partnerId, capability, opts) {
  if (can(partnerId, capability)) return;
  const guestFacing = opts && opts.guestFacing;
  const e = new Error(guestFacing ? GUEST_UNAVAILABLE_EN : `Partner status does not permit: ${capability}`);
  e.status = guestFacing ? 409 : 403;
  if (guestFacing) e.messageAr = GUEST_UNAVAILABLE_AR;
  throw e;
}

function canTransition(from, to) {
  return STATUSES.includes(to) && (TRANSITIONS[from] || []).includes(to);
}

/** ملخص للواجهة: الحالة الحالية، الانتقالات الممكنة، والقدرات الفعلية. */
function statusSummary(partnerId) {
  const status = getPartnerStatus(partnerId);
  if (!status) return null;
  return { status, capabilities: CAPABILITIES[status], allowedTransitions: TRANSITIONS[status] || [] };
}

module.exports = {
  STATUSES, CAPABILITIES, TRANSITIONS,
  getPartnerStatus, can, assertCan, canTransition, statusSummary,
  GUEST_UNAVAILABLE_AR, GUEST_UNAVAILABLE_EN,
};
