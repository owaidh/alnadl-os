// tests/context-switch-audit.js — تدقيق «تبديل السياق» لـSuperAdmin.
//
// السؤال المطروح: حين يدخل SuperAdmin سياق شريك، هل يبقى SuperAdmin يعمل
// داخل سياق، أم يتحوّل إلى محاكاة PartnerAdmin؟ ولمن تعود الصلاحية --
// للهوية أم للسياق؟
//
// هذه المجموعة **تقيس ولا تفترض**: تستدعي النقاط الحساسة فعليًا بعد
// التبديل، وتحاول الوصول إلى شريك آخر، وتخرج من السياق ثم تفحص ما بقي.
'use strict';
const { startServer, stopServer, api, assert, assertEqual, summary, resetCounts, getDataPath } = require('./helpers.js');

function openDb() {
  process.env.SQLITE_PATH = getDataPath();
  for (const m of ['../db.js']) { try { delete require.cache[require.resolve(m)]; } catch (e) {} }
  return require('../db.js');
}

async function run() {
  resetCounts();
  await startServer();
  console.log('=== SuperAdmin context switch — four-layer audit ===');
  const findings = [];

  try {
    const { db, uid } = openDb();
    const SA = (await api('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).data.token;

    const plan = uid('plan');
    db.prepare(`INSERT INTO plans (id,code,name_ar,name_en,monthly_fee,tech_fee_rate,features_json) VALUES (?,?,?,?,?,?,?)`)
      .run(plan, 'CTX', 'خطة', 'Plan', 0, 0.02,
        JSON.stringify({ qrOrdering: true, digitalPayment: true, multiOutlet: true, unifiedCart: true, marketplace: true, whiteLabel: true, corporateWallet: true, analytics: true, partnerDashboard: true }));

    function mkTenant(label) {
      const pid = uid('pt');
      db.prepare(`INSERT INTO partners (id,name_ar,name_en,legal_name,contract_ref,status) VALUES (?,?,?,?,?,'Active')`)
        .run(pid, label, label, label, 'C-' + label);
      db.prepare(`INSERT INTO subscriptions (id,partner_id,plan_id,status,started_at,renews_at) VALUES (?,?,?,'Active',?,?)`)
        .run(uid('sub'), pid, plan, Date.now(), Date.now() + 2592000000);
      const propId = uid('prop');
      db.prepare(`INSERT INTO properties (id,partner_id,name_ar,name_en,timezone,address,status) VALUES (?,?,?,?,?,?,'Active')`)
        .run(propId, pid, label + ' P', label + ' P', 'Asia/Riyadh', 'Riyadh');
      const outId = uid('out');
      db.prepare(`INSERT INTO outlets (id,property_id,name_ar,name_en,type,operator,delivery_mode,sla_prep_min,sla_delivery_min,commission_rate,status,created_at)
                  VALUES (?,?,?,?,'other','alnadl','runner',8,10,0.1,'Active',?)`)
        .run(outId, propId, label + ' O', label + ' O', Date.now());
      return { pid, propId, outId };
    }
    const A = mkTenant('CTXA');
    const B = mkTenant('CTXB');

    /* ================= الطبقة 1 — الهوية ================= */
    // التبديل يقع على العميل بالكامل: لا نقطة نهاية تُستدعى ولا رمز يتغيّر.
    const routes = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
    const hasSwitchEndpoint = /['"]\/api\/[a-z-]*context[a-z-]*['"]/i.test(routes)
      || /switch[_-]?context/i.test(routes);
    assert(!hasSwitchEndpoint,
      '(1) **لا توجد نقطة نهاية لتبديل السياق إطلاقًا** — التبديل حالة عميل بحتة');
    findings.push({ layer: 'Identity', fact: 'no server-side context concept; token unchanged; role stays SuperAdmin' });

    // ولا سجل تدقيق للتبديل
    const auditBefore = db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE action LIKE '%context%'`).get().c;
    assertEqual(auditBefore, 0,
      '(1) **ولا يُسجَّل التبديل في سجل التدقيق** — لا أثر يربط إجراءً بالسياق الذي وقع فيه');
    findings.push({ layer: 'Identity', fact: 'context switch is not audited' });

    /* ================= الطبقة 3 — RBAC على الخادم ================= */
    // كل النقاط الحساسة تُستدعى بنفس رمز SuperAdmin -- وهو ما يملكه العميل
    // فعلًا بعد التبديل، لأن الرمز لم يتغيّر.
    const sensitive = [
      ['Plans', 'GET', '/api/admin/plans'],
      ['Users', 'GET', '/api/admin/users'],
      ['Audit', 'GET', '/api/admin/audit'],
      ['Properties', 'GET', '/api/admin/properties'],
      ['Outlets', 'GET', '/api/admin/outlets'],
      ['Wallets', 'GET', '/api/admin/wallets'],
      ['Settlements', 'GET', '/api/admin/settlements'],
      ['Tenants', 'GET', '/api/admin/partners'],
    ];
    const platformWide = [];
    for (const [name, method, path] of sensitive) {
      const r = await api(method, path, null, SA);
      if (r.status === 200) {
        const rows = Array.isArray(r.data) ? r.data : (r.data && (r.data.assets || r.data.rows)) || [];
        const spansTenants = Array.isArray(rows) && rows.some(x => x && x.partner_id && x.partner_id !== A.pid);
        if (spansTenants) platformWide.push(name);
      }
    }
    assert(platformWide.length > 0,
      `(3) **الصلاحية تأتي من الهوية لا من السياق**: نقاط تعيد بيانات المنصة كاملة بعد التبديل — ${platformWide.join(', ')}`);
    findings.push({ layer: 'Server RBAC', fact: `permission derives from SuperAdmin identity; platform-wide endpoints: ${platformWide.join(', ')}` });

    // الكتابة على شريك آخر: هل تُقبل؟
    const writeB = await api('PUT', `/api/admin/payment-policy/property/${B.propId}`,
      { policy: 'ONLINE', reason: 'context audit' }, SA);
    assertEqual(writeB.status, 200,
      '(3) **والكتابة على شريك آخر تُقبل بعد التبديل** — لا حدّ خادميّ للسياق');
    findings.push({ layer: 'Server RBAC', fact: 'writes to another tenant succeed while "inside" a context' });

    // النقاط التي تُقيَّد فعلًا بالسياق: تلك التي تقبل partnerId صراحة
    const scopedRead = await api('GET', `/api/admin/branding/effective?partnerId=${B.pid}`, null, SA);
    assertEqual(scopedRead.status, 200,
      '(3) وقراءة هوية شريك آخر تُقبل أيضًا — التقييد يقع على العميل حين يمرّر partnerId الحالي');
    findings.push({ layer: 'Server RBAC', fact: 'scoping is a client-side choice of which partnerId to send' });

    /* ================= الطبقة 4 — عزل المستأجرين ================= */
    // لا يوجد عزل على الخادم لـSuperAdmin -- وهذا **تصميم مقصود**: الدور
    // موجود ليدير المنصة كلها. السؤال الحقيقي هو ما إذا كانت الواجهة توحي
    // بغير ذلك.
    const partners = await api('GET', '/api/admin/partners', null, SA);
    assert(partners.data.length >= 2,
      '(4) **SuperAdmin يرى كل الشركاء بعد التبديل** — لا عزل خادميّ، وهو المتوقع لدور المنصة');
    findings.push({ layer: 'Tenant Isolation', fact: 'no server-side isolation for SuperAdmin — by design for a platform role' });

    /* ================= الحوكمة — Acting Context في سجل التدقيق ================= */
    const http = require('http');
    const { BASE: BASE_URL } = require('./helpers.js');
    const callWithHeaders = (method, path, body, token, headers) => new Promise((resolve) => {
      const base = new URL(BASE_URL());
      const payload = body ? JSON.stringify(body) : null;
      const rq = http.request({
        host: base.hostname, port: base.port, method, path,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          ...(headers || {}),
        },
      }, (res) => {
        let b = ''; res.on('data', d => b += d);
        res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(b) }); } catch (e) { resolve({ status: res.statusCode, data: {} }); } });
      });
      rq.on('error', () => resolve({ status: 0, data: {} }));
      if (payload) rq.write(payload);
      rq.end();
    });
    const lastAudit = (action) => db.prepare(
      `SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1`).get(action);

    /* (ح-1) دخول السياق يُسجَّل كحدث مستقل */
    const enter = await callWithHeaders('POST', '/api/admin/acting-context/enter', { partnerId: A.pid }, SA);
    assertEqual(enter.status, 200, '(ح1) دخول السياق يُقبل');
    const entered = lastAudit('ADMIN_CONTEXT_ENTERED');
    assert(!!entered, '(ح1) **ويُسجَّل ADMIN_CONTEXT_ENTERED**');
    assertEqual(entered.acting_partner_id, A.pid, '(ح1) بالسياق الصحيح');
    assertEqual(entered.role, 'SuperAdmin', '(ح1) **والدور يبقى SuperAdmin** — لا انتحال ولا خفض');

    /* (ح-2) إجراء داخل السياق يحمل acting_partner_id */
    const edit = await callWithHeaders('PUT', `/api/admin/payment-policy/property/${A.propId}`,
      { policy: 'ONLINE', reason: 'governance test' }, SA, { 'X-Acting-Partner-Id': A.pid });
    assertEqual(edit.status, 200, '(ح2) تعديل داخل السياق ينجح');
    const edited = lastAudit('payment_policy_set');
    assertEqual(edited.acting_partner_id, A.pid,
      '(ح2) **السجل يقول داخل أي سياق وقع الإجراء** — لا "SuperAdmin عدّل" مجرّدة');
    assertEqual(edited.target_partner_id, A.pid, '(ح2) والمستأجر المستهدَف مُسجَّل أيضًا');
    assertEqual(edited.actor, 'admin', '(ح2) والفاعل كما هو');
    assertEqual(edited.role, 'SuperAdmin', '(ح2) والدور كما هو — الحقل بيانات وصفية لا صلاحية');

    /* (ح-3) الترويسة لا تمنح صلاحية */
    const PA_B = await (async () => {
      const c = await api('POST', '/api/admin/users', { username: 'ctx_padmin_b', role: 'PartnerAdmin', partner_scope: B.pid }, SA);
      await api('POST', `/api/activate/${c.data.activationToken}`, { password: 'ctx-padmin-strong-1' });
      return (await api('POST', '/api/auth/login', { username: 'ctx_padmin_b', password: 'ctx-padmin-strong-1' })).data.token;
    })();
    const forged = await callWithHeaders('PUT', `/api/admin/payment-policy/property/${A.propId}`,
      { policy: 'ONLINE', reason: 'forgery attempt' }, PA_B, { 'X-Acting-Partner-Id': A.pid });
    assertEqual(forged.status, 403,
      '(ح3) **PartnerAdmin لا يكتسب شيئًا بإرسال الترويسة** — لا تمنح صلاحية إطلاقًا');
    const afterForge = lastAudit('payment_policy_set');
    assertEqual(afterForge.id, edited.id, '(ح3) ولا سجل جديد يُكتب لمحاولة مرفوضة');

    // وحتى في إجراء مسموح له، الترويسة تُتجاهل ولا تلوّث السجل
    const ownWrite = await callWithHeaders('PUT', `/api/admin/payment-policy/property/${B.propId}`,
      { policy: 'ONLINE', reason: 'own scope' }, PA_B, { 'X-Acting-Partner-Id': A.pid });
    assertEqual(ownWrite.status, 200, '(ح3) وإجراؤه داخل نطاقه ينجح');
    const ownRow = lastAudit('payment_policy_set');
    assertEqual(ownRow.acting_partner_id, null,
      '(ح3) **والترويسة المزوَّرة تُتجاهل فلا تُنسب إلى سياق لم يقع** — تلويث السجل أسوأ من غيابه');
    assertEqual(ownRow.role, 'PartnerAdmin', '(ح3) والدور المسجَّل هو دوره الحقيقي');

    /* (ح-4) شريك غير موجود يُتجاهل */
    const ghostCtx = await callWithHeaders('PUT', `/api/admin/payment-policy/property/${A.propId}`,
      { policy: 'ONLINE', reason: 'ghost ctx' }, SA, { 'X-Acting-Partner-Id': 'pt_does_not_exist' });
    assertEqual(ghostCtx.status, 200, '(ح4) الإجراء نفسه لا يتأثر');
    assertEqual(lastAudit('payment_policy_set').acting_partner_id, null,
      '(ح4) **وسياق لشريك غير موجود لا يُسجَّل** — لا سياق مخترع في السجل');

    /* (ح-5) إجراء عابر أثناء السياق: acting ≠ target، ويُرى */
    const cross = await callWithHeaders('PUT', `/api/admin/payment-policy/property/${B.propId}`,
      { policy: 'ONLINE', reason: 'cross tenant while in A' }, SA, { 'X-Acting-Partner-Id': A.pid });
    assertEqual(cross.status, 200, '(ح5) الخادم يسمح — SuperAdmin يملك الصلاحية على الاثنين');
    const crossRow = lastAudit('payment_policy_set');
    assertEqual(crossRow.acting_partner_id, A.pid, '(ح5) والسياق المُعلَن مُسجَّل كما هو');
    assertEqual(crossRow.target_partner_id, B.pid,
      '(ح5) **والمستهدَف الحقيقي مُسجَّل بوضوح** — لا يُسجَّل السياق كأنه الهدف بصمت');
    assert(crossRow.acting_partner_id !== crossRow.target_partner_id,
      '(ح5) **واختلافهما ظاهر للمراجع** — وهو ما يجعل الإجراء العابر قابلًا للرصد أصلًا');

    /* (ح-6) الخروج يُسجَّل، وما بعده بلا سياق عالق */
    const exitCall = await callWithHeaders('POST', '/api/admin/acting-context/exit', { partnerId: A.pid }, SA);
    assertEqual(exitCall.status, 200, '(ح6) الخروج يُقبل');
    assertEqual(lastAudit('ADMIN_CONTEXT_EXITED').acting_partner_id, A.pid, '(ح6) **ويُسجَّل ADMIN_CONTEXT_EXITED**');
    const afterExitWrite = await callWithHeaders('PUT', `/api/admin/payment-policy/property/${A.propId}`,
      { policy: 'ONLINE', reason: 'after exit' }, SA);
    assertEqual(afterExitWrite.status, 200, '(ح6) وإجراء المنصة بعده ينجح');
    assertEqual(lastAudit('payment_policy_set').acting_partner_id, null,
      '(ح6) **ولا سياق عالق في الإجراء التالي** — الخروج يُنهي الإطار فعلًا');

    /* ================= الطبقة 2 — الواجهة (DOM حقيقي) ================= */
    let playwright = null;
    try { playwright = require('playwright'); } catch (e) {
      const path = require('path');
      for (const base of (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)) {
        try { playwright = require(path.join(base, 'playwright')); break; } catch (e2) {}
      }
    }
    if (!playwright) {
      console.log('  SKIPPED: playwright unavailable — UI layer of the context audit did not run.');
    } else {
      const { BASE } = require('./helpers.js');
      const browser = await playwright.chromium.launch();
      const page = await browser.newPage();
      try {
        await page.goto(BASE() + '/'); await page.waitForTimeout(600);
        await page.evaluate(async () => {
          const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin' }) });
          S.session = await r.json(); S.mode = 'staff'; render();
        });
        await page.waitForTimeout(700);
        const navBefore = await page.$$eval('.sidebar-link', els => els.map(e => e.innerText.trim()));
        assert(navBefore.length > 0, '(2) قائمة المنصة تُرسم قبل التبديل');

        await page.evaluate(async (id) => { await App.selectTenantForAdmin(id); }, A.pid);
        await page.waitForTimeout(1200);

        const inCtx = await page.evaluate(() => ({
          role: S.session.user.role,
          partnerId: S.PARTNER_ID,
          nav: [...document.querySelectorAll('.sidebar-link')].map(e => e.innerText.trim()),
          scope: (document.querySelector('.sidebar-scope') || {}).innerText || '',
          banner: (document.querySelector('.notebox') || {}).innerText || '',
        }));
        assertEqual(inCtx.role, 'SuperAdmin',
          '(2) **الهوية تبقى SuperAdmin داخل السياق** — تبديل سياق لا انتحال دور');
        assertEqual(inCtx.partnerId, A.pid, '(2) والسياق يشير إلى الشريك المختار');
        assert(/SuperAdmin/.test(inCtx.scope) && /(يعمل داخل سياق|acting in)/.test(inCtx.scope),
          '(2) **والواجهة تقول صراحةً «SuperAdmin يعمل داخل سياق X»** — لا توحي بأنه دخل كـPartnerAdmin');
        assert(/(صلاحياتك ما زالت SuperAdmin|authority is still full SuperAdmin)/.test(inCtx.banner),
          '(2) واللافتة تُصرّح أن الصلاحية كاملة وأن التقييد على البيانات التشغيلية وحدها');
        assert(inCtx.nav.length < navBefore.length,
          `(2) **وشاشات إدارة المنصة تُحجب داخل السياق** (${navBefore.length} ← ${inCtx.nav.length})`);

        /* محاولة الوصول إلى شريك آخر من داخل السياق -- عبر الواجهة نفسها */
        const bReach = await page.evaluate(async (bid) => {
          const r = await fetch(`/api/admin/branding/effective?partnerId=${bid}`, { headers: { Authorization: 'Bearer ' + S.session.token } });
          return r.status;
        }, B.pid);
        assertEqual(bReach, 200,
          '(4) **وقراءة شريك آخر تنجح — وهذا EXPECTED DESIGN** لدور المنصة، لا خرق عزل');

        /* حارس العبور من الواجهة أثناء السياق */
        const blocked = await page.evaluate(async (bid) => {
          try {
            await api('PUT', `/api/admin/payment-policy/property/x?partnerId=${bid}`, { partnerId: bid, policy: 'ONLINE', reason: 'ui cross' }, true);
            return 'ALLOWED';
          } catch (e) { return e.code || e.message; }
        }, B.pid);
        assert(/CROSS_TENANT_IN_CONTEXT/.test(blocked),
          '(ح7) **الواجهة تمنع كتابة موجَّهة لشريك آخر أثناء السياق** — الخادم لن يمنعها لأن الصلاحية قائمة بحق');

        /* والقدرة تبقى كاملة بعد العودة لمستوى المنصة */
        await page.evaluate(() => App.exitPartnerContext());
        await page.waitForTimeout(900);
        const afterReturn = await page.evaluate(async (bid) => {
          try {
            const r = await fetch(`/api/admin/branding/effective?partnerId=${bid}`, { headers: { Authorization: 'Bearer ' + S.session.token } });
            return r.status;
          } catch (e) { return 0; }
        }, B.pid);
        assertEqual(afterReturn, 200,
          '(ح7) **وتعود القدرة كاملة بعد الخروج** — المنع تأطير للسياق لا خفض للصلاحية');
        // إعادة الدخول لإكمال فحص الخروج أدناه
        await page.evaluate(async (id) => { await App.selectTenantForAdmin(id); }, A.pid);
        await page.waitForTimeout(1000);

        /* الخروج: كل ما وضعه الدخول يجب أن يزول */
        await page.evaluate(() => App.exitPartnerContext());
        await page.waitForTimeout(900);
        const afterExit = await page.evaluate(() => ({
          partnerId: S.PARTNER_ID, propertyId: S.PROPERTY_ID,
          ctx: S.contextSwitchedFrom, branding: S.branding, media: S.brandMedia,
          nav: [...document.querySelectorAll('.sidebar-link')].map(e => e.innerText.trim()),
          scope: (document.querySelector('.sidebar-scope') || {}).innerText || '',
        }));
        assertEqual(afterExit.partnerId, null,
          '(2) **والخروج يُزيل النطاق فعلًا** — كان يمسح اللافتة ويترك S.PARTNER_ID، فيكتب المشغّل على شريك لا يراه');
        assertEqual(afterExit.propertyId, null, '(2) والعقار كذلك');
        assertEqual(afterExit.ctx, null, '(2) ومؤشّر السياق يُمسح');
        assertEqual(afterExit.branding, null, '(2) ولا تبقى بيانات الشريك السابق محمَّلة في الشاشات');
        assert(!/(يعمل داخل سياق|acting in)/.test(afterExit.scope), '(2) ووسم السياق يختفي من النطاق');
        assertEqual(afterExit.nav.length, navBefore.length,
          '(2) **وتعود رؤية المنصة كاملة بلا فساد جلسة**');
      } finally {
        await browser.close();
      }
    }

    console.log('\n  --- AUDIT FINDINGS ---');
    for (const f of findings) console.log(`  [${f.layer}] ${f.fact}`);
    console.log('');

  } finally {
    stopServer();
  }
  return summary();
}

module.exports = { run };
if (require.main === module) run().then(ok => process.exit(ok ? 0 : 1));
