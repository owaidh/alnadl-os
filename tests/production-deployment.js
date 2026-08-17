// tests/production-deployment.js — R4-B: PB-1 · PB-3 · G-2.
// كل تأكيد يُثبت سلوكًا حقيقيًا عند الإقلاع أو على قاعدة فعلية.
'use strict';
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { assert, assertEqual, summary, resetCounts } = require('./helpers.js');

const ROOT = path.join(__dirname, '..');

function bootExpectingFailure(env, timeoutMs = 9000) {
  return new Promise((resolve) => {
    const proc = spawn('node', [path.join(ROOT, 'server.js')], {
      cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    proc.stdout.on('data', d => out.push(String(d)));
    proc.stderr.on('data', d => out.push(String(d)));
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) {} resolve({ exitCode: null, output: out.join('') }); }, timeoutMs);
    proc.on('exit', (code) => { clearTimeout(timer); resolve({ exitCode: code, output: out.join('') }); });
  });
}

async function run() {
  resetCounts();
  console.log('=== R4-B: Production Deployment (PB-1 · PB-3 · G-2) ===');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alnadl-deploy-'));

  try {
    // ================= PB-1: الحاوية والمهاجرات =================
    const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    assert(/^COPY\s+migrations\s+\.\/migrations\s*$/m.test(dockerfile),
      'PB-1 **Dockerfile ينسخ migrations/** — غيابه كان يُنتج صورة تنهار بعد إقلاع يبدو ناجحًا');

    // التحقق الحقيقي: بناء شجرة من تعليمات COPY نفسها وتشغيلها
    const positive = spawnSync('node', [path.join(ROOT, 'scripts/verify-container-image.js')],
      { encoding: 'utf8', timeout: 90000 });
    assertEqual(positive.status, 0, 'PB-1 **صورة الإنتاج تُقلع وتصل Ready وتبقى حيّة**');
    const posOut = JSON.parse(positive.stdout.slice(positive.stdout.indexOf('{'), positive.stdout.lastIndexOf('}') + 1));
    assertEqual(posOut.migrationsApplied, posOut.migrationsExpected,
      `PB-1 وكل المهاجرات مُطبَّقة (${posOut.migrationsApplied}/${posOut.migrationsExpected})`);
    assertEqual(posOut.lastMigration, '017_branding_overrides', 'PB-1 حتى 017 ضمنًا');
    assert(posOut.tables >= 60, `PB-1 والمخطط كامل (${posOut.tables} جدولًا)`);
    assertEqual(posOut.aliveAfterGrace, true,
      'PB-1 **وتبقى حيّة بعد فترة سماح** — العطل السابق كان يقع بعد الإقلاع حين يبدأ العامل');

    // السلبي: بلا migrations يجب أن يُرفض الإقلاع صراحة
    const negative = spawnSync('node', [path.join(ROOT, 'scripts/verify-container-image.js'), '--negative'],
      { encoding: 'utf8', timeout: 90000 });
    assertEqual(negative.status, 0, 'PB-1 الاختبار السلبي يمرّ');
    const negOut = JSON.parse(negative.stdout.slice(negative.stdout.indexOf('{'), negative.stdout.lastIndexOf('}') + 1));
    assertEqual(negOut.ready, false, 'PB-1 **بلا migrations لا يصل الخادم Ready**');
    assertEqual(negOut.exitCode, 1, 'PB-1 ويخرج برمز فشل');
    assertEqual(negOut.refusedWithFatal, true,
      'PB-1 **ويرفض صراحة برسالة FATAL** — لا نجاح صامت بمخطط ناقص');
    assertEqual(negOut.migrationsApplied, 0, 'PB-1 ولا تُطبَّق أي مهاجرة');

    // ================= PB-3: قيد النسخة الواحدة =================
    const multi = await bootExpectingFailure({
      NODE_ENV: 'production', PORT: '8855', SQLITE_PATH: path.join(tmp, 'mi.sqlite'),
      APP_INSTANCES: '4', SESSION_SECRET: 'deploy-test-secret-of-sufficient-length-1',
      ADMIN_BOOTSTRAP_USERNAME: 'ops', ADMIN_BOOTSTRAP_PASSWORD: 'ops-strong-pass-12',
    });
    assertEqual(multi.exitCode, 1,
      'PB-3 **تعدد النسخ في الإنتاج يرفض الإقلاع** — قيد مُنفَّذ لا تحذير يُتجاهَل');
    assert(/not production-supported/.test(multi.output), 'PB-3 والرسالة تقول ذلك صراحة');
    assert(/shared store/.test(multi.output), 'PB-3 وتُسمّي الشرط المطلوب');

    // نسخة واحدة تعمل طبيعيًا
    const single = await bootExpectingFailure({
      NODE_ENV: 'production', PORT: '8854', SQLITE_PATH: path.join(tmp, 'si.sqlite'),
      APP_INSTANCES: '1', SESSION_SECRET: 'deploy-test-secret-of-sufficient-length-1',
      ADMIN_BOOTSTRAP_USERNAME: 'ops', ADMIN_BOOTSTRAP_PASSWORD: 'ops-strong-pass-12',
    }, 6000);
    assertEqual(single.exitCode, null, 'PB-3 **والنسخة الواحدة تُقلع طبيعيًا** — القيد لا يعيق النشر المدعوم');

    // التجاوز الواعي متاح لكنه صريح ومُسجَّل
    const accepted = await bootExpectingFailure({
      NODE_ENV: 'production', PORT: '8853', SQLITE_PATH: path.join(tmp, 'ac.sqlite'),
      APP_INSTANCES: '3', ACCEPT_MULTI_INSTANCE_RISK: '1',
      SESSION_SECRET: 'deploy-test-secret-of-sufficient-length-1',
      ADMIN_BOOTSTRAP_USERNAME: 'ops', ADMIN_BOOTSTRAP_PASSWORD: 'ops-strong-pass-12',
    }, 6000);
    assertEqual(accepted.exitCode, null, 'PB-3 والتجاوز الواعي ممكن لبيئة اختبار');
    assert(/multi_instance_risk_accepted/.test(accepted.output),
      'PB-3 **لكنه يُسجَّل صراحة** — قرار مكتوب لا سلوك افتراضي صامت');

    // ================= G-2: النسخ والاستعادة =================
    const br = require('../scripts/backup-restore.js');
    const srcDb = path.join(tmp, 'source.sqlite');
    process.env.SQLITE_PATH = srcDb;
    delete require.cache[require.resolve('../db.js')];
    require('../db.js'); // يُنشئ قاعدة كاملة بكل المهاجرات

    const drill = br.drill(srcDb);
    assertEqual(drill.pass, true, 'G-2 **تمرين الاستعادة الكامل ينجح**');
    assertEqual(drill.digestMatches, true, 'G-2 وبصمة النسخة تُطابق محتواها');
    assertEqual(drill.schemaMatches, true, 'G-2 والمخطط مطابق بعد الاستعادة');
    assertEqual(drill.migrationsMatch, true, 'G-2 وسجل المهاجرات مطابق');
    assertEqual(drill.countsMatch, true, 'G-2 **وعدّاد كل جدول قيمي مطابق** — لا فقدان صف');
    assert(drill.restored.migrations >= 17, `G-2 والنسخة تحمل كل المهاجرات (${drill.restored.migrations})`);

    // نسخة معطوبة تُرفض بدل استعادتها
    const bad = path.join(tmp, 'corrupt.sqlite');
    fs.writeFileSync(bad, 'this is not a sqlite database at all');
    const badCheck = br.verify(bad);
    assertEqual(badCheck.ok, false, 'G-2 **نسخة معطوبة تُرفض عند التحقق**');
    let restoreRefused = false;
    try { br.restore(bad, path.join(tmp, 'target.sqlite')); } catch (e) { restoreRefused = /unverified/.test(e.message); }
    assertEqual(restoreRefused, true,
      'G-2 **والاستعادة ترفض نسخة غير مُتحقَّقة** — لا تُدهس قاعدة عاملة بملف تالف');

    // قاعدة سليمة لكن بلا سجل مهاجرات ليست نسخة صالحة
    const noMig = path.join(tmp, 'nomig.sqlite');
    const { DatabaseSync } = require('node:sqlite');
    const d = new DatabaseSync(noMig); d.exec('CREATE TABLE x (id TEXT)'); d.close();
    assertEqual(br.verify(noMig).ok, false,
      'G-2 وقاعدة بلا سجل مهاجرات تُرفض — السلامة وحدها لا تكفي');

    // الاستعادة تُزيح الهدف القائم بدل دهسه
    const target = path.join(tmp, 'live.sqlite');
    fs.copyFileSync(srcDb, target);
    const madeDir = path.join(tmp, 'bk');
    const made = br.backup(srcDb, madeDir);
    br.restore(made.file, target);
    const aside = fs.readdirSync(tmp).filter(f => f.startsWith('live.sqlite.replaced-'));
    assert(aside.length > 0, 'G-2 **والقاعدة السابقة تُزاح لا تُحذف** — مسار تراجع قائم');

  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
