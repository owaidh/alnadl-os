// tests/operational-closure-b.js — الدفعة (ب) من Operational Closure:
//   P1-04 سياسة التحصيل في رحلة الضيف
//   P1-03 ربط المحافظ بكيان الشريك
//   P1-05 دورة حياة الشريك التجاري
//
// كل تأكيد يفحص أثرًا حقيقيًا عبر HTTP أو على قاعدة فعلية -- لا شكل بيانات
// ولا وجود دالة. المعيار المتّبع في هذا المستودع منذ R3: الاختبار يُثبت
// السلوك الذي يهمّ الضيف أو المحاسب، لا أن الكود يعمل.
'use strict';
const { startServer, stopServer, api, assert, assertEqual, summary, resetCounts, getDataPath } = require('./helpers.js');

function openDb() {
  process.env.SQLITE_PATH = getDataPath();
  for (const m of ['../db.js', '../lib/loyalty.js', '../lib/partner-status.js', '../lib/branding.js',
    '../lib/payment-policy.js', '../lib/merchant-status.js', '../lib/wallet.js']) {
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
  console.log('=== Operational Closure (B): payment policy · wallet scope · merchant lifecycle ===');

  try {
    const { db, uid } = openDb();
    const policyLib = require('../lib/payment-policy.js');
    const merchantLib = require('../lib/merchant-status.js');
    const SA = (await api('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).data.token;

    /* ---------- مستأجر كامل قابل للطلب فعلًا ---------- */
    const planId = uid('plan');
    db.prepare(`INSERT INTO plans (id,code,name_ar,name_en,monthly_fee,tech_fee_rate,features_json) VALUES (?,?,?,?,?,?,?)`)
      .run(planId, 'OCB', 'دفعة ب', 'Batch B', 0, 0.02,
        JSON.stringify({ qrOrdering: true, digitalPayment: true, corporateWallet: true, marketplace: true, unifiedCart: true }));

    function mkTenant(label) {
      const pid = uid('pt');
      db.prepare(`INSERT INTO partners (id,name_ar,name_en,legal_name,contract_ref,status) VALUES (?,?,?,?,?,'Active')`)
        .run(pid, label, label, label, 'C-' + label);
      db.prepare(`INSERT INTO subscriptions (id,partner_id,plan_id,status,started_at,renews_at) VALUES (?,?,?,'Active',?,?)`)
        .run(uid('sub'), pid, planId, Date.now(), Date.now() + 2592000000);
      const propId = uid('prop');
      db.prepare(`INSERT INTO properties (id,partner_id,name_ar,name_en,timezone,address,status) VALUES (?,?,?,?,?,?,'Active')`)
        .run(propId, pid, label + ' P', label + ' P', 'Asia/Riyadh', 'Riyadh');
      const outId = uid('out');
      db.prepare(`INSERT INTO outlets (id,property_id,name_ar,name_en,type,operator,delivery_mode,sla_prep_min,sla_delivery_min,commission_rate,status,created_at)
                  VALUES (?,?,?,?,'coffee','alnadl','runner',8,10,0.1,'Active',?)`)
        .run(outId, propId, label + ' O', label + ' O', Date.now());
      const zoneId = uid('zn');
      db.prepare(`INSERT INTO zones (id,property_id,name_ar,name_en,type,status) VALUES (?,?,?,?,'hall','Active')`)
        .run(zoneId, propId, label + ' Z', label + ' Z');
      const pointId = uid('pnt');
      db.prepare(`INSERT INTO points (id,zone_id,code,label,type,active) VALUES (?,?,?,?,'table',1)`)
        .run(pointId, zoneId, label + '-01', label + '-01');
      const token = uid('tok');
      db.prepare(`INSERT INTO qr_tokens (id,point_id,token,active,created_at) VALUES (?,?,?,1,?)`)
        .run(uid('qt'), pointId, token, Date.now());
      const merId = uid('mer');
      db.prepare(`INSERT INTO merchants (id,property_id,name_ar,name_en,kind,commission_rate,status) VALUES (?,?,?,?,'alnadl',0.1,'Active')`)
        .run(merId, propId, label + ' M', label + ' M');
      const catId = uid('cat');
      db.prepare(`INSERT INTO categories (id,property_id,name_ar,name_en,sort_order,status) VALUES (?,?,?,?,1,'Active')`)
        .run(catId, propId, label + ' C', label + ' C');
      const prodId = uid('prd');
      db.prepare(`INSERT INTO products (id,category_id,merchant_id,outlet_id,sku,name_ar,name_en,base_price,status) VALUES (?,?,?,?,?,?,?,?,'Active')`)
        .run(prodId, catId, merId, outId, prodId, label + ' item', label + ' item', 100);
      return { pid, propId, outId, zoneId, pointId, token, merId, catId, prodId };
    }

    const A = mkTenant('OCA');
    const B = mkTenant('OCB');
    // مستأجر ثالث مخصّص لدورة الشريك التجاري: شرط الإغلاق يقرأ **كل** طلبات
    // ذلك الشريك التجاري، فخلطه بمستأجر تجري عليه اختبارات أخرى يجعل عدّ
    // الطلبات المفتوحة رهينة ترتيب الاختبارات لا رهينة السلوك.
    const C = mkTenant('OCC');
    const PA = await makeUser(SA, 'ocb_padmin', 'PartnerAdmin', A.pid);
    const PB = await makeUser(SA, 'ocb_padmin_b', 'PartnerAdmin', B.pid);
    const OPS = await makeUser(SA, 'ocb_operator', 'Operator', A.pid);
    const FIN = await makeUser(SA, 'ocb_finance', 'AlnadlFinance', null);

    const placeOrder = (t) => api('POST', '/api/orders', {
      pointId: t.pointId, customerName: 'G', customerPhone: '+966500000001',
      items: [{ productId: t.prodId, qty: 1 }],
    });
    const setPolicy = (scopeType, scopeId, body, token) =>
      api('PUT', `/api/admin/payment-policy/${scopeType}/${scopeId}`, body, token || SA);

    /* ================= 1) الافتراض التاريخي لم يتغيّر ================= */
    const base = await placeOrder(A);
    assertEqual(base.status, 201, '(1) الطلب يُنشأ بلا أي سياسة مُعرّفة');
    assertEqual(base.data.status, 'Payment Pending',
      '(1) **وبلا سياسة يبقى السلوك التاريخي حرفيًا** — Payment Pending، فلا يتغيّر شيء على عميل قائم');
    assertEqual(base.data.requiresGuestPayment, true, '(1) والرد يقول صراحة إن هناك تحصيلًا');
    const baseRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(base.data.id);
    assertEqual(baseRow.collection_status, 'PENDING', '(1) وحالة التحصيل PENDING');

    /* ================= 2) الوراثة: شريك → عقار → منفذ ================= */
    const setP = await setPolicy('partner', A.pid, { policy: 'POS_ON_DELIVERY', reason: 'test' });
    assertEqual(setP.status, 200, '(2) سياسة على مستوى الشريك تُحفظ');
    let eff = policyLib.resolvePaymentPolicy({ partnerId: A.pid, propertyId: A.propId, outletId: A.outId });
    assertEqual(eff.policy, 'POS_ON_DELIVERY', '(2) **العقار والمنفذ يرثان سياسة الشريك** بلا تجاوز');
    assertEqual(eff.source, 'partner', '(2) والمصدر مُعلَن: partner');

    await setPolicy('property', A.propId, { policy: 'ONLINE', reason: 'test' });
    eff = policyLib.resolvePaymentPolicy({ partnerId: A.pid, propertyId: A.propId, outletId: A.outId });
    assertEqual(eff.policy, 'ONLINE', '(2) **تجاوز العقار يغلب الشريك**');
    assertEqual(eff.source, 'property', '(2) والمصدر property');

    await setPolicy('outlet', A.outId, { policy: 'NO_GUEST_PAYMENT', reason: 'test' });
    eff = policyLib.resolvePaymentPolicy({ partnerId: A.pid, propertyId: A.propId, outletId: A.outId });
    assertEqual(eff.policy, 'NO_GUEST_PAYMENT', '(2) **والمنفذ يغلب الاثنين** — الأدق يحسم');
    assertEqual(eff.source, 'outlet', '(2) والمصدر outlet');
    const effProp = policyLib.resolvePaymentPolicy({ partnerId: A.pid, propertyId: A.propId });
    assertEqual(effProp.policy, 'ONLINE',
      '(2) **وسياسة المنفذ لا تتسرّب لمستوى العقار** — سلّة موزّعة لا يحكمها منفذ واحد');

    /* ================= 3) رحلة "لا تحصيل" كاملة ================= */
    const noPay = await placeOrder(A);
    assertEqual(noPay.status, 201, '(3) الطلب يُنشأ في منفذ لا يُحصِّل');
    assertEqual(noPay.data.status, 'Confirmed',
      '(3) **ويخرج مؤكَّدًا مباشرة** — لا Payment Pending تعلق للأبد بانتظار دفع لن يحدث');
    assertEqual(noPay.data.requiresGuestPayment, false, '(3) والرد يخبر الواجهة أن لا خطوة دفع');
    const npRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(noPay.data.id);
    assertEqual(npRow.collection_status, 'NOT_REQUIRED', '(3) وحالة التحصيل NOT_REQUIRED لا Paid');
    assertEqual(npRow.payment_method, 'NO_GUEST_PAYMENT', '(3) والوسيلة مسجّلة صراحة');
    assert(npRow.total > 0,
      '(3) **والقيمة الكاملة محفوظة على الطلب** — لا تحصيل لا يعني مجانًا');
    assertEqual(db.prepare('SELECT COUNT(*) c FROM payments WHERE order_id = ?').get(noPay.data.id).c, 0,
      '(3) ولا سطر دفع واحد يُختلق');

    const revRows = db.prepare('SELECT COUNT(*) c FROM revenue_ledger WHERE order_id = ?').get(noPay.data.id).c;
    assert(revRows > 0,
      '(3) **والإيراد يُسجَّل رغم غياب التحصيل** — وإلا لطُبخ الطلب وسُلّم بلا أثر مالي واحد');
    assertEqual(db.prepare(`SELECT COUNT(*) c FROM engage_outbox WHERE order_id = ? AND event_type='order.confirmed'`).get(noPay.data.id).c, 1,
      '(3) وحدث التأكيد يُنشر مرة واحدة، كما في مسار الدفع تمامًا');

    const q = await api('GET', '/api/ops/queue', null, OPS);
    assert(q.data.some(o => o.id === noPay.data.id),
      '(3) **والطلب يظهر في طابور المطبخ** — الحالة الجديدة لم تُخفِه عن المشغّل');

    const payTry = await api('POST', `/api/orders/${noPay.data.id}/pay`, { method: 'card' });
    assertEqual(payTry.status, 409, '(3) **ومحاولة دفعه تُرفض** — الإنفاذ على الخادم لا بإخفاء زر');
    assertEqual(payTry.data.code, 'NO_GUEST_PAYMENT', '(3) بسبب آلي مستقر');

    /* ================= 4) الوسيلة غير المصرّح بها ================= */
    await setPolicy('outlet', A.outId, { policy: 'POS_ON_DELIVERY', reason: 'test' });
    const posOrder = await placeOrder(A);
    assertEqual(posOrder.data.status, 'Payment Pending', '(4) سياسة تحصيل عند التسليم تُبقي خطوة الدفع');
    const wrongMethod = await api('POST', `/api/orders/${posOrder.data.id}/pay`, { method: 'card' });
    assertEqual(wrongMethod.status, 400,
      '(4) **بطاقة في منفذ يُحصِّل عند التسليم تُرفض** — الوسيلة تُفحص لا تُفترض');
    assertEqual(wrongMethod.data.code, 'METHOD_NOT_ALLOWED', '(4) بسبب آلي مستقر');
    const rightMethod = await api('POST', `/api/orders/${posOrder.data.id}/pay`, { method: 'pos' });
    assertEqual(rightMethod.status, 200, '(4) والوسيلة المصرّح بها تمرّ');
    const posRow = db.prepare('SELECT * FROM orders WHERE id = ?').get(posOrder.data.id);
    assertEqual(posRow.collection_status, 'COLLECTED', '(4) وحالة التحصيل تصير COLLECTED');
    assertEqual(posRow.payment_method, 'pos', '(4) والوسيلة الفعلية تُسجَّل كما وقعت');

    /* ================= 5) MIXED: التقاطع لا الاستبدال ================= */
    const badMixed = await setPolicy('outlet', A.outId, { policy: 'MIXED', reason: 'test' });
    assertEqual(badMixed.status, 400, '(5) MIXED بلا قائمة وسائل تُرفض عند الحفظ');
    await setPolicy('outlet', A.outId, { policy: 'MIXED', allowedMethods: ['card', 'cash', 'bitcoin'], reason: 'test' });
    const mixedEff = policyLib.resolvePaymentPolicy({ partnerId: A.pid, propertyId: A.propId, outletId: A.outId });
    assert(!mixedEff.allowedMethods.includes('bitcoin'),
      '(5) **وسيلة لا يعرفها النظام تُصفّى ولو خُزّنت** — قائمة مضبوطة لا تمنح ما لا تملك');
    assert(mixedEff.allowedMethods.includes('card') && mixedEff.allowedMethods.includes('cash'),
      '(5) والوسائل المعروفة تبقى');

    /* ================= 6) الطلب يُحكَم بالسياسة التي أُنشئ تحتها ============ */
    await setPolicy('outlet', A.outId, { policy: 'NO_GUEST_PAYMENT', reason: 'test' });
    const frozen = await placeOrder(A);
    assertEqual(frozen.data.status, 'Confirmed', '(6) طلب أُنشئ بلا تحصيل');
    await setPolicy('outlet', A.outId, { policy: 'ONLINE', reason: 'policy changed later' });
    const lateCollect = await api('POST', `/api/orders/${frozen.data.id}/pay`, { method: 'card' });
    assertEqual(lateCollect.status, 409,
      '(6) **تغيير السياسة لاحقًا لا يجعل طلبًا قديمًا قابلًا للتحصيل** — وإلا حُصِّل من ضيف وُعد بألا يُحصَّل منه');

    /* ================= 7) لا يُسترجَع ما لم يُحصَّل ================= */
    // نقود طلب "لا تحصيل" إلى Delivered بمسار التشغيل العادي
    let cur = frozen.data.id;
    for (const [to, tok] of [['Accepted', OPS], ['Preparing', OPS], ['Ready', OPS], ['Delivered', OPS]]) {
      await api('POST', `/api/orders/${cur}/transition`, { to }, tok);
    }
    const delivered = db.prepare('SELECT status FROM orders WHERE id = ?').get(cur).status;
    assertEqual(delivered, 'Delivered',
      '(7) **الطلب غير المحصَّل يقطع دورة التشغيل كاملة** حتى التسليم');
    const refundTry = await api('POST', `/api/orders/${cur}/refund`, { amount: 10, reason: 'test' }, FIN);
    assertEqual(refundTry.status, 409,
      '(7) **واسترجاعه مرفوض** — استرجاع ما لم يُحصَّل يُنشئ مصروفًا وهميًا في الدفتر');
    assertEqual(refundTry.data.code, 'NO_GUEST_PAYMENT', '(7) وبسبب صريح لا برسالة "لا رصيد" مضلِّلة');

    /* ================= 8) صلاحيات إدارة السياسة ================= */
    const crossWrite = await setPolicy('property', B.propId, { policy: 'ONLINE', reason: 'x' }, PA);
    assertEqual(crossWrite.status, 403,
      '(8) **PartnerAdmin لا يكتب سياسة على عقار شريك آخر** — النطاق يُفحص على الخادم');
    const ownWrite = await setPolicy('property', A.propId, { policy: 'ONLINE', reason: 'x' }, PA);
    assertEqual(ownWrite.status, 200, '(8) ويكتب على عقاره');
    const crossRead = await api('GET', `/api/admin/payment-policy/overrides?partnerId=${B.pid}`, null, PA);
    assertEqual(crossRead.status, 403, '(8) **ولا يقرأ سياسة شريك آخر** — الرفض صريح لا تجاهل صامت');
    const opsWrite = await setPolicy('property', A.propId, { policy: 'ONLINE', reason: 'x' }, OPS);
    assertEqual(opsWrite.status, 403, '(8) والمشغّل لا يملك السطح أصلًا');
    const ghost = await setPolicy('partner', 'pt_does_not_exist', { policy: 'ONLINE', reason: 'x' });
    assertEqual(ghost.status, 404, '(8) ونطاق غير موجود يُرفض بدل إنشاء سياسة معلّقة');
    const badPolicy = await setPolicy('property', A.propId, { policy: 'FREE_FOR_ALL', reason: 'x' });
    assertEqual(badPolicy.status, 400, '(8) وسياسة غير معروفة تُرفض');

    /* ================= 9) الحذف = عودة للوراثة، لا ONLINE ================= */
    await setPolicy('partner', A.pid, { policy: 'NO_GUEST_PAYMENT', reason: 'hotel' });
    await setPolicy('property', A.propId, { policy: 'ONLINE', reason: 'exception' });
    const del = await api('DELETE', `/api/admin/payment-policy/property/${A.propId}`, null, SA);
    assertEqual(del.status, 200, '(9) تجاوز العقار يُزال');
    const afterDel = policyLib.resolvePaymentPolicy({ partnerId: A.pid, propertyId: A.propId });
    assertEqual(afterDel.policy, 'NO_GUEST_PAYMENT',
      '(9) **وتعود الوراثة لا الافتراض** — عقار داخل فندق لا يُحصِّل لا يبدأ فجأة بتحصيل المال');

    /* ================= 10) نقطة الضيف العامة ================= */
    const guestPol = await api('GET', `/api/payment-policy?pointId=${A.pointId}`);
    assertEqual(guestPol.status, 200, '(10) الضيف يقرأ السياسة بلا جلسة');
    assertEqual(guestPol.data.requiresGuestPayment, false, '(10) وتطابق ما يحلّه الخادم عند الإنشاء');
    assertEqual(guestPol.data.allowedMethods.length, 0, '(10) وبلا وسائل حين لا تحصيل');

    /* ================= P1-03: المحافظ ================= */
    // محفظتان بنفس owner_ref تحت شريكين مختلفين -- الحالة الواقعية بالضبط
    const walA = uid('wal'), walB = uid('wal');
    db.prepare(`INSERT INTO wallet_accounts (id,partner_id,owner_name,owner_ref,monthly_budget,spent_this_period,period_start,policy_json,status,created_at)
                VALUES (?,?,?,?,?,0,?,?,'Active',?)`)
      .run(walA, A.pid, 'A pool', 'dept:engineering', 500, Date.now(), JSON.stringify({ perOrderCap: 60 }), Date.now());
    db.prepare(`INSERT INTO wallet_accounts (id,partner_id,owner_name,owner_ref,monthly_budget,spent_this_period,period_start,policy_json,status,created_at)
                VALUES (?,?,?,?,?,0,?,?,'Active',?)`)
      .run(walB, B.pid, 'B pool', 'dept:engineering', 500, Date.now(), JSON.stringify({ perOrderCap: 60 }), Date.now());

    const lookupA = await api('GET', `/api/wallets/lookup?ownerRef=dept:engineering&t=${A.token}`);
    assertEqual(lookupA.status, 200, '(11) البحث برمز QR الخاص بالشريك (أ) ينجح');
    assertEqual(lookupA.data.id, walA,
      '(11) **ويعيد محفظة الشريك (أ) لا (ب)** رغم تطابق owner_ref حرفيًا');
    const lookupB = await api('GET', `/api/wallets/lookup?ownerRef=dept:engineering&t=${B.token}`);
    assertEqual(lookupB.data.id, walB, '(11) والعكس صحيح من رمز الشريك (ب)');
    const noScope = await api('GET', '/api/wallets/lookup?ownerRef=dept:engineering');
    assertEqual(noScope.status, 400,
      '(11) **وبحث بلا نطاق يُرفض** — كان يسمح بخصم ميزانية شركة تحت شريك آخر');
    const badScope = await api('GET', `/api/wallets/lookup?ownerRef=nope&t=${A.token}`);
    assertEqual(badScope.status, 404, '(11) ومعرّف غير موجود يُرفض بنفس شكل الرد');

    // خصم عابر للمستأجرين عبر طلب مصنوع يدويًا
    await setPolicy('partner', A.pid, { policy: 'ONLINE', reason: 'reset' });
    const crossWalletOrder = await api('POST', '/api/orders', {
      pointId: A.pointId, walletId: walB, items: [{ productId: A.prodId, qty: 1 }],
    });
    assertEqual(crossWalletOrder.status, 409,
      '(12) **طلب يحمل محفظة شريك آخر يُرفض عند الإنشاء** — الفحص لا يعتمد على الواجهة');
    assertEqual(crossWalletOrder.data.code, 'WALLET_PARTNER_MISMATCH', '(12) بسبب آلي مستقر');

    // الفحص الثاني عند الدفع: طلب سليم ثم تُبدَّل محفظته في القاعدة.
    // السياسة تُفتح للمحفظة أولًا -- بوابة الوسيلة تسبق فحص الملكية وتردّ
    // 400 قبله، وهو ترتيب صحيح لكنه يحجب ما نريد إثباته هنا.
    // على مستوى المنفذ تحديدًا: تجاوز المنفذ من اختبار سابق ما زال قائمًا
    // وهو الأدق، فسياسة على مستوى الشريك لن تصل. هذا هو سلوك الوراثة
    // الصحيح -- والاختبار يخضع له بدل أن يلتفّ عليه.
    await setPolicy('outlet', A.outId, { policy: 'MIXED', allowedMethods: ['card', 'wallet'], reason: 'wallet test' });
    const walletOrder = await api('POST', '/api/orders', {
      pointId: A.pointId, walletId: walA, items: [{ productId: A.prodId, qty: 1 }],
    });
    assertEqual(walletOrder.status, 201, '(12) وطلب بمحفظة شريكه يُقبل');
    db.prepare('UPDATE orders SET wallet_id = ? WHERE id = ?').run(walB, walletOrder.data.id);
    const crossPay = await api('POST', `/api/orders/${walletOrder.data.id}/pay`, { method: 'wallet' });
    assertEqual(crossPay.status, 409,
      '(12) **وحتى لو وصلت محفظة غريبة إلى الطلب، الدفع يرفضها** — فحصان لا واحد');
    assertEqual(db.prepare('SELECT spent_this_period FROM wallet_accounts WHERE id = ?').get(walB).spent_this_period, 0,
      '(12) ولم تُخصم ريالًا واحدًا من ميزانية الشريك الآخر');

    const dupWallet = await api('POST', '/api/admin/wallets',
      { partnerId: A.pid, ownerName: 'dup', ownerRef: 'dept:engineering', monthlyBudget: 100 }, SA);
    assertEqual(dupWallet.status, 409, '(13) وتكرار owner_ref داخل الشريك نفسه يُرفض');
    const sameRefOtherPartner = await api('POST', '/api/admin/wallets',
      { partnerId: B.pid, ownerName: 'ok', ownerRef: 'dept:sales', monthlyBudget: 100 }, SA);
    assertEqual(sameRefOtherPartner.status, 201, '(13) **والتفرّد داخل الشريك لا عالميًا** — لا يُمنع شريك من اسم شائع');
    const ghostWallet = await api('POST', '/api/admin/wallets',
      { partnerId: 'pt_ghost', ownerName: 'x', ownerRef: 'y', monthlyBudget: 10 }, SA);
    assertEqual(ghostWallet.status, 400, '(13) ومحفظة بشريك غير موجود تُرفض بدل أن تصير يتيمة');

    /* ================= P1-05: دورة الشريك التجاري ================= */
    const PC = await makeUser(SA, 'ocb_padmin_c', 'PartnerAdmin', C.pid);
    const OPC = await makeUser(SA, 'ocb_operator_c', 'Operator', C.pid);
    const mStatus = () => api('GET', `/api/admin/merchants/${C.merId}/status`, null, PC);
    const setMerchant = (to, tok, reason) =>
      api('POST', `/api/admin/merchants/${C.merId}/status`, { status: to, reason: reason === undefined ? 'test' : reason }, tok || SA);

    const s0 = await mStatus();
    assertEqual(s0.data.status, 'Active', '(14) الشريك التجاري يبدأ نشطًا');

    const noReason = await setMerchant('Inactive', SA, null);
    assertEqual(noReason.status, 400, '(14) **وتغيير الحالة بلا سبب يُرفض** — أثر تجاري على طرف ثالث لا يُترك بلا تفسير');

    const toInactive = await setMerchant('Inactive');
    assertEqual(toInactive.status, 200, '(14) الإيقاف المؤقت ينجح');
    const catAfter = await api('GET', `/api/catalog?propertyId=${C.propId}`);
    assert(!catAfter.data.merchants.some(m => m.id === C.merId),
      '(15) **ويختفي من كتالوج الضيف فورًا**');
    assert(!catAfter.data.products.some(p => p.merchant_id === C.merId),
      '(15) ومعه أصنافه');
    const staleCart = await placeOrder(C);
    assertEqual(staleCart.status, 409,
      '(15) **وسلّة قديمة في متصفّح ضيف تُرفض** — الإخفاء من القائمة ليس إنفاذًا');

    // طلب مفتوح يمنع الإغلاق
    await setMerchant('Active');
    const openOrder = await placeOrder(C);
    await api('POST', `/api/orders/${openOrder.data.id}/pay`, { method: 'card' });
    await setMerchant('Inactive');
    const sOpen = await mStatus();
    assert(sOpen.data.openOrders > 0, '(16) الملخّص يعدّ الطلبات المفتوحة فعليًا');
    assert(!sOpen.data.allowedTransitions.includes('Closed'),
      '(16) **والإغلاق لا يُعرَض أصلًا ما دام هناك عمل قائم** — لا زر يفشل عند الضغط');
    assert(sOpen.data.blockedTransitions.some(b => b.to === 'Closed' && b.remedy),
      '(16) والسبب والمسار الصحيح مُصرَّح بهما');
    const earlyClose = await setMerchant('Closed');
    assertEqual(earlyClose.status, 409,
      '(16) **ومحاولة الإغلاق تُرفض على الخادم** — لا يبقى صنف مباع بلا مسار إتمام');

    // إكمال الطلب المفتوح ثم الإغلاق
    let oid = openOrder.data.id;
    for (const to of ['Accepted', 'Preparing', 'Ready', 'Delivered']) {
      await api('POST', `/api/orders/${oid}/transition`, { to }, OPC);
    }
    const nowClose = await setMerchant('Closed');
    assertEqual(nowClose.status, 200, '(17) **وبعد إغلاق آخر طلب يصير الإغلاق ممكنًا** — Inactive ثم إكمال ثم Closed');

    const ledgerAfterClose = db.prepare(`SELECT COUNT(*) c FROM revenue_ledger WHERE order_id = ?`).get(oid).c;
    assert(ledgerAfterClose > 0,
      '(17) **وسجل الإيراد عن بيع تمّ قبل الإغلاق يبقى** — Closed ليس Delete ولا يُسقط عمولة مستحقة');

    const reopenByPartner = await setMerchant('Active', PC);
    assertEqual(reopenByPartner.status, 403,
      '(18) **وإعادة الفتح بعد الإغلاق محجوزة لـSuperAdmin** — قرار تعاقدي لا تشغيلي');
    const reopenBySA = await setMerchant('Active', SA);
    assertEqual(reopenBySA.status, 200, '(18) وSuperAdmin يعيد فتحه');

    const crossMerchant = await api('POST', `/api/admin/merchants/${B.merId}/status`, { status: 'Inactive', reason: 'x' }, PC);
    assertEqual(crossMerchant.status, 403, '(19) **ولا يلمس PartnerAdmin شريكًا تجاريًا لدى شريك آخر**');
    const crossMerchantRead = await api('GET', `/api/admin/merchants/${B.merId}/status`, null, PC);
    assertEqual(crossMerchantRead.status, 403, '(19) ولا يقرأ حالته');
    const invalidJump = await api('POST', `/api/admin/merchants/${C.merId}/status`, { status: 'Deleted', reason: 'x' }, SA);
    assertEqual(invalidJump.status, 400, '(19) وحالة غير معروفة تُرفض');

    assertEqual(merchantLib.CAPABILITIES.Closed.revenueAccrual, true,
      '(20) والنموذج نفسه ينصّ أن الحقوق المالية لا تُمسّ في أي حالة');

  } finally {
    stopServer();
  }
  return summary();
}

module.exports = { run };
if (require.main === module) run().then(ok => process.exit(ok ? 0 : 1));
