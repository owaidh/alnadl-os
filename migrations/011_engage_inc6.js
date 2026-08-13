// migrations/011_engage_inc6.js — Phase 5 P5-Inc-6: Feature Flags + Roles +
// Partner Dashboard Privacy.
//
// Only change: venue_policy_override.scope_type CHECK is widened to also
// accept 'global', so the SAME table and precedence-resolution pattern
// already proven for Engagement Ceiling (Inc-2) and Novelty (Inc-4) can be
// reused for the engage_enabled master flag's Global Safety tier -- no new
// table, no new pattern invented for this. Core Isolation maintained: zero
// changes to any Core table. No new roles table either -- users.role has
// no CHECK constraint (verified before writing this migration), so
// 'SafetyReviewer'/'ProductAdmin' are usable immediately as plain values,
// exactly like every existing role.
'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE venue_policy_override_new (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('global','partner','property','zone')),
      scope_id TEXT NOT NULL,
      policy_key TEXT NOT NULL,
      policy_value_json TEXT NOT NULL,
      set_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    INSERT INTO venue_policy_override_new SELECT * FROM venue_policy_override;
    DROP TABLE venue_policy_override;
    ALTER TABLE venue_policy_override_new RENAME TO venue_policy_override;
  `);
}

module.exports = { up };
