#!/usr/bin/env node
/**
 * scripts/verify-container-image.js — PB-1 verification.
 *
 * لماذا هذه الأداة ولماذا بهذا الشكل:
 * لا يوجد Docker في بيئة البناء الحالية، فلا يمكن تنفيذ `docker build`
 * حرفيًا. البديل الضعيف كان سيكون قائمة ملفات مكتوبة يدويًا -- وهي تنحرف
 * عن Dockerfile في أول تعديل ثم "تُثبت" شيئًا غير صحيح، وهو بالضبط صنف
 * الخطأ الذي أنتج probes خاطئة سابقًا.
 *
 * لذا: هذه الأداة **تقرأ تعليمات COPY من Dockerfile نفسه** وتبني منها شجرة
 * معزولة تُحاكي محتوى الصورة، ثم تُقلع منها. أي تغيير في Dockerfile ينعكس
 * تلقائيًا، ولا يمكن للأداة أن تدّعي تغطية لا يعكسها الملف.
 *
 * الوضعان:
 *   --positive : الصورة كما يصفها Dockerfile -> يجب أن تُقلع وتُطبّق كل
 *                المهاجرات وتصل Ready وتبقى حيّة
 *   --negative : نفس الصورة **بلا migrations/** -> يجب أن ترفض الإقلاع
 *                صراحة، لا أن تنجح بمخطط ناقص
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DOCKERFILE = path.join(ROOT, 'Dockerfile');

/** يستخرج أزواج (المصدر، الوجهة) من تعليمات COPY الحقيقية. */
function parseCopyDirectives() {
  const lines = fs.readFileSync(DOCKERFILE, 'utf8').split('\n');
  const copies = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!/^COPY\s/i.test(line)) continue;
    const parts = line.replace(/^COPY\s+/i, '').split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;
    const dest = parts[parts.length - 1];
    for (const src of parts.slice(0, -1)) copies.push({ src, dest });
  }
  return copies;
}

/** يبني شجرة تُحاكي محتوى الصورة بالضبط. */
function materialiseImage(targetDir, { omit = [] } = {}) {
  fs.mkdirSync(targetDir, { recursive: true });
  const copies = parseCopyDirectives();
  const included = [];
  for (const { src, dest } of copies) {
    if (omit.includes(src)) continue;
    const from = path.join(ROOT, src);
    if (!fs.existsSync(from)) continue;
    const to = dest === './' || dest === '.'
      ? path.join(targetDir, path.basename(src))
      : path.join(targetDir, dest.replace(/^\.?\//, ''));
    fs.cpSync(from, to, { recursive: true });
    included.push(src);
  }
  return { copies: copies.map(c => c.src), included };
}

function bootAndProbe(imageDir, port, dbPath, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const out = [];
    const proc = spawn('node', ['server.js'], {
      cwd: imageDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        SQLITE_PATH: dbPath,
        SESSION_SECRET: 'container-verification-secret-of-sufficient-length',
        ADMIN_BOOTSTRAP_USERNAME: 'containerops',
        ADMIN_BOOTSTRAP_PASSWORD: 'container-strong-pass-1',
        LOG_SILENT: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.on('data', d => out.push(String(d)));
    proc.stderr.on('data', d => out.push(String(d)));

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { proc.kill('SIGKILL'); } catch (e) {}
      resolve({ ...result, output: out.join('') });
    };

    proc.on('exit', (code) => finish({ exited: true, exitCode: code, ready: false, alive: false }));

    (async () => {
      const deadline = Date.now() + timeoutMs;
      let ready = false;
      while (Date.now() < deadline && !settled) {
        await new Promise(r => setTimeout(r, 400));
        try {
          const res = await fetch(`http://localhost:${port}/ready`);
          if (res.ok) { ready = true; break; }
        } catch (e) {}
      }
      if (settled) return;
      if (!ready) return finish({ exited: false, exitCode: null, ready: false, alive: true });
      // البقاء حيًّا يهم بقدر بلوغ Ready: العطل السابق كان يقع **بعد**
      // الإقلاع حين يبدأ العامل عمله، فيبدو الإقلاع ناجحًا.
      await new Promise(r => setTimeout(r, 6000));
      if (settled) return;
      let stillAlive = false;
      try { stillAlive = (await fetch(`http://localhost:${port}/health`)).ok; } catch (e) {}
      finish({ exited: false, exitCode: null, ready: true, alive: stillAlive });
    })();
  });
}

function countTables(dbPath) {
  const r = spawnSync('node', ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(dbPath)});
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name);
    let applied = [];
    try { applied = db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(x => x.id); } catch (e) {}
    console.log(JSON.stringify({ tables: tables.length, applied }));
  `], { encoding: 'utf8' });
  try { return JSON.parse((r.stdout || '').trim().split('\n').pop()); }
  catch (e) { return { tables: 0, applied: [] }; }
}

async function main() {
  const mode = process.argv.includes('--negative') ? 'negative' : 'positive';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alnadl-image-'));
  const imageDir = path.join(tmp, 'image');
  const dbPath = path.join(tmp, 'container.sqlite');
  const port = mode === 'negative' ? 8859 : 8858;

  const { copies, included } = materialiseImage(imageDir,
    mode === 'negative' ? { omit: ['migrations'] } : {});

  console.log(`mode: ${mode}`);
  console.log(`COPY directives read from Dockerfile: ${copies.join(', ')}`);
  console.log(`materialised: ${included.join(', ')}`);

  const boot = await bootAndProbe(imageDir, port, dbPath);
  const db = countTables(dbPath);
  const expectedMigrations = fs.readdirSync(path.join(ROOT, 'migrations'))
    .filter(f => /^\d{3}_.+\.js$/.test(f)).length;

  const result = {
    mode,
    ready: boot.ready,
    aliveAfterGrace: boot.alive,
    exited: boot.exited,
    exitCode: boot.exitCode,
    tables: db.tables,
    migrationsApplied: db.applied.length,
    migrationsExpected: expectedMigrations,
    lastMigration: db.applied[db.applied.length - 1] || null,
    refusedWithFatal: /FATAL: migrations directory/.test(boot.output),
  };

  if (mode === 'positive') {
    result.pass = boot.ready && boot.alive
      && db.applied.length === expectedMigrations
      && !boot.exited;
  } else {
    // السلبي ينجح فقط إذا **رفض** الإقلاع صراحة -- لا إذا أقلع ناقصًا.
    result.pass = !boot.ready && boot.exited && result.refusedWithFatal;
  }

  console.log(JSON.stringify(result, null, 1));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(result.pass ? 'CONTAINER CHECK: PASS' : 'CONTAINER CHECK: FAIL');
  process.exit(result.pass ? 0 : 1);
}

main().catch(e => { console.error('verification error:', e.message); process.exit(1); });
