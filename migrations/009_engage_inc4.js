// migrations/009_engage_inc4.js — Phase 5 P5-Inc-4: Customer/Anonymous
// Memory + Exposure Memory + Text Similarity Novelty + Duplicate Prevention.
//
// Core Isolation maintained: zero changes to any Core table. Tenant
// isolation is structural here: customer_engage_profile is keyed
// (partner_id, identity_ref) UNIQUE -- the SAME phone number visiting two
// different partners gets two entirely separate profile rows, so exposure
// memory can never be computed across a tenant boundary even by accident
// (there is no query path that could join across partner_id at all, since
// every lookup goes through a specific profile_id tied to one partner).
'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE customer_engage_profile (
      id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL,
      identity_ref TEXT NOT NULL,
      is_anonymous INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER
    );
    CREATE UNIQUE INDEX idx_cep_partner_identity ON customer_engage_profile(partner_id, identity_ref);

    CREATE TABLE exposure_memory (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES customer_engage_profile(id) ON DELETE CASCADE ON UPDATE CASCADE,
      mechanic_id TEXT REFERENCES mechanic(id) ON DELETE SET NULL ON UPDATE CASCADE,
      content_hash TEXT NOT NULL,
      token_set_json TEXT NOT NULL,
      exposed_at INTEGER NOT NULL
    );
    CREATE INDEX idx_exposure_memory_profile ON exposure_memory(profile_id, exposed_at);

    CREATE TABLE novelty_evaluation (
      id TEXT PRIMARY KEY,
      moment_id TEXT NOT NULL REFERENCES moment(id) ON DELETE CASCADE ON UPDATE CASCADE,
      is_duplicate INTEGER NOT NULL,
      similarity_score REAL,
      threshold_used REAL NOT NULL,
      -- method is constrained to the two values named explicitly in the
      -- source spec's own data model (§12): 'text_similarity' is what Inc-4
      -- actually implements; 'semantic_embedding' is reserved for Inc-7 and
      -- deliberately unreachable from any code path today -- ENG-NOV-001
      -- stays Partial until that method is real, not just declared.
      method TEXT NOT NULL CHECK(method IN ('text_similarity','semantic_embedding')),
      created_at INTEGER NOT NULL
    );
  `);
}

module.exports = { up };
