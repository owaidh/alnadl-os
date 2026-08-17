// tests/sitemanager-surfaces.js — Role Corrective R3.
// المبدأ: كشف قدرة خلفية مسموحة اليوم -- بلا توسيع صلاحية، وبلا تحويل
// SiteManager إلى PartnerAdmin. كل تأكيد إيجابي هنا يقابل نقطة يسمح بها
// الخادم له فعلًا، وكل تأكيد سلبي يُثبت أن حدوده لم تتزحزح.
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
  console.log('=== Role Corrective R3: SiteManager Operational Surfaces ===');

  try {
    const { db } = openDb();
    const SA = (await api('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).data.token;
    const SM = await makeUser(SA, 'r3_sitemgr', 'SiteManager', 'pt_nova');
    const PA = await makeUser(SA, 'r3_padmin', 'PartnerAdmin', 'pt_nova');
    const OP = await makeUser(SA, 'r3_operator', 'Operator', 'pt_nova');

    // ============ ما يملكه SiteManager فعلًا ============
    for (const [ep, label] of [
      ['/api/ops/queue', 'طابور التشغيل'],
      ['/api/admin/notifications?limit=10', 'التنبيهات'],
      ['/api/manager/live?propertyId=prop_nova_main', 'اللوحة الحية'],
      ['/api/admin/zones', 'المناطق'],
      ['/api/admin/points', 'النقاط'],
    ]) {
      const r = await api('GET', ep, null, SM);
      assertEqual(r.status, 200, `R3 SiteManager يصل إلى ${label} — قدرة قائمة كُشفت لا مُنحت`);
    }

    // ============ الاسترجاع: القدرة المالية المعطّلة ============
    const prod = db.prepare('SELECT id FROM products LIMIT 1').get().id;
    const ord = await api('POST', '/api/orders', { pointId: 'PT-021', customerPhone: '0500777888', items: [{ productId: prod, qty: 2 }] });
    const oid = ord.data.id;
    await api('POST', `/api/orders/${oid}/pay`, { method: 'card' });
    for (const to of ['Accepted', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered']) {
      await api('POST', `/api/orders/${oid}/transition`, { to }, SA);
    }

    const emptyHist = await api('GET', `/api/orders/${oid}/refunds`, null, SM);
    assertEqual(emptyHist.status, 200, 'R3 SiteManager يقرأ سجل استرجاعات الطلب');
    assertEqual(emptyHist.data.length, 0, 'R3 والسجل فارغ قبل أي استرجاع');

    const refund = await api('POST', `/api/orders/${oid}/refund`,
      { amount: 10, reason: 'Guest reported a cold drink', idempotencyKey: 'r3-test-key-1' }, SM);
    assertEqual(refund.status, 200, 'R3 **SiteManager ينفّذ استرجاعًا** — القدرة كانت موجودة خلفيًا وبلا واجهة');

    const afterHist = await api('GET', `/api/orders/${oid}/refunds`, null, SM);
    assert(afterHist.data.length >= 1, 'R3 والاسترجاع يظهر في السجل');

    // منع الإرسال المزدوج -- نفس المفتاح لا يُنفّذ استرجاعًا ثانيًا
    const balBefore = db.prepare('SELECT COALESCE(SUM(amount),0) t FROM refunds WHERE order_id=?').get(oid).t;
    const dup = await api('POST', `/api/orders/${oid}/refund`,
      { amount: 10, reason: 'Guest reported a cold drink', idempotencyKey: 'r3-test-key-1' }, SM);
    assertEqual(dup.status, 200, 'R3 إعادة الإرسال بنفس المفتاح تُقبل');
    const balAfter = db.prepare('SELECT COALESCE(SUM(amount),0) t FROM refunds WHERE order_id=?').get(oid).t;
    assertEqual(balAfter, balBefore,
      'R3 **لكنها لا تُنفّذ استرجاعًا ثانيًا** — الحماية من الإرسال المزدوج حقيقية لا بصرية');

    // ============ حدوده لم تتزحزح ============
    const forbidden = [
      ['GET', '/api/admin/users', 'إدارة المستخدمين'],
      ['GET', '/api/admin/plans', 'إدارة الباقات'],
      ['GET', '/api/admin/partners', 'قائمة الشركاء'],
      ['GET', '/api/admin/settlements', 'التسويات'],
      ['GET', '/api/admin/revenue-ledger', 'دفتر الإيراد'],
      ['GET', '/api/admin/engage/ledger', 'سجل Engage'],
      ['GET', '/api/admin/mechanics', 'مختبر الآليات'],
      ['GET', '/api/admin/loyalty/summary', 'إدارة الولاء'],
      ['GET', '/api/admin/branding', 'العلامة التجارية'],
      ['GET', '/api/audit', 'سجل التدقيق'],
    ];
    for (const [m, ep, label] of forbidden) {
      const r = await api(m, ep, null, SM);
      assertEqual(r.status, 403, `R3 SiteManager ما زال ممنوعًا من ${label} — لم يتحول إلى PartnerAdmin`);
    }
    const smKill = await api('POST', '/api/admin/engage/kill-switch', { enabled: false }, SM);
    assertEqual(smKill.status, 403, 'R3 ولا يملك مفتاح إيقاف Engage');
    const smStatus = await api('POST', '/api/admin/partners/pt_nova/status', { status: 'Suspended', reason: 'try' }, SM);
    assertEqual(smStatus.status, 403, 'R3 ولا يغيّر حالة الشريك');
    const smUser = await api('POST', '/api/admin/users', { username: 'sm_try', role: 'Operator' }, SM);
    assertEqual(smUser.status, 403, 'R3 ولا ينشئ مستخدمين');

    // ============ الأدوار الأخرى لم تتأثر ============
    const paChecks = [
      ['/api/admin/users', 200], ['/api/admin/zones', 200],
      ['/api/partner/overview?partnerId=pt_nova', 200], ['/api/admin/loyalty/summary', 200],
    ];
    for (const [ep, expect] of paChecks) {
      const r = await api('GET', ep, null, PA);
      assertEqual(r.status, expect, `R3 PartnerAdmin لم يتأثر: ${ep}`);
    }
    const saChecks = ['/api/admin/plans', '/api/admin/partners', '/api/admin/engage/kill-switch', '/api/audit'];
    for (const ep of saChecks) {
      const r = await api('GET', ep, null, SA);
      assertEqual(r.status, 200, `R3 SuperAdmin لم يتأثر: ${ep}`);
    }

    // Operator لم يُمنح شيئًا جديدًا
    const opRefund = await api('POST', `/api/orders/${oid}/refund`, { amount: 5, reason: 'try' }, OP);
    assertEqual(opRefund.status, 403, 'R3 Operator لا يستطيع الاسترجاع — لم تتوسع صلاحيته');
    const opNotif = await api('GET', '/api/admin/notifications', null, OP);
    assertEqual(opNotif.status, 403, 'R3 ولا يصل للتنبيهات الإدارية');

    // ============ Properties: تصحيح تدقيق ============
    // تصحيح: التقرير السابق ادّعى عدم وجود PATCH وعدم وجود delivery_grouping.
    // كلاهما خطأ. الاختبار القديم "أثبت" 404 على '/api/admin/properties' بلا
    // :id -- أي أنه اختبر مسارًا غير موجود أصلًا ولم يُثبت شيئًا عن PATCH.
    // ما يلي يفحص الواقع كما هو.
    const propsRead = await api('GET', '/api/admin/properties', null, SA);
    assertEqual(propsRead.status, 200, 'Properties: القراءة متاحة لـSuperAdmin');

    const propId = db.prepare('SELECT id FROM properties LIMIT 1').get().id;
    const patchReal = await api('PATCH', `/api/admin/properties/${propId}`, { deliveryGrouping: 'separate' }, SA);
    assertEqual(patchReal.status, 200,
      'Properties: **PATCH /api/admin/properties/:id موجودة وتعمل** — التقرير السابق كان خاطئًا');
    const grouping = db.prepare('SELECT delivery_grouping FROM properties WHERE id=?').get(propId).delivery_grouping;
    assertEqual(grouping, 'separate',
      'Properties: **delivery_grouping موجود في المخطط ويُحرَّر فعليًا** (migrations/002)');
    await api('PATCH', `/api/admin/properties/${propId}`, { deliveryGrouping: 'grouped' }, SA);

    // العزل قائم على مسار الكتابة الموجود
    const otherProp = db.prepare(`SELECT id FROM properties WHERE partner_id != 'pt_nova' LIMIT 1`).get();
    if (otherProp) {
      const crossPatch = await api('PATCH', `/api/admin/properties/${otherProp.id}`, { deliveryGrouping: 'separate' }, PA);
      assertEqual(crossPatch.status, 403,
        'Properties: PartnerAdmin لا يُعدّل عقار شريك آخر — العزل مُطبَّق على مسار الكتابة القائم');
    }

    // ما هو غير موجود فعلًا: الإنشاء
    const createProp = await api('POST', '/api/admin/properties', { name_en: 'X', partnerId: 'pt_nova' }, SA);
    assertEqual(createProp.status, 404,
      'Properties: **لا يوجد POST لإنشاء عقار** — هذا وحده ما هو مؤجَّل، لا PATCH');

    const smProps = await api('GET', '/api/admin/properties', null, SM);
    assertEqual(smProps.status, 403, 'Properties: ليست ضمن صلاحيات SiteManager');

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
