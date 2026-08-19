// tests/browser-activation-journey.js — P0-02 acceptance.
//
// اختبار متصفح إلزامي **لا يستدعي الـAPI مباشرة لأي خطوة من الرحلة**:
// إنشاء المستخدم من الشاشة -> قراءة رابط التفعيل من النافذة -> فتحه
// كمستخدم -> وضع كلمة المرور -> تسجيل الدخول -> التحقق من النطاق.
//
// السبب: كل اختبارات IAM السابقة (48 تأكيدًا) كانت على مستوى الـAPI، فمرّت
// جميعًا بينما الواجهة كانت ترمي رمز التفعيل -- ولم يكن أحد يستطيع تفعيل
// مستخدم من الإنتاج إطلاقًا. اختبار يتجاوز الواجهة لا يُثبت أن المشغّل
// يستطيع العمل.
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
const { startServer, stopServer, assert, assertEqual, summary, resetCounts, BASE } = require('./helpers.js');


/** يفتح شاشة دخول الموظفين بالنموذج الحقيقي.
    أدوات التطوير تستبدله بقائمة حسابات تجريبية لا وجود لها في الإنتاج،
    فتُعطَّل هنا: المقصود إثبات المسار الذي يسلكه مستخدم حقيقي. */
async function openRealLoginForm(page, base) {
  await page.addInitScript(() => { window.__ALNADL_NO_DEVTOOLS = true; });
  await page.goto(base + '/');
  await page.waitForTimeout(400);
  await page.evaluate(() => { try { delete window.AlnadlDevTools; } catch (e) { window.AlnadlDevTools = null; } });
  await page.click('text=دخول (staff)');
  await page.waitForTimeout(300);
  await page.evaluate(() => { try { delete window.AlnadlDevTools; } catch (e) { window.AlnadlDevTools = null; } render(); });
  await page.waitForSelector('#loginUsername', { timeout: 15000 });
}

async function loginThroughForm(page, base, username, password) {
  await openRealLoginForm(page, base);
  await page.fill('#loginUsername', username);
  await page.fill('#loginPassword', password);
  await page.click('.loginform button');
  await page.waitForTimeout(2500);
}

async function run() {
  resetCounts();
  if (!playwright) {
    console.log('=== P0-02 Browser Activation Journey: SKIPPED ===');
    console.log('  playwright is not installed. This suite drives the real UI and cannot be');
    console.log('  meaningfully replaced by API calls -- that substitution is exactly what');
    console.log('  hid this defect. To run it:  npm install && npx playwright install chromium');
    console.log('\n  0 passed, 0 failed (skipped)');
    return true;
  }
  const { chromium } = playwright;
  await startServer();
  console.log('=== P0-02: Activation journey through the REAL UI ===');

  let browser;
  try {
    browser = await chromium.launch();
    const admin = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errs = [];
    admin.on('pageerror', e => errs.push(e.message));

    // ---- 1) SuperAdmin يدخل ويفتح شاشة المستخدمين ----
    await admin.goto(BASE() + '/');
    await admin.waitForTimeout(400);
    await admin.click('text=دخول (staff)');
    await admin.waitForTimeout(300);
    await admin.click('.userchip:has(b:text-is("admin"))');
    await admin.waitForTimeout(1500);
    await admin.evaluate(() => App.setStaffScreen('users'));
    await admin.waitForTimeout(1200);

    // ---- 2) النص المضلِّل اختفى ----
    const usersText = await admin.locator('.bohwrap').textContent();
    assert(!/كلمة المرور = اسم المستخدم/.test(usersText),
      'P0-02 **نص «كلمة المرور = اسم المستخدم» لم يعد يظهر** في شاشة إنشاء المستخدم');
    assert(/رابط تفعيل|activation link/i.test(usersText),
      'P0-02 والشاشة تشرح أن الحساب يُنشأ بلا كلمة مرور مع رابط تفعيل');

    // ---- 3) إنشاء PartnerAdmin من الواجهة ----
    // الشريك الذي يُنشأ المستخدم داخله -- يُقرأ من سياق الشاشة نفسه
    const TARGET_PARTNER = await admin.evaluate(() => S.PARTNER_ID);
    assert(!!TARGET_PARTNER, 'setup: سياق الشريك محدد في شاشة المستخدمين');
    const uname = 'e2e_padmin_' + Date.now().toString(36);
    await admin.fill('#newUserName', uname);
    await admin.selectOption('#newUserRole', 'PartnerAdmin');
    await admin.click('button:has-text("إنشاء")');
    await admin.waitForTimeout(1800);

    // ---- 4) رابط التفعيل يظهر فعلًا للمشرف ----
    const linkInput = admin.locator('#actLink');
    assertEqual(await linkInput.count(), 1,
      'P0-02 **رابط التفعيل يُعرض للمشرف بعد الإنشاء** — كان يُولَّد ويُرمى');
    const activationUrl = await linkInput.inputValue();
    assert(/\/activate\.html\?token=.+/.test(activationUrl),
      `P0-02 والرابط يشير لصفحة التفعيل بالرمز (${activationUrl.slice(0, 48)}...)`);
    const handoffText = await admin.locator('.ordsheet').textContent();
    assert(/مرة واحدة|once/i.test(handoffText),
      'P0-02 والنافذة تُحذّر أنه يظهر مرة واحدة ولا يمكن استرجاعه');
    await admin.click('.ordsheet button:has-text("إغلاق")');
    await admin.waitForTimeout(600);

    // ---- 5) الحساب قبل التفعيل يُرفض ----
    // المسار البشري: نموذج الدخول الحقيقي، لا استدعاء fetch.
    const pre = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await loginThroughForm(pre, BASE(), uname, uname);   // السلوك القديم بالضبط
    assertEqual(await pre.locator('#loginUsername').count(), 1,
      'P0-02 **الدخول باسم المستخدم ككلمة مرور مرفوض من النموذج الحقيقي** — يبقى على شاشة الدخول');
    const preErr = await pre.locator('.errbox').count();
    assert(preErr > 0, 'P0-02 وتظهر رسالة خطأ للمستخدم');
    await pre.close();

    // ---- 6) المستخدم يفتح الرابط ويضع كلمة مروره ----
    const user = await browser.newPage({ viewport: { width: 420, height: 820 } });
    const userErrs = [];
    user.on('pageerror', e => userErrs.push(e.message));
    await user.goto(activationUrl);
    await user.waitForTimeout(1200);

    const pwField = user.locator('#pw');
    assertEqual(await pwField.count(), 1,
      'P0-02 **صفحة التفعيل تفتح وتعرض حقل كلمة المرور** — الحلقة التي كانت مفقودة');
    const actText = await user.locator('.actcard').textContent();
    assert(actText.includes(uname), 'P0-02 وتعرض اسم المستخدم المستهدف قبل التعيين');

    // كلمة مرور ضعيفة مرفوضة
    await user.fill('#pw', 'short');
    await user.fill('#pw2', 'short');
    await user.click('#go');
    await user.waitForTimeout(700);
    assertEqual(await user.locator('#pw').count(), 1, 'P0-02 وكلمة مرور قصيرة مرفوضة');

    // عدم التطابق مرفوض
    await user.fill('#pw', 'a-strong-password-1');
    await user.fill('#pw2', 'a-different-password-1');
    await user.click('#go');
    await user.waitForTimeout(700);
    const mismatchMsg = await user.locator('.actcard').textContent();
    assert(/غير متطابقتين|do not match/i.test(mismatchMsg), 'P0-02 وعدم التطابق مرفوض');

    // التفعيل الناجح
    const CHOSEN = 'e2e-user-chosen-pass-1';
    await user.fill('#pw', CHOSEN);
    await user.fill('#pw2', CHOSEN);
    await user.click('#go');
    await user.waitForTimeout(2000);
    const doneText = await user.locator('.actcard').textContent();
    assert(/تم تفعيل|is active/i.test(doneText),
      'P0-02 **التفعيل ينجح من واجهة المستخدم**');

    // ---- 7) الدخول من النموذج الحقيقي حتى لوحة الدور ----
    // لا fetch: المسار البشري كاملًا -- نموذج الدخول ثم الشريط الجانبي.
    const loginPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const loginErrs = [];
    loginPage.on('pageerror', e => loginErrs.push(e.message));
    await loginThroughForm(loginPage, BASE(), uname, CHOSEN);

    assertEqual(await loginPage.locator('#loginUsername').count(), 0,
      'P0-02 **الدخول ينجح من النموذج الحقيقي** — شاشة الدخول اختفت');

    // لوحة الدور نفسها تُثبت الدور والنطاق، لا استجابة API
    const scopeText = await loginPage.locator('.sidebar-scope').textContent().catch(() => '');
    assert(scopeText.includes(uname),
      `P0-02 **ولوحة الدور تعرض المستخدم الصحيح** (${scopeText.trim().slice(0, 60)})`);
    assert(/PartnerAdmin/.test(scopeText),
      'P0-02 **والدور المعروض في اللوحة هو PartnerAdmin** — لا مجرد 200');

    // نطاق الشريك: يُثبَت بأن اللوحة تعرض بيانات شريكه هو
    const partnerScope = await loginPage.evaluate(() => ({
      role: S.session && S.session.user && S.session.user.role,
      scope: S.session && S.session.user && S.session.user.scope,
      partnerId: S.PARTNER_ID,
    }));
    assertEqual(partnerScope.role, 'PartnerAdmin', 'P0-02 والدور في الجلسة PartnerAdmin');
    assertEqual(partnerScope.scope, TARGET_PARTNER,
      `P0-02 **ونطاقه هو الشريك الذي أُنشئ داخله بالضبط** (${partnerScope.scope})`);

    // وعمليًا: يرى مستخدمي شريكه ولا يرى غيره
    await loginPage.evaluate(() => App.setStaffScreen('users'));
    await loginPage.waitForTimeout(1500);
    const visibleUsers = await loginPage.evaluate(() =>
      (S.users || []).map(u => u.partner_scope));
    assert(visibleUsers.length > 0, 'P0-02 ويصل فعليًا لشاشة مستخدمي شريكه');
    assert(visibleUsers.every(sc => sc === TARGET_PARTNER || sc == null),
      'P0-02 **ولا يرى مستخدمًا من شريك آخر** — العزل مُثبَت من اللوحة لا من الـAPI');
    assertEqual(loginErrs.length, 0, `P0-02 وصفر أخطاء في صفحة الدخول (${loginErrs.join('; ')})`);

    // ---- 8) الرمز لا يُعاد استخدامه ----
    const replay = await browser.newPage();
    await replay.goto(activationUrl);
    await replay.waitForTimeout(1200);
    const replayText = await replay.locator('.actcard').textContent();
    assert(/غير صالح|invalid/i.test(replayText),
      'P0-02 **ورمز التفعيل بعد استخدامه لا يُعاد استخدامه**');
    assertEqual(await replay.locator('#pw').count(), 0, 'P0-02 ولا يُعرض حقل كلمة مرور');
    await replay.close();

    // ---- 9) نفس الرحلة لـSiteManager ----
    await admin.evaluate(() => App.setStaffScreen('users'));
    await admin.waitForTimeout(1000);
    const smName = 'e2e_sitemgr_' + Date.now().toString(36);
    await admin.fill('#newUserName', smName);
    await admin.selectOption('#newUserRole', 'SiteManager');
    await admin.click('button:has-text("إنشاء")');
    await admin.waitForTimeout(1800);
    const smUrl = await admin.locator('#actLink').inputValue();
    await admin.click('.ordsheet button:has-text("إغلاق")');

    const smPage = await browser.newPage();
    await smPage.goto(smUrl);
    await smPage.waitForTimeout(1000);
    const SM_PASS = 'e2e-sitemgr-pass-1';
    await smPage.fill('#pw', SM_PASS);
    await smPage.fill('#pw2', SM_PASS);
    await smPage.click('#go');
    await smPage.waitForTimeout(1800);
    await smPage.close();

    // الدخول من النموذج الحقيقي حتى لوحة SiteManager
    const smLogin = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await loginThroughForm(smLogin, BASE(), smName, SM_PASS);
    assertEqual(await smLogin.locator('#loginUsername').count(), 0,
      'P0-02 **ونفس الرحلة تعمل لـSiteManager من النموذج الحقيقي**');
    // أدوار التشغيل تستخدم غلافًا مختلفًا عن الإداري: .sidebar-scope خاص
    // بالأخير. التصحيح لافتراضي في الاختبار لا للمنتج -- الدور يُثبَت من
    // الشريط العلوي ومن شاشة الهبوط التشغيلية أدناه.
    const smTop = await smLogin.locator('.topbar, .brand').first().textContent().catch(() => '');
    const smBody = await smLogin.locator('body').textContent().catch(() => '');
    assert(/SiteManager/.test(smTop + smBody),
      'P0-02 ولوحته تعرض دوره SiteManager');
    const smSession = await smLogin.evaluate(() => ({
      role: S.session && S.session.user && S.session.user.role,
      scope: S.session && S.session.user && S.session.user.scope,
      screen: S.screen,
    }));
    assertEqual(smSession.role, 'SiteManager', 'P0-02 والدور في الجلسة SiteManager');
    assertEqual(smSession.scope, TARGET_PARTNER,
      `P0-02 **ونطاقه هو الشريك المطلوب** (${smSession.scope})`);
    assert(['live', 'kds', 'exceptions'].includes(smSession.screen),
      `P0-02 **ويهبط على شاشة دوره التشغيلية** (${smSession.screen})`);
    await smLogin.close();

    // ---- 10) إعادة إصدار رابط من الشاشة ----
    await admin.evaluate(() => App.setStaffScreen('users'));
    await admin.waitForTimeout(1200);
    const reissueBtn = admin.locator('button:has-text("رابط تفعيل")').first();
    assert(await reissueBtn.count() > 0,
      'P0-02 **وزر إعادة إصدار رابط التفعيل متاح لكل مستخدم** — مسار استعادة الوصول');

    assertEqual(errs.length, 0, `P0-02 صفر أخطاء صفحة في واجهة المشرف (${errs.join('; ')})`);
    assertEqual(userErrs.length, 0, `P0-02 وصفر أخطاء في صفحة التفعيل (${userErrs.join('; ')})`);

  } finally {
    if (browser) await browser.close();
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
