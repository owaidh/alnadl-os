#!/usr/bin/env node
/**
 * scripts/diagnose-superadmin.js
 *
 * شغّله على البيئة المرفوعة نفسها لتحديد السبب الجذري بدقة:
 *   node scripts/diagnose-superadmin.js https://your-host  <user>  <pass>
 *
 * يفحص كل نقطة تستدعيها شاشة "الشركاء والباقات" على حدة -- لأن الواجهة
 * تستدعيها داخل Promise.all، فأي فشل واحد يظهر كرسالة واحدة مبهمة.
 * هذا السكربت يكشف أيّها بالضبط، وبأي رمز حالة، وبأي جسم استجابة.
 */
'use strict';

const BASE = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '');
const USER = process.argv[3];
const PASS = process.argv[4];

// نفس الترتيب الذي تستدعيه به loadForRole() لدور SuperAdmin
const ENDPOINTS = [
  ['GET', '/api/admin/zones',      true],
  ['GET', '/api/admin/points',     true],
  ['GET', '/api/admin/categories', true],
  ['GET', '/api/admin/products',   true],
  ['GET', '/api/admin/partners',   true],
  ['GET', '/api/plans',            false],
  ['GET', '/api/admin/plans',      true],  // أُضيفت في v2.8.0 -- غيابها دليل على نسخة أقدم
];

async function main() {
  console.log('=== تشخيص شاشة SuperAdmin ===');
  console.log('الهدف:', BASE);

  // 1) هل الخادم حيّ ومستعد؟
  for (const p of ['/health', '/ready']) {
    try {
      const r = await fetch(BASE + p);
      const body = await r.text();
      console.log(`${p}: ${r.status} ${body.slice(0, 120)}`);
      if (p === '/health' && r.status === 404) {
        console.log('  ⚠️  /health غير موجود ⇒ النسخة المرفوعة أقدم من v2.8.0');
      }
    } catch (e) {
      console.log(`${p}: تعذّر الوصول -- ${e.message}`);
    }
  }

  if (!USER || !PASS) {
    console.log('\n(مرّر اسم المستخدم وكلمة المرور لفحص النقاط المحمية)');
    return;
  }

  // 2) تسجيل الدخول
  let token = null;
  try {
    const r = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { console.log(`\n❌ فشل الدخول: ${r.status} ${JSON.stringify(data)}`); return; }
    token = data.token;
    console.log(`\n✅ الدخول ناجح -- الدور: ${data.user && data.user.role}`);
  } catch (e) {
    console.log(`\n❌ تعذّر الدخول: ${e.message}`); return;
  }

  // 3) كل نقطة على حدة -- هذا هو بيت القصيد
  console.log('\n=== النقاط، واحدة واحدة ===');
  const failures = [];
  for (const [method, path, needsAuth] of ENDPOINTS) {
    try {
      const r = await fetch(BASE + path, {
        method, headers: needsAuth ? { Authorization: `Bearer ${token}` } : {},
      });
      const text = await r.text();
      const reqId = r.headers.get('x-request-id') || '-';
      const mark = r.ok ? '✅' : '❌';
      console.log(`${mark} ${r.status}  ${path}`);
      console.log(`      request-id: ${reqId}`);
      console.log(`      body: ${text.slice(0, 200)}`);
      if (!r.ok) failures.push({ path, status: r.status, reqId, body: text.slice(0, 300) });
    } catch (e) {
      console.log(`❌ EXCEPTION  ${path} -- ${e.message}`);
      failures.push({ path, status: 'exception', body: e.message });
    }
  }

  // 4) الخلاصة
  console.log('\n=== الخلاصة ===');
  if (!failures.length) {
    console.log('كل النقاط ترجع 2xx. إن كان "Server error" ما زال يظهر في المتصفح،');
    console.log('فالسبب على الأرجح في الواجهة أو في وسيط/وكيل أمام الخادم -- افتح');
    console.log('تبويب Network في المتصفح وسجّل الطلب الفاشل ورمز حالته.');
  } else {
    console.log(`فشلت ${failures.length} نقطة:`);
    for (const f of failures) console.log(`  - ${f.path} → ${f.status}`);
    console.log('\nالخطوة التالية: ابحث في سجل الخادم عن السطر المُهيكَل الذي يحمل');
    console.log('الخطأ الحقيقي (الواجهة تُخفيه عمدًا لأسباب أمنية):');
    console.log('\n    grep request_failed <server-log> | tail -20');
    console.log('\nأو بمعرّف الطلب مباشرة:');
    for (const f of failures) if (f.reqId && f.reqId !== '-') console.log(`    grep ${f.reqId} <server-log>`);
    console.log('\nالسطر يحتوي: route · method · status · error -- وهو السبب الجذري.');
  }
}

main().catch(e => { console.error('فشل التشخيص:', e.message); process.exit(1); });
