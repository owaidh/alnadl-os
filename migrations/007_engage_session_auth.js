// migrations/007_engage_session_auth.js — P5-Inc-2 corrective round.
//
// Closes a real authorization gap: session/start, next-moment, and end were
// addressable purely by engage_pass.id / engage_session.id — both generated
// via uid() (short, sequential-ish, never designed to be secret). Anyone
// who could guess or observe an id could act on someone else's Pass/Session.
//
// Fix: every Pass and Session now carries its own cryptographically random,
// unguessable access_token (24 bytes, base64url — ~192 bits of entropy).
// The token becomes the ONLY way to address a Pass/Session from the
// customer-facing API — internal ids (engage_pass.id, engage_session.id)
// are never accepted as client input again. This is the exact same pattern
// already proven and audited in this codebase for QR (GET /api/qr/:token) —
// not a new architecture invented for this fix.
'use strict';
const crypto = require('crypto');

function up(db) {
  try { db.exec(`ALTER TABLE engage_pass ADD COLUMN access_token TEXT`); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }
  try { db.exec(`ALTER TABLE engage_session ADD COLUMN access_token TEXT`); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; }

  // Backfill any existing rows (from Inc-1/Inc-2 testing) with real random
  // tokens so no row is ever left without one.
  const passesWithoutToken = db.prepare(`SELECT id FROM engage_pass WHERE access_token IS NULL`).all();
  for (const row of passesWithoutToken) {
    db.prepare(`UPDATE engage_pass SET access_token = ? WHERE id = ?`).run(crypto.randomBytes(24).toString('base64url'), row.id);
  }
  const sessionsWithoutToken = db.prepare(`SELECT id FROM engage_session WHERE access_token IS NULL`).all();
  for (const row of sessionsWithoutToken) {
    db.prepare(`UPDATE engage_session SET access_token = ? WHERE id = ?`).run(crypto.randomBytes(24).toString('base64url'), row.id);
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_engage_pass_token ON engage_pass(access_token);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_engage_session_token ON engage_session(access_token);
  `);
}

module.exports = { up };
