// migrations/004_engage_inc1.js — Phase 5 P5-Inc-1
//
// Terminology (per ALNADL's explicit correction, binding for all of Phase 5):
//   - Event/Data Flow direction:  Core -> Engage, via order.confirmed -> engage_outbox.
//     Core writes one row to engage_outbox when a payment succeeds. That write is
//     the ONLY thing Core knows about Engage's existence.
//   - Foreign-Key Dependency direction: Engage -> Core, and ONLY Engage -> Core.
//     engage_pass.order_id REFERENCES orders(id) is a REAL constraint below.
//     No Core table (orders, payments, child_orders, ...) is modified by this
//     migration, and none will ever carry a reference toward any engage_* table.
'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE engage_pass (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE ON UPDATE CASCADE,
      identity_ref TEXT,
      context_snapshot_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','revoked')),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    -- Structure only in Inc-1 — personality assignment and Moment logic are
    -- Inc-2 scope. No row is written here until Inc-2 exists; the table is
    -- created now so Inc-2 never needs a schema-altering migration for it.
    CREATE TABLE engage_session (
      id TEXT PRIMARY KEY,
      pass_id TEXT NOT NULL REFERENCES engage_pass(id) ON DELETE CASCADE ON UPDATE CASCADE,
      personality TEXT CHECK(personality IN ('RESET','SPARK','DISCOVER','PLAY','MIND')),
      ceiling_moments_used INTEGER NOT NULL DEFAULT 0,
      ceiling_moments_max INTEGER,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','ended','killed')),
      started_at INTEGER NOT NULL,
      ended_at INTEGER
    );

    -- The ONLY thing Core writes toward Engage. One row per successful
    -- payment, written unconditionally (regardless of engage_enabled) --
    -- the feature flag is checked by the Worker below, never by Core.
    -- This keeps Core's write trivial (a local INSERT, no conditional
    -- Engage-awareness) and keeps all Engage-specific decisions inside Engage.
    CREATE TABLE engage_outbox (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE ON UPDATE CASCADE,
      event_type TEXT NOT NULL DEFAULT 'order.confirmed',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processed','skipped','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      processed_at INTEGER
    );

    CREATE TABLE engage_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      ts INTEGER NOT NULL
    );
  `);

  // engage_enabled feature flag (§6 of the original doc: "لا تُنشأ باقة خامسة
  // تلقائيًا... Feature-based" -- so every existing plan gets the flag added,
  // defaulted OFF, rather than a 5th plan being created).
  // Note: subscriptions.features are resolved LIVE via a JOIN to plans.features_json
  // (see lib/plan.js getSubscription()) -- there is no separate cached copy on
  // the subscriptions table to backfill, unlike this migration's first draft assumed.
  const plans = db.prepare('SELECT id, features_json FROM plans').all();
  for (const plan of plans) {
    const features = JSON.parse(plan.features_json);
    if (!('engage_enabled' in features)) {
      features.engage_enabled = false;
      db.prepare('UPDATE plans SET features_json = ? WHERE id = ?').run(JSON.stringify(features), plan.id);
    }
  }
}

module.exports = { up };
