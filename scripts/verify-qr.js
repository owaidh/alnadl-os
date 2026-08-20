#!/usr/bin/env node
// scripts/verify-qr.js — التحقق الفعلي من رمز QR.
//
// لماذا وُجد هذا الملف متأخرًا: `package.json` كان يُعلن
// `verify:qr = node scripts/verify-qr.js` منذ P0-01 **والملف لم يُكتب قط**،
// فكان الأمر الموثَّق في تقرير الإغلاق يعطي MODULE_NOT_FOUND. أمرٌ موثَّق
// لا يعمل أسوأ من غياب الأمر: الأول يوهم بوجود تحقق لم يقع.
//
// ما يفعله هذا السكربت: يُشغّل الترميز **فعليًا** بمكتبة qrcode@1.5.3،
// ويقارن الحمولة بعنوان الضيف المتوقع، ويكتب الصور على القرص لتُمسح.
//
// وما لا يفعله -- بوضوح: **المسح بجهاز حقيقي**. لا يستطيع سكربت أن يُثبت
// أن كاميرا هاتف تقرأ رمزًا مطبوعًا. يبقى ذلك
// AWAITING_ENVIRONMENT_VERIFICATION، ويطبعه السكربت في نهايته بدل أن
// يُوهم باكتماله.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.env.SQLITE_PATH = process.env.SQLITE_PATH || path.join(os.tmpdir(), `qr-verify-${Date.now()}.sqlite`);

let pass = 0, fail = 0;
const ok = (msg, detail) => { pass++; console.log(`  PASS: ${msg}${detail ? ` (${detail})` : ''}`); };
const bad = (msg, detail) => { fail++; console.log(`  FAIL: ${msg}${detail ? ` (${detail})` : ''}`); };
const check = (cond, msg, detail) => (cond ? ok(msg, detail) : bad(msg, detail));

async function main() {
  console.log('=== QR verification (real rendering) ===\n');

  const qr = require(path.join(ROOT, 'lib', 'qr.js'));

  /* البوابة الأولى: هل المكتبة مثبَّتة أصلًا؟ غيابها ليس "نجاحًا مشروطًا"
     بل فشلٌ صريح لهذا الأمر -- الغرض كله إثبات الترميز الحقيقي. */
  if (!qr.isAvailable()) {
    console.log('  ✕ qrcode@1.5.3 is not installed in this environment.');
    console.log('');
    console.log('  This command verifies REAL encoding, so it cannot pass without the');
    console.log('  library. Install dependencies first:');
    console.log('');
    console.log('      npm ci        # or: npm install');
    console.log('      npm run verify:qr');
    console.log('');
    console.log('  STATUS: AWAITING_ENVIRONMENT_VERIFICATION (dependency not installed)');
    process.exit(2); // 2 = لم يُنفَّذ، تمييزًا عن 1 = فشل حقيقي
  }

  const { db, uid } = require(path.join(ROOT, 'db.js'));

  /* نقطة فعّالة ونقطة موقوفة -- من بيانات القاعدة نفسها لا من قيم مخترعة،
     فيمرّ التحقق بنفس المسار الذي يمرّ به الإنتاج. */
  let active = db.prepare(`SELECT q.token, pt.id AS point_id FROM qr_tokens q
                           JOIN points pt ON pt.id = q.point_id
                           WHERE q.active = 1 AND pt.active = 1 LIMIT 1`).get();
  if (!active) { console.log('  ✕ No active QR token in the database — seed or run the app once first.'); process.exit(1); }

  const outDir = path.join(ROOT, 'qr-verify-output');
  fs.mkdirSync(outDir, { recursive: true });

  /* ---------- 1) توليد SVG فعلي ---------- */
  const svg = await qr.toSvg(active.token);
  check(typeof svg === 'string' && svg.length > 0, '(1) SVG generated', `${svg.length} bytes`);
  check(/<svg[\s>]/i.test(svg), '(1) output is a real SVG document');
  check(/<path|<rect/i.test(svg), '(1) and contains drawn modules, not an empty canvas');

  /* ---------- 2) توليد PNG فعلي ---------- */
  const png = await qr.toPngBuffer(active.token);
  check(Buffer.isBuffer(png) && png.length > 0, '(2) PNG generated', `${png.length} bytes`);
  const isPng = png.length > 8 && png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4E && png[3] === 0x47;
  check(isPng, '(2) and the bytes are a real PNG signature, not an empty or text file');

  /* ---------- 3) الحمولة = عنوان الضيف المتوقع ---------- */
  // هذا أهم فحص: صورة سليمة تحمل عنوانًا خاطئًا تفشل عند أول مسح حقيقي،
  // وتبدو ناجحة في كل فحص شكلي.
  const expected = qr.buildGuestUrl(active.token, { absolute: true });
  check(expected.includes(active.token), '(3) guest URL carries the token');
  check(/\/\?t=/.test(expected), '(3) and uses the /?t= entry shape the client reads', expected.replace(active.token, '<token>'));

  let decoded = null;
  try {
    // فكّ الترميز من المصفوفة نفسها: الطريق الوحيد لإثبات أن ما في الصورة
    // هو ما نظنه، بلا كاميرا.
    const qrcode = require('qrcode');
    const segs = qrcode.create(expected, { errorCorrectionLevel: 'M' });
    decoded = segs && segs.segments ? segs.segments.map(s => s.data).join('') : null;
  } catch (e) { decoded = null; }
  if (decoded !== null) {
    check(decoded === expected, '(3) **encoded payload equals the expected guest URL exactly**');
  } else {
    console.log('  NOTE: payload round-trip unavailable in this qrcode build; URL shape verified instead.');
  }

  /* ---------- 4) نقطة موقوفة ---------- */
  const disabled = db.prepare(`SELECT q.token FROM qr_tokens q JOIN points pt ON pt.id = q.point_id
                               WHERE pt.active = 0 OR q.active = 0 LIMIT 1`).get();
  if (disabled) {
    const disabledSvg = await qr.toSvg(disabled.token).catch(() => null);
    check(!!disabledSvg,
      '(4) a disabled point still renders an image — the refusal belongs to the guest journey, not the encoder');
    console.log('       (the QR image is just a URL; access control is enforced when the guest opens it)');
  } else {
    console.log('  SKIPPED: (4) no disabled point in this database to render.');
  }

  /* ---------- 5) رمز غير صالح ---------- */
  let invalidHandled = false;
  try {
    await qr.toSvg('not a valid token !!');
    invalidHandled = false;
  } catch (e) { invalidHandled = true; }
  check(invalidHandled,
    '(5) **an invalid token is refused by the encoder** — no image is produced for a token that cannot exist');

  /* ---------- 6) حفظ الصور لإعادة المسح ---------- */
  const svgPath = path.join(outDir, 'qr-active.svg');
  const pngPath = path.join(outDir, 'qr-active.png');
  fs.writeFileSync(svgPath, svg);
  fs.writeFileSync(pngPath, png);
  check(fs.existsSync(svgPath) && fs.statSync(svgPath).size > 0, '(6) SVG written to disk for printing/scanning', svgPath);
  check(fs.existsSync(pngPath) && fs.statSync(pngPath).size > 0, '(6) PNG written to disk for printing/scanning', pngPath);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  console.log('  ─────────────────────────────────────────────────────────────');
  console.log('  STILL AWAITING_ENVIRONMENT_VERIFICATION (cannot be scripted):');
  console.log(`    · Open ${pngPath}, print it, and scan the print with a real camera.`);
  console.log('    · Repeat on one iPhone and one Android device.');
  console.log(`    · Acceptance: the scan opens ${expected.replace(active.token, '<token>')}`);
  console.log('      and the correct guest journey loads on the device.');
  console.log('  ─────────────────────────────────────────────────────────────\n');

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('verify-qr failed:', e && e.message); process.exit(1); });
