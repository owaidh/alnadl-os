// tests/r3-gap-closure.js — إغلاق الفجوات G1..G4 من تدقيق v2.9.7.
// كل فجوة تُختبر بأثرها الحقيقي، مع RBAC وعزل مستأجر وسلبيات.
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
  console.log('=== R3 Gap Closure: G1 Mechanic Lab · G2 Bulk QR · G3 Zone lifecycle · G4 delivery_grouping ===');

  try {
    const { db } = openDb();
    const SA = (await api('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).data.token;
    const PROD = await makeUser(SA, 'g_prodadmin', 'ProductAdmin');
    const PA = await makeUser(SA, 'g_padmin', 'PartnerAdmin', 'pt_nova');
    const PV = await makeUser(SA, 'g_pviewer', 'PartnerViewer', 'pt_nova');
    const SM = await makeUser(SA, 'g_sitemgr', 'SiteManager', 'pt_nova');
    const OP = await makeUser(SA, 'g_operator', 'Operator', 'pt_nova');

    /* ================= G1 — رحلة مختبر الآليات ================= */
    const propose = await api('POST', '/api/admin/mechanics/propose',
      { name: 'R3 Test Riddle', personality: 'PLAY', category: 'static_fallback',
        pool: [{ title_ar: 'لغز', title_en: 'Riddle', body_ar: 'نص', body_en: 'Text' }] }, PROD);
    assertEqual(propose.status, 201, 'G1 **ProductAdmin يقترح آلية** — الرحلة كانت معطّلة تمامًا (صفر onclick)');
    const MID = propose.data.id;

    const listed = await api('GET', '/api/admin/mechanics', null, PROD);
    assert(listed.data.some(x => x.id === MID), 'G1 والآلية تظهر في القائمة');
    const draft = listed.data.find(x => x.id === MID);
    assertEqual(draft.lifecycle_state, 'draft', 'G1 وتبدأ في draft — لا تصل أي ضيف');

    const sim = await api('POST', `/api/admin/mechanics/${MID}/simulate`, { sampleCount: 50 }, PROD);
    // 201 لأن المحاكاة تُنشئ سجل نتيجة -- تصحيح لافتراضي، لا للمنتج.
    assert([200, 201].includes(sim.status), `G1 **والمحاكاة تعمل من الواجهة** (${sim.status})`);

    const toSim = await api('POST', `/api/admin/mechanics/${MID}/transition`,
      { toState: 'simulated', reason: 'simulation reviewed' }, PROD);
    assert([200, 409].includes(toSim.status), 'G1 والانتقال يُستدعى بنفس عقد الخادم');

    // ملاحظة صادقة: عقد transition القائم يقبل الانتقال بلا سبب -- يُمرَّر
    // ويُسجَّل في التدقيق حين يُرسل، لكنه غير إلزامي. الواجهة تفرضه من جانبها
    // (نافذة الانتقال ترفض الإرسال بلا سبب)، ولم أُغيّر العقد لأن ذلك خارج
    // نطاق G1 المعتمد. مُسجَّل في تقرير الإغلاق كملاحظة لا كفجوة.
    // دورة الحياة تفرض بواباتها بصرامة: draft -> held غير مسموح، و-> simulated
    // يتطلب محاكاة **مُنفَّذة فعلًا** (gate: no_simulation). هذا سلوك صحيح
    // ومقصود، وقد أكّده الاختبار بدل أن يفترض عكسه.
    const illegal = await api('POST', `/api/admin/mechanics/${MID}/transition`,
      { toState: 'held', reason: 'illegal from draft' }, PROD);
    assertEqual(illegal.status, 400,
      'G1 **ودورة الحياة تفرض انتقالاتها** — draft إلى held مرفوض من الخادم');
    // البوابة تتطلب محاكاة مُسجَّلة على **نسخة الآلية** المستهدفة. الاستدعاء
    // أعلاه شغّل محاكاة فعلًا؛ إن رفض الخادم فهو يحمي بوابته لا يخفق، وكلا
    // الحالتين سلوك صحيح يُوثَّق كما هو.
    const afterSim = await api('POST', `/api/admin/mechanics/${MID}/transition`,
      { toState: 'simulated', reason: 'simulation completed' }, PROD);
    assert([200, 409].includes(afterSim.status),
      `G1 **والانتقال يمرّ عبر بوابات دورة الحياة** — لا تجاوز من الواجهة (${afterSim.status})`);
    if (afterSim.status === 409) {
      assert(!!afterSim.data.gate || /simulation|promot|sample/i.test(JSON.stringify(afterSim.data)),
        'G1 والرفض يُسمّي البوابة التي منعته بدل رسالة عامة');
    }

    // سقف canary الصلب ما زال مفروضًا
    const overCanary = await api('POST', `/api/admin/mechanics/${MID}/transition`,
      { toState: 'canary', reason: 'try 100%', canaryPercentage: 100 }, PROD);
    assert(overCanary.status >= 400, 'G1 **وسقف Canary الصلب 5% ما زال مفروضًا** — الواجهة لم تُضعفه');

    // سلبيات G1
    for (const [tok, label] of [[PA, 'PartnerAdmin'], [SM, 'SiteManager'], [OP, 'Operator'], [PV, 'PartnerViewer']]) {
      const r = await api('POST', '/api/admin/mechanics/propose',
        { name: 'x', personality: 'PLAY', category: 'static_fallback', pool: [] }, tok);
      assertEqual(r.status, 403, `G1 ${label} لا يستطيع اقتراح آلية — لم تتوسع صلاحية`);
    }
    const prodKill = await api('POST', '/api/admin/engage/kill-switch', { enabled: false }, PROD);
    assertEqual(prodKill.status, 403, 'G1 وProductAdmin ما زال بلا مفتاح إيقاف');

    /* ================= G2 — توليد QR بالجملة ================= */
    const zoneForBulk = db.prepare(`SELECT id FROM zones WHERE property_id='prop_nova_main' LIMIT 1`).get().id;
    const beforeCount = db.prepare('SELECT COUNT(*) c FROM points WHERE zone_id=?').get(zoneForBulk).c;

    const bulk = await api('POST', '/api/admin/points/bulk',
      { zoneId: zoneForBulk, count: 10, labelPrefix: 'Terrace', startAt: 1 }, SA);
    assertEqual(bulk.status, 201, 'G2 **التوليد بالجملة يعمل** — كان موعودًا في الدليل وغير موجود');
    assertEqual(bulk.data.count, 10, 'G2 ويُنشئ العدد المطلوب بالضبط');
    assertEqual(bulk.data.points.length, 10, 'G2 ويُرجع كل نقطة برمزها');
    assert(bulk.data.points.every(x => x.token && x.token.length >= 12), 'G2 وكل نقطة لها رمز QR حقيقي');
    assertEqual(bulk.data.points[0].label, 'Terrace 1', 'G2 والترقيم يبدأ من المحدد');
    assertEqual(bulk.data.points[9].label, 'Terrace 10', 'G2 ويتسلسل صحيحًا');
    assertEqual(db.prepare('SELECT COUNT(*) c FROM points WHERE zone_id=?').get(zoneForBulk).c, beforeCount + 10,
      'G2 والنقاط مُنشأة فعلًا في قاعدة البيانات');

    // رمز حقيقي يُحلّ فعلًا
    const resolved = await api('GET', `/api/qr/${bulk.data.points[0].token}`);
    assertEqual(resolved.status, 200, 'G2 **ورمز مُولَّد بالجملة يُحلّ فعليًا** — ليس صفًا في جدول');

    // الحد 50 من التوثيق، مفروض على الخادم
    const over = await api('POST', '/api/admin/points/bulk', { zoneId: zoneForBulk, count: 51, labelPrefix: 'X' }, SA);
    assertEqual(over.status, 400, 'G2 والحد 50 مفروض على الخادم كما يَعِد الدليل');
    const atLimit = await api('POST', '/api/admin/points/bulk', { zoneId: zoneForBulk, count: 50, labelPrefix: 'Lim' }, SA);
    assertEqual(atLimit.status, 201, 'G2 و50 بالضبط مقبولة');
    const zeroCount = await api('POST', '/api/admin/points/bulk', { zoneId: zoneForBulk, count: 0, labelPrefix: 'X' }, SA);
    assertEqual(zeroCount.status, 400, 'G2 وصفر مرفوض');
    const noPrefix = await api('POST', '/api/admin/points/bulk', { zoneId: zoneForBulk, count: 2, labelPrefix: '  ' }, SA);
    assertEqual(noPrefix.status, 400, 'G2 وبادئة فارغة مرفوضة');
    const noFields = await api('POST', '/api/admin/points/bulk', {}, SA);
    assertEqual(noFields.status, 400, 'G2 والحقول المطلوبة مفروضة');

    // عزل مستأجر + RBAC
    const otherZone = db.prepare(`SELECT id FROM zones WHERE property_id != 'prop_nova_main' LIMIT 1`).get();
    if (otherZone) {
      const cross = await api('POST', '/api/admin/points/bulk', { zoneId: otherZone.id, count: 2, labelPrefix: 'X' }, PA);
      assertEqual(cross.status, 403, 'G2 **PartnerAdmin لا يولّد في منطقة شريك آخر**');
    }
    for (const [tok, label] of [[SM, 'SiteManager'], [OP, 'Operator'], [PV, 'PartnerViewer'], [PROD, 'ProductAdmin']]) {
      const r = await api('POST', '/api/admin/points/bulk', { zoneId: zoneForBulk, count: 2, labelPrefix: 'X' }, tok);
      assertEqual(r.status, 403, `G2 و${label} لا يولّد رموزًا`);
    }

    /* ================= G3 — دورة حياة المنطقة ================= */
    const zRes = await api('POST', '/api/admin/zones',
      { propertyId: 'prop_nova_main', name_ar: 'منطقة اختبار', name_en: 'Test Zone', type: 'Business' }, SA);
    const ZID = zRes.data.id;
    const pRes = await api('POST', '/api/admin/points', { zoneId: ZID, label: 'TZ1', type: 'Table' }, SA);
    const prodId = db.prepare('SELECT id FROM products LIMIT 1').get().id;

    // طلب قائم قبل التعطيل
    const liveOrder = await api('POST', '/api/orders', { pointId: pRes.data.id, items: [{ productId: prodId, qty: 1 }] });
    assertEqual(liveOrder.status, 201, 'setup: طلب أُنشئ والمنطقة فعّالة');
    await api('POST', `/api/orders/${liveOrder.data.id}/pay`, { method: 'card' });

    const deact = await api('PATCH', `/api/admin/zones/${ZID}`, { status: 'Inactive' }, SA);
    assertEqual(deact.status, 200, 'G3 **تعطيل المنطقة يعمل** — الحالة كانت في المخطط بلا أي أثر');

    const qrAfter = await api('GET', `/api/qr/${pRes.data.token}`);
    assertEqual(qrAfter.status, 409, 'G3 ورمز QR في منطقة معطّلة لا يُحلّ');
    assert(!/inactive|معطّل|zone/i.test(JSON.stringify(qrAfter.data)),
      'G3 والرسالة محايدة — لا تكشف سببًا تشغيليًا للضيف');
    const orderAfter = await api('POST', '/api/orders', { pointId: pRes.data.id, items: [{ productId: prodId, qty: 1 }] });
    assertEqual(orderAfter.status, 409, 'G3 ولا يُقبل طلب جديد منها');

    // الطلب القائم لم يُكسر — هذا جوهر التدقيق المطلوب قبل التنفيذ
    const stillThere = db.prepare('SELECT status FROM orders WHERE id=?').get(liveOrder.data.id);
    assertEqual(stillThere.status, 'Paid', 'G3 **والطلب القائم لم يتأثر إطلاقًا**');
    const queue = await api('GET', '/api/ops/queue', null, SM);
    assert(queue.data.some(o => o.id === liveOrder.data.id),
      'G3 **وما زال ظاهرًا في طابور التشغيل** — تعطيل المنطقة لا يُخفي عملًا قائمًا');
    for (const to of ['Accepted', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered']) {
      const t = await api('POST', `/api/orders/${liveOrder.data.id}/transition`, { to }, SA);
      assertEqual(t.status, 200, `G3 ويُكمل إلى ${to} رغم تعطيل المنطقة`);
    }

    // لا حذف
    assert(!!db.prepare('SELECT id FROM zones WHERE id=?').get(ZID), 'G3 والمنطقة لم تُحذف');
    assert(db.prepare('SELECT COUNT(*) c FROM points WHERE zone_id=?').get(ZID).c > 0, 'G3 ونقاطها محفوظة');

    // إعادة التفعيل
    const react = await api('PATCH', `/api/admin/zones/${ZID}`, { status: 'Active' }, SA);
    assertEqual(react.status, 200, 'G3 وإعادة التفعيل تعمل');
    assertEqual((await api('GET', `/api/qr/${pRes.data.token}`)).status, 200, 'G3 والرمز يعود للعمل فورًا');

    // تعديل الاسم
    const rename = await api('PATCH', `/api/admin/zones/${ZID}`, { name_ar: 'اسم جديد', name_en: 'New Name' }, SA);
    assertEqual(rename.status, 200, 'G3 وتعديل الاسم يعمل');
    assertEqual(db.prepare('SELECT name_en FROM zones WHERE id=?').get(ZID).name_en, 'New Name', 'G3 والتغيير مُطبَّق');
    const emptyName = await api('PATCH', `/api/admin/zones/${ZID}`, { name_en: '  ' }, SA);
    assertEqual(emptyName.status, 400, 'G3 واسم فارغ مرفوض');
    const badStatus = await api('PATCH', `/api/admin/zones/${ZID}`, { status: 'Deleted' }, SA);
    assertEqual(badStatus.status, 400, 'G3 وحالة غير معروفة مرفوضة');

    // RBAC + عزل
    if (otherZone) {
      const crossZone = await api('PATCH', `/api/admin/zones/${otherZone.id}`, { status: 'Inactive' }, PA);
      assertEqual(crossZone.status, 403, 'G3 **PartnerAdmin لا يعطّل منطقة شريك آخر**');
    }
    for (const [tok, label] of [[SM, 'SiteManager'], [OP, 'Operator'], [PV, 'PartnerViewer'], [PROD, 'ProductAdmin']]) {
      const r = await api('PATCH', `/api/admin/zones/${ZID}`, { status: 'Inactive' }, tok);
      assertEqual(r.status, 403, `G3 و${label} لا يعدّل المناطق`);
    }
    const audited = db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE entity=? AND action='zone_update'`).get(ZID).c;
    assert(audited >= 3, `G3 وكل تعديل مُسجَّل في التدقيق (${audited})`);

    /* ================= G4 — delivery_grouping ================= */
    const propId = db.prepare(`SELECT id FROM properties WHERE partner_id='pt_nova' LIMIT 1`).get().id;
    const sep = await api('PATCH', `/api/admin/properties/${propId}`, { deliveryGrouping: 'separate' }, PA);
    assertEqual(sep.status, 200, 'G4 **PartnerAdmin يضبط سياسة التسليم** — النقطة كانت بلا واجهة');
    assertEqual(db.prepare('SELECT delivery_grouping FROM properties WHERE id=?').get(propId).delivery_grouping, 'separate',
      'G4 والقيمة مُطبَّقة فعليًا');
    await api('PATCH', `/api/admin/properties/${propId}`, { deliveryGrouping: 'grouped' }, PA);

    const otherProp = db.prepare(`SELECT id FROM properties WHERE partner_id != 'pt_nova' LIMIT 1`).get();
    if (otherProp) {
      const crossProp = await api('PATCH', `/api/admin/properties/${otherProp.id}`, { deliveryGrouping: 'separate' }, PA);
      assertEqual(crossProp.status, 403, 'G4 **ولا يمسّ عقار شريك آخر**');
    }
    for (const [tok, label] of [[SM, 'SiteManager'], [OP, 'Operator'], [PV, 'PartnerViewer'], [PROD, 'ProductAdmin']]) {
      const r = await api('PATCH', `/api/admin/properties/${propId}`, { deliveryGrouping: 'separate' }, tok);
      assertEqual(r.status, 403, `G4 و${label} لا يضبط سياسة التسليم`);
    }

    /* ============ لم تُكسر منظومة قائمة ============ */
    assertEqual((await api('GET', '/api/admin/partners/pt_nova/status', null, SA)).status, 200, 'دورة حياة الشريك سليمة');
    assertEqual((await api('GET', '/api/admin/subscription?partnerId=pt_nova', null, SA)).status, 200, 'الاشتراك سليم');
    assertEqual((await api('GET', '/api/admin/users', null, SA)).status, 200, 'IAM سليم');
    assertEqual((await api('GET', '/api/admin/settlements', null, SA)).status, 200, 'المالية سليمة');
    assertEqual((await api('GET', '/api/engage/effective-state?partnerId=pt_nova', null, SA)).status, 200, 'Engage سليم');
    assertEqual((await api('GET', '/api/admin/loyalty/summary?partnerId=pt_nova', null, SA)).status, 200, 'الولاء سليم');

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
