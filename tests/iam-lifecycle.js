// tests/iam-lifecycle.js — Role & Control Completeness Corrective §3.1/§3.2 + §12.
//
// الادعاء تحت الاختبار: لم يعد أي حساب يُنشأ بكلمة مرور معروفة للمسؤول،
// ولا يستطيع أي دور تجاوز نطاقه أو منح دور أعلى منه، ولا يمكن إقفال
// المنصة بتعطيل آخر SuperAdmin.
'use strict';
const { startServer, stopServer, api, loginAs, assert, assertEqual, summary, resetCounts, getDataPath, BASE } = require('./helpers.js');

function openDb() {
  process.env.SQLITE_PATH = getDataPath();
  delete require.cache[require.resolve('../db.js')];
  return require('../db.js');
}

async function run() {
  resetCounts();
  await startServer();
  console.log('=== Role Corrective: IAM Lifecycle & Non-Escalation ===');

  try {
    const { db } = openDb();
    const SA = await loginAs('admin');

    // ================= §3.1 لا كلمة مرور معروفة للمسؤول =================
    const created = await api('POST', '/api/admin/users',
      { username: 'ops_newhire', role: 'Operator' }, SA);
    assertEqual(created.status, 201, '§3.1 يُنشأ المستخدم');
    assertEqual(created.data.status, 'pending_activation',
      '§3.1 الحساب يبدأ بحالة انتظار التفعيل، لا نشطًا بكلمة مرور');
    assert(!!created.data.activationToken, '§3.1 يُعاد رمز تفعيل لينسخه المسؤول');

    const row = db.prepare('SELECT password_hash, status FROM users WHERE username=?').get('ops_newhire');
    assertEqual(row.password_hash, null,
      '§3.1 لا توجد كلمة مرور إطلاقًا في قاعدة البيانات — انتهى مبدأ "كلمة المرور = اسم المستخدم"');

    // السلوك القديم بالضبط: الدخول باسم المستخدم ككلمة مرور
    const oldWay = await api('POST', '/api/auth/login', { username: 'ops_newhire', password: 'ops_newhire' });
    assertEqual(oldWay.status, 401,
      '§3.1 الدخول باسم المستخدم ككلمة مرور مرفوض — هذه هي الثغرة التي أُغلقت');

    // الرمز مُجزَّأ لا صريح
    const stored = db.prepare('SELECT token_hash FROM user_activation_tokens WHERE user_id=?').get(created.data.id);
    assert(stored.token_hash !== created.data.activationToken && stored.token_hash.length === 64,
      '§12 رمز التفعيل يُخزَّن مُجزَّأً فقط، لا نصًا صريحًا');

    // ================= دورة التفعيل =================
    const peek = await api('GET', `/api/activate/${created.data.activationToken}`);
    assertEqual(peek.data.valid, true, 'التفعيل: الرمز الصحيح صالح');
    assertEqual(peek.data.username, 'ops_newhire', 'ويعرض اسم المستخدم قبل التعيين');

    const weak = await api('POST', `/api/activate/${created.data.activationToken}`, { password: 'short' });
    assertEqual(weak.status, 400, '§13 كلمة مرور ضعيفة مرفوضة');
    const stillPending = db.prepare('SELECT status FROM users WHERE username=?').get('ops_newhire');
    assertEqual(stillPending.status, 'pending_activation', 'ومحاولة فاشلة لا تُفعّل الحساب');

    const ok = await api('POST', `/api/activate/${created.data.activationToken}`, { password: 'a-strong-password-1' });
    assertEqual(ok.status, 200, 'التفعيل ينجح بكلمة مرور مقبولة');

    const nowLogin = await api('POST', '/api/auth/login', { username: 'ops_newhire', password: 'a-strong-password-1' });
    assertEqual(nowLogin.status, 200, 'المستخدم يدخل بكلمة المرور التي اختارها هو');
    assertEqual(nowLogin.data.user.role, 'Operator', 'بدوره الصحيح');

    // §12 إعادة اللعب
    const replay = await api('POST', `/api/activate/${created.data.activationToken}`, { password: 'another-password-1' });
    assertEqual(replay.status, 400, '§12 إعادة استخدام نفس الرمز مرفوضة — استخدام واحد');
    const stillWorks = await api('POST', '/api/auth/login', { username: 'ops_newhire', password: 'a-strong-password-1' });
    assertEqual(stillWorks.status, 200, 'ومحاولة الإعادة لم تُغيّر كلمة المرور القائمة');

    // انتهاء الصلاحية
    const exp = await api('POST', '/api/admin/users', { username: 'exp_user', role: 'Runner' }, SA);
    db.prepare(`UPDATE user_activation_tokens SET expires_at=? WHERE user_id=?`).run(Date.now() - 1000, exp.data.id);
    const expired = await api('POST', `/api/activate/${exp.data.activationToken}`, { password: 'a-strong-password-1' });
    assertEqual(expired.status, 400, '§12 رمز منتهي الصلاحية مرفوض');

    // رمز مختلق
    const bogus = await api('GET', '/api/activate/completely-made-up-token');
    assertEqual(bogus.data.valid, false, '§12 رمز مختلق مرفوض');
    assert(!bogus.data.username, 'ولا يكشف أي معلومة عن أي حساب');

    // إعادة الإصدار تُبطل السابق
    const reissued = await api('POST', `/api/admin/users/${created.data.id}/activation`, {}, SA);
    assertEqual(reissued.status, 200, '§3.1 يمكن إعادة إصدار رابط تفعيل (استعادة وصول)');
    const afterReset = await api('POST', '/api/auth/login', { username: 'ops_newhire', password: 'a-strong-password-1' });
    assertEqual(afterReset.status, 401,
      '§3.1 إعادة التعيين تُبطل كلمة المرور القائمة فورًا — لا يبقى وصول قديم صالحًا');

    // ================= §3.2 عدم التصعيد =================
    const pa = await api('POST', '/api/admin/users',
      { username: 'pa_scoped', role: 'PartnerAdmin', partner_scope: 'pt_nova' }, SA);
    await api('POST', `/api/activate/${pa.data.activationToken}`, { password: 'partner-admin-pass-1' });
    const PA = (await api('POST', '/api/auth/login', { username: 'pa_scoped', password: 'partner-admin-pass-1' })).data.token;

    const escalate = await api('POST', '/api/admin/users', { username: 'sneaky_sa', role: 'SuperAdmin' }, PA);
    assertEqual(escalate.status, 403,
      '§3.2 PartnerAdmin لا يستطيع إنشاء SuperAdmin — منع تصعيد الصلاحية مفروض على الخادم');
    for (const r of ['AlnadlFinance', 'ProductAdmin', 'SafetyReviewer', 'PartnerAdmin']) {
      const att = await api('POST', '/api/admin/users', { username: 'x_' + r, role: r }, PA);
      assertEqual(att.status, 403, `§3.2 PartnerAdmin لا يستطيع منح دور ${r}`);
    }
    const allowedRole = await api('POST', '/api/admin/users', { username: 'site_op', role: 'Operator' }, PA);
    assertEqual(allowedRole.status, 201, '§3.2 لكنه يستطيع إنشاء الأدوار التشغيلية المصرح بها');
    const scoped = db.prepare('SELECT partner_scope FROM users WHERE username=?').get('site_op');
    assertEqual(scoped.partner_scope, 'pt_nova',
      '§3.2 النطاق يُفرض من الخادم — لا يُقرأ من جسم الطلب');

    // نطاق مزوّر في جسم الطلب
    const forged = await api('POST', '/api/admin/users',
      { username: 'forged_scope', role: 'Operator', partner_scope: 'pt_alrowad' }, PA);
    assertEqual(forged.status, 201, 'الطلب يُقبل');
    const forgedRow = db.prepare('SELECT partner_scope FROM users WHERE username=?').get('forged_scope');
    assertEqual(forgedRow.partner_scope, 'pt_nova',
      '§3.2 لكن النطاق المزوّر في الجسم يُتجاهل تمامًا — الشريك من الجلسة لا من العميل');

    // عبور المستأجر على التعديل
    const otherPartnerUser = await api('POST', '/api/admin/users',
      { username: 'other_op', role: 'Operator', partner_scope: 'pt_alrowad' }, SA);
    const crossEdit = await api('PATCH', `/api/admin/users/${otherPartnerUser.data.id}`, { status: 'suspended' }, PA);
    assertEqual(crossEdit.status, 403,
      '§12 PartnerAdmin من شريك A لا يستطيع تعديل مستخدم شريك B');

    const selfEscalate = await api('PATCH', `/api/admin/users/${allowedRole.data.id}`, { role: 'SuperAdmin' }, PA);
    assertEqual(selfEscalate.status, 403, '§3.2 ولا يستطيع ترقية أحد مستخدميه إلى SuperAdmin');

    // ================= §3.1 تعديل الدور والنطاق والحالة =================
    const roleChange = await api('PATCH', `/api/admin/users/${allowedRole.data.id}`, { role: 'SiteManager' }, SA);
    assertEqual(roleChange.status, 200, '§3.1 SuperAdmin يستطيع تغيير الدور — لم يكن ممكنًا قبل هذه الجولة');
    assertEqual(roleChange.data.role, 'SiteManager', 'والدور الجديد مُطبَّق');

    const suspend = await api('PATCH', `/api/admin/users/${allowedRole.data.id}`, { status: 'suspended' }, SA);
    assertEqual(suspend.status, 200, '§3.1 الإيقاف يعمل');
    const suspendedLogin = await api('POST', '/api/auth/login', { username: 'site_op', password: 'anything-at-all-1' });
    assertEqual(suspendedLogin.status, 401, 'والمستخدم الموقوف لا يدخل');

    const premature = await api('POST', '/api/admin/users', { username: 'never_activated', role: 'Runner' }, SA);
    const forceActive = await api('PATCH', `/api/admin/users/${premature.data.id}`, { status: 'active' }, SA);
    assertEqual(forceActive.status, 409,
      '§3.1 لا يمكن القفز فوق التفعيل — حساب لم يُفعّل لا يصبح نشطًا بضغطة إدارية');

    // ================= §3.2 حماية آخر SuperAdmin =================
    const sas = db.prepare(`SELECT id FROM users WHERE role='SuperAdmin' AND active=1`).all();
    // عطّل الجميع عدا واحد
    for (let i = 1; i < sas.length; i++) {
      db.prepare(`UPDATE users SET active=0, status='suspended' WHERE id=?`).run(sas[i].id);
    }
    const lastSA = sas[0].id;
    const killLast = await api('PATCH', `/api/admin/users/${lastSA}`, { status: 'suspended' }, SA);
    assertEqual(killLast.status, 409,
      '§3.2 تعطيل آخر SuperAdmin مرفوض — وإلا أصبحت المنصة غير قابلة للإدارة بلا مسار استرجاع');
    const demoteLast = await api('PATCH', `/api/admin/users/${lastSA}`, { role: 'Operator' }, SA);
    assertEqual(demoteLast.status, 409, '§3.2 وخفض دوره مرفوض للسبب نفسه');
    for (let i = 1; i < sas.length; i++) {
      db.prepare(`UPDATE users SET active=1, status='active' WHERE id=?`).run(sas[i].id);
    }

    // ================= §3.2 ملخص الصلاحيات =================
    const rolesSA = await api('GET', '/api/admin/roles', null, SA);
    assertEqual(rolesSA.status, 200, '§3.2 ملخص الأدوار متاح');
    assert(rolesSA.data.some(r => r.role === 'SuperAdmin'), 'SuperAdmin يرى كل الأدوار');
    assert(rolesSA.data.every(r => Array.isArray(r.ar) && Array.isArray(r.en)),
      '§13 الملخص بلغة أعمال بالعربية والإنجليزية، لا أسماء نقاط برمجية');
    const rolesPA = await api('GET', '/api/admin/roles', null, PA);
    assert(!rolesPA.data.some(r => ['SuperAdmin', 'AlnadlFinance', 'ProductAdmin', 'SafetyReviewer'].includes(r.role)),
      '§3.2 PartnerAdmin لا يُعرض له أي دور منصة يمكن منحه');

    // ================= §12 التدقيق =================
    const auditRows = db.prepare(`SELECT action FROM audit_log WHERE entity=? ORDER BY ts ASC`).all(allowedRole.data.id);
    assert(auditRows.some(a => a.action === 'user_create'), '§3.1 الإنشاء مُسجَّل في التدقيق');
    assert(auditRows.filter(a => a.action === 'user_update').length >= 2,
      '§3.1 تغيير الدور والحالة كلاهما مُسجَّل بقبل/بعد');

    // ================= §13 لا كلمة مرور في أي استجابة =================
    const usersList = await api('GET', '/api/admin/users', null, SA);
    const blob = JSON.stringify(usersList.data);
    for (const leak of ['password_hash', 'password', 'activationToken', 'token_hash']) {
      assert(!blob.includes(leak), `§13 قائمة المستخدمين لا تكشف "${leak}"`);
    }

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
