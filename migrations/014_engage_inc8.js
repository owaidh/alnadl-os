// migrations/014_engage_inc8.js — Phase 5 P5-Inc-8: Mechanic Lab + Learning
// Engine + Lifecycle Governance.
//
// mechanic_version.lifecycle_state's CHECK constraint already included the
// full 8-state lifecycle (draft/simulated/canary/emerging/promoted/held/
// rejected/retired) since migration 006 (Inc-2) -- this migration does not
// need to widen it, only add the columns and tables needed to actually
// GOVERN transitions through that lifecycle, which did not exist before
// now. The 5 existing static mechanics stay exactly as already seeded
// (lifecycle_state='promoted', created_by='alnadl_admin') -- they are
// grandfathered production content, not retroactively re-governed; this
// migration's tables apply to mechanics going through the lifecycle from
// here forward, including any AI-proposed ones.
//
// Core Isolation maintained: zero changes to any Core table.
'use strict';

function up(db) {
  db.exec(`
    ALTER TABLE mechanic_version ADD COLUMN canary_percentage REAL;

    -- Full audit of every lifecycle transition -- reason, a metrics
    -- snapshot taken AT the moment of transition (not recomputed later,
    -- which could drift from what was actually true when the decision was
    -- made), the acting identity, whether it was a human or system/
    -- automatic decision, and the policy version in effect.
    CREATE TABLE mechanic_lifecycle_event (
      id TEXT PRIMARY KEY,
      mechanic_version_id TEXT NOT NULL REFERENCES mechanic_version(id) ON DELETE CASCADE ON UPDATE CASCADE,
      from_state TEXT,
      to_state TEXT NOT NULL,
      reason TEXT,
      metrics_snapshot_json TEXT,
      actor TEXT NOT NULL,
      is_system_decision INTEGER NOT NULL DEFAULT 0,
      policy_version TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_mechanic_lifecycle_event_mv ON mechanic_lifecycle_event(mechanic_version_id, created_at);

    -- An open incident BLOCKS promotion outright until a SafetyReviewer or
    -- SuperAdmin explicitly resolves it -- this is the enforcement
    -- mechanism for "No Promotion with unresolved Safety incident".
    CREATE TABLE mechanic_safety_incident (
      id TEXT PRIMARY KEY,
      mechanic_version_id TEXT NOT NULL REFERENCES mechanic_version(id) ON DELETE CASCADE ON UPDATE CASCADE,
      moment_id TEXT REFERENCES moment(id) ON DELETE SET NULL ON UPDATE CASCADE,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
      reason TEXT,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      resolved_by TEXT
    );
    CREATE INDEX idx_mechanic_safety_incident_mv ON mechanic_safety_incident(mechanic_version_id, status);

    -- Simulated sessions: proves "same production logic path without
    -- reaching real customers" by recording REAL Safety-gate (and, for
    -- AI-based mechanics, real provider-generation) outcomes -- but into
    -- this table, never into engage_session/moment/exposure_memory, so a
    -- simulation can never appear in any customer-facing surface, the
    -- real Ledger, or Partner analytics.
    CREATE TABLE mechanic_simulation_run (
      id TEXT PRIMARY KEY,
      mechanic_version_id TEXT NOT NULL REFERENCES mechanic_version(id) ON DELETE CASCADE ON UPDATE CASCADE,
      sample_count INTEGER NOT NULL,
      safety_pass_count INTEGER NOT NULL,
      safety_fail_count INTEGER NOT NULL,
      policy_version TEXT,
      run_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

module.exports = { up };
