// tests/browser-payment-policy.js — تحقق واجهة حقيقي للدفعة (ب).
//
// السبب الذي فرض هذا الملف هو نفسه الذي فرض browser-activation-journey.js:
// اختبار على مستوى الـAPI يُثبت أن الخادم صحيح، لا أن الضيف يستطيع إتمام
// طلبه. رحلة "لا تحصيل" تحديدًا تعيش أو تموت في الواجهة -- لو بقي زر
// «ادفع الآن» ظاهرًا، لتوقّف الضيف عند خطوة لا وجود لها ولانتهت الرحلة عند
// شاشة صامتة، بينما كل تأكيدات الخادم خضراء.
'use strict';
const path = require('path');
function loadPlaywright() {
  try { return require('playwright'); } catch (e) {}
  for (const base of (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)) {
    try { return require(path.join(base, 'playwright')); } catch (e) {}
  }
  return null;
}
const playwright = loadPlaywright();
const fs = require('fs');
const { startServer, stopServer, api, assert, assertEqual, summary, resetCounts, BASE, getDataPath } = require('./helpers.js');

/* المسار يُبنى من __dirname لا من مجلد التشغيل: اللقطات كُتبت أول مرة إلى
   tests/docs/ لأن المسار كان نسبيًا، فبدا التحقق ناجحًا بينما لا لقطة واحدة
   في مكانها. */
const SHOTS = path.join(__dirname, '..', 'docs', 'batchb-screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);

const awaiting = [];

function openDb() {
  process.env.SQLITE_PATH = getDataPath();
  for (const m of ['../db.js', '../lib/payment-policy.js']) {
    try { delete require.cache[require.resolve(m)]; } catch (e) {}
  }
  return require('../db.js');
}

/** يفتح رحلة الضيف على رمز QR محدّد ويصل إلى شاشة الدفع بسلّة حقيقية. */
async function guestToCheckout(page, base, token) {
  await page.goto(`${base}/?t=${token}`);
  await page.waitForTimeout(900);
  // عقار متعدد المنافذ يبدأ بشاشة اختيار المنفذ (Service Hub) -- الرحلة
  // الحقيقية تمرّ بها، فلا تُتخطّى هنا.
  if (await page.evaluate(() => S.screen === 'hub')) {
    await page.click('.qrpickitem');
    await page.waitForTimeout(700);
  }
  // شاشة الترحيب -> القائمة
  if (await page.evaluate(() => S.screen === 'welcome')) {
    await page.click('.btn-primary');
    await page.waitForTimeout(900);
  }
  await page.waitForFunction(() => S.catalog && (S.catalog.products || []).length > 0, { timeout: 15000 });
  // الإضافة عبر مسار المنتج الحقيقي (openProduct -> addActiveToCart) لا ببناء
  // سطر سلّة يدويًا. كشفت اللقطة أن السطر المبني يدويًا كان ينقصه lineTotal،
  // فظهر الإجمالي 0.00 بينما التأكيد النصّي مرّ -- تحقق نصّي على رقم صفريّ
  // لا يُثبت شيئًا.
  await page.evaluate(() => {
    const prod = (S.catalog.products || [])[0];
    App.openProduct(prod.id);
    App.addActiveToCart();
  });
  await page.waitForFunction(() => S.cart.length > 0 && S.cart[0].lineTotal > 0, { timeout: 10000 });
  await page.evaluate(() => App.goCheckout());
  await page.waitForFunction(() => S.screen === 'checkout', { timeout: 15000 });
  await page.waitForTimeout(400);
}

async function run() {
  resetCounts();
  if (!playwright) {
    console.log('  SKIPPED: playwright is not installed — real-DOM verification of the checkout screen did not run.');
    awaiting.push({ item: 'Guest checkout DOM verification', reason: 'playwright not installed in this environment' });
    return true;
  }
  await startServer();
  console.log('=== Browser: payment policy in the guest checkout and the admin screen ===');

  const browser = await playwright.chromium.launch();
  try {
    const { db, uid } = openDb();
    const base = BASE();
    const SA = (await api('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).data.token;

    // نقطة QR حقيقية على أول عقار في بيانات العرض
    const point = db.prepare(`SELECT pt.id, pt.zone_id, z.property_id, pr.partner_id, q.token
                              FROM points pt JOIN zones z ON z.id = pt.zone_id
                              JOIN properties pr ON pr.id = z.property_id
                              JOIN qr_tokens q ON q.point_id = pt.id AND q.active = 1
                              WHERE pt.active = 1 LIMIT 1`).get();
    assert(!!point, 'بيانات العرض تحوي نقطة QR فعّالة للرحلة');

    const setPolicy = (scopeType, scopeId, body) =>
      api('PUT', `/api/admin/payment-policy/${scopeType}/${scopeId}`, body, SA);
    const clearPolicy = (scopeType, scopeId) =>
      api('DELETE', `/api/admin/payment-policy/${scopeType}/${scopeId}`, null, SA);

    /* ---------- 1) السلوك الافتراضي: خطوة الدفع كما كانت ---------- */
    let page = await browser.newPage();
    await guestToCheckout(page, base, point.token);
    let hasMethods = await page.$$eval('.paymethodrow', els => els.length);
    assert(hasMethods > 0, '(1) **بلا سياسة تظهر وسائل الدفع كما كانت** — لا تغيير على عميل قائم');
    let btn = (await page.textContent('.btn-primary')) || '';
    assert(/ادفع|Pay/.test(btn), '(1) وزر الدفع يحمل نصّه المعتاد');
    await page.screenshot({ path: shot('01-checkout-default.png') });
    await page.close();

    /* ---------- 2) لا تحصيل: خطوة الدفع تختفي من الشاشة ---------- */
    await setPolicy('property', point.property_id, { policy: 'NO_GUEST_PAYMENT', reason: 'browser test' });
    page = await browser.newPage();
    await guestToCheckout(page, base, point.token);
    hasMethods = await page.$$eval('.paymethodrow', els => els.length);
    assertEqual(hasMethods, 0,
      '(2) **كتلة وسائل الدفع تختفي كليًا** — لا خيار معطّل يقف عنده الضيف بلا تفسير');
    const body = await page.textContent('.scrbody');
    assert(/لا حاجة للدفع|No payment needed/.test(body),
      '(2) وتظهر رسالة صريحة تشرح السبب بدل فراغ');
    btn = (await page.textContent('.btn-primary')) || '';
    assert(/تأكيد الطلب|Confirm order/.test(btn),
      '(2) **وزر الإجراء يقول «تأكيد الطلب» لا «ادفع الآن»** — النص يصف ما سيحدث فعلًا');
    assert(!/ادفع الآن|Pay now/.test(btn), '(2) ولا يبقى أثر من نصّ الدفع');

    // الإجمالي يبقى معروضًا: القيمة حقيقية والطلب ليس مجانيًا
    // التأكيد يطلب رقمًا **غير صفري** صراحةً: قيمة الطلب هي بيت القصيد هنا،
    // وسلّة صفرية كانت ستمرّ على فحص "يحتوي رقمًا" وتُخفي الخلل.
    const shownTotal = await page.evaluate(() => App.computeTotals().total);
    assert(shownTotal > 0,
      '(2) **والإجمالي يبقى بقيمة حقيقية** — لا تحصيل من الضيف لا يعني طلبًا بلا قيمة');
    const totals = await page.textContent('.totalsbox');
    assert(totals.includes(String(Math.round(shownTotal * 100) / 100).split('.')[0]),
      '(2) والقيمة نفسها معروضة في صندوق الإجماليات لا محسوبة في الذاكرة فقط');
    await page.screenshot({ path: shot('02-checkout-no-guest-payment.png') });

    /* ---------- 3) الرحلة تكتمل فعلًا حتى شاشة النتيجة ---------- */
    await page.click('.btn-primary');
    await page.waitForTimeout(1500);
    const resultText = await page.textContent('body');
    assert(/تم تأكيد طلبك|Your order is confirmed/.test(resultText),
      '(3) **والرحلة تكتمل إلى شاشة تأكيد** — لا «تم الدفع بنجاح» لطلب لم يُدفع');
    const orderId = await page.evaluate(() => S.currentOrder && S.currentOrder.id);
    assert(!!orderId, '(3) وطلب حقيقي أُنشئ');
    const row = db.prepare('SELECT status, collection_status FROM orders WHERE id = ?').get(orderId);
    assertEqual(row.status, 'Confirmed', '(3) وحالته Confirmed في القاعدة');
    assertEqual(row.collection_status, 'NOT_REQUIRED', '(3) وحالة تحصيله NOT_REQUIRED');

    // متابعة الطلب: أول درجة في السلّم يجب أن تكون "تم تأكيد الطلب" لا "تم الاستلام"
    await page.evaluate(() => App.goTrack());
    await page.waitForTimeout(900);
    const trackText = await page.textContent('body');
    await page.screenshot({ path: shot('03-tracking-confirmed.png') });
    assert(/تم تأكيد الطلب|Order confirmed/.test(trackText),
      '(3) **وشاشة المتابعة تبدأ من «تم تأكيد الطلب»** — سلّم لا يذكر دفعًا لم يقع');
    await page.close();

    /* ---------- 4) MIXED: تُعرض الوسائل المصرّح بها فقط ---------- */
    await setPolicy('property', point.property_id, { policy: 'MIXED', allowedMethods: ['cash'], reason: 'browser test' });
    page = await browser.newPage();
    await guestToCheckout(page, base, point.token);
    const methodsText = await page.textContent('.scrbody');
    assert(/نقدًا|Cash/.test(methodsText), '(4) الوسيلة المصرّح بها تظهر');
    assert(!/Apple Pay/.test(methodsText),
      '(4) **ووسيلة غير مصرّح بها لا تُعرض أصلًا** — لا يختار الضيف طريقًا سيُرفض');
    await page.screenshot({ path: shot('04-checkout-mixed-methods.png') });
    const chosen = await page.evaluate(() => S.payMethod);
    assertEqual(chosen, 'cash',
      '(4) **والاختيار المسبق يُصحَّح تلقائيًا** — بطاقة محفوظة من زيارة سابقة كانت ستفشل عند الإرسال');
    await page.close();
    await clearPolicy('property', point.property_id);

    /* ---------- 5) شاشة الإدارة: تعرض المصدر لا النتيجة وحدها ---------- */
    await setPolicy('partner', point.partner_id, { policy: 'NO_GUEST_PAYMENT', reason: 'browser test' });
    page = await browser.newPage();
    await page.goto(base + '/');
    await page.waitForTimeout(500);
    await page.evaluate(async () => {
      const r = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
      });
      const d = await r.json();
      S.session = d; S.mode = 'staff'; S.PARTNER_ID = S.PARTNER_ID || null;
    });
    // النقر على عنصر القائمة نفسه لا استدعاء الدالة: هذا يُثبت أن الشاشة
    // موصولة بالتنقّل فعلًا. (كشف هذا التحقق أن setStaffScreen هي المسار
    // الحقيقي، وأن استدعاء دالة أخرى كان سيمرّ باختبار أخضر وشاشة لا يصلها
    // المشغّل.)
    await page.evaluate(() => render());
    await page.waitForTimeout(400);
    await page.click('text=سياسة التحصيل');
    await page.waitForFunction(() => S.paymentPolicies !== null, { timeout: 15000 });
    await page.waitForTimeout(600);
    const adminText = await page.textContent('body');
    assert(/سياسة التحصيل|Payment Policy|لا تحصيل من الضيف|No guest payment/.test(adminText),
      '(5) **شاشة سياسة التحصيل تُرسم للمشغّل** — الإعداد موجود في الواجهة لا في الـAPI فقط');
    const showsSource = await page.evaluate(() => {
      const el = document.querySelector('body');
      return /المصدر|Source/.test(el.innerText);
    });
    assert(showsSource,
      '(5) **وتُظهر المستوى الذي فرض السياسة** — مشغّل يرى النتيجة بلا مصدرها يغيّر المستوى الخطأ ولا يتحرّك شيء');
    const hasInherit = await page.evaluate(() =>
      [...document.querySelectorAll('option')].some(o => /وراثة|Inherit/.test(o.textContent)));
    assert(hasInherit, '(5) وخيار العودة للوراثة معروض صراحة لا مخفيًا');
    // كشفته المراجعة البصرية: صفّ يقول «موروثة» بلا ذكر ما يرثه هو عين
    // العيب الذي بُنيت الشاشة لعلاجه، مستوًى أدنى.
    const inheritedShowsValue = await page.evaluate(() =>
      /موروثة: .+ من |Inherited: .+ from /.test(document.body.innerText));
    assert(inheritedShowsValue,
      '(5) **والصف الموروث يذكر قيمته الفعّالة ومصدرها** — «موروثة» وحدها لا تخبر المشغّل بشيء');
    await page.screenshot({ path: shot('05-admin-payment-policy.png'), fullPage: true });

    /* ---------- 6) شاشة الشركاء التجاريين: أزرار الحالة والسبب المُصرَّح ---------- */
    await page.click('text=الشركاء التجاريون');
    await page.waitForFunction(() => Object.keys(S.merchantStatuses || {}).length > 0, { timeout: 15000 });
    await page.waitForTimeout(500);
    const merchText = await page.textContent('body');
    assert(/إيقاف مؤقت|Set inactive/.test(merchText),
      '(6) **أزرار دورة الحياة تظهر للمشغّل** — الحالة كانت شارة للعرض فقط بلا أي إجراء');
    const merchantId = await page.evaluate(() => (S.merchants[0] || {}).id);
    await page.evaluate(async (id) => {
      await api('POST', `/api/admin/merchants/${id}/status`, { status: 'Inactive', reason: 'browser verification' }, true);
      await App.loadMerchants();
    }, merchantId);
    await page.waitForTimeout(700);
    const afterText = await page.textContent('body');
    assert(/موقوف مؤقتًا|Inactive/.test(afterText), '(6) والحالة الجديدة تُعرض بالعربية لا برمزها الخام');
    const blockedShown = await page.evaluate(() => {
      const st = Object.values(S.merchantStatuses).find(x => x && x.blockedTransitions.length);
      return st ? /Close blocked|الإغلاق محجوب/.test(document.body.innerText) : true;
    });
    assert(blockedShown,
      '(6) **وحين يُحجب الإغلاق يُعلَن السبب** — لا خيار يختفي بلا تفسير');
    await page.screenshot({ path: shot('06-merchant-lifecycle.png'), fullPage: true });
    await page.close();
    await clearPolicy('partner', point.partner_id);

  } finally {
    await browser.close();
    stopServer();
  }
  return summary();
}

module.exports = { run, awaiting };
if (require.main === module) run().then(ok => process.exit(ok ? 0 : 1));
