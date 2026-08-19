// lib/statemachine.js — Order State Machine (Screen Spec §10)
// The UI never changes an order's state directly; every transition passes
// through here so an invalid jump is structurally impossible.
'use strict';

// P1-04: 'Confirmed' هو نظير 'Paid' التشغيلي حين لا تحصيل من الضيف أصلًا.
// حالة جديدة ولا تُعاد استخدام 'Paid': الحالة تُقرأ في كل شاشة تشغيل وكل
// تقرير، وتسمية طلبٍ لم يُحصَّل قطّ بـ"مدفوع" كذبة تنتشر بصمت في كل واحد
// منها. القيمة المالية الحقيقية للطلب محفوظة كاملة في total، وحقيقة عدم
// التحصيل في collection_status = NOT_REQUIRED -- محورَان منفصلان عمدًا.
const TRANSITIONS = {
  'Created':           { to: ['Payment Pending', 'Confirmed', 'Cancelled'], by: ['System', 'Customer'] },
  'Payment Pending':    { to: ['Paid', 'Failed', 'Cancelled'],            by: ['Gateway', 'System'] },
  'Paid':               { to: ['Accepted', 'Cancelled'],                 by: ['Operator', 'SiteManager'] },
  // نفس مخرجات 'Paid' بالضبط: من هذه النقطة فصاعدًا الطلب تشغيليّ بحت
  // ولا يعنيه كيف (أو إن) حُصِّل.
  'Confirmed':          { to: ['Accepted', 'Cancelled'],                 by: ['Operator', 'SiteManager'] },
  'Accepted':           { to: ['Preparing', 'Cancelled'],                by: ['Operator'] },
  'Preparing':          { to: ['Ready', 'Cancelled'],                    by: ['Operator', 'SiteManager'] },
  'Ready':              { to: ['Out for Delivery', 'Delivered'],         by: ['Runner', 'Operator'] },
  'Out for Delivery':   { to: ['Delivered', 'Delivery Failed'],          by: ['Runner'] },
  'Delivery Failed':    { to: ['Out for Delivery', 'Cancelled'],         by: ['SiteManager'] },
  // Q03: a Delivered order can be refunded fully or partially; a partial
  // refund can later be topped up to a full refund once the cumulative
  // refunded amount reaches the order total (see server.js /refund handler
  // for the amount bookkeeping — this table only governs the STATE jump).
  'Delivered':          { to: ['Refunded', 'Partially Refunded'],        by: ['AlnadlFinance', 'SiteManager'] },
  'Partially Refunded': { to: ['Refunded'],                              by: ['AlnadlFinance', 'SiteManager'] },
  // Q03: a Cancelled order that had already been captured (payment
  // succeeded before cancellation) must still be refundable.
  'Cancelled':          { to: ['Refunded'],                              by: ['AlnadlFinance', 'SiteManager'] },
};

/* المصدر الوحيد لسؤال "هل الطلب مُخلّى للمطبخ؟". كان هذا السؤال منثورًا
   كقائمة نصّية مكرّرة في طابور KDS ولوحة المدير والمحفظة والتنبيهات؛ إضافة
   'Confirmed' لكل نسخة على حدة كانت ستضمن نسيان واحدة -- والنتيجة طلب
   حقيقي لا يظهر لأحد. */
const CLEARED_TO_PREPARE = ['Paid', 'Confirmed'];
/* الحالات النشطة في شاشة التشغيل. */
const ACTIVE_KDS_STATES = [...CLEARED_TO_PREPARE, 'Accepted', 'Preparing', 'Ready', 'Out for Delivery'];

function canTransition(from, to) {
  return !!(TRANSITIONS[from] && TRANSITIONS[from].to.includes(to));
}
function actorAllowed(from, role) {
  return !!(TRANSITIONS[from] && TRANSITIONS[from].by.includes(role));
}

module.exports = { TRANSITIONS, canTransition, actorAllowed, CLEARED_TO_PREPARE, ACTIVE_KDS_STATES };
