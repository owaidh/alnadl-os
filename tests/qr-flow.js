// tests/qr-flow.js — P0-01.
//
// تصنيف صريح: ما يمكن التحقق منه محليًا يُختبَر ويُحسب، وما يحتاج
// qrcode@1.5.3 لا يُحسب PASS ولا SKIPPED -- بل يُبلَّغ كـ
// AWAITING DEPENDENCY ENVIRONMENT VERIFICATION، لئلا يُوحي رقم أخضر
// بأن QR تُحقّق منه وهو لم يُولَّد أصلًا.
'use strict';
const { startServer, stopServer, api, assert, assertEqual, summary, resetCounts, getDataPath, BASE } = require('./helpers.js');

function openDb() {
  process.env.SQLITE_PATH = getDataPath();
  for (const m of ['../db.js', '../lib/qr.js']) {
    try { delete require.cache[require.resolve(m)]; } catch (e) {}
  }
  return require('../db.js');
}
async function makeUser(SA, username, role, scope) {
  const c = await api('POST', '/api/admin/users', { username, role, partner_scope: scope || null }, SA);
  await api('POST', `/api/activate/${c.data.activationToken}`, { password: `${username}-strong-pass-1` });
  return (await api('POST', '/api/auth/login', { username, password: `${username}-strong-pass-1` })).data.token;
}
async function raw(path, token) {
  const res = await fetch(BASE() + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, type: res.headers.get('content-type') || '', body: await res.text() };
}

const AWAITING = [];
function awaiting(what, why) { AWAITING.push({ what, why }); }

async function run() {
  resetCounts();
  await startServer();
  console.log('=== P0-01: Guest QR flow ===');

  try {
    const { db } = openDb();
    const qrLib = require('../lib/qr.js');
    const SA = (await api('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).data.token;
    const PA = await makeUser(SA, 'qr_padmin', 'PartnerAdmin', 'pt_nova');
    const SM = await makeUser(SA, 'qr_sitemgr', 'SiteManager', 'pt_nova');
    const OP = await makeUser(SA, 'qr_operator', 'Operator', 'pt_nova');

    // ================= بناء رابط الضيف — المصدر الوحيد =================
    const prevBase = process.env.PUBLIC_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    assertEqual(qrLib.buildGuestUrl('abc123def456'), '/?t=abc123def456',
      'الرابط النسبي يُبنى بالشكل الذي تفهمه واجهة الضيف');
    assertEqual(qrLib.buildGuestUrl('abc123def456', { absolute: true }), '/?t=abc123def456',
      '**وبلا PUBLIC_BASE_URL يبقى نسبيًا** — لا يُخمَّن مضيف، فالرمز المطبوع يعيش أشهرًا');

    process.env.PUBLIC_BASE_URL = 'https://order.example.com';
    assertEqual(qrLib.buildGuestUrl('abc123def456', { absolute: true }), 'https://order.example.com/?t=abc123def456',
      'ومع أصل مضبوط يصبح مطلقًا وصالحًا للطباعة');

    // أصل ملوّث لا يُقبل
    for (const badBase of ['https://evil.com/path', 'https://evil.com/?x=1', 'javascript:alert(1)', 'not-a-url']) {
      process.env.PUBLIC_BASE_URL = badBase;
      assertEqual(qrLib.buildGuestUrl('abc123def456', { absolute: true }), '/?t=abc123def456',
        `**أصل غير صالح يسقط للنسبي الآمن** بدل بناء رابط مشبوه: ${badBase.slice(0, 26)}`);
    }
    if (prevBase === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = prevBase;

    // حقن عبر الرمز مرفوض
    for (const bad of ['../../etc/passwd', 'a b', 'tok"quote', "tok'quote", 'javascript:alert(1)',
                       'x', 'tok<script>', 'a'.repeat(200), '', 'tok&next=https://evil.com']) {
      let refused = false;
      try { qrLib.buildGuestUrl(bad); } catch (e) { refused = e.status === 400; }
      assert(refused, `**رمز غير صالح مرفوض قبل بناء أي رابط**: ${JSON.stringify(bad).slice(0, 30)}`);
    }

    // ================= النقطة والرابط =================
    const zid = db.prepare(`SELECT id FROM zones WHERE property_id='prop_nova_main' LIMIT 1`).get().id;
    const pt = await api('POST', '/api/admin/points', { zoneId: zid, label: 'QR-1', type: 'Table' }, SA);
    const PID = pt.data.id;

    const info = await api('GET', `/api/admin/points/${PID}/qr`, null, SA);
    assertEqual(info.status, 200, 'نقطة QR تُرجع سياق النقطة');
    assertEqual(info.data.pointId, PID, 'بمُعرّف النقطة الصحيح');
    assert(/\/\?t=/.test(info.data.guestUrl), 'ورابط ضيف صالح');
    assert(info.data.guestUrl.includes(pt.data.token),
      '**والرابط يحمل رمز النقطة نفسه** — لا رمزًا آخر ولا مسارًا موازيًا');
    assertEqual(info.data.partnerId, 'pt_nova', 'وسياق الشريك الصحيح');
    assert(info.data.zone && info.data.zone.id === zid, 'والمنطقة الصحيحة');

    // الرابط الذي يعرضه الخادم هو الذي يفتح رحلة الضيف فعلًا
    const guestPath = info.data.guestUrl.replace(/^https?:\/\/[^/]+/, '');
    const tokenFromUrl = new URLSearchParams(guestPath.split('?')[1]).get('t');
    const resolved = await api('GET', `/api/qr/${tokenFromUrl}`);
    assertEqual(resolved.status, 200,
      '**الرابط المعروض يفتح رحلة الضيف فعليًا** — مسار واحد لا اثنان');
    assertEqual(resolved.data.point.id, PID, 'ويصل لنفس النقطة');
    assertEqual(resolved.data.partner.id, 'pt_nova', 'ونفس الشريك');
    assert(!!resolved.data.branding, 'ومعه الهوية المحلولة');

    // ================= نقطة موقوفة =================
    await api('PATCH', `/api/admin/points/${PID}`, { active: false }, SA);
    const disabled = await api('GET', `/api/qr/${tokenFromUrl}`);
    assert(disabled.status >= 400,
      `**نقطة موقوفة لا تفتح رحلة الضيف** (${disabled.status})`);
    const disabledInfo = await api('GET', `/api/admin/points/${PID}/qr`, null, SA);
    assertEqual(disabledInfo.data.active, false, 'والإدارة تعرف أنها موقوفة فتُنبّه المشغّل');
    await api('PATCH', `/api/admin/points/${PID}`, { active: true }, SA);
    assertEqual((await api('GET', `/api/qr/${tokenFromUrl}`)).status, 200, 'وإعادة التفعيل تُعيدها للعمل');

    // ================= رمز غير صالح =================
    for (const bogus of ['not-a-real-token', 'aaaaaaaaaaaa', '0'.repeat(24)]) {
      const r = await api('GET', `/api/qr/${bogus}`);
      assertEqual(r.status, 404, `**رمز غير صالح يُرفض**: ${bogus.slice(0, 16)}`);
    }

    // ================= RBAC وعزل المستأجر =================
    assertEqual((await api('GET', `/api/admin/points/${PID}/qr`, null, PA)).status, 200, 'PartnerAdmin يصل لرمز نقطته');
    assertEqual((await api('GET', `/api/admin/points/${PID}/qr`, null, SM)).status, 200, 'وSiteManager كذلك');
    assertEqual((await api('GET', `/api/admin/points/${PID}/qr`, null, OP)).status, 403, '**وOperator لا يصل**');
    assertEqual((await api('GET', `/api/admin/points/${PID}/qr`)).status, 401, 'ولا مجهول');

    const otherZone = db.prepare(`SELECT id FROM zones WHERE property_id != 'prop_nova_main' LIMIT 1`).get();
    if (otherZone) {
      const otherPt = await api('POST', '/api/admin/points', { zoneId: otherZone.id, label: 'X-1', type: 'Table' }, SA);
      assertEqual((await api('GET', `/api/admin/points/${otherPt.data.id}/qr`, null, PA)).status, 403,
        '**وPartnerAdmin لا يصل لرمز نقطة شريك آخر**');
    }
    assertEqual((await api('GET', '/api/admin/points/PT-NOPE/qr', null, SA)).status, 404, 'ونقطة غير موجودة تُرجع 404');

    // ================= عقد الصور =================
    const badFmt = await raw(`/api/admin/points/${PID}/qr?format=gif`, SA);
    assertEqual(badFmt.status, 400, 'صيغة غير مدعومة مرفوضة');

    const svg = await raw(`/api/admin/points/${PID}/qr?format=svg`, SA);
    if (qrLib.isAvailable()) {
      assertEqual(svg.status, 200, 'SVG يُولَّد');
      assert(/image\/svg/.test(svg.type), 'بنوع محتوى صحيح');
      assert(/<svg/.test(svg.body), 'ومحتوى SVG فعلي');
      const png = await raw(`/api/admin/points/${PID}/qr?format=png&download=1`, SA);
      assertEqual(png.status, 200, 'وPNG يُولَّد للتنزيل');
    } else {
      assertEqual(svg.status, 503,
        '**غياب الاعتماد يُبلَّغ بـ503 صريح** لا 500 غامض — المشغّل يعرف ما ينقص');
      assert(/qrcode@1\.5\.3/.test(svg.body), 'والرسالة تُسمّي الاعتماد وإصداره');
      awaiting('SVG/PNG rendering', 'qrcode@1.5.3 not installable in this environment (npm 403)');
      awaiting('Downloaded/printed QR re-scan', 'requires a rendered image');
      awaiting('iPhone/Android camera scan', 'requires a rendered image and a physical device');
    }

    // ================= الصورة لا تُخزَّن =================
    const stored = db.prepare(`SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name LIKE '%qr_image%'`).get().c;
    assertEqual(stored, 0,
      '**لا جدول لصور QR** — تُشتق حتميًا من الرابط، فلا نسخة ثانية تتقادم بصمت');

  } finally {
    stopServer();
  }

  const ok = summary();
  if (AWAITING.length) {
    console.log('\n  AWAITING DEPENDENCY ENVIRONMENT VERIFICATION:');
    for (const a of AWAITING) console.log(`    - ${a.what}  (${a.why})`);
    console.log('    These are NOT counted as passing. QR image generation is unverified');
    console.log('    until qrcode@1.5.3 is installed in the build/deploy environment.');
  }
  return ok;
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
