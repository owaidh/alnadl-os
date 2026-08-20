// tests/brand-media.js — Scope 2: White Label Brand Media & Commercial Outlet Identity.
//
// ترتيب الوراثة المعتمد -- يُثبَّت هنا نصًّا لا في تعليق فقط، فأي تغيير
// مستقبلي يقلبه يُسقط اختبارًا باسمه:
//
//   Outlet Override → Commercial Partner Brand → Property → Partner → ALNADL Default
//
// وقاعدة حاكمة فوقه: إن كانت الهوية البيضاء غير مفعّلة للشريك **المضيف**،
// فالنتيجة ALNADL افتراضيًا **دائمًا** مهما كانت بيانات الشريك التجاري أو
// العقار أو المنفذ. البوابة واحدة لأن العلاقة التجارية مع النادل واحدة.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { startServer, stopServer, api, assert, assertEqual, summary, resetCounts, BASE, getDataPath } = require('./helpers.js');

function openDb() {
  process.env.SQLITE_PATH = getDataPath();
  for (const m of ['../db.js', '../lib/branding.js', '../lib/brand-media.js', '../lib/storage.js']) {
    try { delete require.cache[require.resolve(m)]; } catch (e) {}
  }
  return require('../db.js');
}

/* مولّد PNG صالح فعلًا -- لا بايتات عشوائية. الفرق مهم: الاختبار يجب أن
   يمرّ بنفس كاشف النوع الذي يواجه ملفًا حقيقيًا، وإلا لأثبت أن الرفض يعمل
   ولم يُثبت أن القبول يعمل. */
function makePng(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.alloc(width * 3 + 1);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return c ^ 0xFFFFFFFF;
}

/** رفع multipart حقيقي عبر HTTP -- لا استدعاء مباشر للمكتبة. المسار الذي
    يواجه المستخدم هو المسار الذي يُختبر. */
async function upload(scopeType, scopeId, assetType, buffer, token, filename) {
  const boundary = '----alnadltest' + Math.random().toString(36).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="assetType"\r\n\r\n${assetType}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename || 'x.png'}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`, 'utf8');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([head, buffer, tail]);
  const http = require('http');
  const base = new URL(BASE());
  return new Promise((resolve) => {
    const req = http.request({
      host: base.hostname, port: base.port, method: 'POST',
      path: `/api/admin/brand-assets/${scopeType}/${scopeId}`,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
    }, (res) => {
      let b = ''; res.on('data', d => b += d);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(b) }); } catch (e) { resolve({ status: res.statusCode, data: {} }); } });
    });
    req.on('error', () => resolve({ status: 0, data: {} }));
    req.end(body);
  });
}

async function run() {
  resetCounts();
  await startServer();
  console.log('=== Scope 2: brand media, inheritance and commercial outlet identity ===');

  try {
    const { db, uid } = openDb();
    const branding = require('../lib/branding.js');
    const SA = (await api('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).data.token;

    /* ---------- مستأجران كاملان ---------- */
    const platformPlan = uid('plan');
    db.prepare(`INSERT INTO plans (id,code,name_ar,name_en,monthly_fee,tech_fee_rate,features_json) VALUES (?,?,?,?,?,?,?)`)
      .run(platformPlan, 'S2PLAT', 'منصة', 'Platform', 0, 0.02,
        JSON.stringify({ qrOrdering: true, multiOutlet: true, unifiedCart: true, marketplace: true, whiteLabel: true, multiProperty: true }));
    const basicPlan = uid('plan');
    db.prepare(`INSERT INTO plans (id,code,name_ar,name_en,monthly_fee,tech_fee_rate,features_json) VALUES (?,?,?,?,?,?,?)`)
      .run(basicPlan, 'S2BASIC', 'أساسية', 'Basic', 0, 0.02,
        JSON.stringify({ qrOrdering: true, multiOutlet: true, whiteLabel: false }));

    function mkTenant(label, planId, mode) {
      const pid = uid('pt');
      db.prepare(`INSERT INTO partners (id,name_ar,name_en,legal_name,contract_ref,status) VALUES (?,?,?,?,?,'Active')`)
        .run(pid, label, label, label, 'C-' + label);
      db.prepare(`INSERT INTO subscriptions (id,partner_id,plan_id,status,started_at,renews_at) VALUES (?,?,?,'Active',?,?)`)
        .run(uid('sub'), pid, planId, Date.now(), Date.now() + 2592000000);
      db.prepare(`INSERT INTO partner_branding (partner_id,mode,logo_text,primary_color,show_powered_by,updated_at) VALUES (?,?,?,?,?,?)`)
        .run(pid, mode, label + ' Brand', '#123456', 1, Date.now());
      const propId = uid('prop');
      db.prepare(`INSERT INTO properties (id,partner_id,name_ar,name_en,timezone,address,status) VALUES (?,?,?,?,?,?,'Active')`)
        .run(propId, pid, label + ' P', label + ' P', 'Asia/Riyadh', 'Riyadh');
      const zoneId = uid('zn');
      db.prepare(`INSERT INTO zones (id,property_id,name_ar,name_en,type,status) VALUES (?,?,?,?,'hall','Active')`)
        .run(zoneId, propId, label + ' Z', label + ' Z');
      const pointId = uid('pnt');
      db.prepare(`INSERT INTO points (id,zone_id,code,label,type,active) VALUES (?,?,?,?,'table',1)`)
        .run(pointId, zoneId, label + '-01', label + '-01');
      const token = uid('tok');
      db.prepare(`INSERT INTO qr_tokens (id,point_id,token,active,created_at) VALUES (?,?,?,1,?)`)
        .run(uid('qt'), pointId, token, Date.now());
      // شريك تجاري مستقل + منفذ يتبعه، ومنفذ آخر يديره المضيف
      const merId = uid('mer');
      db.prepare(`INSERT INTO merchants (id,property_id,name_ar,name_en,kind,commission_rate,status) VALUES (?,?,?,?,'partner',0.12,'Active')`)
        .run(merId, propId, label + ' Commercial', label + ' Commercial');
      const outCommercial = uid('out');
      db.prepare(`INSERT INTO outlets (id,property_id,name_ar,name_en,type,operator,delivery_mode,sla_prep_min,sla_delivery_min,commission_rate,merchant_id,status,created_at)
                  VALUES (?,?,?,?,'coffee','third_party','runner',8,10,0.12,?,'Active',?)`)
        .run(outCommercial, propId, label + ' CommercialOutlet', label + ' CommercialOutlet', merId, Date.now());
      const outHost = uid('out');
      db.prepare(`INSERT INTO outlets (id,property_id,name_ar,name_en,type,operator,delivery_mode,sla_prep_min,sla_delivery_min,commission_rate,status,created_at)
                  VALUES (?,?,?,?,'restaurant','alnadl','runner',8,10,0.1,'Active',?)`)
        .run(outHost, propId, label + ' HostOutlet', label + ' HostOutlet', Date.now());
      return { pid, propId, zoneId, pointId, token, merId, outCommercial, outHost };
    }

    const A = mkTenant('S2A', platformPlan, 'full_white_label');   // مُهوَّى
    const B = mkTenant('S2B', platformPlan, 'full_white_label');   // مستأجر آخر
    const C = mkTenant('S2C', basicPlan, 'full_white_label');      // بلا استحقاق
    const D = mkTenant('S2D', platformPlan, 'alnadl');             // استحقاق لكن mode=alnadl

    const PA = await (async () => {
      await api('POST', '/api/admin/users', { username: 's2_padmin', role: 'PartnerAdmin', partner_scope: A.pid }, SA);
      const c = await api('POST', '/api/admin/users', { username: 's2_padmin2', role: 'PartnerAdmin', partner_scope: A.pid }, SA);
      await api('POST', `/api/activate/${c.data.activationToken}`, { password: 's2-padmin-strong-1' });
      return (await api('POST', '/api/auth/login', { username: 's2_padmin2', password: 's2-padmin-strong-1' })).data.token;
    })();
    const PB = await (async () => {
      const c = await api('POST', '/api/admin/users', { username: 's2_padmin_b', role: 'PartnerAdmin', partner_scope: B.pid }, SA);
      await api('POST', `/api/activate/${c.data.activationToken}`, { password: 's2-padminb-strong-1' });
      return (await api('POST', '/api/auth/login', { username: 's2_padmin_b', password: 's2-padminb-strong-1' })).data.token;
    })();

    const png = makePng(120, 60);
    const resolve = (ctx) => branding.resolveBranding(ctx);

    /* ===== 1) هوية الشريك الرئيسي ===== */
    const up1 = await upload('partner', A.pid, 'logo', png, SA);
    assertEqual(up1.status, 201, '(1) **هوية الشريك الرئيسي: رفع الشعار ينجح**');
    let eff = resolve({ partnerId: A.pid });
    assertEqual(eff.sources.logo_asset_id, 'partner', '(1) والمصدر partner');
    assert(!!eff.logo_src, '(1) والرابط جاهز للاستهلاك بلا بناء في الواجهة');

    /* ===== 2) العقار يرث الشريك ===== */
    eff = resolve({ partnerId: A.pid, propertyId: A.propId });
    assertEqual(eff.sources.logo_asset_id, 'partner',
      '(2) **العقار يرث شعار الشريك** بلا تجاوز خاص به');

    /* ===== 3) العقار يتجاوز البانر وحده ===== */
    const up3 = await upload('property', A.propId, 'banner', png, SA);
    assertEqual(up3.status, 201, '(3) رفع بانر على العقار ينجح');
    eff = resolve({ partnerId: A.pid, propertyId: A.propId });
    assertEqual(eff.sources.banner_asset_id, 'property', '(3) **البانر يصير من العقار**');
    assertEqual(eff.sources.logo_asset_id, 'partner',
      '(3) **والشعار يبقى موروثًا من الشريك** — الوراثة حقلًا بحقل لا استبدال كتلة');

    /* ===== 4) المنفذ يرث العقار ===== */
    eff = resolve({ partnerId: A.pid, propertyId: A.propId, outletId: A.outHost });
    assertEqual(eff.sources.banner_asset_id, 'property', '(4) **المنفذ يرث بانر العقار**');
    assertEqual(eff.sources.logo_asset_id, 'partner', '(4) وشعار الشريك');

    /* ===== 5) المنفذ يتجاوز الشعار وحده ===== */
    const up5 = await upload('outlet', A.outHost, 'logo', png, SA);
    assertEqual(up5.status, 201, '(5) رفع شعار على المنفذ ينجح');
    eff = resolve({ partnerId: A.pid, propertyId: A.propId, outletId: A.outHost });
    assertEqual(eff.sources.logo_asset_id, 'outlet', '(5) **الشعار يصير من المنفذ**');
    assertEqual(eff.sources.banner_asset_id, 'property', '(5) **والبانر يبقى من العقار**');

    /* ===== 6) إزالة التجاوز تعيد الوراثة الصحيحة ===== */
    const outletAssetId = eff.logo_asset_id;
    const del6 = await api('DELETE', `/api/admin/brand-assets/${outletAssetId}`, null, SA);
    assertEqual(del6.status, 200, '(6) حذف أصل المنفذ ينجح');
    eff = resolve({ partnerId: A.pid, propertyId: A.propId, outletId: A.outHost });
    assertEqual(eff.sources.logo_asset_id, 'partner',
      '(6) **وتعود الوراثة إلى المستوى الأعلى تلقائيًا** — لا حقل يشير إلى أصل محذوف');
    assert(!!eff.logo_src, '(6) والشعار ما زال معروضًا (لا صورة مكسورة)');

    /* ===== 7) هوية الشريك التجاري ===== */
    const up7 = await upload('merchant', A.merId, 'logo', png, SA);
    assertEqual(up7.status, 201, '(7) **الشريك التجاري يملك هوية مستقلة قابلة للإدارة**');
    const merchantAssetId = up7.data.id;

    /* ===== 8) منفذ مرتبط بشريك تجاري ⇒ هويته ===== */
    eff = resolve({ partnerId: A.pid, propertyId: A.propId, outletId: A.outCommercial });
    assertEqual(eff.sources.logo_asset_id, 'merchant',
      '(8) **منفذ الشريك التجاري يحمل شعار شريكه لا شعار الجهة المضيفة**');
    assertEqual(eff.logo_asset_id, merchantAssetId, '(8) وهو الأصل نفسه المرفوع له');
    // ملاحظة: البانر **لا** يرث هنا -- حدّ الوسائط في (8ب) يقطع وراثته عبر
    // حدود العلامات. أما الحقول غير البصرية-الغلافية فترث عاديًا.
    assertEqual(eff.sources.banner_asset_id, 'none',
      '(8) والبانر لا يُورَّث عبر حدّ العلامة (تفصيله في 8ب)');
    assertEqual(eff.sources.show_powered_by, 'partner',
      '(8) **وما لم يعرّفه الشريك التجاري من الحقول الأخرى يبقى موروثًا** — الوراثة حقلًا بحقل قائمة');
    // الترتيب المعتمد: تجاوز المنفذ فوق الشريك التجاري
    const up8 = await upload('outlet', A.outCommercial, 'logo', png, SA);
    assertEqual(up8.status, 201, '(8) رفع شعار على المنفذ نفسه');
    eff = resolve({ partnerId: A.pid, propertyId: A.propId, outletId: A.outCommercial });
    assertEqual(eff.sources.logo_asset_id, 'outlet',
      '(8) **وتجاوز المنفذ يغلب الشريك التجاري** — Outlet → Merchant → Property → Partner');
    await api('DELETE', `/api/admin/brand-assets/${eff.logo_asset_id}`, null, SA);
    eff = resolve({ partnerId: A.pid, propertyId: A.propId, outletId: A.outCommercial });
    assertEqual(eff.sources.logo_asset_id, 'merchant', '(8) وبإزالته يعود إلى الشريك التجاري');
    // القاعدة الصريحة: العقار **لا** يطمس الشريك التجاري
    await upload('property', A.propId, 'logo', png, SA);
    eff = resolve({ partnerId: A.pid, propertyId: A.propId, outletId: A.outCommercial });
    assertEqual(eff.sources.logo_asset_id, 'merchant',
      '(8) **وهوية العقار لا تطمس الشريك التجاري** — المنفذ تجاري علامة قائمة بذاتها لا فرع من الجهة المضيفة');

    /* ===== 8-ب) حدّ البانر: لا يُورَّث عبر حدود العلامات ===== */
    // البانر مضبوط على العقار (رُفع في السيناريو 3). المنفذ التجاري يحمل
    // هوية شريكه التجاري، فيجب **ألا** يرث غلاف الجهة المضيفة.
    eff = resolve({ partnerId: A.pid, propertyId: A.propId, outletId: A.outCommercial });
    assertEqual(eff.sources.logo_asset_id, 'merchant', '(8ب) المنفذ يحمل هوية شريكه التجاري');
    assertEqual(eff.banner_asset_id, null,
      '(8ب) **ولا بانر أصلًا بدل وراثة غلاف علامة أخرى** — غياب الغلاف أصدق من غلاف جهة أخرى');
    assertEqual(eff.sources.banner_asset_id, 'none', '(8ب) والمصدر معلن: none لا property');
    assertEqual(eff.banner_src, null, '(8ب) ولا رابط يُقدَّم للواجهة');
    // وبانر خاص بالشريك التجاري يظهر
    const upMerBanner = await upload('merchant', A.merId, 'banner', png, SA);
    assertEqual(upMerBanner.status, 201, '(8ب) رفع بانر للشريك التجاري');
    eff = resolve({ partnerId: A.pid, propertyId: A.propId, outletId: A.outCommercial });
    assertEqual(eff.sources.banner_asset_id, 'merchant',
      '(8ب) **Outlet → Commercial Partner → لا بانر** — والمسار لا يمرّ بالعقار إطلاقًا');
    // وتجاوز المنفذ يغلب الشريك التجاري في البانر أيضًا
    const upOutBanner = await upload('outlet', A.outCommercial, 'banner', png, SA);
    assertEqual(upOutBanner.status, 201, '(8ب) رفع بانر على المنفذ');
    eff = resolve({ partnerId: A.pid, propertyId: A.propId, outletId: A.outCommercial });
    assertEqual(eff.sources.banner_asset_id, 'outlet', '(8ب) وتجاوز المنفذ يغلب');
    await api('DELETE', `/api/admin/brand-assets/${upOutBanner.data.id}`, null, SA);
    await api('DELETE', `/api/admin/brand-assets/${upMerBanner.data.id}`, null, SA);
    // ومنفذ **بلا** شريك تجاري يبقى على الوراثة العادية للبانر
    eff = resolve({ partnerId: A.pid, propertyId: A.propId, outletId: A.outHost });
    assertEqual(eff.sources.banner_asset_id, 'property',
      '(8ب) **ومنفذ بلا شريك تجاري يرث البانر عاديًا** — الحدّ يخصّ حدود العلامات لا كل المنافذ');

    /* ===== 9) QR مباشر إلى منفذ تجاري: الهوية من أول رسم ===== */
    // منفذ المضيف يُوقف فيبقى منفذ الشريك التجاري وحده فعّالًا في العقار
    db.prepare(`UPDATE outlets SET status = 'Inactive' WHERE id = ?`).run(A.outHost);
    const html = await (async () => {
      const http = require('http'); const base = new URL(BASE());
      return new Promise((res2) => {
        http.get({ host: base.hostname, port: base.port, path: `/?t=${A.token}` }, (r) => {
          let b = ''; r.on('data', d => b += d); r.on('end', () => res2(b));
        }).on('error', () => res2(''));
      });
    })();
    assert(/id="brand-seed"/.test(html),
      '(9) **الهوية محقونة في HTML قبل أول رسم** — لا انتظار JS ولا وميض');
    const seed = JSON.parse((html.match(/id="brand-seed">([^<]*)/) || [])[1] || '{}');
    assertEqual(seed.whiteLabelActive, true, '(9) والبذرة تقول إن الهوية فعّالة');
    const hub = await api('GET', `/api/service-hub/${A.token}`);
    assertEqual(hub.data.outlet.brand.sources.logo_asset_id, 'merchant',
      '(9) **ورمز يخصّ منفذًا تجاريًا يسلّم هوية الشريك التجاري من نقطة الدخول**');
    db.prepare(`UPDATE outlets SET status = 'Active' WHERE id = ?`).run(A.outHost);

    /* ===== 10) وصول عابر للمستأجرين ===== */
    const crossRead = await api('GET', `/api/admin/brand-assets?partnerId=${A.pid}`, null, PB);
    assertEqual(crossRead.status, 403, '(10) **قراءة أصول مستأجر آخر مرفوضة**');
    const crossDelete = await api('DELETE', `/api/admin/brand-assets/${merchantAssetId}`, null, PB);
    assertEqual(crossDelete.status, 404,
      '(10) **وحذفها مرفوض ولو عُرف معرّف الأصل** — ونفس رد "غير موجود" فلا يصلح للاستكشاف');
    assert(!!require('../lib/brand-media.js').getAsset(merchantAssetId), '(10) والأصل ما زال سليمًا');
    const crossUpload = await upload('property', A.propId, 'logo', png, PB);
    assertEqual(crossUpload.status, 403, '(10) والرفع على نطاق مستأجر آخر مرفوض');

    /* ===== 11) شريك بلا استحقاق ===== */
    const noEnt = await upload('partner', C.pid, 'logo', png, SA);
    // 402 هو رمز بوابة الاستحقاق المعتمد في هذا النظام (requireFeature)،
    // لا 403. الاختبار يتبع اصطلاح المنتج ولا يفرض عليه اصطلاحًا آخر:
    // تغيير الرمز إرضاءً لاختبار كان سيكسر كل مستهلك يفرّق بين "ممنوع"
    // و"غير مشمول في باقتك".
    assertEqual(noEnt.status, 402,
      '(11) **شريك بلا White Label لا يرفع وسائط** — بوابة الاستحقاق على الخادم لا في الواجهة');
    // وحتى لو خُزّنت بيانات، النتيجة ALNADL
    db.prepare(`INSERT INTO branding_overrides (id,scope_type,scope_id,logo_text,updated_at) VALUES (?,?,?,?,?)`)
      .run(uid('br'), 'merchant', C.merId, 'Should Not Appear', Date.now());
    let effC = resolve({ partnerId: C.pid, propertyId: C.propId, outletId: C.outCommercial });
    assertEqual(effC.whiteLabelActive, false, '(11) والهوية غير فعّالة');
    assertEqual(effC.gatedBy, 'plan_entitlement', '(11) بسبب معلن: الاستحقاق');
    assertEqual(effC.logo_text, 'ALNADL',
      '(11) **ALNADL افتراضيًا مهما كانت بيانات الشريك التجاري مخزَّنة**');
    // ونفس القاعدة حين يكون mode=alnadl رغم الاستحقاق
    db.prepare(`INSERT INTO branding_overrides (id,scope_type,scope_id,logo_text,updated_at) VALUES (?,?,?,?,?)`)
      .run(uid('br'), 'merchant', D.merId, 'Should Not Appear', Date.now());
    const effD = resolve({ partnerId: D.pid, propertyId: D.propId, outletId: D.outCommercial });
    assertEqual(effD.logo_text, 'ALNADL', '(11) **وكذلك حين يكون mode=alnadl** — بوابة المضيف تحكم الكل');
    assertEqual(effD.gatedBy, 'mode_alnadl', '(11) بسبب معلن مختلف');

    /* ===== 12) نوع ملف غير مسموح ===== */
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8');
    const badSvg = await upload('partner', A.pid, 'logo', svg, SA, 'logo.png');
    assertEqual(badSvg.status, 400,
      '(12) **SVG مرفوض ولو سُمّي .png** — النوع يُكشف من البايتات لا من الامتداد');
    assertEqual(badSvg.data.code, 'BAD_MIME', '(12) بسبب آلي مستقر');
    const fakePng = await upload('partner', A.pid, 'logo', Buffer.from('GIF89a not really'), SA, 'x.png');
    assertEqual(fakePng.status, 400, '(12) وامتداد كاذب لا يمرّ');

    /* ===== 13) حجم كبير ===== */
    const huge = Buffer.concat([png, Buffer.alloc(1024 * 1024 * 2)]);
    const tooBig = await upload('partner', A.pid, 'logo', huge, SA);
    assert(tooBig.status === 400 || tooBig.status === 413,
      '(13) **ملف يتجاوز الحدّ مرفوض** — والحدّ يُفرض أثناء الاستقبال لا بعده');
    const bigDims = await upload('partner', A.pid, 'favicon', makePng(1200, 1200), SA);
    assertEqual(bigDims.status, 400, '(13) وأبعاد تتجاوز حدّ النوع مرفوضة');
    assertEqual(bigDims.data.code, 'TOO_LARGE_DIMENSIONS', '(13) بسبب آلي مستقر');

    /* ===== 14) اجتياز المسار ===== */
    const storage = require('../lib/storage.js');
    let traversalBlocked = false;
    try { storage.getStorage().get('../../../../etc/passwd'); }
    catch (e) { traversalBlocked = /Invalid storage key|escapes/.test(e.message); }
    assert(traversalBlocked, '(14) **مفتاح يحمل اجتياز مسار يُرفض في طبقة التخزين نفسها**');
    const trav = await upload('partner', A.pid, 'logo', png, SA, '../../evil.png');
    assertEqual(trav.status, 201, '(14) واسم ملف خبيث لا يمنع الرفع...');
    const stored = require('../lib/brand-media.js').getAsset(trav.data.id);
    assert(!/\.\./.test(stored.storage_key) && !/\.\./.test(stored.original_name || ''),
      '(14) **...لأنه لا يدخل المسار أصلًا** — المفتاح يولّده الخادم والاسم للعرض فقط');

    /* ===== 15) أصل مفقود ⇒ سقوط للوراثة ===== */
    const missingAsset = require('../lib/brand-media.js').getAsset(up1.data.id);
    if (missingAsset) storage.getStorage().remove(missingAsset.storage_key);
    const served = await api('GET', `/api/brand-assets/${up1.data.id}`);
    assertEqual(served.status, 404,
      '(15) **ملف مفقود يُرجع 404 نظيفًا لا 500 ولا صورة مكسورة**');

    /* ===== 18) السلة متعددة المنافذ: Shell عام وهوية داخل كل قسم ===== */
    const hubMulti = await api('GET', `/api/service-hub/${A.token}`);
    assert(Array.isArray(hubMulti.data.outlets) && hubMulti.data.outlets.length >= 2,
      '(18) العقار يعرض أكثر من منفذ');
    const commercial = hubMulti.data.outlets.find(o => o.id === A.outCommercial);
    const host = hubMulti.data.outlets.find(o => o.id === A.outHost);
    assertEqual(commercial.brand.sources.logo_asset_id, 'merchant',
      '(18) **كل منفذ يحمل هويته المحلولة على الخادم** — الواجهة لا تعيد بناء الوراثة');
    assert(host.brand.sources.logo_asset_id !== 'merchant',
      '(18) ومنفذ المضيف يحمل هوية المضيف لا الشريك التجاري');
    // الـShell هوية الشريك **أو العقار** -- كلاهما "المستوى العام" في
    // نصّ المتطلَّب. المهم أنه ليس هوية منفذ ولا شريك تجاري: تلك تعيش
    // داخل قسم المنفذ في السلّة لا في الترويسة العامة.
    assert(['partner', 'property'].includes(hubMulti.data.branding.sources.logo_asset_id),
      '(18) **والهوية العامة للـShell تبقى هوية الشريك/العقار** — لا تبديل شعار داخل سلّة واحدة');
    assert(!['merchant', 'outlet'].includes(hubMulti.data.branding.sources.logo_asset_id),
      '(18) ولا تتسرّب هوية منفذ أو شريك تجاري إلى الترويسة العامة');


    /* ===== 16 + 17) بقاء الوسائط عبر إعادة التشغيل وإعادة إنشاء الحاوية =====
       بخادم مستقل بمسار قاعدة **ثابت**: مُشغّل الاختبارات المشترك يولّد
       قاعدة جديدة لكل إقلاع، فإعادة التشغيل عبره كانت تمحو المستأجرين --
       أي أنها تختبر شيئًا آخر تمامًا. البقاء لا يُثبَت إلا حين تبقى القاعدة
       والتخزين ويتغيّر ما عداهما. */
    {
      const os = require('os');
      const { spawn } = require('child_process');
      const http = require('http');
      const volume = fs.mkdtempSync(path.join(os.tmpdir(), 'brandvol-'));
      const dbPath = path.join(volume, 'app.sqlite');
      const mediaPath = path.join(volume, 'media');
      fs.mkdirSync(mediaPath, { recursive: true });
      const PORT2 = 8960 + Math.floor(Math.random() * 30);
      const env = { ...process.env, PORT: String(PORT2), SQLITE_PATH: dbPath, BRAND_MEDIA_PATH: mediaPath, NODE_ENV: 'development' };

      const boot = async (cwd) => {
        const proc = spawn('node', ['server.js'], { cwd: cwd || path.join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
        for (let i = 0; i < 60; i++) {
          if (proc.exitCode !== null) return null;
          const ok = await new Promise(r => {
            const rq = http.get({ host: '127.0.0.1', port: PORT2, path: '/ready', timeout: 1500 }, res => { res.resume(); r(res.statusCode === 200); });
            rq.on('error', () => r(false)); rq.on('timeout', () => { rq.destroy(); r(false); });
          });
          if (ok) return proc;
          await new Promise(r => setTimeout(r, 250));
        }
        try { proc.kill(); } catch (e) {}
        return null;
      };
      const call = (opts, body) => new Promise(r => {
        const rq = http.request({ host: '127.0.0.1', port: PORT2, ...opts }, res => {
          let b = ''; res.on('data', d => b += d);
          res.on('end', () => { try { r({ status: res.statusCode, data: JSON.parse(b), raw: b }); } catch (e) { r({ status: res.statusCode, data: {}, raw: b }); } });
        });
        rq.on('error', () => r({ status: 0, data: {} }));
        if (body) rq.write(body);
        rq.end();
      });

      let proc = await boot();
      assert(!!proc, '(16) خادم مستقل بمسار قاعدة وتخزين ثابتين يقلع');
      const tok2 = (await call({ method: 'POST', path: '/api/auth/login', headers: { 'Content-Type': 'application/json' } },
        JSON.stringify({ username: 'admin', password: 'admin' }))).data.token;
      const pid2 = (await call({ method: 'GET', path: '/api/admin/partners', headers: { Authorization: 'Bearer ' + tok2 } })).data[0].id;
      // تفعيل الاستحقاق والوضع على هذا الشريك
      const d2 = new (require('node:sqlite').DatabaseSync)(dbPath);
      const platId = d2.prepare("SELECT id FROM plans WHERE code = 'PLATFORM'").get().id;
      d2.prepare('UPDATE subscriptions SET plan_id = ? WHERE partner_id = ?').run(platId, pid2);
      d2.prepare("INSERT OR REPLACE INTO partner_branding (partner_id,mode,logo_text,updated_at) VALUES (?,'full_white_label','Persist Brand',?)").run(pid2, Date.now());
      d2.close();

      const boundary = '----persist' + Math.random().toString(36).slice(2);
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="assetType"\r\n\r\nlogo\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.png"\r\nContent-Type: application/octet-stream\r\n\r\n`, 'utf8'),
        png, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
      ]);
      const upP = await call({
        method: 'POST', path: `/api/admin/brand-assets/partner/${pid2}`,
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length, Authorization: 'Bearer ' + tok2 },
      }, body);
      assertEqual(upP.status, 201, '(16) رفع أصل على التخزين الدائم');
      const assetId2 = upP.data.id;
      assertEqual((await call({ method: 'GET', path: `/api/brand-assets/${assetId2}` })).status, 200, '(16) والأصل يُقدَّم قبل إعادة التشغيل');

      // إعادة تشغيل
      proc.kill('SIGKILL'); await new Promise(r => setTimeout(r, 900));
      proc = await boot();
      assert(!!proc, '(16) الخادم يقلع مجددًا');
      assertEqual((await call({ method: 'GET', path: `/api/brand-assets/${assetId2}` })).status, 200,
        '(16) **الأصل ما زال يُقدَّم بعد إعادة التشغيل** — الوسائط على تخزين دائم لا في طبقة الصورة');

      // إعادة إنشاء "الحاوية": شجرة تطبيق جديدة كليًا على نفس القاعدة ونفس التخزين
      proc.kill('SIGKILL'); await new Promise(r => setTimeout(r, 900));
      const recreated = fs.mkdtempSync(path.join(os.tmpdir(), 'brandapp-'));
      for (const item of ['server.js', 'db.js', 'lib', 'migrations', 'public', 'package.json']) {
        fs.cpSync(path.join(__dirname, '..', item), path.join(recreated, item), { recursive: true });
      }
      proc = await boot(recreated);
      assert(!!proc, '(17) شجرة تطبيق جديدة تقلع على نفس القاعدة والتخزين');
      const afterRecreate = await call({ method: 'GET', path: `/api/brand-assets/${assetId2}` });
      assertEqual(afterRecreate.status, 200,
        '(17) **والأصل باقٍ بعد استبدال شجرة التطبيق كاملة** — عمر الوسائط مستقل عن عمر الحاوية');
      proc.kill('SIGKILL');
      fs.rmSync(volume, { recursive: true, force: true });
      fs.rmSync(recreated, { recursive: true, force: true });
    }

    /* ===== حارس إضافي: products.merchant_id لا يُستنتج منه شيء ===== */
    const catId = uid('cat');
    db.prepare(`INSERT INTO categories (id,property_id,name_ar,name_en,sort_order,status) VALUES (?,?,?,?,1,'Active')`)
      .run(catId, A.propId, 'c', 'c');
    const otherMer = uid('mer');
    db.prepare(`INSERT INTO merchants (id,property_id,name_ar,name_en,kind,commission_rate,status) VALUES (?,?,?,?,'partner',0.1,'Active')`)
      .run(otherMer, A.propId, 'Other', 'Other');
    await upload('merchant', otherMer, 'logo', png, SA);
    db.prepare(`INSERT INTO products (id,category_id,merchant_id,outlet_id,sku,name_ar,name_en,base_price,status) VALUES (?,?,?,?,?,?,?,?,'Active')`)
      .run(uid('prd'), catId, otherMer, A.outCommercial, 'sku1', 'p', 'p', 10);
    eff = resolve({ partnerId: A.pid, propertyId: A.propId, outletId: A.outCommercial });
    assertEqual(eff.sources.logo_asset_id, 'merchant', 'الحارس: الهوية ما زالت من الشريك التجاري');
    assertEqual(eff.logo_asset_id, merchantAssetId,
      '**الحارس: صنف يبيعه شريك تجاري آخر داخل المنفذ لا يغيّر هوية المنفذ** — outlets.merchant_id هو المصدر الوحيد');

  } finally {
    stopServer();
  }
  return summary();
}

module.exports = { run };
if (require.main === module) run().then(ok => process.exit(ok ? 0 : 1));
