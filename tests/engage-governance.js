// tests/engage-governance.js — Role Corrective R2 §1/§2 + §6.
// الادعاء: الحالة الفعّالة تُفكَّك بأسبابها، والتحكم يحترم RBAC حرفيًا —
// مفتاح الإيقاف لـSuperAdmin فقط، والشريك يُقيّد ولا يوسّع، ولا عبور مستأجر.
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
  console.log('=== Role Corrective R2: Engage Governance & Finance ===');

  try {
    const { db } = openDb();
    const SA = (await api('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).data.token;
    const PA = await makeUser(SA, 'r2_padmin', 'PartnerAdmin', 'pt_nova');
    const PV = await makeUser(SA, 'r2_pviewer', 'PartnerViewer', 'pt_nova');
    const FIN = await makeUser(SA, 'r2_finance', 'AlnadlFinance');
    const OP = await makeUser(SA, 'r2_operator', 'Operator', 'pt_nova');

    // ================= §1 الحالة الفعّالة تُفكَّك بأسبابها =================
    const st0 = await api('GET', '/api/engage/effective-state?partnerId=pt_nova', null, SA);
    assertEqual(st0.status, 200, '§1 SuperAdmin يقرأ الحالة الفعّالة لأي شريك');
    assert('effective' in st0.data && 'blockedBy' in st0.data,
      '§1 الاستجابة تحمل النتيجة والسبب معًا — لا نتيجة بلا تفسير');
    assert(st0.data.layers && st0.data.layers.plan && st0.data.layers.subscription && st0.data.layers.globalKillSwitch,
      '§1 الطبقات الأربع مُفكَّكة: الباقة والاشتراك والمفتاح العام والتقييدات');
    assertEqual(st0.data.blockedBy, 'not_in_plan',
      '§1 حين لا تشمل الباقة Engage، السبب المُبلَّغ هو الباقة تحديدًا — لا رسالة عامة');

    // فعّل Engage في الباقة
    const plan = db.prepare(`SELECT * FROM plans WHERE code='PLATFORM'`).get();
    const f = JSON.parse(plan.features_json); f.engage_enabled = true;
    db.prepare('UPDATE plans SET features_json=? WHERE id=?').run(JSON.stringify(f), plan.id);
    await api('POST', '/api/admin/subscription', { partnerId: 'pt_nova', planCode: 'PLATFORM' }, SA);

    const st1 = await api('GET', '/api/engage/effective-state?partnerId=pt_nova', null, SA);
    assertEqual(st1.data.effective, true, '§1 بعد تفعيل الباقة يصبح Engage فعّالًا');
    assertEqual(st1.data.blockedBy, null, '§1 وبلا سبب منع');

    // ================= §1 مفتاح الإيقاف العام =================
    const kill = await api('POST', '/api/admin/engage/kill-switch', { enabled: false }, SA);
    assertEqual(kill.status, 200, '§1 SuperAdmin يوقف Engage على المنصة');
    const st2 = await api('GET', '/api/engage/effective-state?partnerId=pt_nova', null, SA);
    assertEqual(st2.data.effective, false, '§1 والإيقاف يسري فعليًا');
    assertEqual(st2.data.blockedBy, 'global_kill_switch',
      '§1 والسبب يُنسب للمفتاح العام لا للباقة — التفكيك دقيق');

    // §2 الشريك يرى الأثر ولا يملك التجاوز
    const pSt = await api('GET', '/api/engage/effective-state', null, PA);
    assertEqual(pSt.status, 200, '§2 PartnerAdmin يقرأ حالته الفعّالة');
    assertEqual(pSt.data.partnerId, 'pt_nova', '§2 مُقيَّدة بشريكه تلقائيًا');
    assertEqual(pSt.data.effective, false, '§2 ويرى أن Engage موقوف');
    assertEqual(pSt.data.layers.globalKillSwitch.controlledBy, 'SuperAdmin',
      '§2 والواجهة تُخبره أن التحكم لدى النادل — لا زر يفشل');
    assert(!('aiGeneration' in pSt.data.layers),
      '§2 ولا تُكشف له طبقة توليد الذكاء الاصطناعي — تفاصيل منصة');

    const paKill = await api('POST', '/api/admin/engage/kill-switch', { enabled: true }, PA);
    assertEqual(paKill.status, 403, '§2 PartnerAdmin لا يستطيع رفع مفتاح الإيقاف العام');
    const pvKill = await api('POST', '/api/admin/engage/kill-switch', { enabled: true }, PV);
    assertEqual(pvKill.status, 403, '§2 ولا PartnerViewer');

    await api('POST', '/api/admin/engage/kill-switch', { enabled: true }, SA); // استئناف

    // ================= §2 التقييد باتجاه واحد =================
    const restrict = await api('POST', '/api/admin/engage/policy-overrides',
      { scopeType: 'zone', scopeId: 'z_lobby', flagKey: 'engage_enabled', enabled: false }, PA);
    assertEqual(restrict.status, 201, '§2 PartnerAdmin يستطيع التقييد داخل نطاقه');

    const crossRestrict = await api('POST', '/api/admin/engage/policy-overrides',
      { scopeType: 'property', scopeId: 'prop_alrowad_hq', flagKey: 'engage_enabled', enabled: false }, PA);
    assertEqual(crossRestrict.status, 403,
      '§2 لكنه لا يستطيع تقييد عقار شريك آخر — عزل المستأجر مفروض على الخادم');

    const pvRestrict = await api('POST', '/api/admin/engage/policy-overrides',
      { scopeType: 'zone', scopeId: 'z_lobby', flagKey: 'engage_enabled', enabled: false }, PV);
    assertEqual(pvRestrict.status, 403, '§2 PartnerViewer قراءة فقط — لا تقييد');

    // ================= §2 لا سجل كامل للشريك =================
    const paLedger = await api('GET', '/api/admin/engage/ledger', null, PA);
    assertEqual(paLedger.status, 403, '§2 PartnerAdmin لا يصل لسجل التجارب الكامل');
    const pvLedger = await api('GET', '/api/admin/engage/ledger', null, PV);
    assertEqual(pvLedger.status, 403, '§2 ولا PartnerViewer');

    const paOverview = await api('GET', '/api/partner/engage/overview', null, PA);
    assertEqual(paOverview.status, 200, '§2 لكن نظرة الشريك المُجمّعة متاحة له');
    const pvOverview = await api('GET', '/api/partner/engage/overview', null, PV);
    assertEqual(pvOverview.status, 200, '§2 وللمُطّلع أيضًا');

    // ================= §2 لا عبور مستأجر =================
    const crossRead = await api('GET', '/api/engage/effective-state?partnerId=pt_alrowad', null, PA);
    assertEqual(crossRead.status, 403,
      '§2 PartnerAdmin لا يقرأ حالة شريك آخر حتى بتمرير مُعرّفه صراحةً');

    // ================= §12 سلبيات بقية الأدوار =================
    const opState = await api('GET', '/api/engage/effective-state?partnerId=pt_nova', null, OP);
    assertEqual(opState.status, 403, '§12 Operator لا يصل لحوكمة Engage');
    const finKill = await api('POST', '/api/admin/engage/kill-switch', { enabled: false }, FIN);
    assertEqual(finKill.status, 403, '§12 AlnadlFinance لا يملك مفتاح الإيقاف — لا توسيع للتشغيل');
    const finPolicy = await api('GET', '/api/admin/engage/policy-overrides', null, FIN);
    assertEqual(finPolicy.status, 403, '§12 ولا تقييدات السياسة');

    // ================= §6 دفتر الإيراد =================
    const finLedger = await api('GET', '/api/admin/revenue-ledger', null, FIN);
    assertEqual(finLedger.status, 200, '§6 AlnadlFinance يصل لدفتر الإيراد');
    const saLedger = await api('GET', '/api/admin/revenue-ledger', null, SA);
    assertEqual(saLedger.status, 200, '§6 وكذلك SuperAdmin');
    const opLedger = await api('GET', '/api/admin/revenue-ledger', null, OP);
    assertEqual(opLedger.status, 403, '§6 ولا يصله Operator');

    const finOps = await api('GET', '/api/ops/queue', null, FIN);
    assertEqual(finOps.status, 403,
      '§6 ودور المالية لم يُوسَّع للتشغيل — لا يزال ممنوعًا من شاشة الطلبات');

    // ================= §13 لا تسريب أسرار =================
    const blob = JSON.stringify(st1.data) + JSON.stringify(paOverview.data);
    for (const leak of ['accessToken', 'sessionToken', 'access_token', 'prompt', 'rendered_payload', 'selection_reason']) {
      assert(!blob.includes(leak), `§13 حالة Engage لا تكشف "${leak}"`);
    }

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
