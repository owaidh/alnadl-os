#!/usr/bin/env node
/**
 * scripts/backup-restore.js — R4-B / G-2.
 *
 * لماذا لا `cp data.sqlite backup.sqlite`:
 * النسخ المباشر أثناء الكتابة يُنتج ملفًا ممزقًا. مع WAL يصبح الأمر أسوأ --
 * الملف الرئيس قد لا يحمل آخر المعاملات المُثبتة أصلًا، فتبدو النسخة سليمة
 * وهي ناقصة بصمت. نسخة احتياطية لا تُكتشف عيوبها إلا وقت الكارثة أسوأ من
 * لا نسخة، لأنها تمنح ثقة زائفة.
 *
 * البديل المستخدم: `VACUUM INTO` -- عملية ذرّية تُنتج قاعدة متسقة من لقطة
 * واحدة، تعمل والخادم يكتب، ولا تحتاج إيقاف الخدمة.
 *
 * الاستخدام:
 *   node scripts/backup-restore.js backup  [--db path] [--out dir]
 *   node scripts/backup-restore.js verify  --file <backup>
 *   node scripts/backup-restore.js restore --file <backup> --db <target>
 *   node scripts/backup-restore.js drill                 (نسخ + استعادة + تحقق)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data.sqlite');
const DEFAULT_OUT = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '14', 10);

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** لقطة متسقة عبر VACUUM INTO -- ذرّية وتعمل أثناء الكتابة. */
function backup(dbPath, outDir) {
  if (!fs.existsSync(dbPath)) throw new Error(`source database not found: ${dbPath}`);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(outDir, `alnadl-${stamp}.sqlite`);

  const db = new DatabaseSync(dbPath);
  // VACUUM INTO يرفض الكتابة فوق ملف قائم، وهو ما نريده: لا نسخة تُدهس.
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  db.close();

  const digest = sha256(target);
  fs.writeFileSync(target + '.sha256', digest + '  ' + path.basename(target) + '\n');

  // التحقق يجري **فورًا** لا عند الاستعادة: نسخة معطوبة تُكتشف الآن وهناك
  // وقت لإعادة المحاولة، لا بعد أسبوعين وقت الحاجة إليها.
  const check = verify(target);
  if (!check.ok) {
    fs.unlinkSync(target);
    fs.unlinkSync(target + '.sha256');
    throw new Error(`backup verification failed immediately after creation: ${check.reason}`);
  }
  prune(outDir);
  return { file: target, sha256: digest, ...check };
}

/** يتحقق أن النسخة قاعدة سليمة كاملة المخطط والمهاجرات. */
function verify(file) {
  if (!fs.existsSync(file)) return { ok: false, reason: 'file not found' };
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const integrity = db.prepare('PRAGMA integrity_check').get();
    const verdict = integrity && (integrity.integrity_check || Object.values(integrity)[0]);
    if (verdict !== 'ok') return { ok: false, reason: `integrity_check: ${verdict}` };

    const tables = db.prepare(`SELECT COUNT(*) c FROM sqlite_master WHERE type='table'`).get().c;
    let applied = [];
    try { applied = db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(r => r.id); } catch (e) {}
    // قاعدة بلا سجل مهاجرات ليست نسخة صالحة لنظام يعتمد المهاجرات.
    if (!applied.length) return { ok: false, reason: 'no schema_migrations recorded' };

    // عدّ صفوف الجداول الحاملة للقيمة -- الرقم نفسه يُقارَن بعد الاستعادة.
    const counts = {};
    for (const t of ['partners', 'orders', 'payments', 'refunds', 'settlements',
                     'revenue_ledger', 'loyalty_accounts', 'users', 'audit_log']) {
      try { counts[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch (e) { counts[t] = null; }
    }
    return { ok: true, tables, migrations: applied.length, lastMigration: applied[applied.length - 1], counts };
  } catch (e) {
    return { ok: false, reason: e.message };
  } finally {
    if (db) { try { db.close(); } catch (e) {} }
  }
}

/** الاستعادة لا تدهس هدفًا قائمًا دون إزاحته أولًا. */
function restore(file, targetDb) {
  const check = verify(file);
  if (!check.ok) throw new Error(`refusing to restore an unverified backup: ${check.reason}`);
  if (fs.existsSync(targetDb)) {
    const aside = `${targetDb}.replaced-${Date.now()}`;
    fs.renameSync(targetDb, aside);
    // ملفات WAL المصاحبة تُزاح معه، وإلا خلطت القديم بالجديد.
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(targetDb + suffix)) fs.renameSync(targetDb + suffix, aside + suffix);
    }
  }
  fs.copyFileSync(file, targetDb);
  const after = verify(targetDb);
  if (!after.ok) throw new Error(`restore produced an unusable database: ${after.reason}`);
  return after;
}

function prune(outDir) {
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  for (const f of fs.readdirSync(outDir)) {
    if (!/^alnadl-.*\.sqlite$/.test(f)) continue;
    const full = path.join(outDir, f);
    if (fs.statSync(full).mtimeMs < cutoff) {
      fs.unlinkSync(full);
      if (fs.existsSync(full + '.sha256')) fs.unlinkSync(full + '.sha256');
    }
  }
}

/** تمرين كامل: نسخ -> استعادة لقاعدة منفصلة -> مقارنة. */
function drill(dbPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alnadl-drill-'));
  const outDir = path.join(tmp, 'backups');
  const restored = path.join(tmp, 'restored.sqlite');

  const before = verify(dbPath);
  if (!before.ok) throw new Error(`source database is not verifiable: ${before.reason}`);

  const made = backup(dbPath, outDir);
  const digestOnDisk = fs.readFileSync(made.file + '.sha256', 'utf8').split(/\s+/)[0];
  const digestMatches = digestOnDisk === sha256(made.file);

  const after = restore(made.file, restored);

  const countsMatch = Object.keys(before.counts).every(t => before.counts[t] === after.counts[t]);
  const schemaMatches = before.tables === after.tables;
  const migrationsMatch = before.migrations === after.migrations
    && before.lastMigration === after.lastMigration;

  const result = {
    source: { tables: before.tables, migrations: before.migrations, counts: before.counts },
    restored: { tables: after.tables, migrations: after.migrations, counts: after.counts },
    digestMatches, schemaMatches, migrationsMatch, countsMatch,
    pass: digestMatches && schemaMatches && migrationsMatch && countsMatch,
  };
  fs.rmSync(tmp, { recursive: true, force: true });
  return result;
}

if (require.main === module) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'backup') {
      console.log(JSON.stringify(backup(arg('db', DEFAULT_DB), arg('out', DEFAULT_OUT)), null, 1));
    } else if (cmd === 'verify') {
      const r = verify(arg('file'));
      console.log(JSON.stringify(r, null, 1));
      process.exit(r.ok ? 0 : 1);
    } else if (cmd === 'restore') {
      console.log(JSON.stringify(restore(arg('file'), arg('db', DEFAULT_DB)), null, 1));
    } else if (cmd === 'drill') {
      const r = drill(arg('db', DEFAULT_DB));
      console.log(JSON.stringify(r, null, 1));
      console.log(r.pass ? 'RESTORE DRILL: PASS' : 'RESTORE DRILL: FAIL');
      process.exit(r.pass ? 0 : 1);
    } else {
      console.log('usage: backup-restore.js backup|verify|restore|drill [--db path] [--out dir] [--file backup]');
      process.exit(2);
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
}

module.exports = { backup, verify, restore, drill, prune };
