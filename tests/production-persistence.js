// tests/production-persistence.js — P0: Production Data Persistence.
//
// العطل الذي تُغلقه هذه المجموعة وقع في الإنتاج فعلًا: التطبيق أقلع وعمل
// وخدم الطلبات، ثم أُعيد تشغيل الحاوية فوجد المستخدم كلمة مروره الصحيحة
// مرفوضة -- لأن حسابه لم يعد موجودًا. القاعدة كانت تُكتب داخل مجلد التطبيق،
// وهو جزء من طبقة الصورة.
//
// ولذلك لا تكتفي هذه الاختبارات بفحص أن الإعداد "مضبوط": تكتب سجلًا، تُنهي
// العملية، تُشغّل عملية جديدة، وتسأل هل السجل موجود. الفرق جوهري -- إعداد
// صحيح على مسار مؤقت يبدو صحيحًا في كل فحص ثابت.
'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { assert, assertEqual, summary, resetCounts } = require('./helpers.js');

const ROOT = path.join(__dirname, '..');
const PORT = 8899 + Math.floor(Math.random() * 60);

function httpGet(pathname) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: pathname, timeout: 4000 }, (res) => {
      let body = ''; res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
  });
}

/** يُشغّل الخادم وينتظر جاهزيته. يُرجع العملية، أو null إن مات قبل الجاهزية. */
async function startServerWith(env, cwd) {
  const proc = spawn('node', ['server.js'], {
    cwd: cwd || ROOT,
    env: { ...process.env, PORT: String(PORT), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', d => out += d);
  proc.stderr.on('data', d => out += d);
  for (let i = 0; i < 60; i++) {
    if (proc.exitCode !== null) return { proc: null, out, exitCode: proc.exitCode };
    const r = await httpGet('/ready');
    if (r.status === 200) return { proc, out, exitCode: null };
    await new Promise(r2 => setTimeout(r2, 250));
  }
  try { proc.kill(); } catch (e) {}
  return { proc: null, out, exitCode: null };
}

function stop(proc) {
  if (!proc) return;
  try { proc.kill('SIGKILL'); } catch (e) {}
}

/** يُشغّل الخادم ويعيد ما طُبع، بلا انتظار جاهزية — لحالات الفشل المتوقع. */
function runUntilExit(env, cwd) {
  const r = spawnSync('node', ['server.js'], {
    cwd: cwd || ROOT,
    env: { ...process.env, PORT: String(PORT + 1), ...env },
    encoding: 'utf8', timeout: 20000,
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

async function run() {
  resetCounts();
  console.log('=== Production Data Persistence (P0) ===');

  // "الحجم الدائم" يُحاكى بمجلد **خارج شجرة التطبيق** — وهو جوهر الاختبار:
  // البيانات يجب أن تنجو من استبدال شجرة التطبيق كاملة.
  const volume = fs.mkdtempSync(path.join(os.tmpdir(), 'alnadl-volume-'));
  const dbPath = path.join(volume, 'alnadl.sqlite');
  // بيانات الاعتماد الأولية مطلوبة في الإنتاج على قاعدة فارغة (حارس قائم
  // منذ P0-Activation: لا بيانات عرض تُزرع في الإنتاج). تُمرَّر هنا لأن هذه
  // المجموعة تفحص البقاء لا التهيئة.
  const PROD = {
    NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(48),
    ADMIN_BOOTSTRAP_USERNAME: 'persist_admin',
    ADMIN_BOOTSTRAP_PASSWORD: 'persist-admin-strong-pass-1',
  };
  let recreatedRoot = null;
  const appDbExistedBefore = fs.existsSync(path.join(ROOT, 'data.sqlite'));

  try {
    /* ===== 1) الإنتاج بلا SQLITE_PATH يرفض الإقلاع ===== */
    const missing = runUntilExit({ ...PROD, SQLITE_PATH: '' });
    assertEqual(missing.code, 1,
      '(1) **الإنتاج بلا SQLITE_PATH يرفض الإقلاع** — لا افتراض صامت على قرص مؤقت');
    assert(/FATAL/.test(missing.out) && /SQLITE_PATH/.test(missing.out),
      '(1) والرسالة FATAL صريحة وتسمّي المتغيّر المطلوب');
    assert(/persistent/i.test(missing.out),
      '(1) وتشرح **لماذا** — لا تكتفي بذكر متغيّر ناقص');
    assert(!/\/data\b/.test(missing.out.replace(/alnadl-volume[^\s]*/g, '')) || /provider/i.test(missing.out),
      '(1) **ولا تفرض مسارًا بعينه** — مسار التركيب قرار بنية تحتية لا يملكه الكود');

    /* ===== 2) مجلد غير موجود أو غير قابل للكتابة ===== */
    const badDir = runUntilExit({ ...PROD, SQLITE_PATH: path.join(volume, 'nope', 'x.sqlite') });
    assertEqual(badDir.code, 1,
      '(2) **مجلد غير موجود يُوقف الإقلاع ولا يُنشأ تلقائيًا** — الإنشاء التلقائي يُخفي مسارًا مكتوبًا غلطًا');
    assert(/does not exist/i.test(badDir.out), '(2) والسبب مذكور بالمسار نفسه');

    const roDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alnadl-ro-'));
    fs.chmodSync(roDir, 0o500);
    const roRun = runUntilExit({ ...PROD, SQLITE_PATH: path.join(roDir, 'x.sqlite') });
    // جذر النظام يتجاوز صلاحيات الملفات، فالفحص لا يُطبَّق إلا حين يكون
    // معنى له. تجاهله بصمت أصدق من تأكيد يمرّ لسبب خاطئ.
    if (process.getuid && process.getuid() !== 0) {
      assertEqual(roRun.code, 1, '(2) ومجلد غير قابل للكتابة يُوقف الإقلاع');
      assert(/not writable/i.test(roRun.out), '(2) ويذكر أن SQLite يحتاج الكتابة في المجلد لا الملف وحده (WAL)');
    } else {
      console.log('  SKIPPED: فحص المجلد غير القابل للكتابة — التشغيل كجذر يتجاوز الصلاحيات');
    }
    fs.chmodSync(roDir, 0o700); fs.rmSync(roDir, { recursive: true, force: true });

    /* ===== 3) مسار صالح: الإقلاع والمهاجرات والجاهزية ===== */
    let s = await startServerWith({ ...PROD, SQLITE_PATH: dbPath });
    assert(!!s.proc, '(3) **مسار صالح ⇒ الخادم يصل إلى Ready فعلًا** (وليس مجرد إقلاع)');
    assert(fs.existsSync(dbPath), '(3) وملف القاعدة أُنشئ في الحجم لا في مجلد التطبيق');
    assert(new RegExp(`\\[db\\] SQLite database: ${dbPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(s.out),
      '(3) **والمسار الفعلي مطبوع عند الإقلاع** — غيابه من السجل هو ما جعل العطل يمرّ');
    assert(!/SESSION_SECRET.*x{10}|xxxxxxxxxx/.test(s.out), '(3) ولا يُطبع أي سرّ مع المسار');

    const health = await httpGet('/health');
    assertEqual(health.status, 200, '(3) و/health يستجيب');
    // الفحص الاستشاري (نفس نظام الملفات) يُطلق تحذيرًا هنا لأن /tmp و/app
    // على نفس الجهاز في هذه البيئة -- وهي **الحالة الإيجابية الكاذبة**
    // بعينها التي منعت جعله إيقافًا. الاختبار يُثبت أنه لم يمنع الإقلاع.
    if (/WARNING: the database directory is on the same filesystem/.test(s.out)) {
      assert(true, '(3) **والفحص الاستشاري حذّر ولم يمنع الإقلاع** — نُوقف على يقين ونُحذّر على ترجيح');
    }

    // المهاجرات: آخر مهاجرة في المستودع يجب أن تكون مطبَّقة **في قاعدة الحجم**
    const expectedLast = fs.readdirSync(path.join(ROOT, 'migrations'))
      .filter(f => /^\d+_.+\.js$/.test(f)).sort().pop().replace(/\.js$/, '');
    const { DatabaseSync } = require('node:sqlite');
    let probe = new DatabaseSync(dbPath);
    const applied = probe.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(r => r.id);
    assert(applied.includes(expectedLast),
      `(4) **آخر مهاجرة (${expectedLast}) مطبَّقة في قاعدة الحجم نفسها** لا في قاعدة أخرى داخل التطبيق`);
    assertEqual(applied.length, fs.readdirSync(path.join(ROOT, 'migrations')).filter(f => /^\d+_.+\.js$/.test(f)).length,
      '(4) وعددها مطابق لعدد ملفات المهاجرات — لا مهاجرة سقطت');
    // يُقاس **الفارق** لا الحالة المطلقة: مجلد عمل متّسخ (قاعدة خلّفها تشغيل
    // تطوير سابق) كان سيُسقط التأكيد لسبب لا علاقة له بما نفحصه.
    assertEqual(fs.existsSync(path.join(ROOT, 'data.sqlite')), appDbExistedBefore,
      '(4) **ولم تُنشأ قاعدة ثانية داخل مجلد التطبيق** — قاعدتان تعنيان كتابةً في واحدة وقراءةً من أخرى');

    /* ===== 5) بقاء البيانات عبر إعادة التشغيل ===== */
    const marker = 'persist_' + Date.now().toString(36);
    probe.prepare(`INSERT INTO partners (id,name_ar,name_en,legal_name,contract_ref,status)
                   VALUES (?,?,?,?,?,'Active')`).run(marker, marker, marker, marker, 'C-' + marker);
    probe.close();

    stop(s.proc);
    await new Promise(r => setTimeout(r, 900));
    s = await startServerWith({ ...PROD, SQLITE_PATH: dbPath });
    assert(!!s.proc, '(5) الخادم يقلع بعد إعادة التشغيل');
    probe = new DatabaseSync(dbPath);
    assert(!!probe.prepare('SELECT id FROM partners WHERE id = ?').get(marker),
      '(5) **السجل ما زال موجودًا بعد إعادة التشغيل** — هذا هو الاختبار الذي كان غائبًا');
    probe.close();

    /* ===== 6) بقاء البيانات عبر إعادة إنشاء الحاوية ===== */
    // تُحاكى بنسخ شجرة التطبيق إلى مسار جديد كليًا — أي "حاوية" أخرى بشيفرة
    // جديدة — مع توجيهها إلى **نفس الحجم**. هذا يفصل عمر البيانات عن عمر
    // شجرة التطبيق، وهو جوهر ما فشل في الإنتاج.
    stop(s.proc);
    await new Promise(r => setTimeout(r, 900));
    recreatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'alnadl-recreated-'));
    for (const item of ['server.js', 'db.js', 'lib', 'migrations', 'public', 'package.json']) {
      fs.cpSync(path.join(ROOT, item), path.join(recreatedRoot, item), { recursive: true });
    }
    s = await startServerWith({ ...PROD, SQLITE_PATH: dbPath }, recreatedRoot);
    assert(!!s.proc, '(6) نسخة تطبيق جديدة تمامًا تقلع على نفس الحجم');
    probe = new DatabaseSync(dbPath);
    assert(!!probe.prepare('SELECT id FROM partners WHERE id = ?').get(marker),
      '(6) **والبيانات باقية بعد استبدال شجرة التطبيق كاملة** — عمر البيانات مستقل عن عمر الحاوية');
    const stillApplied = probe.prepare('SELECT COUNT(*) c FROM schema_migrations').get().c;
    assertEqual(stillApplied, applied.length,
      '(6) والمهاجرات لم تُعَد من الصفر — القاعدة هي نفسها لا قاعدة جديدة تصادف التشابه');
    probe.close();
    assert(!fs.existsSync(path.join(recreatedRoot, 'data.sqlite')),
      '(6) ولا قاعدة محلية أُنشئت في شجرة التطبيق الجديدة');

    /* ===== 7) النسخ الاحتياطي يعمل على قاعدة الإنتاج نفسها ===== */
    const backupDir = path.join(volume, 'backups');
    const bk = spawnSync('node', [path.join(ROOT, 'scripts', 'backup-restore.js'), 'backup'], {
      env: { ...process.env, ...PROD, SQLITE_PATH: dbPath, BACKUP_DIR: backupDir },
      encoding: 'utf8', timeout: 30000,
    });
    const bkOut = (bk.stdout || '') + (bk.stderr || '');
    assertEqual(bk.status, 0, '(7) النسخ الاحتياطي ينجح تحت إعداد الإنتاج');
    assert(bkOut.includes(dbPath) || bkOut.includes(path.basename(dbPath)),
      '(7) **ويعمل على قاعدة SQLITE_PATH نفسها** لا على مسار يحسبه بنفسه');
    const backupFile = fs.existsSync(backupDir)
      ? fs.readdirSync(backupDir).find(f => f.endsWith('.sqlite')) : null;
    assert(!!backupFile, '(7) وملف النسخة أُنشئ فعلًا');
    if (backupFile) {
      const bdb = new DatabaseSync(path.join(backupDir, backupFile));
      assert(!!bdb.prepare('SELECT id FROM partners WHERE id = ?').get(marker),
        '(7) **والنسخة تحوي بيانات الإنتاج الحقيقية** — نسخة فارغة تُصدر تقرير نجاح كاذبًا');
      bdb.close();
    }

    /* ===== 8) الجلسات تنجو من إعادة التشغيل ما دام السرّ ثابتًا =====
       منطق الأمان لم يُمسّ في هذا الإصلاح؛ المطلوب إثبات الخاصية لا تغييرها.
       والسبب أن العَرَض الذي شكا منه المستخدم ("حدّثت الصفحة فخرجت") له
       سببان مختلفان تمامًا -- قاعدة ضائعة، أو سرّ يتغيّر مع كل إقلاع --
       وخلطهما يُنتج إصلاحًا لأحدهما مع بقاء الآخر. */
    const loginBody = JSON.stringify({ username: 'persist_admin', password: 'persist-admin-strong-pass-1' });
    const token = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/auth/login', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) } }, (res) => {
        let b = ''; res.on('data', d => b += d);
        res.on('end', () => { try { resolve(JSON.parse(b).token); } catch (e) { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.end(loginBody);
    });
    assert(!!token, '(9) الدخول ينجح بحساب الإنتاج الأولي');

    const meWith = (t) => new Promise((resolve) => {
      // لا توجد نقطة /api/auth/me في هذا النظام؛ صلاحية الرمز تُقاس بنقطة
      // إدارية حقيقية تتطلب جلسة -- وهو قياس أصدق على أي حال.
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/admin/partners',
        headers: { Authorization: 'Bearer ' + t } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', () => resolve(0));
    });
    assertEqual(await meWith(token), 200, '(9) والرمز صالح قبل إعادة التشغيل');

    stop(s.proc);
    await new Promise(r => setTimeout(r, 900));
    s = await startServerWith({ ...PROD, SQLITE_PATH: dbPath }, recreatedRoot);
    assert(!!s.proc, '(9) الخادم يقلع مجددًا بنفس SESSION_SECRET');
    assertEqual(await meWith(token), 200,
      '(9) **ونفس الرمز ما زال صالحًا بعد إعادة التشغيل** — السرّ الثابت يعني أن restart وحده لا يُخرج أحدًا');

    // والعكس بعينه: سرّ مختلف يُبطل الجلسة. يُثبَّت هنا لأنه سبب "الخروج عند
    // التحديث" الذي يُخطئ الناس في نسبته إلى القاعدة.
    stop(s.proc);
    await new Promise(r => setTimeout(r, 900));
    s = await startServerWith({ ...PROD, SESSION_SECRET: 'y'.repeat(48), SQLITE_PATH: dbPath }, recreatedRoot);
    assert(!!s.proc, '(9) الخادم يقلع بسرّ مختلف');
    assertEqual(await meWith(token), 401,
      '(9) **وسرّ متغيّر يُبطل كل الجلسات** — ولهذا يجب تثبيته في متغيّرات البيئة لا توليده');

    /* ===== 10) التطوير لم يتغيّر ===== */
    stop(s.proc);
    await new Promise(r => setTimeout(r, 700));
    const devDb = path.join(volume, 'dev-check.sqlite');
    const devRun = await startServerWith({ NODE_ENV: 'development', SQLITE_PATH: devDb });
    assert(!!devRun.proc, '(10) **التطوير يعمل كما كان** — الإلزام يخصّ الإنتاج وحده');
    stop(devRun.proc);

  } finally {
    try { fs.rmSync(volume, { recursive: true, force: true }); } catch (e) {}
    if (recreatedRoot) { try { fs.rmSync(recreatedRoot, { recursive: true, force: true }); } catch (e) {} }
  }
  return summary();
}

module.exports = { run };
if (require.main === module) run().then(ok => process.exit(ok ? 0 : 1));
