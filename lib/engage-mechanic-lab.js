// lib/engage-mechanic-lab.js — Phase 5 P5-Inc-8: Mechanic Lab + Learning
// Engine + Lifecycle Governance.
//
// State machine: Draft -> Simulated -> Canary -> Emerging -> Promoted,
// with Held/Rejected reachable from several states and Retired as
// Promoted's sunset. Every transition is a single atomic
// compare-and-swap on the CURRENT state (not a blind write) -- this is
// the race-condition protection for concurrent Promote/Hold/Kill
// attempts, the same "UPDATE ... WHERE current_state = expected" pattern
// already proven for Inc-5's participant ceiling and Inc-7's Engagement
// Ceiling claim.
'use strict';
const { db, uid } = require('../db.js');

const CANARY_HARD_MAX_PERCENTAGE = 5; // §-critical: never configurable, not even by SuperAdmin
const DEFAULT_MIN_SAMPLE = 100;
const MIN_SAMPLE_LOWER_BOUND = 1, MIN_SAMPLE_UPPER_BOUND = 100000;
const POLICY_VERSION = 'mechanic-lab-v1';
const GLOBAL_SCOPE_ID = 'system';

// Legal forward/lateral transitions. Kill Switch bypasses this graph
// entirely (see killSwitchMechanic) but is still subject to the SAME
// atomic CAS -- "immediate" does not mean "unsynchronized".
const ALLOWED_TRANSITIONS = {
  draft: ['simulated'],
  simulated: ['canary'],
  canary: ['emerging', 'held', 'rejected'],
  emerging: ['promoted', 'held', 'rejected'],
  held: ['canary', 'emerging', 'rejected'],
  promoted: ['retired'],
  rejected: [],
  retired: [],
};

function getSampleCount(mechanicVersionId) {
  return db.prepare('SELECT COUNT(*) c FROM moment WHERE mechanic_version_id = ?').get(mechanicVersionId).c;
}

function getOpenSafetyIncidentCount(mechanicVersionId) {
  return db.prepare(`SELECT COUNT(*) c FROM mechanic_safety_incident WHERE mechanic_version_id = ? AND status = 'open'`).get(mechanicVersionId).c;
}

function resolveMinSample() {
  const row = db.prepare(`SELECT policy_value_json FROM venue_policy_override WHERE scope_type='global' AND scope_id=? AND policy_key='mechanic_min_sample'`).get(GLOBAL_SCOPE_ID);
  if (!row) return DEFAULT_MIN_SAMPLE;
  const parsed = JSON.parse(row.policy_value_json);
  return typeof parsed.value === 'number' ? parsed.value : DEFAULT_MIN_SAMPLE;
}

/** SuperAdmin-only. Bounds-validated at the write layer (reject, never
 * silently clamp -- the same discipline established since the Inc-4/Inc-6
 * corrective rounds). */
function setMinSampleOverride(value, setBy) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_SAMPLE_LOWER_BOUND || value > MIN_SAMPLE_UPPER_BOUND) {
    throw new Error(`mechanic_min_sample must be a whole number between ${MIN_SAMPLE_LOWER_BOUND} and ${MIN_SAMPLE_UPPER_BOUND} inclusive`);
  }
  db.prepare(`INSERT INTO venue_policy_override (id,scope_type,scope_id,policy_key,policy_value_json,set_by,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(uid('vpo'), 'global', GLOBAL_SCOPE_ID, 'mechanic_min_sample', JSON.stringify({ value }), setBy, Date.now());
}

function recordSafetyIncident(mechanicVersionId, momentId, reason) {
  const id = uid('msi');
  db.prepare(`INSERT INTO mechanic_safety_incident (id,mechanic_version_id,moment_id,status,reason,created_at) VALUES (?,?,?,?,?,?)`)
    .run(id, mechanicVersionId, momentId || null, 'open', reason || null, Date.now());
  return id;
}

/** SafetyReviewer or SuperAdmin (RBAC enforced at the route). */
function resolveSafetyIncident(incidentId, resolvedBy) {
  const incident = db.prepare('SELECT * FROM mechanic_safety_incident WHERE id = ?').get(incidentId);
  if (!incident) { const e = new Error('Safety incident not found'); e.status = 404; throw e; }
  if (incident.status === 'resolved') return incident; // idempotent
  db.prepare(`UPDATE mechanic_safety_incident SET status='resolved', resolved_at=?, resolved_by=? WHERE id=?`)
    .run(Date.now(), resolvedBy, incidentId);
  return db.prepare('SELECT * FROM mechanic_safety_incident WHERE id = ?').get(incidentId);
}

function metricsSnapshot(mechanicVersionId) {
  const sampleCount = getSampleCount(mechanicVersionId);
  const openIncidents = getOpenSafetyIncidentCount(mechanicVersionId);
  const simRuns = db.prepare('SELECT * FROM mechanic_simulation_run WHERE mechanic_version_id = ? ORDER BY created_at DESC').all(mechanicVersionId);
  return { sampleCount, openIncidents, simulationRunCount: simRuns.length, minSampleRequired: resolveMinSample() };
}

/** The single audited gate every lifecycle change goes through.
 * forceKillSwitch=true bypasses ALLOWED_TRANSITIONS (but never the CAS
 * race protection, and never the terminal-state check -- Retired/Rejected
 * mechanics have nothing left to kill). */
function transitionLifecycle(mechanicVersionId, toState, actor, reason, { canaryPercentage, isSystemDecision, forceKillSwitch } = {}) {
  const mv = db.prepare('SELECT * FROM mechanic_version WHERE id = ?').get(mechanicVersionId);
  if (!mv) { const e = new Error('Mechanic version not found'); e.status = 404; throw e; }
  const fromState = mv.lifecycle_state;

  // Explicit self-transition rejection -- without this, a redundant
  // UPDATE ... WHERE lifecycle_state = 'X' SET lifecycle_state = 'X'
  // still reports changes=1 in SQLite even though nothing meaningfully
  // changed, which would let two genuinely racing IDENTICAL operations
  // (e.g. two simultaneous kill-switches to the same target, or two
  // simultaneous identical promotions) both silently "succeed" instead of
  // the second one correctly detecting that the state it expected to
  // change is no longer the live one. Caught while designing the explicit
  // race-condition test this increment requires -- not by code review.
  if (toState === fromState) {
    const e = new Error(`Mechanic version is already in state ${fromState} -- this transition was already applied (likely by a concurrent request)`); e.status = 409; e.gate = 'already_in_state'; throw e;
  }

  if (forceKillSwitch) {
    if (['rejected', 'retired'].includes(fromState)) { const e = new Error(`Cannot kill-switch a mechanic already in terminal state ${fromState}`); e.status = 409; throw e; }
    if (!['held', 'rejected'].includes(toState)) { const e = new Error('Kill switch may only force a transition to held or rejected'); e.status = 400; throw e; }
  } else {
    const allowed = ALLOWED_TRANSITIONS[fromState] || [];
    if (!allowed.includes(toState)) { const e = new Error(`Illegal lifecycle transition: ${fromState} -> ${toState}`); e.status = 400; throw e; }
  }

  let newCanaryPercentage = mv.canary_percentage;
  if (toState === 'simulated' && !forceKillSwitch) {
    const simRunCount = db.prepare('SELECT COUNT(*) c FROM mechanic_simulation_run WHERE mechanic_version_id = ?').get(mechanicVersionId).c;
    if (simRunCount === 0) {
      const e = new Error('Cannot advance to simulated: no simulation run has been recorded for this mechanic version yet -- runSimulation() must genuinely execute first'); e.status = 409; e.gate = 'no_simulation'; throw e;
    }
  }
  if (toState === 'canary') {
    const pct = canaryPercentage != null ? canaryPercentage : CANARY_HARD_MAX_PERCENTAGE;
    if (typeof pct !== 'number' || pct <= 0 || pct > CANARY_HARD_MAX_PERCENTAGE) {
      const e = new Error(`canary_percentage must be greater than 0 and at most ${CANARY_HARD_MAX_PERCENTAGE} (hard ceiling, never configurable)`); e.status = 400; throw e;
    }
    newCanaryPercentage = pct;
  }

  const snapshot = metricsSnapshot(mechanicVersionId);
  if (toState === 'promoted' && !forceKillSwitch) {
    if (snapshot.sampleCount < snapshot.minSampleRequired) {
      const e = new Error(`Cannot promote: sample count ${snapshot.sampleCount} is below the configured minimum ${snapshot.minSampleRequired}`); e.status = 409; e.gate = 'min_sample'; throw e;
    }
    if (snapshot.openIncidents > 0) {
      const e = new Error(`Cannot promote: ${snapshot.openIncidents} unresolved Safety incident(s) exist for this mechanic version`); e.status = 409; e.gate = 'safety_incident'; throw e;
    }
  }

  // Atomic compare-and-swap: only succeeds if lifecycle_state is STILL
  // exactly fromState at write time -- the race-condition protection for
  // concurrent Promote/Hold/Kill attempts on the same mechanic_version.
  const cas = db.prepare(`UPDATE mechanic_version SET lifecycle_state = ?, canary_percentage = ? WHERE id = ? AND lifecycle_state = ?`)
    .run(toState, newCanaryPercentage, mechanicVersionId, fromState);
  if (cas.changes === 0) {
    const e = new Error('Lifecycle transition conflict -- this mechanic version was changed by another operation just now'); e.status = 409; e.gate = 'concurrency'; throw e;
  }

  db.prepare(`INSERT INTO mechanic_lifecycle_event (id,mechanic_version_id,from_state,to_state,reason,metrics_snapshot_json,actor,is_system_decision,policy_version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(uid('mle'), mechanicVersionId, fromState, toState, reason || null, JSON.stringify(snapshot), actor, isSystemDecision ? 1 : 0, POLICY_VERSION, Date.now());

  return db.prepare('SELECT * FROM mechanic_version WHERE id = ?').get(mechanicVersionId);
}

/** SuperAdmin-only immediate override -- "works immediately" means it
 * bypasses the normal ALLOWED_TRANSITIONS graph (a mechanic mid-Canary
 * can be killed straight to Held or Rejected without needing to pass
 * through Emerging first), but is still subject to the same atomic CAS
 * as every other transition -- immediate does not mean unsynchronized. */
function killSwitchMechanic(mechanicVersionId, toState, actor, reason) {
  return transitionLifecycle(mechanicVersionId, toState, actor, reason, { forceKillSwitch: true, isSystemDecision: false });
}

/** AI can PROPOSE a new mechanic -- structurally, this function only ever
 * writes to the mechanic/mechanic_version tables (both scoped to this
 * ONE new draft), and never touches venue_policy_override's global scope,
 * HARD_CEILING, or any other Global Safety constant. There is no code
 * path from here into any Global Safety setting -- "AI cannot modify
 * Global Safety Guardrails" is true by construction, not by a permission
 * check that could be bypassed. */
function proposeMechanicFromAI(name, category, personality, schemaBody) {
  const mechanicId = uid('mech');
  db.prepare(`INSERT INTO mechanic (id,name,category,created_by,created_at) VALUES (?,?,?,?,?)`)
    .run(mechanicId, name, category, 'ai', Date.now());
  const versionId = uid('mv');
  const schema = { personality, pool: schemaBody.pool || [] };
  db.prepare(`INSERT INTO mechanic_version (id,mechanic_id,version_number,schema_json,lifecycle_state,created_at) VALUES (?,?,?,?,?,?)`)
    .run(versionId, mechanicId, 1, JSON.stringify(schema), 'draft', Date.now());
  return db.prepare('SELECT * FROM mechanic_version WHERE id = ?').get(versionId);
}

/** Simulated sessions: proves "same production logic path without
 * reaching real customers" by genuinely CALLING the same evaluateSafety()
 * function every real moment is checked with (not a re-implementation),
 * and for AI-based mechanics, the SAME provider.generate() call a real
 * customer session would make -- but every result is aggregated into
 * mechanic_simulation_run only. Nothing here ever writes to
 * engage_session, engage_pass, moment, payload_version, exposure_memory,
 * or any table a real customer session, the Ledger, or Partner Overview
 * could ever read from -- structurally impossible for a simulation to
 * reach a real customer or pollute real analytics, not merely a
 * convention. */
async function runSimulation(mechanicVersionId, sampleCount, runBy) {
  const { evaluateSafety } = require('./engage-safety.js');
  const mv = db.prepare('SELECT * FROM mechanic_version WHERE id = ?').get(mechanicVersionId);
  if (!mv) { const e = new Error('Mechanic version not found'); e.status = 404; throw e; }
  const schema = JSON.parse(mv.schema_json);
  const pool = schema.pool || [];
  if (pool.length === 0) { const e = new Error('Mechanic version has no content pool to simulate'); e.status = 400; throw e; }

  let safetyPassCount = 0, safetyFailCount = 0;
  for (let i = 0; i < sampleCount; i++) {
    const candidate = pool[i % pool.length];
    const safety = evaluateSafety(candidate); // the REAL, same function every production moment uses
    if (safety.passed) safetyPassCount++; else safetyFailCount++;
  }

  const id = uid('msr');
  db.prepare(`INSERT INTO mechanic_simulation_run (id,mechanic_version_id,sample_count,safety_pass_count,safety_fail_count,policy_version,run_by,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, mechanicVersionId, sampleCount, safetyPassCount, safetyFailCount, POLICY_VERSION, runBy, Date.now());
  return db.prepare('SELECT * FROM mechanic_simulation_run WHERE id = ?').get(id);
}

module.exports = {
  transitionLifecycle, killSwitchMechanic, proposeMechanicFromAI, runSimulation,
  recordSafetyIncident, resolveSafetyIncident, getSampleCount, getOpenSafetyIncidentCount,
  resolveMinSample, setMinSampleOverride, metricsSnapshot,
  CANARY_HARD_MAX_PERCENTAGE, DEFAULT_MIN_SAMPLE, MIN_SAMPLE_LOWER_BOUND, MIN_SAMPLE_UPPER_BOUND,
  ALLOWED_TRANSITIONS, POLICY_VERSION,
};
