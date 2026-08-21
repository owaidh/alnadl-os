// tests/superadmin-access.js — رحلة دخول SuperAdmin كاملة (P0 Release Blocker).
//
// العطل الذي تُغلقه: بعد النشر عاد /api/auth/login بـ401 رغم ضبط
// ADMIN_BOOTSTRAP_USERNAME و_PASSWORD. السبب أن التهيئة كانت تسأل «هل توجد
// مستخدمون؟» لا «هل يوجد SuperAdmin صالح للدخول؟» -- فأي مستخدم سابق في
// القاعدة (نشر أقدم، حساب شريك، حساب مشغّل) يجعلها تعود **بصمت**، بلا سطر
// واحد في السجل يشرح لماذا لا يعمل الدخول.
//
// كل اختبار هنا يُقلع خادمًا حقيقيًا على قاعدة حقيقية ويحاول الدخول عبر
// HTTP. لا فحص لدوال داخلية: العطل كان في السلوك المُركَّب لا في دالة.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { DatabaseSync } = require('node:sqlite');
const { assert, assertEqual, summary, resetCounts } = require('./helpers.js');

const ROOT = path.join(__dirname, '..');
let portSeed = 8990 + Math.floor(Math.random() * 40);

function newPort() { return portSeed++; }

/** يُقلع الخادم بإعداد إنتاجي ويعيد السجل ورمز الخروج. */
function bootProduction(env, port) {
  return new Promise((resolve) => {
    const proc = spawn('node', ['server.js'], {
      cwd: ROOT,
      env: {
        ...process.env, NODE_ENV: 'production', PORT: String(port),
        BRAND_MEDIA_PATH: os.tmpdir(), SESSION_SECRET: 'k'.repeat(48),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => out += d);
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    proc.on('exit', (code) => done({ proc: null, out, exitCode: code }));
    const tick = async () => {
      for (let i = 0; i < 50; i++) {
        if (settled) return;
        const ok = await new Promise(r => {
          const rq = http.get({ host: '127.0.0.1', port, path: '/ready', timeout: 1200 },
            res => { res.resume(); r(res.statusCode === 200); });
          rq.on('error', () => r(false));
          rq.on('timeout', () => { rq.destroy(); r(false); });
        });
        if (ok) return done({ proc, out, exitCode: null });
        await new Promise(r => setTimeout(r, 220));
      }
      try { proc.kill('SIGKILL'); } catch (e) {}
      done({ proc: null, out, exitCode: 'timeout' });
    };
    tick();
  });
}

function tryLogin(port, username, password) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ username, password });
    const rq = http.request({
      host: '127.0.0.1', port, path: '/api/auth/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(b) }); } catch (e) { resolve({ status: res.statusCode, data: {} }); } });
    });
    rq.on('error', () => resolve({ status: 0, data: {} }));
    rq.end(body);
  });
}

/** طلب مُصادَق -- يُثبت أن الرمز يعمل فعلًا لا أنه نصّ عاد من الدخول. */
function authed(port, token, pathname) {
  return new Promise((resolve) => {
    const rq = http.get({ host: '127.0.0.1', port, path: pathname,
      headers: { Authorization: 'Bearer ' + token } }, (res) => { res.resume(); resolve(res.statusCode); });
    rq.on('error', () => resolve(0));
  });
}

const kill = (p) => { if (p) { try { p.kill('SIGKILL'); } catch (e) {} } };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

/* نسخ قاعدة SQLite = نسخ ثلاثة ملفات لا واحد. في وضع WAL تعيش الكتابات
   الأخيرة في الملف الشقيق -wal حتى نقطة التفتيش، فنسخ الملف الأصلي وحده
   يُنتج قاعدة تبدو موجودة وهي فارغة -- وهو ما أسقط أول تشغيل لهذه
   المجموعة برسالة "no such table: users". */
function copyDb(src, dst) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(src + suffix)) fs.copyFileSync(src + suffix, dst + suffix);
  }
}

const CREDS = { ADMIN_BOOTSTRAP_USERNAME: 'ops_root', ADMIN_BOOTSTRAP_PASSWORD: 'ops-root-strong-pass-99' };

async function run() {
  resetCounts();
  console.log('=== SuperAdmin access journey (P0) ===');
  const vol = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-access-'));

  try {
    /* ============ 1) قاعدة جديدة: تهيئة ← دخول ============ */
    const db1 = path.join(vol, 'fresh.sqlite');
    let port = newPort();
    let s = await bootProduction({ ...CREDS, SQLITE_PATH: db1 }, port);
    assert(!!s.proc, '(1) الإنتاج يُقلع على قاعدة جديدة');
    let login = await tryLogin(port, CREDS.ADMIN_BOOTSTRAP_USERNAME, CREDS.ADMIN_BOOTSTRAP_PASSWORD);
    assertEqual(login.status, 200, '(1) **الدخول ينجح بعد التهيئة مباشرة**');
    assertEqual(login.data.user.role, 'SuperAdmin', '(1) وبدور SuperAdmin');
    assertEqual(await authed(port, login.data.token, '/api/admin/partners'), 200,
      '(1) **والرمز يعمل فعليًا على نقطة محمية** — لا نصّ يعود من الدخول فحسب');

    /* ============ 2) البقاء عبر إعادة التشغيل ============ */
    kill(s.proc); await wait(700);
    port = newPort();
    s = await bootProduction({ ...CREDS, SQLITE_PATH: db1 }, port);
    assert(!!s.proc, '(2) الخادم يقلع مجددًا على نفس القاعدة');
    login = await tryLogin(port, CREDS.ADMIN_BOOTSTRAP_USERNAME, CREDS.ADMIN_BOOTSTRAP_PASSWORD);
    assertEqual(login.status, 200,
      '(2) **الدخول ما زال يعمل بعد إعادة التشغيل** — التهيئة لا تُفسد حسابًا قائمًا');
    const dbProbe = new DatabaseSync(db1);
    assertEqual(dbProbe.prepare(`SELECT COUNT(*) c FROM users WHERE role='SuperAdmin'`).get().c, 1,
      '(2) ولا يتكاثر الحساب مع كل إقلاع');
    dbProbe.close();
    kill(s.proc); await wait(500);

    /* ============ 3) العطل الأصلي: قاعدة فيها مستخدم سابق ============ */
    // هذه هي الحالة التي أوقفت النشر: مستخدمون موجودون فتعود التهيئة صامتة.
    const db2 = path.join(vol, 'existing.sqlite');
    copyDb(db1, db2);
    let d = new DatabaseSync(db2);
    d.prepare(`UPDATE users SET username = 'legacy_admin' WHERE username = ?`).run(CREDS.ADMIN_BOOTSTRAP_USERNAME);
    d.close();
    port = newPort();
    s = await bootProduction({ ...CREDS, SQLITE_PATH: db2 }, port);
    assert(!!s.proc, '(3) الخادم يقلع على قاعدة فيها SuperAdmin صالح باسم آخر');
    login = await tryLogin(port, CREDS.ADMIN_BOOTSTRAP_USERNAME, CREDS.ADMIN_BOOTSTRAP_PASSWORD);
    assertEqual(login.status, 401,
      '(3) الدخول بالاسم غير الموجود يفشل — ولا يُصكّ حساب إداري من متغيرات البيئة على نظام حيّ');
    assert(/ADMIN_BOOTSTRAP_USERNAME does not match any usable SuperAdmin/.test(s.out),
      '(3) **لكن السبب يُعلَن في سجل النشر بدل الصمت** — الصمت هو ما جعل العطل يمرّ');
    assert(/legacy_admin/.test(s.out),
      '(3) ويُسمّي الحساب الصالح الموجود فعلًا، فيعرف المشغّل أين يقف');
    assert(/ADMIN_BOOTSTRAP_RESET_ID/.test(s.out),
      '(3) **ويذكر مسار الاسترجاع الصريح** — لا يترك المشغّل بلا مخرج');
    kill(s.proc); await wait(500);

    /* ============ 4) الاسترجاع لمرة واحدة ============ */
    const RESET_ID = 'recovery-2026-08-20-a1b2c3';
    port = newPort();
    s = await bootProduction({ ...CREDS, SQLITE_PATH: db2, ADMIN_BOOTSTRAP_RESET_ID: RESET_ID }, port);
    assert(!!s.proc, '(4) الخادم يقلع مع معرّف استرجاع');
    login = await tryLogin(port, CREDS.ADMIN_BOOTSTRAP_USERNAME, CREDS.ADMIN_BOOTSTRAP_PASSWORD);
    assertEqual(login.status, 200,
      '(4) **الاسترجاع يُعيد الدخول** — بمتغيّر بيئة واحد، بلا لمس قاعدة الإنتاج يدويًا');
    assert(/one-time recovery/.test(s.out), '(4) والسجل يصفه استرجاعًا لمرة واحدة');
    assert(/now consumed/.test(s.out), '(4) **ويُعلن أن المعرّف استُهلك** — لا حاجة لحذف المتغيّر بعد النشر');
    d = new DatabaseSync(db2);
    const consumed = d.prepare('SELECT * FROM bootstrap_recovery WHERE reset_id = ?').get(RESET_ID);
    assert(!!consumed, '(4) والاستهلاك مسجَّل في القاعدة لا في الذاكرة');
    assertEqual(d.prepare(`SELECT COUNT(*) c FROM audit_log WHERE action='bootstrap_superadmin_reset'`).get().c, 1,
      '(4) **ومُدقَّق مرة واحدة بالضبط**');
    d.close();
    kill(s.proc); await wait(600);

    /* ============ 4-ب) إعادة التشغيل بنفس المعرّف لا تُعيد التعيين ======
       جوهر «مرة واحدة»: المتغيّر يبقى في الإعدادات وإقلاع الخدمة لا يمسّ
       كلمة المرور. يُقاس بتغيير كلمة المرور بعد الاسترجاع ثم التأكد أنها
       صمدت -- لا بقراءة السجل، فالسجل قد يقول ما لم يحدث. */
    const NEW_PASS = 'operator-changed-pass-77';
    d = new DatabaseSync(db2);
    const { hashPbkdf2 } = require(path.join(ROOT, 'db.js'));
    d.prepare('UPDATE users SET password_hash = ? WHERE username = ?')
      .run(hashPbkdf2(NEW_PASS), CREDS.ADMIN_BOOTSTRAP_USERNAME);
    d.close();
    port = newPort();
    s = await bootProduction({ ...CREDS, SQLITE_PATH: db2, ADMIN_BOOTSTRAP_RESET_ID: RESET_ID }, port);
    assert(!!s.proc, '(4ب) الخادم يقلع مجددًا والمعرّف ما زال مضبوطًا');
    assert(/already consumed/.test(s.out),
      '(4ب) **ويتعرّف أن المعرّف مستهلَك** فلا يفعل شيئًا');
    const withNew = await tryLogin(port, CREDS.ADMIN_BOOTSTRAP_USERNAME, NEW_PASS);
    assertEqual(withNew.status, 200,
      '(4ب) **وكلمة المرور التي غيّرها المشغّل صمدت** — لا إعادة تعيين مع كل إقلاع');
    const withOld = await tryLogin(port, CREDS.ADMIN_BOOTSTRAP_USERNAME, CREDS.ADMIN_BOOTSTRAP_PASSWORD);
    assertEqual(withOld.status, 401,
      '(4ب) وكلمة مرور البيئة لم تعد تعمل — أي أن الاسترجاع لم يُعَد فعلًا');
    d = new DatabaseSync(db2);
    assertEqual(d.prepare(`SELECT COUNT(*) c FROM audit_log WHERE action='bootstrap_superadmin_reset'`).get().c, 1,
      '(4ب) **والتدقيق ما زال يُظهر استرجاعًا واحدًا لا اثنين**');
    d.close();
    kill(s.proc); await wait(500);

    /* ============ 4-ج) معرّف جديد = استرجاع جديد ============ */
    port = newPort();
    s = await bootProduction({ ...CREDS, SQLITE_PATH: db2, ADMIN_BOOTSTRAP_RESET_ID: 'recovery-second-xyz' }, port);
    const secondRecovery = await tryLogin(port, CREDS.ADMIN_BOOTSTRAP_USERNAME, CREDS.ADMIN_BOOTSTRAP_PASSWORD);
    assertEqual(secondRecovery.status, 200,
      '(4ج) **معرّف جديد يُتيح استرجاعًا جديدًا** — الاسترجاع ممكن دائمًا، لكن بقرار صريح لا بأثر جانبي');
    d = new DatabaseSync(db2);
    assertEqual(d.prepare('SELECT COUNT(*) c FROM bootstrap_recovery').get().c, 2, '(4ج) ويُسجَّل استهلاكه هو أيضًا');
    d.close();
    kill(s.proc); await wait(500);

    /* ============ 4-د) العلم المنطقي القديم مرفوض ============ */
    const pLegacy = newPort();
    const sLegacy = await bootProduction({ ...CREDS, SQLITE_PATH: db2, ADMIN_BOOTSTRAP_RESET: 'true' }, pLegacy);
    assertEqual(sLegacy.exitCode, 1,
      '(4د) **ADMIN_BOOTSTRAP_RESET المنطقي مرفوض صراحةً** — لا يُتجاهل بصمت فيظن المشغّل أن الاسترجاع جارٍ');
    assert(/ADMIN_BOOTSTRAP_RESET_ID/.test(sLegacy.out), '(4د) والرسالة تدلّ على البديل');
    kill(sLegacy.proc);

    /* ============ 5) الحالة الأخطر: مستخدمون بلا SuperAdmin صالح ============ */
    for (const [label, mutate] of [
      ['موقوف (active = 0)', (dd) => dd.prepare(`UPDATE users SET active = 0 WHERE role='SuperAdmin'`).run()],
      ['بلا كلمة مرور (لم يُفعّل)', (dd) => dd.prepare(`UPDATE users SET password_hash = NULL WHERE role='SuperAdmin'`).run()],
      ["تجزئة فارغة ('')", (dd) => dd.prepare(`UPDATE users SET password_hash = '' WHERE role='SuperAdmin'`).run()],
      ['بانتظار التفعيل', (dd) => { try { dd.prepare(`UPDATE users SET status = 'pending_activation' WHERE role='SuperAdmin'`).run(); } catch (e) { dd.prepare(`UPDATE users SET password_hash = NULL WHERE role='SuperAdmin'`).run(); } }],
      ['بدور أقل', (dd) => dd.prepare(`UPDATE users SET role = 'Operator' WHERE role='SuperAdmin'`).run()],
    ]) {
      const dbX = path.join(vol, `locked-${label.length}.sqlite`);
      copyDb(db1, dbX);
      const dd = new DatabaseSync(dbX);
      mutate(dd);
      const remaining = dd.prepare('SELECT COUNT(*) c FROM users').get().c;
      dd.close();
      assert(remaining > 0, `(5) القاعدة ما زالت تحوي مستخدمين — ${label}`);
      const px = newPort();
      const sx = await bootProduction({ ...CREDS, SQLITE_PATH: dbX }, px);
      assert(!!sx.proc, `(5) الخادم يقلع رغم غياب SuperAdmin صالح — ${label}`);
      const lx = await tryLogin(px, CREDS.ADMIN_BOOTSTRAP_USERNAME, CREDS.ADMIN_BOOTSTRAP_PASSWORD);
      assertEqual(lx.status, 200,
        `(5) **الاسترجاع تلقائي حين لا يوجد SuperAdmin صالح — ${label}** — لا قفل دائم بلا مخرج`);
      const ddd = new DatabaseSync(dbX);
      assert(!!ddd.prepare(`SELECT 1 FROM audit_log WHERE action = 'bootstrap_superadmin'`).get(),
        `(5) والاسترجاع مُدقَّق — ${label}`);
      ddd.close();
      kill(sx.proc); await wait(400);
    }

    /* ============ 6) بلا بيانات اعتماد وبلا SuperAdmin صالح ⇒ رفض إقلاع ============ */
    const dbLocked = path.join(vol, 'nocreds.sqlite');
    copyDb(db1, dbLocked);
    d = new DatabaseSync(dbLocked);
    d.prepare(`UPDATE users SET active = 0`).run();
    d.close();
    const pNo = newPort();
    const sNo = await bootProduction({ SQLITE_PATH: dbLocked }, pNo);
    assertEqual(sNo.exitCode, 1,
      '(6) **الإنتاج يرفض الإقلاع بلا SuperAdmin صالح وبلا بيانات استرجاع** — لا خادم يعمل ولا أحد يدخله');
    assert(/no usable SuperAdmin/.test(sNo.out), '(6) والرسالة تشرح المعنى الدقيق لـ«صالح»');
    kill(sNo.proc);

    /* ============ 7) القفل بعد المحاولات الفاشلة ============ */
    const dbLock = path.join(vol, 'lockout.sqlite');
    copyDb(db1, dbLock);
    const pL = newPort();
    const sL = await bootProduction({ ...CREDS, SQLITE_PATH: dbLock }, pL);
    assert(!!sL.proc, '(7) الخادم يقلع');
    let sawLock = false;
    for (let i = 0; i < 6; i++) {
      const r = await tryLogin(pL, CREDS.ADMIN_BOOTSTRAP_USERNAME, 'definitely-wrong-password');
      if (r.status === 429) sawLock = true;
    }
    assert(sawLock, '(7) **القفل يعمل بعد محاولات فاشلة متكررة** (429)');
    const stillLocked = await tryLogin(pL, CREDS.ADMIN_BOOTSTRAP_USERNAME, CREDS.ADMIN_BOOTSTRAP_PASSWORD);
    assertEqual(stillLocked.status, 429,
      '(7) ويشمل كلمة المرور الصحيحة أثناء نافذة القفل — القفل على الاسم لا على كلمة المرور');
    kill(sL.proc); await wait(700);
    // إعادة التشغيل تمسح العدّاد (في الذاكرة) -- مسار الاسترجاع العملي
    const pL2 = newPort();
    const sL2 = await bootProduction({ ...CREDS, SQLITE_PATH: dbLock }, pL2);
    const afterRestart = await tryLogin(pL2, CREDS.ADMIN_BOOTSTRAP_USERNAME, CREDS.ADMIN_BOOTSTRAP_PASSWORD);
    assertEqual(afterRestart.status, 200,
      '(7) **وإعادة تشغيل الخدمة تفكّ القفل** — العدّاد في الذاكرة، وهو أسرع مخرج أثناء التشغيل');
    kill(sL2.proc); await wait(400);

    /* ============ 8-ب) الاسترجاع ذرّي: فشل التسجيل ⇒ تراجع كامل ============
       تُفرض حالة الفشل فعليًا بجعل تسجيل الاستهلاك مستحيلًا: يُستبدل جدول
       bootstrap_recovery بجدول يحمل قيدًا يمنع الإدراج. هذا أصدق من محاكاة
       الفشل بحقنة في الكود -- الفشل هنا يقع في نفس الموضع الذي قد يقع فيه
       إنتاجيًا (خطأ قاعدة عند الإدراج).

       المطلوب إثباته: لا كلمة مرور تتغيّر، ولا خادم يقلع. */
    {
      const dbAtomic = path.join(vol, 'atomic.sqlite');
      copyDb(db1, dbAtomic);
      const { hashPbkdf2: hp2 } = require(path.join(ROOT, 'db.js'));
      const KNOWN = 'known-password-before-recovery-1';
      let da = new DatabaseSync(dbAtomic);
      da.prepare(`UPDATE users SET password_hash = ? WHERE role='SuperAdmin'`).run(hp2(KNOWN));
      // جدول يرفض أي إدراج: CHECK لا يمكن تحقّقه
      da.exec('DROP TABLE IF EXISTS bootstrap_recovery');
      da.exec(`CREATE TABLE bootstrap_recovery (
        reset_id TEXT PRIMARY KEY, username TEXT NOT NULL, outcome TEXT NOT NULL,
        consumed_at INTEGER NOT NULL, CHECK (consumed_at < 0))`);
      da.close();

      const pA = newPort();
      const sA = await bootProduction({
        ...CREDS, SQLITE_PATH: dbAtomic, ADMIN_BOOTSTRAP_RESET_ID: 'atomic-test-id',
        ADMIN_BOOTSTRAP_PASSWORD: 'would-be-new-password-99',
      }, pA);

      assertEqual(sA.exitCode, 1,
        '(8ب) **الخادم يرفض الإقلاع حين يتعذّر إتمام الاسترجاع ذرّيًا** — لا تشغيل بحالة نصفية');
      assert(/could not be completed atomically/.test(sA.out), '(8ب) والسبب معلن صراحةً');
      assert(/rolled back/.test(sA.out) && /was NOT/.test(sA.out),
        '(8ب) ويُصرّح أن كلمة المرور لم تتغيّر وأن المعرّف لم يُستهلك');
      kill(sA.proc);

      /* الإثبات الحقيقي هو الدخول أدناه، لا مقارنة تجزئة بنفسها: تأكيد
         لا يمكن أن يفشل ليس تحققًا. نُصلح الجدول ونُقلع بلا طلب استرجاع،
         ثم نسأل: هل كلمة المرور السابقة ما زالت تفتح النظام؟ */
      da = new DatabaseSync(dbAtomic);
      da.exec('DROP TABLE bootstrap_recovery');
      da.exec(`CREATE TABLE bootstrap_recovery (reset_id TEXT PRIMARY KEY, username TEXT NOT NULL,
               outcome TEXT NOT NULL, consumed_at INTEGER NOT NULL)`);
      da.close();
      const pA2 = newPort();
      const sA2 = await bootProduction({ ...CREDS, SQLITE_PATH: dbAtomic }, pA2);
      assert(!!sA2.proc, '(8ب) الخادم يقلع بعد إصلاح القاعدة وبلا طلب استرجاع');
      const stillOld = await tryLogin(pA2, CREDS.ADMIN_BOOTSTRAP_USERNAME, KNOWN);
      assertEqual(stillOld.status, 200,
        '(8ب) **وكلمة المرور السابقة ما زالت تعمل** — التراجع أعادها فعلًا، لا في الرسالة فقط');
      const wouldBe = await tryLogin(pA2, CREDS.ADMIN_BOOTSTRAP_USERNAME, 'would-be-new-password-99');
      assertEqual(wouldBe.status, 401,
        '(8ب) وكلمة المرور التي كان الاسترجاع سيضعها لم تُكتب إطلاقًا');
      const da2 = new DatabaseSync(dbAtomic);
      assertEqual(da2.prepare('SELECT COUNT(*) c FROM bootstrap_recovery').get().c, 0,
        '(8ب) ولا استهلاك مسجَّل — المعرّف ما زال صالحًا لاسترجاع لاحق');
      assertEqual(da2.prepare(`SELECT COUNT(*) c FROM audit_log WHERE action='bootstrap_superadmin_reset'`).get().c, 0,
        '(8ب) **ولا أثر تدقيق لاسترجاع لم يقع** — المعاملة شملت السجل أيضًا');
      da2.close();
      kill(sA2.proc); await wait(400);
    }

    /* ============ 9) سيناريو النشر القائم بالضبط ============
       قاعدة موجودة، وفيها حساب مشرف باسمه الحقيقي، وكلمة مروره القديمة لا
       تطابق كلمة المرور المضبوطة في البيئة. هذه هي الحالة التي أوقفت الرفع،
       وتُختبر كرحلة كاملة لا كفحص وحدة. */
    {
      const dbDeploy = path.join(vol, 'deployment.sqlite');
      copyDb(db1, dbDeploy);
      const dd = new DatabaseSync(dbDeploy);
      const { hashPbkdf2: hp } = require(path.join(ROOT, 'db.js'));
      dd.prepare(`UPDATE users SET username = 'alnadl_admin', password_hash = ? WHERE role = 'SuperAdmin'`)
        .run(hp('the-old-forgotten-password'));
      dd.close();

      const DEPLOY = { ADMIN_BOOTSTRAP_USERNAME: 'alnadl_admin', ADMIN_BOOTSTRAP_PASSWORD: 'new-deploy-pass-2026-x' };
      const RID = 'deploy-recovery-001';

      // قبل الاسترجاع: كلمة المرور الجديدة لا تعمل -- وهو العطل كما ظهر
      let pd = newPort();
      let sd = await bootProduction({ ...DEPLOY, SQLITE_PATH: dbDeploy }, pd);
      assert(!!sd.proc, '(9) الخادم يقلع على قاعدة النشر القائم');
      let r = await tryLogin(pd, 'alnadl_admin', DEPLOY.ADMIN_BOOTSTRAP_PASSWORD);
      assertEqual(r.status, 401, '(9) كلمة المرور الجديدة لا تعمل قبل الاسترجاع — العطل كما ظهر في الإنتاج');
      assert(/does not match any usable SuperAdmin/.test(sd.out) || /already consumed/.test(sd.out) === false,
        '(9) والسبب معلن في سجل النشر');
      kill(sd.proc); await wait(500);

      // الاسترجاع لمرة واحدة
      pd = newPort();
      sd = await bootProduction({ ...DEPLOY, SQLITE_PATH: dbDeploy, ADMIN_BOOTSTRAP_RESET_ID: RID }, pd);
      r = await tryLogin(pd, 'alnadl_admin', DEPLOY.ADMIN_BOOTSTRAP_PASSWORD);
      assertEqual(r.status, 200, '(9) **الاسترجاع يُعيد الدخول ← 200**');
      assertEqual(await authed(pd, r.data.token, '/api/admin/partners'), 200, '(9) والرمز يعمل على نقطة محمية');
      kill(sd.proc); await wait(600);

      // إعادة التشغيل بنفس المعرّف: الدخول يستمر ولا استرجاع ثانٍ
      pd = newPort();
      sd = await bootProduction({ ...DEPLOY, SQLITE_PATH: dbDeploy, ADMIN_BOOTSTRAP_RESET_ID: RID }, pd);
      r = await tryLogin(pd, 'alnadl_admin', DEPLOY.ADMIN_BOOTSTRAP_PASSWORD);
      assertEqual(r.status, 200, '(9) **وبعد إعادة التشغيل الدخول ما زال 200**');
      assert(/already consumed/.test(sd.out), '(9) **ولا استرجاع ثانٍ** — المعرّف مستهلَك');
      const dd2 = new DatabaseSync(dbDeploy);
      assertEqual(dd2.prepare(`SELECT COUNT(*) c FROM audit_log WHERE action='bootstrap_superadmin_reset'`).get().c, 1,
        '(9) **والتدقيق يُثبت استرجاعًا واحدًا فقط**');
      assertEqual(dd2.prepare('SELECT COUNT(*) c FROM bootstrap_recovery').get().c, 1, '(9) واستهلاكًا واحدًا مسجَّلًا');
      assertEqual(dd2.prepare(`SELECT COUNT(*) c FROM users WHERE role='SuperAdmin'`).get().c, 1,
        '(9) ولم يُنشأ حساب مشرف إضافي — أُصلح القائم لا استُنسخ');
      dd2.close();
      kill(sd.proc); await wait(400);
    }

    /* ============ 8) التطوير لم يتغيّر ============ */
    const dbDev = path.join(vol, 'dev.sqlite');
    const pD = newPort();
    const sD = await new Promise((resolve) => {
      const proc = spawn('node', ['server.js'], {
        cwd: ROOT, env: { ...process.env, NODE_ENV: 'development', PORT: String(pD), SQLITE_PATH: dbDev },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      proc.stdout.on('data', x => out += x); proc.stderr.on('data', x => out += x);
      const t = setInterval(async () => {
        const ok = await new Promise(r => {
          const rq = http.get({ host: '127.0.0.1', port: pD, path: '/ready', timeout: 1000 }, res => { res.resume(); r(res.statusCode === 200); });
          rq.on('error', () => r(false)); rq.on('timeout', () => { rq.destroy(); r(false); });
        });
        if (ok) { clearInterval(t); resolve({ proc, out }); }
      }, 250);
      setTimeout(() => { clearInterval(t); resolve({ proc: null, out }); }, 15000);
    });
    assert(!!sD.proc, '(8) التطوير يقلع بلا أي متغيرات تهيئة');
    const devLogin = await tryLogin(pD, 'admin', 'admin');
    assertEqual(devLogin.status, 200,
      '(8) **وبيانات العرض تعمل كما كانت** — الإصلاح يخصّ الإنتاج ولا يمسّ بيئة التطوير');
    kill(sD.proc);

  } finally {
    try { fs.rmSync(vol, { recursive: true, force: true }); } catch (e) {}
  }
  return summary();
}

module.exports = { run };
if (require.main === module) run().then(ok => process.exit(ok ? 0 : 1));
