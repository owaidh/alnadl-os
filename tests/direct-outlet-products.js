// tests/direct-outlet-products.js — منتجات المنفذ المباشرة (merchant_id = NULL).
//
// القاعدة التي تُثبَّت هنا: **الشريك التجاري حالة اختيارية، لا شرط ضمني.**
// هو ينشأ حين يوجد طرف تجاري آخر داخل المنفذ، وليس شرطًا ليبيع الشريك
// الرئيسي منتجاته بنفسه.
//
// الخلل الذي أُغلق: بوابة marketplace في الكتالوج كانت
// `visibleMerchantIds.has(p.merchant_id)`، و`Set.has(null)` تساوي false --
// فكان المنتج المباشر يختفي من القائمة **بلا قصد**، رغم أن طلبه يُقبل
// وإيراده يُحسب. أي منتج صالح تمامًا لا يراه أحد.
'use strict';
const { startServer, stopServer, api, assert, assertEqual, summary, resetCounts, getDataPath } = require('./helpers.js');

function openDb() {
  process.env.SQLITE_PATH = getDataPath();
  for (const m of ['../db.js', '../lib/branding.js', '../lib/revenue-engine.js']) {
    try { delete require.cache[require.resolve(m)]; } catch (e) {}
  }
  return require('../db.js');
}

async function run() {
  resetCounts();
  await startServer();
  console.log('=== Direct outlet products (no Commercial Partner) ===');

  try {
    const { db, uid } = openDb();
    const branding = require('../lib/branding.js');
    const SA = (await api('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).data.token;

    const plan = uid('plan');
    db.prepare(`INSERT INTO plans (id,code,name_ar,name_en,monthly_fee,tech_fee_rate,features_json) VALUES (?,?,?,?,?,?,?)`)
      .run(plan, 'DOP', 'خطة', 'Plan', 0, 0.02,
        JSON.stringify({ qrOrdering: true, digitalPayment: true, multiOutlet: true, unifiedCart: true, marketplace: true, whiteLabel: true }));

    const pid = uid('pt');
    db.prepare(`INSERT INTO partners (id,name_ar,name_en,legal_name,contract_ref,status) VALUES (?,?,?,?,?,'Active')`)
      .run(pid, 'جهة مباشرة', 'Direct Site', 'Direct', 'C-DIR');
    db.prepare(`INSERT INTO subscriptions (id,partner_id,plan_id,status,started_at,renews_at) VALUES (?,?,?,'Active',?,?)`)
      .run(uid('sub'), pid, plan, Date.now(), Date.now() + 2592000000);
    const propId = uid('prop');
    db.prepare(`INSERT INTO properties (id,partner_id,name_ar,name_en,timezone,address,status) VALUES (?,?,?,?,?,?,'Active')`)
      .run(propId, pid, 'الموقع', 'Site', 'Asia/Riyadh', 'Riyadh');
    const zoneId = uid('zn');
    db.prepare(`INSERT INTO zones (id,property_id,name_ar,name_en,type,status) VALUES (?,?,?,?,'hall','Active')`)
      .run(zoneId, propId, 'المنطقة', 'Zone');
    const pointId = uid('pnt'); const token = uid('tok');
    db.prepare(`INSERT INTO points (id,zone_id,code,label,type,active) VALUES (?,?,?,?,'table',1)`).run(pointId, zoneId, 'P-01', 'P-01');
    db.prepare(`INSERT INTO qr_tokens (id,point_id,token,active,created_at) VALUES (?,?,?,1,?)`).run(uid('qt'), pointId, token, Date.now());

    // منفذ **بلا** شريك تجاري -- يديره الشريك الرئيسي بنفسه
    const outDirect = uid('out');
    db.prepare(`INSERT INTO outlets (id,property_id,name_ar,name_en,type,operator,delivery_mode,sla_prep_min,sla_delivery_min,commission_rate,status,created_at)
                VALUES (?,?,?,?,'other','alnadl','runner',8,10,0.1,'Active',?)`)
      .run(outDirect, propId, 'منفذ مباشر', 'Direct Outlet', Date.now());
    // ومنفذ لشريك تجاري مستقل -- للسلّة المختلطة
    const merId = uid('mer');
    db.prepare(`INSERT INTO merchants (id,property_id,name_ar,name_en,kind,commission_rate,status) VALUES (?,?,?,?,'partner',0.2,'Active')`)
      .run(merId, propId, 'علامة مستقلة', 'Independent Brand');
    const outCommercial = uid('out');
    db.prepare(`INSERT INTO outlets (id,property_id,name_ar,name_en,type,operator,delivery_mode,sla_prep_min,sla_delivery_min,commission_rate,merchant_id,status,created_at)
                VALUES (?,?,?,?,'other','third_party','runner',8,10,0.2,?,'Active',?)`)
      .run(outCommercial, propId, 'منفذ العلامة', 'Brand Outlet', merId, Date.now());

    const catId = uid('cat');
    db.prepare(`INSERT INTO categories (id,property_id,name_ar,name_en,sort_order,status) VALUES (?,?,?,?,1,'Active')`)
      .run(catId, propId, 'الكل', 'All');
    // المنتج المباشر: merchant_id = NULL صراحةً
    const prodDirect = uid('prd');
    db.prepare(`INSERT INTO products (id,category_id,merchant_id,outlet_id,sku,name_ar,name_en,base_price,status) VALUES (?,?,NULL,?,?,?,?,?,'Active')`)
      .run(prodDirect, catId, outDirect, 'sku-direct', 'صنف مباشر', 'Direct Item', 40);
    const prodCommercial = uid('prd');
    db.prepare(`INSERT INTO products (id,category_id,merchant_id,outlet_id,sku,name_ar,name_en,base_price,status) VALUES (?,?,?,?,?,?,?,?,'Active')`)
      .run(prodCommercial, catId, merId, outCommercial, 'sku-com', 'صنف العلامة', 'Brand Item', 60);

    /* ===== 1) الظهور في الكتالوج ===== */
    const cat = await api('GET', `/api/catalog?propertyId=${propId}`);
    assertEqual(cat.status, 200, '(1) الكتالوج يستجيب');
    const ids = cat.data.products.map(p => p.id);
    assert(ids.includes(prodDirect),
      '(1) **المنتج المباشر (merchant_id = NULL) يظهر في الكتالوج** — الشريك التجاري ليس شرطًا للظهور');
    assert(ids.includes(prodCommercial), '(1) ومنتج الشريك التجاري يظهر أيضًا');
    const directRow = cat.data.products.find(p => p.id === prodDirect);
    assertEqual(directRow.merchant_id, null, '(1) ويبقى merchant_id فارغًا كما هو — لا شريك وهمي يُختلق له');
    assertEqual(directRow.outlet_id, outDirect, '(1) وارتباطه بالمنفذ محفوظ');

    /* ===== 2) بوابة marketplace ما زالت تعمل على من تخصّه ===== */
    const noMarket = uid('plan');
    db.prepare(`INSERT INTO plans (id,code,name_ar,name_en,monthly_fee,tech_fee_rate,features_json) VALUES (?,?,?,?,?,?,?)`)
      .run(noMarket, 'NOMKT', 'بلا سوق', 'No Marketplace', 0, 0.02,
        JSON.stringify({ qrOrdering: true, multiOutlet: true, unifiedCart: true, marketplace: false }));
    db.prepare('UPDATE subscriptions SET plan_id = ? WHERE partner_id = ?').run(noMarket, pid);
    const gated = await api('GET', `/api/catalog?propertyId=${propId}`);
    const gatedIds = gated.data.products.map(p => p.id);
    assert(!gatedIds.includes(prodCommercial),
      '(2) **بلا باقة marketplace يختفي منتج الشريك التجاري** — البوابة لم تُكسر');
    assert(gatedIds.includes(prodDirect),
      '(2) **بينما يبقى المنتج المباشر ظاهرًا** — البوابة تخصّ من له شريك تجاري، لا الجميع');
    db.prepare('UPDATE subscriptions SET plan_id = ? WHERE partner_id = ?').run(plan, pid);

    /* ===== 3) الطلب والتشغيل ===== */
    const order = await api('POST', '/api/orders', {
      pointId, customerName: 'G', customerPhone: '+966500000009',
      items: [{ productId: prodDirect, qty: 2 }],
    });
    assertEqual(order.status, 201, '(3) **الطلب يُقبل** — كان يُقبل قبل الإصلاح أيضًا، وهو الدليل أن المنتج صالح');
    const oid = order.data.id;
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(oid);
    assertEqual(items.length, 1, '(3) والصنف مسجَّل');
    assertEqual(items[0].merchant_id, null, '(3) **ولا يُختلق له شريك تجاري في سطر الطلب**');
    assertEqual(items[0].outlet_id, outDirect, '(3) وارتباطه بالمنفذ محفوظ في الطلب');

    await api('POST', `/api/orders/${oid}/pay`, { method: 'card' });
    const paid = db.prepare('SELECT status FROM orders WHERE id = ?').get(oid);
    assertEqual(paid.status, 'Paid', '(3) والدفع يمرّ');

    const OPS = await (async () => {
      const c = await api('POST', '/api/admin/users', { username: 'dop_ops', role: 'Operator', partner_scope: pid }, SA);
      await api('POST', `/api/activate/${c.data.activationToken}`, { password: 'dop-ops-strong-pass-1' });
      return (await api('POST', '/api/auth/login', { username: 'dop_ops', password: 'dop-ops-strong-pass-1' })).data.token;
    })();
    const queue = await api('GET', '/api/ops/queue', null, OPS);
    assert(queue.data.some(o => o.id === oid), '(4) **والطلب يظهر في طابور التشغيل**');
    for (const to of ['Accepted', 'Preparing', 'Ready', 'Delivered']) {
      const r = await api('POST', `/api/orders/${oid}/transition`, { to }, OPS);
      assertEqual(r.status, 200, `(4) الانتقال إلى ${to}`);
    }

    /* ===== 5) الإيراد والتسوية ===== */
    const ledger = db.prepare('SELECT * FROM revenue_ledger WHERE order_id = ?').all(oid);
    assert(ledger.length > 0,
      '(5) **الإيراد يُسجَّل للمنتج المباشر** — محرّك الإيراد يعمل على outlet_id لا merchant_id');
    assertEqual(ledger[0].outlet_id, outDirect, '(5) وينسب إلى المنفذ الصحيح');
    assert(ledger[0].gross_amount > 0, '(5) وبقيمة حقيقية');
    const model = JSON.parse(ledger[0].model_snapshot_json || '{}');
    assert(!('merchant_id' in model) || model.merchant_id == null,
      '(5) **ولا عمولة شريك تجاري وهمية تُنشأ** — النموذج نموذج المنفذ المعتاد');

    /* ===== 6) الهوية ===== */
    const eff = branding.resolveBranding({ partnerId: pid, propertyId: propId, outletId: outDirect });
    assert(!Object.values(eff.sources || {}).includes('merchant'),
      '(6) **الهوية لا تحاول استنتاج شريك تجاري** لمنفذ لا يملك واحدًا');

    /* ===== 7) سلّة مختلطة: مباشر + شريك تجاري ===== */
    const mixed = await api('POST', '/api/orders', {
      pointId, customerName: 'G2', customerPhone: '+966500000010',
      items: [{ productId: prodDirect, qty: 1 }, { productId: prodCommercial, qty: 1 }],
    });
    assertEqual(mixed.status, 201, '(7) **سلّة تجمع منتجًا مباشرًا ومنتج شريك تجاري تُقبل**');
    const mixedItems = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY line_total').all(mixed.data.id);
    assertEqual(mixedItems.length, 2, '(7) وكلا الصنفين مسجَّل');
    const directItem = mixedItems.find(i => i.outlet_id === outDirect);
    const comItem = mixedItems.find(i => i.outlet_id === outCommercial);
    assertEqual(directItem.merchant_id, null, '(7) **الصنف المباشر يبقى بلا شريك تجاري**');
    assertEqual(comItem.merchant_id, merId, '(7) **وصنف العلامة يحتفظ بشريكه** — لا اختلاط بين الاثنين');

    const children = db.prepare('SELECT * FROM child_orders WHERE parent_order_id = ?').all(mixed.data.id);
    assertEqual(children.length, 2, '(7) **والسلّة الموحّدة تفرّع الطلب لكل منفذ** — المباشر كأي منفذ آخر');
    assert(children.some(c => c.outlet_id === outDirect) && children.some(c => c.outlet_id === outCommercial),
      '(7) وكل فرع منسوب لمنفذه');

    await api('POST', `/api/orders/${mixed.data.id}/pay`, { method: 'card' });
    const mixedLedger = db.prepare('SELECT * FROM revenue_ledger WHERE order_id = ?').all(mixed.data.id);
    assertEqual(mixedLedger.length, 2,
      '(7) **وسطر إيراد مستقل لكل منفذ** — لا يُخلط إيراد المباشر بإيراد العلامة');
    const dLed = mixedLedger.find(l => l.outlet_id === outDirect);
    const cLed = mixedLedger.find(l => l.outlet_id === outCommercial);
    assert(!!dLed && !!cLed, '(7) والاثنان موجودان');
    // النسب مختلفة عمدًا في التجهيزة (10% و20%) فيظهر أي خلط لو وقع
    assert(Math.abs(dLed.alnadl_amount / dLed.eligible_base - 0.1) < 0.02,
      '(7) **ونسبة المنفذ المباشر تتبع نموذجه هو** (10%)');
    assert(Math.abs(cLed.alnadl_amount / cLed.eligible_base - 0.2) < 0.02,
      '(7) **ونسبة منفذ العلامة تتبع نموذجه هو** (20%) — لا تسرّب بين النموذجين');

  } finally {
    stopServer();
  }
  return summary();
}

module.exports = { run };
if (require.main === module) run().then(ok => process.exit(ok ? 0 : 1));
