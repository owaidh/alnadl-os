// tests/corrective-closure.js — إغلاق تصحيحي للجولات الحالية.
// ثلاث نقاط: تفعيل الشريك من الواجهة · الاسترجاع الكامل بحذف المبلغ ·
// تصحيح تدقيق العقارات (في مجموعة SiteManager).
'use strict';
const { startServer, stopServer, api, assert, assertEqual, summary, resetCounts, getDataPath } = require('./helpers.js');

function openDb() {
  process.env.SQLITE_PATH = getDataPath();
  for (const m of ['../db.js', '../lib/loyalty.js', '../lib/partner-status.js']) {
    try { delete require.cache[require.resolve(m)]; } catch (e) {}
  }
  return require('../db.js');
}
async function makeUser(SA, username, role, scope) {
  const c = await api('POST', '/api/admin/users', { username, role, partner_scope: scope || null }, SA);
  await api('POST', `/api/activate/${c.data.activationToken}`, { password: `${username}-strong-pass-1` });
  return (await api('POST', '/api/auth/login', { username, password: `${username}-strong-pass-1` })).data.token;
}

async function run() {
  resetCounts();
  await startServer();
  console.log('=== Corrective Closure: activation UI path · full refund · properties audit ===');

  try {
    const { db } = openDb();
    const SA = (await api('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).data.token;
    const SM = await makeUser(SA, 'cc_sitemgr', 'SiteManager', 'pt_nova');

    // ================= (1) تفعيل الشريك بلا API يدوي =================
    // نفس النقاط التي تستدعيها الواجهة بالضبط، بنفس الترتيب.
    const onboard = await api('POST', '/api/admin/onboard', {
      partnerNameAr: 'شريك تصحيحي', partnerNameEn: 'Corrective Co',
      propertyNameAr: 'الفرع', propertyNameEn: 'Main', planCode: 'PLATFORM',
    }, SA);
    assertEqual(onboard.status, 201, '(1) شريك جديد أُنشئ من الواجهة');
    const NP = onboard.data.partnerId;

    const st0 = await api('GET', `/api/admin/partners/${NP}/status`, null, SA);
    assertEqual(st0.status, 200, '(1) الواجهة تقرأ الحالة الحالية');
    assertEqual(st0.data.status, 'Draft', '(1) والشريك الجديد في Draft كما هو مُعتمَد');
    assert(st0.data.allowedTransitions.includes('Active'),
      '(1) والانتقال إلى Active معروض ضمن allowedTransitions');
    assert(Array.isArray(st0.data.allowedTransitions) && !st0.data.allowedTransitions.includes('Draft'),
      '(1) ولا يُعرض انتقال غير موجود في allowedTransitions');

    // السبب إلزامي -- نفس ما تفرضه النافذة
    const noReason = await api('POST', `/api/admin/partners/${NP}/status`, { status: 'Active' }, SA);
    assertEqual(noReason.status, 400, '(1) التفعيل بلا سبب مرفوض');

    const activate = await api('POST', `/api/admin/partners/${NP}/status`,
      { status: 'Active', reason: 'Setup complete — activating from the Partner Control Center' }, SA);
    assertEqual(activate.status, 200, '(1) **التفعيل ينجح عبر النقطة التي تستدعيها الواجهة** — بلا SQL ولا API يدوي');
    assertEqual(activate.data.previous, 'Draft', '(1) والانتقال يُسجّل مصدره');

    const st1 = await api('GET', `/api/admin/partners/${NP}/status`, null, SA);
    assertEqual(st1.data.status, 'Active', '(1) والحالة تُقرأ محدَّثة من الخادم بعد النجاح');
    assertEqual(st1.data.capabilities.qrResolves, true, '(1) والقدرات تحدّثت معها');
    assertEqual(st1.data.capabilities.createOrder, true, '(1) وقبول الطلبات صار مفتوحًا');

    // التفعيل له أثر حقيقي: الضيف يستطيع الطلب الآن
    const zone = await api('POST', '/api/admin/zones',
      { propertyId: onboard.data.propertyId, name_ar: 'ص', name_en: 'Hall', type: 'Business' }, SA);
    const point = await api('POST', '/api/admin/points', { zoneId: zone.data.id, label: 'T1', type: 'Table' }, SA);
    const qr = await api('GET', `/api/qr/${point.data.token}`);
    assertEqual(qr.status, 200, '(1) **ورمز QR يُحلّ فعليًا بعد التفعيل** — الأثر حقيقي لا وسم');

    const audited = db.prepare(
      `SELECT reason FROM audit_log WHERE entity=? AND action='partner_status_change'`).all(NP);
    assert(audited.length >= 1 && audited[0].reason, '(1) والانتقال مُسجَّل بسببه في التدقيق');

    // ================= (2) الاسترجاع الكامل بحذف المبلغ =================
    const prod = db.prepare('SELECT id FROM products LIMIT 1').get().id;
    async function deliveredOrder() {
      const o = await api('POST', '/api/orders', { pointId: 'PT-021', customerPhone: '0500123123', items: [{ productId: prod, qty: 2 }] });
      await api('POST', `/api/orders/${o.data.id}/pay`, { method: 'card' });
      for (const to of ['Accepted','Preparing','Ready','Out for Delivery','Delivered']) {
        await api('POST', `/api/orders/${o.data.id}/transition`, { to }, SA);
      }
      return o.data.id;
    }

    const full = await deliveredOrder();
    const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE order_id=? AND status='Captured'`).get(full).s;
    assert(paid > 0, 'setup: الطلب مدفوع فعلًا');

    // هذا بالضبط ما كانت الواجهة تعد به ويرفضه الخادم بـ400
    const fullRefund = await api('POST', `/api/orders/${full}/refund`,
      { reason: 'Full refund with amount omitted' }, SM);
    assertEqual(fullRefund.status, 200,
      '(2) **حذف المبلغ = استرجاع كامل** — كانت الواجهة تعد به والخادم يرفضه بـ400');
    const refunded = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE order_id=?`).get(full).s;
    assert(Math.abs(refunded - paid) < 0.01,
      `(2) والمبلغ المُسترجَع يساوي المدفوع بالضبط (${refunded} من ${paid})`);
    assertEqual(db.prepare('SELECT status FROM orders WHERE id=?').get(full).status, 'Refunded',
      '(2) والطلب انتقل إلى Refunded لا Partially Refunded');

    // لا تجاوز للرصيد المتبقي
    const over = await api('POST', `/api/orders/${full}/refund`, { reason: 'again' }, SM);
    assert(over.status === 409, '(2) ولا يمكن استرجاع شيء بعد استنفاد الرصيد');
    const stillSame = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE order_id=?`).get(full).s;
    assert(Math.abs(stillSame - refunded) < 0.01, '(2) والمبلغ لم يتغيّر بعد المحاولة المرفوضة');

    // idempotency ما زالت تعمل مع الاسترجاع الكامل
    const idemOrder = await deliveredOrder();
    const k = 'cc-idem-full-1';
    const first = await api('POST', `/api/orders/${idemOrder}/refund`, { reason: 'full', idempotencyKey: k }, SM);
    assertEqual(first.status, 200, '(2) استرجاع كامل بمفتاح idempotency');
    const beforeDup = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE order_id=?`).get(idemOrder).s;
    const second = await api('POST', `/api/orders/${idemOrder}/refund`, { reason: 'full', idempotencyKey: k }, SM);
    assertEqual(second.status, 200, '(2) وإعادة الإرسال بنفس المفتاح تُقبل');
    const afterDup = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE order_id=?`).get(idemOrder).s;
    assertEqual(afterDup, beforeDup,
      '(2) **ولا تُنفّذ استرجاعًا ثانيًا** — idempotency سليمة مع المبلغ المحذوف');

    // جزئي ثم كامل للباقي
    const partialOrder = await deliveredOrder();
    const totalPaid = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE order_id=? AND status='Captured'`).get(partialOrder).s;
    await api('POST', `/api/orders/${partialOrder}/refund`, { amount: 5, reason: 'partial first' }, SM);
    const rest = await api('POST', `/api/orders/${partialOrder}/refund`, { reason: 'remainder' }, SM);
    assertEqual(rest.status, 200, '(2) وحذف المبلغ بعد استرجاع جزئي يسترجع **الباقي** لا الكل');
    const finalSum = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE order_id=?`).get(partialOrder).s;
    assert(Math.abs(finalSum - totalPaid) < 0.01,
      `(2) والمجموع لا يتجاوز المدفوع (${finalSum} من ${totalPaid})`);
    const noReasonRefund = await api('POST', `/api/orders/${partialOrder}/refund`, {}, SM);
    assert(noReasonRefund.status >= 400, '(2) والسبب ما زال إلزاميًا');

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
