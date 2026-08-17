// tests/role-surfaces.js — Role Corrective §3.3 / §7 / §12.
// كل دور: شاشة بداية صحيحة، تنقّل غير فارغ، ورفض خادمي حقيقي لما لا يملكه.
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
  const l = await api('POST', '/api/auth/login', { username, password: `${username}-strong-pass-1` });
  return l.data.token;
}

async function run() {
  resetCounts();
  await startServer();
  console.log('=== Role Corrective: Role Surfaces & RBAC Negatives ===');

  try {
    openDb();
    const SA = (await api('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).data.token;

    const PROD = await makeUser(SA, 'prodadmin_t', 'ProductAdmin');
    const SAFE = await makeUser(SA, 'safetyrev_t', 'SafetyReviewer');
    const FIN  = await makeUser(SA, 'finance_t', 'AlnadlFinance');
    const PA   = await makeUser(SA, 'partneradm_t', 'PartnerAdmin', 'pt_nova');
    const PV   = await makeUser(SA, 'partnerview_t', 'PartnerViewer', 'pt_nova');
    const OP   = await makeUser(SA, 'operator_t', 'Operator', 'pt_nova');

    // ---- §3.3 ProductAdmin: ما يسمح به الخادم فعلًا ----
    for (const ep of ['/api/admin/mechanics', '/api/admin/engage/overview']) {
      const r = await api('GET', ep, null, PROD);
      assertEqual(r.status, 200, `§3.3 ProductAdmin يصل إلى ${ep} — سطحه مبني على صلاحية حقيقية`);
    }
    // ...وما لا يسمح به
    const paKill = await api('POST', '/api/admin/engage/kill-switch', { enabled: false }, PROD);
    assertEqual(paKill.status, 403,
      '§3.3 ProductAdmin لا يملك مفتاح الإيقاف العام — محصور بـSuperAdmin، والواجهة لا تعرضه');
    const paPolicy = await api('POST', '/api/admin/engage/policy-overrides', { level: 'property' }, PROD);
    assertEqual(paPolicy.status, 403, '§3.3 ولا يملك تقييدات السياسة');
    const paUsers = await api('GET', '/api/admin/users', null, PROD);
    assertEqual(paUsers.status, 403, '§12 ولا يصل لإدارة المستخدمين');
    const paSettle = await api('GET', '/api/admin/settlements', null, PROD);
    assertEqual(paSettle.status, 403, '§12 ولا للتسويات المالية');

    // ---- §3.3 SafetyReviewer ----
    const srLedger = await api('GET', '/api/admin/engage/ledger', null, SAFE);
    assertEqual(srLedger.status, 200, '§3.3 SafetyReviewer يصل لسجل التجارب');
    const srMech = await api('GET', '/api/admin/mechanics', null, SAFE);
    assertEqual(srMech.status, 200, 'ويصل لقائمة الآليات لعرض حوادثها');
    const srPropose = await api('POST', '/api/admin/mechanics/propose', { name: 'x', personality: 'PLAY', pool: [] }, SAFE);
    assertEqual(srPropose.status, 403,
      '§3.3 لكنه لا يستطيع اقتراح آلية — المراجعة ليست تأليفًا');
    const srKill = await api('POST', '/api/admin/engage/kill-switch', { enabled: false }, SAFE);
    assertEqual(srKill.status, 403, '§3.3 ولا يملك مفتاح الإيقاف');
    const srUsers = await api('GET', '/api/admin/users', null, SAFE);
    assertEqual(srUsers.status, 403, '§12 ولا إدارة المستخدمين');

    // ---- §12 سلبيات بقية الأدوار ----
    const opMech = await api('GET', '/api/admin/mechanics', null, OP);
    assertEqual(opMech.status, 403, '§12 Operator لا يصل لمختبر الآليات');
    const opUsers = await api('GET', '/api/admin/users', null, OP);
    assertEqual(opUsers.status, 403, '§12 ولا لإدارة المستخدمين');
    const opPlans = await api('POST', '/api/admin/plans', { code: 'X', monthlyFee: 0, techFeeRate: 0 }, OP);
    assertEqual(opPlans.status, 403, '§12 ولا لإنشاء باقات');

    const pvCreate = await api('POST', '/api/admin/users', { username: 'pv_try', role: 'Operator' }, PV);
    assertEqual(pvCreate.status, 403, '§11 PartnerViewer لا ينجح له أي mutation حتى بالاستدعاء المباشر');
    const pvZone = await api('POST', '/api/admin/zones', { propertyId: 'prop_nova_main', name_ar: 'x', name_en: 'x' }, PV);
    assertEqual(pvZone.status, 403, '§11 ولا إنشاء موارد');

    const finMech = await api('GET', '/api/admin/mechanics', null, FIN);
    assertEqual(finMech.status, 403, '§12 AlnadlFinance لا يصل للتشغيل غير المالي');
    const finSettle = await api('GET', '/api/admin/settlements', null, FIN);
    assertEqual(finSettle.status, 200, '§9 لكنه يصل للتسويات — دوره المالي سليم');
    const finAudit = await api('GET', '/api/audit', null, FIN);
    assertEqual(finAudit.status, 200, '§9 وللتدقيق');

    // ---- §12 عبور المستأجر ----
    const paOther = await api('GET', '/api/partner/overview?partnerId=pt_alrowad', null, PA);
    assertEqual(paOther.status, 403, '§12 PartnerAdmin من شريك A لا يرى بيانات شريك B');
    const pvOther = await api('GET', '/api/partner/overview?partnerId=pt_alrowad', null, PV);
    assertEqual(pvOther.status, 403, '§12 وكذلك PartnerViewer');
    const paOwn = await api('GET', '/api/partner/overview?partnerId=pt_nova', null, PA);
    assertEqual(paOwn.status, 200, '§7 وكلاهما يرى شريكه — Overview متاح فعليًا لـPartnerAdmin');

    // ---- كل دور له نقطة بداية تعمل ----
    const HOME = {
      ProductAdmin: ['/api/admin/mechanics', PROD],
      SafetyReviewer: ['/api/admin/engage/ledger', SAFE],
      AlnadlFinance: ['/api/admin/settlements', FIN],
      PartnerAdmin: ['/api/partner/overview?partnerId=pt_nova', PA],
      PartnerViewer: ['/api/partner/overview?partnerId=pt_nova', PV],
      Operator: ['/api/ops/queue', OP],
    };
    for (const [role, [ep, tok]] of Object.entries(HOME)) {
      const r = await api('GET', ep, null, tok);
      assertEqual(r.status, 200, `§11 ${role} تُحمّل شاشته الأولى بنجاح — لا شاشة فارغة`);
    }

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
