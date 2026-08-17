// tests/loyalty-admin.js — Role Corrective §5.
// سطح إداري فقط: لا تغيير في قواعد الولاء، ولا Campaigns/Tiers/Network.
// الادعاء تحت الاختبار: عزل مستأجر كامل، وإخفاء الجوال، والتقييد بالصلاحية.
'use strict';
const { startServer, stopServer, api, assert, assertEqual, summary, resetCounts, getDataPath } = require('./helpers.js');

function openDb() {
  process.env.SQLITE_PATH = getDataPath();
  // run-all يُشغّل المجموعات في نفس العملية. lib/loyalty.js يستدعي db.js
  // **عند التحميل**، فيلتقط مقبض القاعدة السائد وقتها ويحتفظ به في ذاكرة
  // الوحدات. بدون إبطال ذاكرته أيضًا، يكتب هذا الاختبار في قاعدة مجموعة
  // سابقة بينما الخادم يقرأ من القاعدة الحالية -- فتظهر النتائج فارغة.
  // اكتُشف لأن المجموعة تنجح منفردة وتفشل في التسلسل.
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
  console.log('=== Role Corrective §5: Loyalty Administration ===');

  try {
    const { db } = openDb();
    const loyalty = require('../lib/loyalty.js');
    const SA = (await api('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).data.token;
    // هذه المجموعة تُنشئ شركاءها بنفسها بدل الاعتماد على شركاء البذرة
    // المشتركين. في تشغيل متسلسل قد تكون مجموعة سابقة بدّلت باقة pt_nova
    // أو حالته، فيتوقف الكسب وتُصبح النتيجة رهينة ترتيب التشغيل. شركاء
    // خاصون يجعلون النتيجة حتمية أيًا كان ما سبقها.
    const { uid } = require('../db.js');
    const planId = uid('plan');
    db.prepare(`INSERT INTO plans (id,code,name_ar,name_en,monthly_fee,tech_fee_rate,features_json) VALUES (?,?,?,?,?,?,?)`)
      .run(planId, 'LOYADMIN_T', 'اختبار', 'Test', 0, 0.02,
        JSON.stringify({ qrOrdering: true, digitalPayment: true, loyalty_enabled: true, loyalty_redeem_enabled: true }));

    function mkPartner(label) {
      const pid = uid('pt');
      db.prepare(`INSERT INTO partners (id,name_ar,name_en,legal_name,contract_ref,status) VALUES (?,?,?,?,?,'Active')`)
        .run(pid, label, label, label, 'C-' + label);
      db.prepare(`INSERT INTO subscriptions (id,partner_id,plan_id,status,started_at,renews_at) VALUES (?,?,?,'Active',?,?)`)
        .run(uid('sub'), pid, planId, Date.now(), Date.now() + 2592000000);
      return pid;
    }
    const P1 = mkPartner('LoyA');   // الشريك تحت الفحص
    const P2 = mkPartner('LoyB');   // شريك آخر بنفس رقم الجوال

    const PA = await makeUser(SA, 'la_padmin', 'PartnerAdmin', P1);
    const PV = await makeUser(SA, 'la_pviewer', 'PartnerViewer', P1);
    const OP = await makeUser(SA, 'la_operator', 'Operator', P1);
    const FIN = await makeUser(SA, 'la_finance', 'AlnadlFinance');


    const PHONE_A = '0501112233', PHONE_B = '0509998877';
    loyalty.earnPoints(P1, PHONE_A, 'ORD-LA-1', 250);
    loyalty.earnPoints(P1, PHONE_B, 'ORD-LA-2', 80);
    loyalty.earnPoints(P2, PHONE_A, 'ORD-LA-3', 500); // نفس الجوال، شريك آخر

    // ================= الملخص =================
    const sum = await api('GET', `/api/admin/loyalty/summary?partnerId=${P1}`, null, SA);
    assertEqual(sum.status, 200, '§5 SuperAdmin يقرأ ملخص ولاء شريك محدد');
    assert(sum.data.entitlements && 'loyaltyEnabled' in sum.data.entitlements && 'redeemEnabled' in sum.data.entitlements,
      '§5 الملخص يعرض حالتي loyalty_enabled و loyalty_redeem_enabled');
    assertEqual(sum.data.entitlements.redeemPolicy, 'verified_only', '§5 وسياسة التحقق الفعّالة');
    assert('total' in sum.data.accounts && 'verified' in sum.data.accounts && 'unverified' in sum.data.accounts,
      '§5 وإجماليات الحسابات مع تفصيل الموثّق وغير الموثّق');
    assert(sum.data.activity.pointsEarned >= 330, '§5 ونشاط الكسب');
    assert('pointsRedeemed' in sum.data.activity, '§5 ونشاط الاستبدال');

    // ================= العزل =================
    assertEqual(sum.data.accounts.total, 2,
      '§5 الملخص يحصي حسابَي هذا الشريك فقط — رصيد نفس الجوال لدى شريك آخر لا يُحتسب');
    assert(sum.data.accounts.totalBalance === 330,
      `§5 وإجمالي الرصيد يخصّ هذا الشريك وحده (${sum.data.accounts.totalBalance})`);

    const other = await api('GET', `/api/admin/loyalty/summary?partnerId=${P2}`, null, PA);
    assertEqual(other.status, 403, '§5 PartnerAdmin لا يقرأ ملخص شريك آخر حتى بتمرير مُعرّفه');

    const paOwn = await api('GET', '/api/admin/loyalty/summary', null, PA);
    assertEqual(paOwn.status, 200, '§5 لكنه يقرأ شريكه بلا معاملات');
    assertEqual(paOwn.data.partnerId, P1, '§5 والنطاق مُشتق من جلسته لا من الطلب');

    // نطاق مزوّر في الاستعلام
    const forged = await api('GET', `/api/admin/loyalty/summary?partnerId=${P2}`, null, PV);
    assertEqual(forged.status, 403, '§5 و PartnerViewer كذلك — النطاق المزوّر مرفوض');

    // ================= الحسابات وإخفاء الجوال =================
    const accts = await api('GET', `/api/admin/loyalty/accounts?partnerId=${P1}`, null, SA);
    assertEqual(accts.status, 200, '§5 قائمة الحسابات متاحة');
    assertEqual(accts.data.length, 2, '§5 وتحمل حسابي هذا الشريك فقط');

    const blob = JSON.stringify(accts.data);
    assert(!blob.includes(PHONE_A) && !blob.includes(PHONE_B),
      '§5 **لا يظهر أي رقم جوال كامل في القائمة الإدارية**');
    assert(accts.data.every(a => /^••••\d{4}$/.test(a.customerMasked)),
      '§5 والأرقام مُخفاة جزئيًا مع إبقاء آخر أربعة للتمييز التشغيلي');
    assert(!blob.includes('customer_key'), '§5 ولا يُعاد الحقل الخام إطلاقًا');
    assert(accts.data.every(a => 'verificationStatus' in a), '§5 وحالة التحقق ظاهرة لكل حساب');

    // ================= السجل =================
    const target = accts.data[0];
    const hist = await api(`GET`, `/api/admin/loyalty/accounts/${target.id}/history`, null, PA);
    assertEqual(hist.status, 200, '§5 سجل الحساب متاح ضمن النطاق');
    assert(Array.isArray(hist.data.history) && hist.data.history.length > 0, '§5 ويحمل الحركات');
    assert(!JSON.stringify(hist.data).includes(PHONE_A), '§5 والجوال مُخفى في السجل أيضًا');

    // حساب شريك آخر
    const otherAcct = db.prepare(`SELECT id FROM loyalty_accounts WHERE partner_id=? LIMIT 1`).get(P2);
    const crossHist = await api('GET', `/api/admin/loyalty/accounts/${otherAcct.id}/history`, null, PA);
    assertEqual(crossHist.status, 403,
      '§5 **تمرير مُعرّف حساب شريك آخر مرفوض** — العزل يُفحص على الحساب نفسه لا على المعامل');

    // ================= الصلاحيات =================
    const opTry = await api('GET', '/api/admin/loyalty/summary', null, OP);
    assertEqual(opTry.status, 403, '§5 Operator لا يصل لإدارة الولاء');
    const finTry = await api('GET', `/api/admin/loyalty/summary?partnerId=${P1}`, null, FIN);
    assertEqual(finTry.status, 403, '§5 ولا AlnadlFinance — لم يُوسَّع دوره');
    const noParam = await api('GET', '/api/admin/loyalty/summary', null, SA);
    assertEqual(noParam.status, 400, '§5 وSuperAdmin يجب أن يُحدّد شريكًا صراحةً');

    // PartnerViewer قراءة فقط: لا نقاط تعديل أصلًا في هذا السطح
    const pvRead = await api('GET', '/api/admin/loyalty/summary', null, PV);
    assertEqual(pvRead.status, 200, '§5 PartnerViewer يقرأ ملخص شريكه');

    // ================= §4 يظهر أثره هنا =================
    await api('POST', `/api/admin/partners/${P1}/status`, { status: 'Suspended', reason: 'Loyalty admin test' }, SA);
    const suspended = await api('GET', `/api/admin/loyalty/summary?partnerId=${P1}`, null, SA);
    assertEqual(suspended.data.entitlements.blockedByPartnerStatus, true,
      '§5 حين توقف حالة الشريك الاستبدال، يُصرَّح بذلك بدل أن يبدو تناقضًا غير مفسَّر');
    assertEqual(suspended.data.entitlements.partnerStatus, 'Suspended', '§5 وتُعرض الحالة نفسها');
    assertEqual(suspended.data.accounts.totalBalance, 330,
      '§5 **والأرصدة كما هي أثناء الإيقاف — لا تُلغى نقطة واحدة**');
    await api('POST', `/api/admin/partners/${P1}/status`, { status: 'Active', reason: 'restore' }, SA);

    // ================= لا ميزات خارج النطاق =================
    for (const ep of ['/api/admin/loyalty/campaigns', '/api/admin/loyalty/tiers', '/api/admin/loyalty/network']) {
      const r = await api('GET', ep, null, SA);
      assertEqual(r.status, 404, `§5 لم تُبنَ ميزة خارج النطاق: ${ep}`);
    }

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
