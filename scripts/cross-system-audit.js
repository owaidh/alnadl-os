// scripts/cross-system-audit.js
//
// تدقيق متقاطع للنسخة الحالية. **لا يُصلح شيئًا** ولا يضيف نقاطًا ولا يغيّر
// صلاحيات -- يفحص ويُبلّغ فقط.
//
// المبدأ الذي يحكم التصنيف:
//   PASS                   = القدرة موجودة خلفيًا وواجهيًا وتعمل ضمن صلاحيتها
//   GAP                    = قدرة خلفية حقيقية بلا واجهة، ولها رحلة استخدام واضحة
//   BUG                    = تناقض فعلي: الواجهة تعد بما يرفضه الخادم أو العكس
//   INTENTIONALLY DEFERRED = غياب مقصود وموثَّق بسبب
//
// ملاحظة منهجية مستفادة من خطأ التدقيق السابق: لا يُحكم على غياب مسار إلا
// باستدعائه بالشكل الصحيح تمامًا (بما فيه :id بكائن حقيقي). 404 على مسار
// مكتوب خطأً لا يُثبت شيئًا.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 8871;
const BASE = `http://localhost:${PORT}`;
const DB = path.join(__dirname, '..', 'audit-run.sqlite');
let proc = null;

function cleanup() {
  for (const f of [DB, DB + '-shm', DB + '-wal']) { try { fs.unlinkSync(f); } catch (e) {} }
}

async function start() {
  cleanup();
  proc = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), SQLITE_PATH: DB, RATE_LIMIT_DISABLED: '1', LOG_SILENT: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 250));
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return; } catch (e) {}
  }
  throw new Error('server did not start');
}
function stop() { if (proc) { try { proc.kill('SIGKILL'); } catch (e) {} proc = null; } cleanup(); }

async function call(method, p, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await res.json(); } catch (e) {}
    return { status: res.status, data };
  } catch (e) { return { status: 0, data: { error: e.message } }; }
}
const login = async (u, p) => (await call('POST', '/api/auth/login', { username: u, password: p })).data;

const ROWS = [];
function row(o) { ROWS.push(o); }

async function main() {
  await start();
  const db = (() => {
    process.env.SQLITE_PATH = DB;
    delete require.cache[require.resolve('../db.js')];
    return require('../db.js').db;
  })();

  const SA = (await login('admin', 'admin')).token;

  // ---- حسابات لكل دور، عبر دورة IAM الحقيقية ----
  const tokens = { SuperAdmin: SA };
  async function mk(role, scope) {
    const u = 'aud_' + role.toLowerCase();
    const c = await call('POST', '/api/admin/users', { username: u, role, partner_scope: scope || null }, SA);
    if (c.status !== 201) return null;
    await call('POST', `/api/activate/${c.data.activationToken}`, { password: `${u}-strong-pass-1` });
    const l = await login(u, `${u}-strong-pass-1`);
    return l && l.token;
  }
  for (const [role, scope] of [
    ['PartnerAdmin', 'pt_nova'], ['PartnerViewer', 'pt_nova'], ['SiteManager', 'pt_nova'],
    ['Operator', 'pt_nova'], ['Runner', 'pt_nova'],
    ['AlnadlFinance', null], ['ProductAdmin', null], ['SafetyReviewer', null],
  ]) tokens[role] = await mk(role, scope);

  const ROLES = Object.keys(tokens);

  /* ============ 1) Role × Capability — مصفوفة الوصول الفعلية ============
     كل نقطة تُستدعى بكل دور. النتيجة وقائع لا افتراضات. */
  const PROBES = [
    ['GET', '/api/admin/partners', null, 'قائمة الشركاء'],
    ['GET', '/api/admin/plans', null, 'إدارة الباقات'],
    ['GET', '/api/admin/users', null, 'إدارة المستخدمين'],
    ['GET', '/api/admin/properties', null, 'العقارات'],
    ['GET', '/api/admin/outlets', null, 'المنافذ'],
    ['GET', '/api/admin/zones', null, 'المناطق'],
    ['GET', '/api/admin/points', null, 'النقاط'],
    ['GET', '/api/admin/categories', null, 'فئات القائمة'],
    ['GET', '/api/admin/products', null, 'المنتجات'],
    ['GET', '/api/admin/merchants', null, 'التجار'],
    ['GET', '/api/admin/settlements', null, 'التسويات'],
    ['GET', '/api/admin/revenue-ledger', null, 'دفتر الإيراد'],
    ['GET', '/api/admin/wallets', null, 'محافظ الشركات'],
    ['GET', '/api/admin/branding?partnerId=pt_nova', null, 'العلامة التجارية'],
    ['GET', '/api/audit', null, 'سجل التدقيق'],
    ['GET', '/api/admin/notifications', null, 'التنبيهات'],
    ['GET', '/api/ops/queue', null, 'طابور التشغيل'],
    ['GET', '/api/runner/queue', null, 'طابور التسليم'],
    ['GET', '/api/manager/live?propertyId=prop_nova_main', null, 'اللوحة الحية'],
    ['GET', '/api/admin/mechanics', null, 'مختبر الآليات'],
    ['GET', '/api/admin/engage/overview', null, 'نظرة Engage'],
    ['GET', '/api/admin/engage/ledger', null, 'سجل التجارب'],
    ['GET', '/api/admin/engage/kill-switch', null, 'مفتاح الإيقاف'],
    ['GET', '/api/admin/engage/policy-overrides', null, 'تقييدات Engage'],
    ['GET', '/api/engage/effective-state?partnerId=pt_nova', null, 'الحالة الفعّالة'],
    ['GET', '/api/partner/engage/overview', null, 'Engage الشريك'],
    ['GET', '/api/partner/overview?partnerId=pt_nova', null, 'أداء الشريك'],
    ['GET', '/api/admin/loyalty/summary?partnerId=pt_nova', null, 'ملخص الولاء'],
    ['GET', '/api/admin/partners/pt_nova/status', null, 'حالة الشريك'],
    ['GET', '/api/admin/subscription?partnerId=pt_nova', null, 'الاشتراك'],
  ];
  /* تصحيح: كان التدقيق يفحص قدرة الاسترجاع عبر '/api/admin/refunds' وهو
     **مسار غير موجود أصلًا** -- فـ404 كانت عن خطأ كتابة لا عن غياب صلاحية.
     المسار الحقيقي هو GET /api/orders/:id/refunds ويحتاج طلبًا فعليًا،
     فيُهيّأ هنا ويُضاف للمصفوفة بمُعرّفه الصحيح. */
  const probeOrder = await call('POST', '/api/orders',
    { pointId: 'PT-021', customerPhone: '0500222333', items: [{ productId: 'p_latte', qty: 1 }] });
  if (probeOrder.status === 201) {
    await call('POST', `/api/orders/${probeOrder.data.id}/pay`, { method: 'card' });
    for (const to of ['Accepted', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered']) {
      await call('POST', `/api/orders/${probeOrder.data.id}/transition`, { to }, SA);
    }
    PROBES.push(['GET', `/api/orders/${probeOrder.data.id}/refunds`, null, 'سجل استرجاعات الطلب']);
  }

  const matrix = {};
  for (const [m, p, b, label] of PROBES) {
    matrix[label] = {};
    for (const r of ROLES) {
      if (!tokens[r]) { matrix[label][r] = 'n/a'; continue; }
      const res = await call(m, p, b, tokens[r]);
      matrix[label][r] = res.status;
    }
  }

  /* ============ 2) وجود المسارات — بالشكل الصحيح تمامًا ============ */
  const propId = db.prepare('SELECT id FROM properties LIMIT 1').get().id;
  const outletId = db.prepare('SELECT id FROM outlets LIMIT 1').get()?.id;
  const zoneId = db.prepare('SELECT id FROM zones LIMIT 1').get()?.id;
  const pointId = db.prepare('SELECT id FROM points LIMIT 1').get()?.id;
  const routeChecks = [
    ['PATCH', `/api/admin/properties/${propId}`, { deliveryGrouping: 'grouped' }, 'تعديل عقار'],
    ['POST', '/api/admin/properties', { name_en: 'X', partnerId: 'pt_nova' }, 'إنشاء عقار'],
    ['POST', '/api/admin/outlets', { propertyId: propId, name_ar: 'ت', name_en: 'T' }, 'إنشاء منفذ'],
    ['PATCH', outletId ? `/api/admin/outlets/${outletId}` : '/api/admin/outlets/none', { status: 'Active' }, 'تعديل منفذ'],
    ['POST', '/api/admin/zones', { propertyId: propId, name_ar: 'ت', name_en: 'T', type: 'Business' }, 'إنشاء منطقة'],
    ['PATCH', zoneId ? `/api/admin/zones/${zoneId}` : '/api/admin/zones/none', { status: 'Active' }, 'تعديل منطقة'],
    ['POST', '/api/admin/points', { zoneId, label: 'T', type: 'Table' }, 'إنشاء نقطة'],
    ['PATCH', pointId ? `/api/admin/points/${pointId}` : '/api/admin/points/none', { active: 1 }, 'تعديل نقطة'],
    ['POST', '/api/admin/points/bulk', { zoneId, count: 2, labelPrefix: 'AUD' }, 'توليد نقاط بالجملة'],
    ['POST', '/api/admin/mechanics/propose', { name: 'AuditMech', personality: 'PLAY', category: 'static_fallback', pool: [{ body_ar: 'a', body_en: 'b' }] }, 'اقتراح آلية'],
  ];
  const routes = {};
  for (const [m, p, b, label] of routeChecks) {
    const res = await call(m, p, b, SA);
    routes[label] = { method: m, status: res.status, exists: res.status !== 404 };
  }

  /* ============ 3) دورة حياة الشريك — الأثر الحقيقي لا الحالة ============ */
  const lifecycle = [];
  const ob = await call('POST', '/api/admin/onboard', {
    partnerNameAr: 'تدقيق', partnerNameEn: 'AuditCo',
    propertyNameAr: 'ف', propertyNameEn: 'M', planCode: 'PLATFORM',
  }, SA);
  const AP = ob.data.partnerId, APROP = ob.data.propertyId;
  const az = await call('POST', '/api/admin/zones', { propertyId: APROP, name_ar: 'ص', name_en: 'H', type: 'Business' }, SA);
  const apt = await call('POST', '/api/admin/points', { zoneId: az.data.id, label: 'A1', type: 'Table' }, SA);
  const acat = await call('POST', '/api/admin/categories', { propertyId: APROP, name_ar: 'ق', name_en: 'C' }, SA);
  const aprod = await call('POST', '/api/admin/products', { categoryId: acat.data.id, name_ar: 'م', name_en: 'P', basePrice: 20 }, SA);
  const auser = await call('POST', '/api/admin/users', { username: 'aud_lc_op', role: 'Operator', partner_scope: AP }, SA);
  await call('POST', `/api/activate/${auser.data.activationToken}`, { password: 'aud-lc-op-strong-1' });

  async function probeState(label) {
    const qr = await call('GET', `/api/qr/${apt.data.token}`);
    const ord = await call('POST', '/api/orders', { pointId: apt.data.id, customerPhone: '0500999888', items: [{ productId: aprod.data.id, qty: 1 }] });
    const lg = await login('aud_lc_op', 'aud-lc-op-strong-1');
    const st = await call('GET', `/api/admin/partners/${AP}/status`, null, SA);
    const settle = await call('GET', '/api/admin/settlements', null, SA);
    lifecycle.push({
      state: label,
      login: lg && lg.token ? 'ALLOW' : 'DENY',
      qr: qr.status === 200 ? 'ALLOW' : `DENY(${qr.status})`,
      newOrder: ord.status === 201 ? 'ALLOW' : `DENY(${ord.status})`,
      settlements: settle.status === 200 ? 'ALLOW' : `DENY(${settle.status})`,
      capabilities: st.data && st.data.capabilities,
      openOrders: st.data && st.data.openOrders,
    });
    return ord.status === 201 ? ord.data.id : null;
  }

  await probeState('Draft');
  await call('POST', `/api/admin/partners/${AP}/status`, { status: 'Active', reason: 'audit activation' }, SA);
  const liveOrder = await probeState('Active');
  if (liveOrder) await call('POST', `/api/orders/${liveOrder}/pay`, { method: 'card' });

  /* ---- حارس الإغلاق: يُفحص **بينما الطلب ما زال مفتوحًا** ----
     تصحيح نزاهة: كان هذا الفحص يجري **بعد** إكمال الطلب إلى Delivered،
     فيُرجع 200 بطبيعة الحال -- أي أن الأداة لم تكن تُثبت الشرط إطلاقًا
     رغم أن التقرير كان يوثّقه كأنه فُحص. الترتيب الآن يفحص الحالتين
     أولًا، ثم يُصرّف الطلب، ثم يُغلق. */
  const closeGuard = {};
  closeGuard.activeWithOpenOrder = (await call('POST', `/api/admin/partners/${AP}/status`,
    { status: 'Closed', reason: 'audit: close attempt while Active with an open order' }, SA));

  await call('POST', `/api/admin/partners/${AP}/status`, { status: 'Suspended', reason: 'audit suspension' }, SA);
  await probeState('Suspended');

  closeGuard.suspendedWithOpenOrder = (await call('POST', `/api/admin/partners/${AP}/status`,
    { status: 'Closed', reason: 'audit: close attempt while Suspended with an open order' }, SA));

  // الطلب المفتوح يُكمل أثناء الإيقاف؟
  let completed = null;
  if (liveOrder) {
    let ok = true;
    for (const to of ['Accepted', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered']) {
      const t = await call('POST', `/api/orders/${liveOrder}/transition`, { to }, SA);
      if (t.status !== 200) ok = false;
    }
    completed = ok;
  }
  // تُصرَّف بقية الطلبات المفتوحة لهذا الشريك حتى يصبح الإغلاق ممكنًا فعلًا
  const NEXT = { 'Payment Pending': 'Paid', Paid: 'Accepted', Accepted: 'Preparing',
                 Preparing: 'Ready', Ready: 'Out for Delivery', 'Out for Delivery': 'Delivered' };
  for (let guard = 0; guard < 40; guard++) {
    const open = db.prepare(
      `SELECT id, status FROM orders WHERE partner_id = ? AND status NOT IN ('Delivered','Cancelled','Refunded','Delivery Failed')`
    ).all(AP);
    if (!open.length) break;
    for (const o of open) {
      const to = NEXT[o.status];
      if (to) await call('POST', `/api/orders/${o.id}/transition`, { to }, SA);
    }
  }
  closeGuard.openOrdersRemaining = db.prepare(
    `SELECT COUNT(*) c FROM orders WHERE partner_id = ? AND status NOT IN ('Delivered','Cancelled','Refunded','Delivery Failed')`
  ).get(AP).c;

  closeGuard.afterAllOrdersClosed = (await call('POST', `/api/admin/partners/${AP}/status`,
    { status: 'Closed', reason: 'audit: close after every order reached a terminal state' }, SA));

  await call('POST', `/api/admin/partners/${AP}/status`, { status: 'Active', reason: 'audit reactivate' }, SA);
  await probeState('Active (again)');

  /* ============ 4) Subscription × Partner Status ============ */
  db.prepare(`UPDATE subscriptions SET status='Suspended' WHERE partner_id=?`).run(AP);
  const subSuspended = await call('GET', `/api/engage/effective-state?partnerId=${AP}`, null, SA);
  const orderWithSubSuspended = await call('POST', '/api/orders', { pointId: apt.data.id, items: [{ productId: aprod.data.id, qty: 1 }] });
  db.prepare(`UPDATE subscriptions SET status='Active' WHERE partner_id=?`).run(AP);

  /* ============ 5) Tenant Isolation — قراءة وكتابة ============ */
  const PA = tokens.PartnerAdmin;
  const isolation = [];
  const otherProp = db.prepare(`SELECT id FROM properties WHERE partner_id != 'pt_nova' LIMIT 1`).get();
  const otherAcct = db.prepare(`SELECT id FROM loyalty_accounts WHERE partner_id IS NOT NULL AND partner_id != 'pt_nova' LIMIT 1`).get();
  const checks = [
    ['READ', 'GET', `/api/partner/overview?partnerId=${AP}`, null, 'أداء شريك آخر'],
    ['READ', 'GET', `/api/engage/effective-state?partnerId=${AP}`, null, 'حالة Engage لشريك آخر'],
    ['READ', 'GET', `/api/admin/loyalty/summary?partnerId=${AP}`, null, 'ولاء شريك آخر'],
    ['READ', 'GET', `/api/admin/partners/${AP}/status`, null, 'حالة شريك آخر'],
    ['WRITE', 'PATCH', otherProp ? `/api/admin/properties/${otherProp.id}` : '/api/admin/properties/none', { deliveryGrouping: 'separate' }, 'تعديل عقار شريك آخر'],
    ['WRITE', 'POST', '/api/admin/engage/policy-overrides', { scopeType: 'property', scopeId: otherProp ? otherProp.id : 'none', flagKey: 'engage_enabled', enabled: false }, 'تقييد Engage لشريك آخر'],
    ['WRITE', 'POST', `/api/admin/partners/${AP}/status`, { status: 'Suspended', reason: 'cross tenant attempt' }, 'تغيير حالة شريك آخر'],
  ];
  for (const [kind, m, p, b, label] of checks) {
    const res = await call(m, p, b, PA);
    isolation.push({ kind, label, status: res.status, refused: res.status === 403 || res.status === 404 });
  }
  if (otherAcct) {
    const r = await call('GET', `/api/admin/loyalty/accounts/${otherAcct.id}/history`, null, PA);
    isolation.push({ kind: 'READ', label: 'سجل حساب ولاء لشريك آخر', status: r.status, refused: r.status === 403 });
  }

  /* ============ 6) IAM ============ */
  const iam = {};
  const nu = await call('POST', '/api/admin/users', { username: 'aud_iam_u', role: 'Operator', partner_scope: 'pt_nova' }, SA);
  iam.createdPending = nu.data && nu.data.status === 'pending_activation';
  iam.tokenReturnedOnce = !!(nu.data && nu.data.activationToken);
  iam.passwordNullInDb = db.prepare('SELECT password_hash FROM users WHERE username=?').get('aud_iam_u').password_hash === null;
  iam.loginBeforeActivation = (await call('POST', '/api/auth/login', { username: 'aud_iam_u', password: 'aud_iam_u' })).status === 401;
  await call('POST', `/api/activate/${nu.data.activationToken}`, { password: 'aud-iam-strong-1' });
  iam.loginAfterActivation = (await call('POST', '/api/auth/login', { username: 'aud_iam_u', password: 'aud-iam-strong-1' })).status === 200;
  iam.replayRefused = (await call('POST', `/api/activate/${nu.data.activationToken}`, { password: 'other-pass-1' })).status === 400;
  const roleChange = await call('PATCH', `/api/admin/users/${nu.data.id}`, { role: 'SiteManager' }, SA);
  iam.roleChange = roleChange.status === 200;
  const disable = await call('PATCH', `/api/admin/users/${nu.data.id}`, { status: 'suspended' }, SA);
  iam.disable = disable.status === 200;
  iam.disabledCannotLogin = (await call('POST', '/api/auth/login', { username: 'aud_iam_u', password: 'aud-iam-strong-1' })).status === 401;
  const reissue = await call('POST', `/api/admin/users/${nu.data.id}/activation`, {}, SA);
  iam.reissue = reissue.status === 200;
  const listed = await call('GET', '/api/admin/users', null, SA);
  iam.noPasswordInList = !JSON.stringify(listed.data).match(/password|token_hash|activationToken/i);

  /* ============ 7) Financial integrity ============ */
  const fin = {};
  const fo = await call('POST', '/api/orders', { pointId: 'PT-021', customerPhone: '0500111000', items: [{ productId: 'p_latte', qty: 2 }] }, null);
  if (fo.status === 201) {
    await call('POST', `/api/orders/${fo.data.id}/pay`, { method: 'card' });
    for (const to of ['Accepted', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered']) {
      await call('POST', `/api/orders/${fo.data.id}/transition`, { to }, SA);
    }
    const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE order_id=? AND status='Captured'`).get(fo.data.id).s;
    const partial = await call('POST', `/api/orders/${fo.data.id}/refund`, { amount: 5, reason: 'audit partial' }, SA);
    fin.partialRefund = partial.status === 200;
    const idemKey = 'audit-idem-1';
    await call('POST', `/api/orders/${fo.data.id}/refund`, { amount: 3, reason: 'audit idem', idempotencyKey: idemKey }, SA);
    const beforeDup = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE order_id=?`).get(fo.data.id).s;
    await call('POST', `/api/orders/${fo.data.id}/refund`, { amount: 3, reason: 'audit idem', idempotencyKey: idemKey }, SA);
    const afterDup = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE order_id=?`).get(fo.data.id).s;
    fin.idempotent = Math.abs(afterDup - beforeDup) < 0.01;
    const rest = await call('POST', `/api/orders/${fo.data.id}/refund`, { reason: 'audit remainder' }, SA);
    fin.fullRemaining = rest.status === 200;
    const total = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE order_id=?`).get(fo.data.id).s;
    fin.neverExceedsPaid = total <= paid + 0.01;
    fin.overRefundRefused = (await call('POST', `/api/orders/${fo.data.id}/refund`, { reason: 'again' }, SA)).status >= 400;
    fin.ledgerReversed = db.prepare(`SELECT COUNT(*) c FROM revenue_ledger WHERE order_id=? AND type='refund_adjustment'`).get(fo.data.id).c > 0;
  }

  stop();

  /* حارس نزاهة التدقيق: أي 500 في المصفوفة يعني خللًا حقيقيًا أو مسبارًا
     ناقصًا -- لا يُصنَّف كصلاحية. وأي 404 يجب أن يكون على مسار **قُصد**
     إثبات غيابه، لا على مسار مكتوب خطأً. */
  const anomalies = [];
  for (const [cap, byRole] of Object.entries(matrix)) {
    for (const [role, code] of Object.entries(byRole)) {
      if (code === 500) anomalies.push({ kind: 'SERVER_ERROR', cap, role });
      if (code === 404) anomalies.push({ kind: 'NOT_FOUND', cap, role });
    }
  }

  const report = { generatedAt: new Date().toISOString(), roles: ROLES, matrix, routes, lifecycle, anomalies,
    closeGuard: {
      // كل سيناريو مُسجَّل منفصلًا مع رمزه وعدد الطلبات المفتوحة وقتها،
      // فلا يبقى ادعاء في التقرير بلا دليل مباشر من هذه الأداة.
      activeWithOpenOrder: {
        expected: 409, status: closeGuard.activeWithOpenOrder.status,
        code: closeGuard.activeWithOpenOrder.data && closeGuard.activeWithOpenOrder.data.code,
        openOrders: closeGuard.activeWithOpenOrder.data && closeGuard.activeWithOpenOrder.data.openOrders,
        pass: closeGuard.activeWithOpenOrder.status === 409,
      },
      suspendedWithOpenOrder: {
        expected: 409, status: closeGuard.suspendedWithOpenOrder.status,
        code: closeGuard.suspendedWithOpenOrder.data && closeGuard.suspendedWithOpenOrder.data.code,
        openOrders: closeGuard.suspendedWithOpenOrder.data && closeGuard.suspendedWithOpenOrder.data.openOrders,
        pass: closeGuard.suspendedWithOpenOrder.status === 409,
      },
      openOrdersDrained: { expected: 0, remaining: closeGuard.openOrdersRemaining, pass: closeGuard.openOrdersRemaining === 0 },
      closeAfterDrain: {
        expected: 200, status: closeGuard.afterAllOrdersClosed.status,
        pass: closeGuard.afterAllOrdersClosed.status === 200,
      },
    },
    openOrderCompletedWhileSuspended: completed,
    subscriptionCross: { engageBlockedBy: subSuspended.data && subSuspended.data.blockedBy, orderStatus: orderWithSubSuspended.status },
    isolation, iam, fin };
  fs.writeFileSync(path.join(__dirname, '..', 'audit-findings.json'), JSON.stringify(report, null, 2));
  if (anomalies.length) {
    console.log('ANOMALIES IN ACCESS MATRIX:', JSON.stringify(anomalies));
  } else {
    console.log('access matrix clean: no 500, no unintended 404');
  }
  const cg = report.closeGuard;
  console.log('close guard: Active+open=' + cg.activeWithOpenOrder.status + '(' + (cg.activeWithOpenOrder.pass ? 'PASS' : 'FAIL') + ')'
    + ' Suspended+open=' + cg.suspendedWithOpenOrder.status + '(' + (cg.suspendedWithOpenOrder.pass ? 'PASS' : 'FAIL') + ')'
    + ' drained=' + cg.openOrdersDrained.remaining + '(' + (cg.openOrdersDrained.pass ? 'PASS' : 'FAIL') + ')'
    + ' closeAfter=' + cg.closeAfterDrain.status + '(' + (cg.closeAfterDrain.pass ? 'PASS' : 'FAIL') + ')');
  console.log('audit complete -> audit-findings.json');
}

main().catch(e => { stop(); console.error('AUDIT FAILED:', e.message); process.exit(1); });
