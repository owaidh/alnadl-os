// tests/partner-lifecycle.js — Role Corrective §4.
//
// السيناريوهان اللذان طُلبا صراحةً:
//   طلب مفتوح -> إيقاف الشريك -> الطلب يُكمل حتى Delivered، بينما QR جديد يُرفض
//   Suspended -> Active -> تعود الطلبات دون فقد أي إعداد أو رصيد
'use strict';
const { startServer, stopServer, api, assert, assertEqual, summary, resetCounts, getDataPath } = require('./helpers.js');

function openDb() {
  process.env.SQLITE_PATH = getDataPath();
  delete require.cache[require.resolve('../db.js')];
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
  console.log('=== Role Corrective §4: Partner Lifecycle ===');

  try {
    const { db } = openDb();
    const SA = (await api('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).data.token;
    const PA = await makeUser(SA, 'pl_padmin', 'PartnerAdmin', 'pt_nova');
    const P = 'pt_nova';
    const token = db.prepare(`SELECT token FROM qr_tokens WHERE point_id='PT-021' AND active=1`).get().token;
    const prod = db.prepare('SELECT id FROM products LIMIT 1').get().id;
    const setStatus = (st, reason) => api('POST', `/api/admin/partners/${P}/status`, { status: st, reason }, SA);

    // الشريك التجريبي يبدأ Active
    assertEqual((await api('GET', `/api/admin/partners/${P}/status`, null, SA)).data.status, 'Active',
      'setup: الشريك التجريبي فعّال');

    // ============ RBAC + السبب الإلزامي ============
    const paTry = await api('POST', `/api/admin/partners/${P}/status`, { status: 'Suspended', reason: 'trying' }, PA);
    assertEqual(paTry.status, 403,
      '§4 PartnerAdmin لا يستطيع تغيير حالة شريكه — إيقاف الأعمال ليس قرارًا يملكه على نفسه');

    const noReason = await api('POST', `/api/admin/partners/${P}/status`, { status: 'Suspended' }, SA);
    assertEqual(noReason.status, 400, '§4 السبب إلزامي — الحالة تُقرأ لاحقًا في التدقيق والنزاعات');
    const shortReason = await api('POST', `/api/admin/partners/${P}/status`, { status: 'Suspended', reason: 'x' }, SA);
    assertEqual(shortReason.status, 400, '§4 وسبب رمزي لا يُقبل');

    const badJump = await api('POST', `/api/admin/partners/${P}/status`, { status: 'Draft', reason: 'invalid move' }, SA);
    assertEqual(badJump.status, 409, '§4 Active -> Draft غير مسموح — الانتقالات محكومة لا حرة');

    // ============ السيناريو 1: طلب مفتوح ثم إيقاف ============
    const order = await api('POST', '/api/orders', { pointId: 'PT-021', customerPhone: '0500000111', items: [{ productId: prod, qty: 1 }] });
    assertEqual(order.status, 201, 'setup: طلب أُنشئ والشريك فعّال');
    const oid = order.data.id;
    await api('POST', `/api/orders/${oid}/pay`, { method: 'card' });

    const susp = await setStatus('Suspended', 'Commercial hold pending contract review');
    assertEqual(susp.status, 200, '§4 SuperAdmin يوقف الشريك بسبب مُسجَّل');

    // ---- الطلب المفتوح يُكمل كامل دورته ----
    for (const to of ['Accepted', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered']) {
      const t = await api('POST', `/api/orders/${oid}/transition`, { to }, SA);
      assertEqual(t.status, 200, `§4 الطلب المفتوح ينتقل إلى ${to} رغم إيقاف الشريك`);
    }
    const finalState = db.prepare('SELECT status FROM orders WHERE id=?').get(oid);
    assertEqual(finalState.status, 'Delivered',
      '§4 **الطلب المدفوع وصل Delivered كاملًا** — الإيقاف يقفل الباب ولا يطرد من في الداخل');

    // ---- بينما رمز QR جديد يُرفض ----
    const qrDuring = await api('GET', `/api/qr/${token}`);
    assertEqual(qrDuring.status, 409, '§4 وفي الوقت نفسه، رمز QR لا يُحلّ');
    const orderDuring = await api('POST', '/api/orders', { pointId: 'PT-021', items: [{ productId: prod, qty: 1 }] });
    assertEqual(orderDuring.status, 409, '§4 ولا يُقبل أي طلب جديد');
    assert(!/suspend|موقوف|commercial/i.test(JSON.stringify(qrDuring.data)),
      '§4 والرسالة محايدة — لا تكشف للضيف أن السبب تجاري أو أن الشريك موقوف');

    // ---- والحقوق المالية تبقى ----
    const settleDuring = await api('GET', '/api/admin/settlements', null, SA);
    assertEqual(settleDuring.status, 200, '§4 التسويات تبقى متاحة — الإيقاف لا يُسقط حقًا مُستحقًا');
    const loginDuring = await api('POST', '/api/auth/login', { username: 'pl_padmin', password: 'pl_padmin-strong-pass-1' });
    assertEqual(loginDuring.status, 200,
      '§4 ومستخدمو الشريك يدخلون — المدير يحتاج رؤية طلباته المفتوحة وتسوياته وسبب الإيقاف');

    // ---- الكسب متوقف والأرصدة محفوظة ----
    const balBefore = db.prepare(`SELECT COALESCE(SUM(points_balance),0) b FROM loyalty_accounts WHERE partner_id=?`).get(P).b;
    const order2 = await api('POST', '/api/orders', { pointId: 'PT-021', customerPhone: '0500000111', items: [{ productId: prod, qty: 1 }] });
    assertEqual(order2.status, 409, '§4 لا طلب جديد ⇒ لا مسار كسب جديد');
    const balDuring = db.prepare(`SELECT COALESCE(SUM(points_balance),0) b FROM loyalty_accounts WHERE partner_id=?`).get(P).b;
    assertEqual(balDuring, balBefore,
      '§4 **الأرصدة محفوظة كما هي** — الإيقاف لا يُلغي نقطة واحدة');

    // ============ السيناريو 2: العودة إلى Active ============
    const zonesBefore = db.prepare(`SELECT COUNT(*) c FROM zones WHERE property_id IN (SELECT id FROM properties WHERE partner_id=?)`).get(P).c;
    const prodsBefore = db.prepare(`SELECT COUNT(*) c FROM products`).get().c;

    const reactivate = await setStatus('Active', 'Contract review cleared');
    assertEqual(reactivate.status, 200, '§4 العودة إلى Active ممكنة');
    assertEqual(reactivate.data.previous, 'Suspended', '§4 والانتقال يُسجّل مصدره');

    const qrAfter = await api('GET', `/api/qr/${token}`);
    assertEqual(qrAfter.status, 200, '§4 رمز QR يعمل فورًا بعد الاستئناف');
    const orderAfter = await api('POST', '/api/orders', { pointId: 'PT-021', customerPhone: '0500000111', items: [{ productId: prod, qty: 1 }] });
    assertEqual(orderAfter.status, 201, '§4 **الطلبات الجديدة تعود للعمل**');

    const zonesAfter = db.prepare(`SELECT COUNT(*) c FROM zones WHERE property_id IN (SELECT id FROM properties WHERE partner_id=?)`).get(P).c;
    const prodsAfter = db.prepare(`SELECT COUNT(*) c FROM products`).get().c;
    const balAfter = db.prepare(`SELECT COALESCE(SUM(points_balance),0) b FROM loyalty_accounts WHERE partner_id=?`).get(P).b;
    assertEqual(zonesAfter, zonesBefore, '§4 دون فقد أي منطقة');
    assertEqual(prodsAfter, prodsBefore, '§4 ولا أي منتج');
    assert(balAfter >= balDuring, '§4 ولا أي رصيد ولاء');

    // ============ Closed ============
    const closed = await setStatus('Closed', 'Contract terminated by mutual agreement');
    assertEqual(closed.status, 200, '§4 الإغلاق ممكن');
    const loginClosed = await api('POST', '/api/auth/login', { username: 'pl_padmin', password: 'pl_padmin-strong-pass-1' });
    assertEqual(loginClosed.status, 401, '§4 وبعده لا يدخل مستخدمو الشريك');
    const qrClosed = await api('GET', `/api/qr/${token}`);
    assertEqual(qrClosed.status, 409, '§4 ولا يُحلّ أي رمز QR');

    // ---- Closed ليس Delete ----
    const ordersKept = db.prepare('SELECT COUNT(*) c FROM orders WHERE partner_id=?').get(P).c;
    const loyaltyKept = db.prepare('SELECT COUNT(*) c FROM loyalty_accounts WHERE partner_id=?').get(P).c;
    const auditKept = db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE entity=?`).get(P).c;
    assert(ordersKept > 0, '§4 **الطلبات محفوظة كاملة بعد الإغلاق**');
    assert(loyaltyKept >= 0, '§4 وحسابات الولاء محفوظة');
    assert(auditKept >= 3, `§4 وسجل التدقيق يحمل كل الانتقالات (${auditKept})`);
    const reasons = db.prepare(`SELECT reason FROM audit_log WHERE entity=? AND action='partner_status_change'`).all(P);
    assert(reasons.every(r => r.reason && r.reason.length >= 4),
      '§4 وكل انتقال يحمل سببه المُسجَّل — لا سجل بلا معنى');

    // ---- العودة من الإغلاق بقرار صريح ----
    const reopen = await setStatus('Active', 'Contract renewed');
    assertEqual(reopen.status, 200, '§4 العودة من Closed ممكنة بقرار SuperAdmin صريح ومُدقَّق');

    // ============ ملخص الحالة للشريك ============
    const paView = await api('GET', `/api/admin/partners/${P}/status`, null, PA);
    assertEqual(paView.status, 200, '§4 الشريك يرى حالته');
    assert(!paView.data.allowedTransitions,
      '§4 ولا يُعرض له مسار تغيير لا يملكه — الواجهة تعكس RBAC ولا تتجاوزه');

    const crossView = await api('GET', '/api/admin/partners/pt_alrowad/status', null, PA);
    assertEqual(crossView.status, 403, '§4 ولا يرى حالة شريك آخر');

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
