// tests/golive-input-validation.js
//
// انحدار للسبب الجذري المُثبَت للخطأ الميداني على البيئة المرفوعة:
// حقل مطلوب مفقود في جسم الطلب كان يصل مباشرة إلى ربط معلمة SQLite،
// فيرمي السائق TypeError -> 500 -> يظهر للمشغّل كـ"Server error" مبهم،
// بينما هو في حقيقته مُدخل ناقص أي 400.
'use strict';
const { startServer, stopServer, api, loginAs, assert, assertEqual, summary, resetCounts, getDataPath } = require('./helpers.js');

function openDb() {
  process.env.SQLITE_PATH = getDataPath();
  delete require.cache[require.resolve('../db.js')];
  return require('../db.js');
}

async function run() {
  resetCounts();
  await startServer();
  console.log('=== Go-Live Suite: Input Validation (field diagnosis) ===');

  try {
    const { db } = openDb();
    const T = await loginAs('admin');

    // ---- السبب الجذري بالضبط كما وقع ميدانيًا ----
    const missing = await api('POST', '/api/admin/onboard',
      { partnerNameAr: 'مدينة الألعاب', partnerNameEn: 'Golden Playland' }, T);
    assertEqual(missing.status, 400,
      'ROOT CAUSE: planCode مفقود يُرجع 400 لا 500 — هذا هو الخطأ الميداني الذي ظهر كـ"Server error"');
    assert(/planCode/.test(JSON.stringify(missing.data)),
      'التشخيص: الاستجابة تُسمّي الحقل الناقص بالضبط بدل رسالة عامة');

    const empty = await api('POST', '/api/admin/onboard',
      { partnerNameAr: 'أ', partnerNameEn: 'A', planCode: '' }, T);
    assertEqual(empty.status, 400, 'سلسلة فارغة تُعامَل كمفقود لا كرمز صالح');

    const blank = await api('POST', '/api/admin/onboard',
      { partnerNameAr: '   ', partnerNameEn: 'A', planCode: 'PLATFORM' }, T);
    assertEqual(blank.status, 400, 'حقل من مسافات فقط يُرفض');

    const nulled = await api('POST', '/api/admin/onboard',
      { partnerNameAr: null, partnerNameEn: 'A', planCode: 'PLATFORM' }, T);
    assertEqual(nulled.status, 400, 'null يُرفض قبل الوصول للربط');

    // ---- لا شيء من هذا كسر المسار الصحيح ----
    const good = await api('POST', '/api/admin/onboard',
      { partnerNameAr: 'شريك صحيح', partnerNameEn: 'Valid Partner', planCode: 'PLATFORM' }, T);
    assertEqual(good.status, 201, 'الطلب الصحيح ما زال ينجح — الحارس لم يكسر المسار السليم');

    // ---- رسالة مفيدة حين لا توجد باقات إطلاقًا (حالة البيئة المرفوعة) ----
    db.prepare('DELETE FROM subscriptions').run();
    db.prepare('DELETE FROM plans').run();
    const noPlans = await api('POST', '/api/admin/onboard',
      { partnerNameAr: 'ب', partnerNameEn: 'B', planCode: 'PLATFORM' }, T);
    assertEqual(noPlans.status, 400, 'رمز باقة غير موجود يُرجع 400');
    assert(/No plans exist yet/.test(JSON.stringify(noPlans.data)),
      'حين تكون قاعدة الباقات فارغة تمامًا، الرسالة تُرشد المشغّل لإنشاء باقة أولًا بدل "Unknown plan code" المبهمة');

    // ---- مسار إنشاء الباقة من الواجهة البرمجية متاح فعلًا ----
    const created = await api('POST', '/api/admin/plans',
      { code: 'FIELDFIX', name_ar: 'اختبار', name_en: 'Test', monthlyFee: 100, techFeeRate: 0.02,
        entitlements: { qrOrdering: true } }, T);
    assertEqual(created.status, 201, 'يمكن إنشاء أول باقة عبر الواجهة البرمجية');
    const nowOk = await api('POST', '/api/admin/onboard',
      { partnerNameAr: 'ج', partnerNameEn: 'C', planCode: 'FIELDFIX' }, T);
    assertEqual(nowOk.status, 201,
      'بعد إنشاء الباقة، الـonboarding ينجح — السلسلة كاملة تعمل من الصفر');

    // ---- لا يوجد 500 في أي من هذه المسارات ----
    for (const r of [missing, empty, blank, nulled, noPlans]) {
      assert(r.status !== 500, 'لا يُرجع أي مُدخل خاطئ 500 — المُدخل الناقص ليس عطل خادم');
      assert(!/Server error/.test(JSON.stringify(r.data)),
        'لا تظهر رسالة "Server error" المبهمة لأي خطأ مُدخلات');
    }

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
