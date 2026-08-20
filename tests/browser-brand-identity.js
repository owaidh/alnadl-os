// tests/browser-brand-identity.js — Scope 2 · رحلة الضيف الحقيقية بالمتصفح.
//
// لماذا لا تكفي اختبارات الـAPI هنا: كل تأكيدات المُحلِّل قد تكون خضراء
// بينما الضيف يرى شعار ALNADL -- يكفي أن تنسى شاشة واحدة سؤال Brand Shell.
// وهذا بالضبط ما حدث سابقًا في هذا المشروع: تسمية «مُشغَّل من النادل»
// كانت تظهر داخل تجربة عميل مُهوَّاة، ولم يكشفها إلا النظر.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
function loadPlaywright() {
  try { return require('playwright'); } catch (e) {}
  for (const base of (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)) {
    try { return require(path.join(base, 'playwright')); } catch (e) {}
  }
  return null;
}
const playwright = loadPlaywright();
const { startServer, stopServer, api, assert, assertEqual, summary, resetCounts, BASE, getDataPath } = require('./helpers.js');

const SHOTS = path.join(__dirname, '..', 'docs', 'scope2-screenshots');
const shot = (n) => path.join(SHOTS, n);
const awaiting = [];

function openDb() {
  process.env.SQLITE_PATH = getDataPath();
  for (const m of ['../db.js', '../lib/branding.js', '../lib/brand-media.js', '../lib/storage.js']) {
    try { delete require.cache[require.resolve(m)]; } catch (e) {}
  }
  return require('../db.js');
}

/* PNG بلون مصمت — يجعل الشعار مرئيًا في اللقطة ومميّزًا بين الجهات. */
let CRC = null;
function crc32(b) {
  if (!CRC) { CRC = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; } }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return c ^ 0xFFFFFFFF;
}
function makePng(w, h, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(w * 3 + 1);
    for (let x = 0; x < w; x++) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function upload(scopeType, scopeId, assetType, buffer, token) {
  const boundary = '----e2e' + Math.random().toString(36).slice(2);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="assetType"\r\n\r\n${assetType}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: application/octet-stream\r\n\r\n`, 'utf8'),
    buffer, Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);
  const http = require('http'); const base = new URL(BASE());
  return new Promise((r) => {
    const rq = http.request({
      host: base.hostname, port: base.port, method: 'POST',
      path: `/api/admin/brand-assets/${scopeType}/${scopeId}`,
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length, Authorization: 'Bearer ' + token },
    }, (res) => { let b = ''; res.on('data', d => b += d); res.on('end', () => { try { r({ status: res.statusCode, data: JSON.parse(b) }); } catch (e) { r({ status: res.statusCode, data: {} }); } }); });
    rq.on('error', () => r({ status: 0, data: {} }));
    rq.end(body);
  });
}

/** يقود رحلة ضيف حقيقية من الرمز حتى الشاشة المطلوبة. */
async function guestJourney(page, base, token, opts) {
  const o = opts || {};
  await page.goto(`${base}/?t=${token}`);
  await page.waitForTimeout(900);
  const firstRender = await page.evaluate(() => ({
    title: document.title,
    seed: (() => { const el = document.getElementById('brand-seed'); return el ? JSON.parse(el.textContent) : null; })(),
    headerText: (document.querySelector('.fohtop, .apptop, header') || document.body).innerText.slice(0, 120),
  }));
  if (await page.evaluate(() => S.screen === 'hub')) {
    if (o.pickOutletId) {
      await page.evaluate((id) => App.chooseOutlet(id), o.pickOutletId);
    } else {
      await page.click('.qrpickitem');
    }
    await page.waitForTimeout(800);
  }
  if (await page.evaluate(() => S.screen === 'welcome')) {
    await page.click('.btn-primary');
    await page.waitForTimeout(900);
  }
  await page.waitForFunction(() => S.catalog && (S.catalog.products || []).length >= 0, { timeout: 15000 }).catch(() => {});
  return firstRender;
}

async function run() {
  resetCounts();
  if (!playwright) {
    console.log('  SKIPPED: playwright not installed — the guest brand journey was not verified in a real browser.');
    awaiting.push({ item: 'Brand identity browser E2E', reason: 'playwright not installed in this environment' });
    return true;
  }
  fs.mkdirSync(SHOTS, { recursive: true });
  await startServer();
  console.log('=== Browser E2E: brand identity through the guest journey ===');
  const browser = await playwright.chromium.launch();

  try {
    const { db, uid } = openDb();
    const base = BASE();
    const SA = (await api('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).data.token;

    const plan = uid('plan');
    db.prepare(`INSERT INTO plans (id,code,name_ar,name_en,monthly_fee,tech_fee_rate,features_json) VALUES (?,?,?,?,?,?,?)`)
      .run(plan, 'E2EPLAT', 'منصة', 'Platform', 0, 0.02,
        JSON.stringify({ qrOrdering: true, digitalPayment: true, multiOutlet: true, unifiedCart: true, marketplace: true, whiteLabel: true, multiProperty: true }));

    // مستأجر واحد محايد قطاعيًا: جهة مضيفة + منفذ لشريك تجاري مستقل داخلها.
    // النموذج نفسه يصلح لشركة أو مجمّع أو موقع فعاليات بلا أي تغيير.
    const pid = uid('pt');
    db.prepare(`INSERT INTO partners (id,name_ar,name_en,legal_name,contract_ref,status) VALUES (?,?,?,?,?,'Active')`)
      .run(pid, 'جهة الأفق', 'Ufuq Site', 'Ufuq', 'C-UFUQ');
    db.prepare(`INSERT INTO subscriptions (id,partner_id,plan_id,status,started_at,renews_at) VALUES (?,?,?,'Active',?,?)`)
      .run(uid('sub'), pid, plan, Date.now(), Date.now() + 2592000000);
    db.prepare(`INSERT INTO partner_branding (partner_id,mode,logo_text,primary_color,show_powered_by,updated_at)
                VALUES (?,'full_white_label','جهة الأفق','#0F766E',1,?)`).run(pid, Date.now());
    const propId = uid('prop');
    db.prepare(`INSERT INTO properties (id,partner_id,name_ar,name_en,timezone,address,status) VALUES (?,?,?,?,?,?,'Active')`)
      .run(propId, pid, 'الأفق - الموقع الرئيسي', 'Ufuq Main Site', 'Asia/Riyadh', 'Riyadh');
    const zoneId = uid('zn');
    db.prepare(`INSERT INTO zones (id,property_id,name_ar,name_en,type,status) VALUES (?,?,?,?,'hall','Active')`)
      .run(zoneId, propId, 'المنطقة أ', 'Zone A');
    const mkPoint = (label) => {
      const pointId = uid('pnt'); const token = uid('tok');
      db.prepare(`INSERT INTO points (id,zone_id,code,label,type,active) VALUES (?,?,?,?,'table',1)`).run(pointId, zoneId, label, label);
      db.prepare(`INSERT INTO qr_tokens (id,point_id,token,active,created_at) VALUES (?,?,?,1,?)`).run(uid('qt'), pointId, token, Date.now());
      return { pointId, token };
    };
    const mainPoint = mkPoint('LOBBY-01');

    const merId = uid('mer');
    db.prepare(`INSERT INTO merchants (id,property_id,name_ar,name_en,kind,commission_rate,status) VALUES (?,?,?,?,'partner',0.12,'Active')`)
      .run(merId, propId, 'علامة رمّان', 'Rumman Brand');
    const outCommercial = uid('out');
    db.prepare(`INSERT INTO outlets (id,property_id,name_ar,name_en,type,operator,delivery_mode,sla_prep_min,sla_delivery_min,commission_rate,merchant_id,status,created_at)
                VALUES (?,?,?,?,'coffee','third_party','runner',8,10,0.12,?,'Active',?)`)
      .run(outCommercial, propId, 'علامة رمّان', 'Rumman Brand', merId, Date.now());
    const outHost = uid('out');
    db.prepare(`INSERT INTO outlets (id,property_id,name_ar,name_en,type,operator,delivery_mode,sla_prep_min,sla_delivery_min,commission_rate,status,created_at)
                VALUES (?,?,?,?,'restaurant','alnadl','runner',8,10,0.1,'Active',?)`)
      .run(outHost, propId, 'منفذ الأفق', 'Ufuq Outlet', Date.now());

    const catId = uid('cat');
    db.prepare(`INSERT INTO categories (id,property_id,name_ar,name_en,sort_order,status) VALUES (?,?,?,?,1,'Active')`)
      .run(catId, propId, 'الكل', 'All');
    /* منتج المضيف يُنسب إلى شريك تجاري خاص بالمضيف.
       كشفه تدقيق السلّة الموحّدة: الكتالوج يُسقط أي منتج لا يخصّ شريكًا
       تجاريًا مرئيًا (`visibleMerchantIds`)، فمنتج بـmerchant_id فارغ يختفي
       من القائمة بصمت. ذلك ما جعل تجهيزة سابقة تُظهر منفذًا واحدًا فأوحت
       بأن السلّة الموحّدة غير متاحة -- وهي متاحة. */
    const hostMerId = uid('mer');
    db.prepare(`INSERT INTO merchants (id,property_id,name_ar,name_en,kind,commission_rate,status) VALUES (?,?,?,?,'alnadl',0.1,'Active')`)
      .run(hostMerId, propId, 'منفذ الأفق', 'Ufuq Outlet');
    for (const [oid, mid, nm] of [[outCommercial, merId, 'صنف رمّان'], [outHost, hostMerId, 'صنف الأفق']]) {
      db.prepare(`INSERT INTO products (id,category_id,merchant_id,outlet_id,sku,name_ar,name_en,base_price,status) VALUES (?,?,?,?,?,?,?,?,'Active')`)
        .run(uid('prd'), catId, mid, oid, uid('sku'), nm, nm, 22);
    }

    // هويتان متمايزتان بصريًا: الجهة الرئيسية أخضر، الشريك التجاري أحمر
    await upload('partner', pid, 'logo', makePng(160, 80, [15, 118, 110]), SA);
    await upload('partner', pid, 'banner', makePng(600, 200, [15, 118, 110]), SA);
    await upload('merchant', merId, 'logo', makePng(160, 80, [190, 60, 60]), SA);
    db.prepare(`UPDATE branding_overrides SET logo_text = ?, primary_color = ? WHERE scope_type='merchant' AND scope_id = ?`)
      .run('علامة رمّان', '#BE3C3C', merId);

    /* ================= A — الشريك الرئيسي ================= */
    let page = await browser.newPage();
    let first = await guestJourney(page, base, mainPoint.token, { pickOutletId: outHost });
    assert(/الأفق/.test(first.title),
      '(A) **عنوان الصفحة يحمل هوية الجهة الرئيسية من أول رسم** — محقون على الخادم');
    assertEqual(first.seed && first.seed.whiteLabelActive, true, '(A) والبذرة تصل قبل أي JS');
    let visible = await page.evaluate(() => document.body.innerText);
    assert(!/ALNADL/i.test(visible.replace(/مقدَّم من ALNADL|Powered by ALNADL/g, '')),
      '(A) **ولا يظهر اسم ALNADL في رحلة الضيف** إلا كنسبة صغيرة');
    let brandNow = await page.evaluate(() => brandName());
    assertEqual(brandNow, 'جهة الأفق', '(A) وهوية الجهة الرئيسية فعّالة طوال الرحلة');
    await page.screenshot({ path: shot('A-main-partner-menu.png') });
    await page.close();

    /* ================= B — تجاوز العقار ================= */
    await upload('property', propId, 'logo', makePng(160, 80, [40, 70, 160]), SA);
    db.prepare(`UPDATE branding_overrides SET logo_text = ? WHERE scope_type='property' AND scope_id = ?`)
      .run('الأفق - المنطقة أ', propId);
    page = await browser.newPage();
    await guestJourney(page, base, mainPoint.token, { pickOutletId: outHost });
    brandNow = await page.evaluate(() => brandName());
    assertEqual(brandNow, 'الأفق - المنطقة أ',
      '(B) **تجاوز العقار يظهر في رحلة الضيف** ويغلب هوية الشريك');
    await page.screenshot({ path: shot('B-property-override.png') });
    await page.close();

    /* ================= C — الانتقال إلى منفذ شريك تجاري ================= */
    page = await browser.newPage();
    await page.goto(`${base}/?t=${mainPoint.token}`);
    await page.waitForTimeout(900);
    const atHub = await page.evaluate(() => S.screen);
    assertEqual(atHub, 'hub', '(C) رمز الجهة الرئيسية يعرض المنافذ أولًا');
    const hubBrand = await page.evaluate(() => brandName());
    assertEqual(hubBrand, 'الأفق - المنطقة أ', '(C) **وهوية الجهة الرئيسية ظاهرة في شاشة الاختيار**');
    await page.screenshot({ path: shot('C1-hub-main-identity.png') });
    await page.evaluate((id) => App.chooseOutlet(id), outCommercial);
    await page.waitForTimeout(1000);
    const commercialBrand = await page.evaluate(() => brandName());
    assertEqual(commercialBrand, 'علامة رمّان',
      '(C) **وبعد اختيار منفذ الشريك التجاري تتحول الهوية إليه** — لا تبقى هوية الجهة الرئيسية');
    const commercialSource = await page.evaluate(() => activeBrand().sources.logo_asset_id);
    assertEqual(commercialSource, 'merchant', '(C) والمصدر هو الشريك التجاري لا العقار');
    // كشفته المراجعة البصرية لا التأكيدات: شاشة بهويتين معًا.
    await page.evaluate(() => App.goScreen('welcome'));
    await page.waitForTimeout(600);
    const heading = await page.evaluate(() => { const h = document.querySelector('.welcome h2'); return h ? h.innerText.trim() : ''; });
    assertEqual(heading, 'علامة رمّان',
      '(C) **وعنوان الشاشة يتبع الهوية الفعّالة لا اسم الجهة الرئيسية** — لا شاشة واحدة بهويتين');
    await page.evaluate(() => App.goScreen('menu'));
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot('C2-commercial-outlet-identity.png') });
    // §2 بصريًا: لا غلاف موروث من الجهة الرئيسية داخل هوية شريك تجاري.
    await page.evaluate(() => App.goScreen('welcome'));
    await page.waitForTimeout(600);
    const bannerCount = await page.$$eval('.brandbanner', els => els.length);
    assertEqual(bannerCount, 0,
      '(§2) **لا يظهر غلاف الجهة الرئيسية داخل هوية شريك تجاري** — غيابه أصدق من غلاف علامة أخرى');
    await page.screenshot({ path: shot('C3-commercial-no-inherited-banner.png') });
    await page.evaluate(() => App.goScreen('menu'));
    await page.waitForTimeout(400);
    // والعودة تُعيد هوية الجهة الرئيسية
    await page.evaluate(() => App.goScreen('hub'));
    await page.waitForTimeout(700);
    assertEqual(await page.evaluate(() => brandName()), 'الأفق - المنطقة أ',
      '(C) **والعودة للمستوى الرئيسي تُعيد هوية الشريك الرئيسي**');
    await page.close();

    /* ================= D — رمز مباشر لمنفذ تجاري ================= */
    // منفذ المضيف يُوقف مؤقتًا، فيصير رمز النقطة مرتبطًا بمنفذ الشريك التجاري وحده
    db.prepare(`UPDATE outlets SET status='Inactive' WHERE id = ?`).run(outHost);
    page = await browser.newPage();
    const directFirst = await guestJourney(page, base, mainPoint.token);
    assert(/رمّان/.test(directFirst.title),
      '(D) **رمز يخصّ منفذًا تجاريًا يُظهر هويته من أول رسم** — لا هوية الجهة الرئيسية ثم تتحول');
    assertEqual(directFirst.seed && directFirst.seed.logoText, 'علامة رمّان',
      '(D) والبذرة المحقونة تحمل اسم الشريك التجاري نفسه');
    assertEqual(await page.evaluate(() => brandName()), 'علامة رمّان', '(D) والهوية تستمر بعد التحميل');
    await page.screenshot({ path: shot('D-direct-commercial-qr.png') });
    await page.close();
    db.prepare(`UPDATE outlets SET status='Active' WHERE id = ?`).run(outHost);

    /* ================= E — show_powered_by = 0 ================= */
    db.prepare(`UPDATE partner_branding SET show_powered_by = 0 WHERE partner_id = ?`).run(pid);
    page = await browser.newPage();
    await guestJourney(page, base, mainPoint.token, { pickOutletId: outHost });
    await page.evaluate(() => App.goScreen('welcome'));
    await page.waitForTimeout(600);
    let text = await page.evaluate(() => document.body.innerText);
    assert(!/ALNADL/i.test(text),
      '(E) **مع show_powered_by = 0 لا يظهر اسم ALNADL في رحلة الضيف إطلاقًا**');
    await page.screenshot({ path: shot('E-powered-by-off.png') });
    await page.close();

    /* ================= F — show_powered_by = 1 ================= */
    db.prepare(`UPDATE partner_branding SET show_powered_by = 1 WHERE partner_id = ?`).run(pid);
    page = await browser.newPage();
    await guestJourney(page, base, mainPoint.token, { pickOutletId: outHost });
    await page.evaluate(() => App.goScreen('welcome'));
    await page.waitForTimeout(600);
    const attribution = await page.$('.poweredby');
    assert(!!attribution, '(F) **ومع show_powered_by = 1 تظهر النسبة**');
    const size = await page.evaluate(() => {
      const el = document.querySelector('.poweredby');
      const h = document.querySelector('.welcome h2');
      return { attr: parseFloat(getComputedStyle(el).fontSize), heading: h ? parseFloat(getComputedStyle(h).fontSize) : 99 };
    });
    assert(size.attr < size.heading,
      '(F) **دون أن تطغى على هوية العميل** — النسبة ثانوية بصريًا بالقياس لا بالانطباع');
    await page.screenshot({ path: shot('F-powered-by-on.png') });
    await page.close();

    /* ================= السلة متعددة المنافذ ================= */
    page = await browser.newPage();
    await guestJourney(page, base, mainPoint.token, { pickOutletId: outHost });
    // سلّة حقيقية من منفذين: القائمة تعرض منتجات المنفذ النشط وحده، فالمسار
    // الصحيح هو مسار الضيف نفسه -- أضف من منفذ، بدّل المنفذ، أضف من الآخر.
    /* رحلة ضيف حقيقية عبر الشاشات -- لا حالة مصطنعة.
       أثبت التدقيق أن السلّة الموحّدة مدعومة كاملةً: الكتالوج على مستوى
       الموقع، والقائمة تفلتر بالفئة لا بالمنفذ، والخادم يفرّع الطلب إلى
       child_orders لكل منفذ حين تشمل الباقة unifiedCart. فالمسار متاح
       للضيف فعلًا، ويجب أن يُختبر كما يسلكه. */
    const addFrom = async (outletId) => {
      const added = await page.evaluate((oid) => {
        const p = (S.catalog.products || []).find(x => x.outlet_id === oid);
        if (!p) return false;
        App.openProduct(p.id); App.addActiveToCart(); return true;
      }, outletId);
      return added;
    };
    assert(await addFrom(outHost), '(§8) إضافة صنف من منفذ المضيف عبر القائمة');
    // العودة إلى مستوى اختيار المنافذ ثم اختيار منفذ الشريك التجاري
    await page.evaluate(() => App.goScreen('hub'));
    await page.waitForTimeout(600);
    assertEqual(await page.evaluate(() => brandName()), 'الأفق - المنطقة أ',
      '(§4) **والعودة لمستوى اختيار المنافذ تُعيد هوية السياق الأعلى فورًا** — لا هوية شريك تجاري عالقة');
    await page.screenshot({ path: shot('I-back-to-outlet-selection.png') });
    await page.evaluate((id) => App.chooseOutlet(id), outCommercial);
    await page.waitForTimeout(800);
    assertEqual(await page.evaluate(() => brandName()), 'علامة رمّان', '(§8) والهوية تتحول للشريك التجاري');
    assert(await addFrom(outCommercial), '(§8) وإضافة صنف من منفذه');
    await page.evaluate(() => App.goScreen('cart'));
    await page.waitForTimeout(700);
    const sections = await page.$$eval('.outletsection', els => els.map(e => e.innerText.trim()));
    const cartIds = await page.evaluate(() => cartOutletIds().length);
    assertEqual(cartIds, 2, '(§8) السلّة تضمّ منفذين فعلًا');
    if (cartIds > 1) {
      assert(sections.length >= 2,
        '(§8) **سلّة من منفذين تعرض قسمًا لكل منفذ** — لا يلتبس على الضيف من يقدّم ماذا');
      // كل قسم يميّز نفسه: قسم يحمل اسم الصفحة نفسه لا يخبر الضيف بشيء.
      const pageTitle = await page.evaluate(() => brandHeadingLabel());
      assert(sections.some(x => x.includes('علامة رمّان')),
        '(§6) **قسم الشريك التجاري يحمل اسمه وهويته**');
      assert(sections.some(x => !x.includes('علامة رمّان') && x !== pageTitle),
        '(§6) **وقسم منفذ المضيف يحمل اسم المنفذ لا اسم الصفحة** — وإلا لم تميّز الترويسة شيئًا');
      const shellDuringCart = await page.evaluate(() => activeBrand().sources.logo_asset_id);
      assert(!['merchant', 'outlet'].includes(shellDuringCart),
        '(§8) **والـShell يبقى على هوية الشريك/العقار** — لا تبديل شعار عام داخل سلّة واحدة');
    }
    await page.screenshot({ path: shot('G-unified-cart-sections.png') });
    await page.close();

    /* ================= الوضع الداكن ================= */
    page = await browser.newPage();
    await guestJourney(page, base, mainPoint.token, { pickOutletId: outHost });
    await page.evaluate(() => App.goScreen('welcome'));
    await page.waitForTimeout(500);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((th) => { document.documentElement.setAttribute('data-theme', th); render(); }, theme);
      await page.waitForTimeout(500);
      const readable = await page.evaluate(() => {
        const el = document.querySelector('.welcome h2, .scrhead h3, h2, h3');
        if (!el) return true;
        const st = getComputedStyle(el);
        return st.color !== st.backgroundColor;
      });
      assert(readable, `(§17) **النصّ يبقى مقروءًا في الوضع ${theme}** — لون العلامة لا يُجبر كل خلفية`);
      /* تباين سياق الموقع يُقاس رقميًا لا يُقدَّر بالنظر. كشف القياس أن
         الحدّ كان أبيض على أبيض (نسبة ≈ 1.0) في الوضع الفاتح -- نصّ موجود
         في DOM ويمرّ كل تأكيد "هل هو ظاهر؟" بينما لا يراه أحد. */
      const contrast = await page.evaluate(() => {
        const el = document.querySelector('.locpill');
        if (!el) return null;
        const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        let node = el, bg = 'rgb(255,255,255)';
        while (node) { const c = getComputedStyle(node).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)') { bg = c; break; } node = node.parentElement; }
        const l1 = lum(getComputedStyle(el).color), l2 = lum(bg);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      });
      if (contrast !== null) {
        assert(contrast >= 4.5,
          `(§3/§17) **سياق الموقع مقروء فعلًا في الوضع ${theme}** — نسبة تباين ${contrast.toFixed(1)}:1 (الحدّ 4.5)`);
      }
      await page.screenshot({ path: shot(`H-theme-${theme}.png`) });
    }
    await page.close();

  } finally {
    await browser.close();
    stopServer();
  }
  return summary();
}

module.exports = { run, awaiting };
if (require.main === module) run().then(ok => process.exit(ok ? 0 : 1));
