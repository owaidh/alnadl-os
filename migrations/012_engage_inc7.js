// migrations/012_engage_inc7.js — Phase 5 P5-Inc-7: AI Provider Layer +
// Orchestration + Fallback + Safety Pipeline + Semantic Novelty.
//
// Core Isolation maintained: zero changes to any Core table. All three new
// tables were already named in the Rev2 target schema (§12) -- this
// migration finally creates them, it does not invent new structure beyond
// what was already planned. engage_ai_generation is added to every plan's
// features_json (default false), the same additive pattern already used
// for engage_enabled in migration 004.
'use strict';

function up(db) {
  db.exec(`
    -- One row per AI provider invocation attempt (primary, and the single
    -- allowed retry with an alternate provider if the primary fails) --
    -- §25.4's exact required fields: provider/model/version/latency/
    -- result/cost, all present, all mandatory except cost (an estimate,
    -- not always knowable).
    CREATE TABLE engage_provider_call (
      id TEXT PRIMARY KEY,
      moment_id TEXT NOT NULL REFERENCES moment(id) ON DELETE CASCADE ON UPDATE CASCADE,
      provider TEXT NOT NULL,
      model TEXT,
      model_version TEXT,
      policy_version TEXT,
      latency_ms INTEGER,
      result TEXT NOT NULL CHECK(result IN ('success','timeout','error','fallback')),
      cost_estimate REAL,
      created_at INTEGER NOT NULL
    );

    -- Links a moment to the specific provider call that produced its
    -- content (when AI generation succeeded) -- separate from
    -- engage_provider_call itself so a moment can be traced to "the
    -- generation decision" distinctly from "every attempt made".
    CREATE TABLE generation_evaluation (
      id TEXT PRIMARY KEY,
      moment_id TEXT NOT NULL REFERENCES moment(id) ON DELETE CASCADE ON UPDATE CASCADE,
      provider_call_id TEXT REFERENCES engage_provider_call(id) ON DELETE SET NULL ON UPDATE CASCADE,
      policy_version TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- Safety/Age/Cultural/Playability gate result for a moment -- always
    -- recorded, whether the content came from AI or the static fallback
    -- pool, so the Ledger can answer "was this checked, and did it pass?"
    -- for every single moment ever served, not just AI-generated ones.
    CREATE TABLE safety_evaluation (
      id TEXT PRIMARY KEY,
      moment_id TEXT NOT NULL REFERENCES moment(id) ON DELETE CASCADE ON UPDATE CASCADE,
      passed INTEGER NOT NULL,
      gates_checked_json TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  const plans = db.prepare('SELECT id, features_json FROM plans').all();
  for (const plan of plans) {
    const features = JSON.parse(plan.features_json);
    if (!('engage_ai_generation' in features)) {
      features.engage_ai_generation = false;
      db.prepare('UPDATE plans SET features_json = ? WHERE id = ?').run(JSON.stringify(features), plan.id);
    }
  }
}

module.exports = { up };
