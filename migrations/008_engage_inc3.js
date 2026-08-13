// migrations/008_engage_inc3.js — Phase 5 P5-Inc-3: Experience Ledger +
// Customer/Engage Events + Admin Visibility.
//
// Core Isolation maintained: every new table/column here belongs to Engage
// only. No Core table (orders, payments, ...) is touched by this migration,
// and none ever will be — the same one-way Engage->Core dependency rule
// from Inc-1 applies unchanged.
'use strict';

function up(db) {
  db.exec(`
    -- Q: "which mechanic/content and WHY was it chosen?" -- selection_reason
    -- answers the "why" explicitly, not just implicitly via mechanic_version_id.
    -- Inc-2 only had round-robin static selection; this makes that reasoning
    -- a first-class, auditable fact instead of something you'd have to infer.
    ALTER TABLE moment ADD COLUMN selection_reason TEXT;

    -- Q: "when, and what happened at each step?" -- one row per lifecycle
    -- event for a session (start, each moment served/skipped, session end).
    CREATE TABLE experience_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES engage_session(id) ON DELETE CASCADE ON UPDATE CASCADE,
      moment_id TEXT REFERENCES moment(id) ON DELETE SET NULL ON UPDATE CASCADE,
      event_type TEXT NOT NULL CHECK(event_type IN ('session_start','moment_served','moment_completed','moment_skipped','session_end')),
      reason TEXT,
      ts INTEGER NOT NULL
    );

    -- Q: "what was the outcome/result?" -- the customer's actual response to
    -- a specific moment (completed it, skipped it, ...). idempotency_key
    -- lets a client safely retry a response submission (e.g. after a flaky
    -- network) without ever double-recording the same interaction.
    CREATE TABLE response_event (
      id TEXT PRIMARY KEY,
      moment_id TEXT NOT NULL REFERENCES moment(id) ON DELETE CASCADE ON UPDATE CASCADE,
      response_payload_json TEXT,
      idempotency_key TEXT,
      ts INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_response_event_idem ON response_event(moment_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
  `);
}

module.exports = { up };
