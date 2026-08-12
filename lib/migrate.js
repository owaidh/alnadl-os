// lib/migrate.js — versioned, forward-only migration runner (Q08).
//
// Replaces the previous approach (raw CREATE TABLE IF NOT EXISTS + silent
// try/catch ALTER TABLE scattered in db.js) with a real, auditable system:
//   - Every migration is a numbered file in /migrations, in the exact order
//     it must run.
//   - Applied migrations are tracked in `schema_migrations` — never
//     re-applied, never applied out of order.
//   - Each migration exports { up(db) } and, where the change is safely
//     reversible, { down(db) } for rollback (see docs/DEPLOYMENT.md
//     "Rollback" section for the operational procedure — this file only
//     provides the mechanism, not a one-click production rollback button).
//
// This does NOT replace the initial schema bootstrap in db.js (the
// CREATE TABLE IF NOT EXISTS block) — that remains the baseline for a
// brand-new database. Migrations after this point are the only way
// forward; db.js's bootstrap block is treated as migration 000 and is not
// edited again once any real deployment exists.
'use strict';
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function ensureMigrationsTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL
  )`);
}

function appliedIds(db) {
  return new Set(db.prepare('SELECT id FROM schema_migrations').all().map(r => r.id));
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{3}_.+\.js$/.test(f))
    .sort(); // numeric prefix guarantees correct order
}

/** Applies every migration not yet recorded, in numeric order. Idempotent:
 * safe to call on every server boot, same guarantee the old ad-hoc system had. */
function runMigrations(db) {
  ensureMigrationsTable(db);
  const applied = appliedIds(db);
  const files = listMigrationFiles();
  const results = [];
  for (const file of files) {
    const id = file.replace(/\.js$/, '');
    if (applied.has(id)) continue;
    const migration = require(path.join(MIGRATIONS_DIR, file));
    if (typeof migration.up !== 'function') throw new Error(`Migration ${file} has no up(db) export`);
    const started = Date.now();
    db.exec('BEGIN');
    try {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(id, Date.now());
      db.exec('COMMIT');
      results.push({ id, status: 'applied', ms: Date.now() - started });
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${id} failed and was rolled back: ${e.message}`);
    }
  }
  return results;
}

module.exports = { runMigrations, listMigrationFiles, ensureMigrationsTable };
