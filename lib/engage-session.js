// lib/engage-session.js — Phase 5 P5-Inc-2/3: Session creation linked to an
// Engage Pass, Moment serving from Approved Static/Fallback Content, strict
// Engagement Ceiling enforcement, capability-token authorization, and (Inc-3)
// full Experience Ledger event logging + customer response capture.
//
// Every function here takes an unguessable access_token, NEVER an internal
// id. engage_pass.id / engage_session.id are never accepted as
// authorization from client input anywhere in this file — the same
// discipline already proven for QR tokens (GET /api/qr/:token) elsewhere in
// this codebase. A token that does not resolve to exactly the right
// pass/session simply finds nothing; there is no id-guessing surface left.
'use strict';
const { db, uid } = require('../db.js');
const { resolvePersonality, resolveCeiling } = require('./engage-personality.js');
const { getOrCreateProfile, checkNovelty, recordExposureAndEvaluation } = require('./engage-novelty.js');
const crypto = require('crypto');

function genToken() { return crypto.randomBytes(24).toString('base64url'); }

function logExperienceEvent(sessionId, momentId, eventType, reason) {
  db.prepare(`INSERT INTO experience_event (session_id,moment_id,event_type,reason,ts) VALUES (?,?,?,?,?)`)
    .run(sessionId, momentId || null, eventType, reason || null, Date.now());
}

/** Starts a session for the pass identified by accessToken, or returns the
 * ALREADY-EXISTING session for that pass if one exists — regardless of
 * whether it is still running or has already ended. This is deliberate and
 * load-bearing: a Pass maps to exactly ONE session for the lifetime of
 * Inc-2's scope. Without this, a customer (or a malicious client) could
 * call startSession() again after a RESET session auto-ends at ceiling=1
 * and receive a FRESH session with a fresh ceiling counter — silently
 * bypassing "one experience only, no replay" by simply re-entering.
 * Checking only status='running' does NOT catch this, because the first
 * session's status is 'ended' by the time the bypass attempt happens — the
 * check must cover ANY prior session for this pass. */
function startSession(passAccessToken) {
  if (typeof passAccessToken !== 'string' || !passAccessToken) { const e = new Error('accessToken is required'); e.status = 403; throw e; }
  const pass = db.prepare('SELECT * FROM engage_pass WHERE access_token = ?').get(passAccessToken);
  if (!pass) { const e = new Error('Invalid or unknown access token'); e.status = 403; throw e; }
  const isExpired = pass.status === 'active' && Date.now() > pass.expires_at;
  if (pass.status !== 'active' || isExpired) { const e = new Error('Pass is not active'); e.status = 409; throw e; }

  const existing = db.prepare(`SELECT * FROM engage_session WHERE pass_id = ? ORDER BY started_at ASC LIMIT 1`).get(pass.id);
  if (existing) return existing;

  const snapshot = JSON.parse(pass.context_snapshot_json);
  const personality = resolvePersonality(snapshot.propertyId, snapshot.zoneId);
  const ceilingMax = resolveCeiling(personality, snapshot.partnerId, snapshot.propertyId, snapshot.zoneId);

  const sessionId = uid('es');
  const sessionToken = genToken();
  const now = Date.now();
  db.prepare(`INSERT INTO engage_session (id,pass_id,personality,ceiling_moments_used,ceiling_moments_max,status,started_at,access_token) VALUES (?,?,?,0,?,?,?,?)`)
    .run(sessionId, pass.id, personality, ceilingMax, 'running', now, sessionToken);
  logExperienceEvent(sessionId, null, 'session_start', `personality=${personality} ceilingMax=${ceilingMax}`);
  return db.prepare('SELECT * FROM engage_session WHERE id = ?').get(sessionId);
}

/** Serves the next Moment for the session identified by accessToken, or
 * throws a 409 if the Ceiling has been reached. An unknown token resolves
 * to nothing — 403, not 404, deliberately (see Inc-2 security notes). Every
 * serve is now logged to experience_event AND carries an explicit
 * selection_reason on the moment row itself — Inc-3's Experience Ledger
 * requirement to answer "why this content?" as a stored fact, not an
 * inference. */
function serveNextMoment(sessionAccessToken) {
  if (typeof sessionAccessToken !== 'string' || !sessionAccessToken) { const e = new Error('accessToken is required'); e.status = 403; throw e; }
  const session = db.prepare('SELECT * FROM engage_session WHERE access_token = ?').get(sessionAccessToken);
  if (!session) { const e = new Error('Invalid or unknown access token'); e.status = 403; throw e; }
  if (session.status !== 'running') { const e = new Error(`Session is ${session.status}, not running`); e.status = 409; throw e; }
  if (session.ceiling_moments_used >= session.ceiling_moments_max) {
    const e = new Error('Engagement Ceiling reached for this session'); e.status = 409; e.ceilingReached = true; throw e;
  }

  const mechanicVersion = db.prepare(`
    SELECT mv.* FROM mechanic_version mv JOIN mechanic m ON m.id = mv.mechanic_id
    WHERE m.category = 'static_fallback' AND mv.lifecycle_state = 'promoted'
      AND json_extract(mv.schema_json, '$.personality') = ?
    LIMIT 1`).get(session.personality);
  if (!mechanicVersion) { const e = new Error(`No approved content available for personality ${session.personality}`); e.status = 500; throw e; }
  const mechanic = db.prepare('SELECT * FROM mechanic WHERE id = ?').get(mechanicVersion.mechanic_id);

  const schema = JSON.parse(mechanicVersion.schema_json);
  const pool = schema.pool;
  const startIndex = session.ceiling_moments_used % pool.length;

  // Duplicate Prevention (Inc-4): resolve the customer's Engage-local
  // profile (known or fresh-anonymous, see lib/engage-novelty.js), then try
  // pool candidates starting from the natural round-robin position, picking
  // the FIRST one that is not a duplicate within the configured memory
  // window. If every candidate in this small static pool is already a
  // duplicate (realistic for Inc-4's fixed short lists), fall back to the
  // original round-robin choice anyway rather than blocking the
  // experience entirely -- but the resulting novelty_evaluation records
  // is_duplicate=true honestly either way; this is never silently hidden.
  const pass = db.prepare('SELECT * FROM engage_pass WHERE id = ?').get(session.pass_id);
  const snapshot = JSON.parse(pass.context_snapshot_json);
  const profile = getOrCreateProfile(snapshot.partnerId, pass.identity_ref, pass.id);

  let chosenIndex = startIndex, chosenEvaluation = null;
  for (let i = 0; i < pool.length; i++) {
    const candidateIndex = (startIndex + i) % pool.length;
    const evaluation = checkNovelty(profile.id, pool[candidateIndex], snapshot.partnerId, snapshot.propertyId, snapshot.zoneId);
    if (!evaluation.isDuplicate) { chosenIndex = candidateIndex; chosenEvaluation = evaluation; break; }
    if (i === 0) chosenEvaluation = evaluation; // remember the natural choice's evaluation as the fallback
  }
  const content = pool[chosenIndex];
  const noveltyNote = chosenEvaluation.isDuplicate
    ? `novelty: duplicate (score=${chosenEvaluation.similarityScore.toFixed(2)} >= threshold=${chosenEvaluation.threshold}), pool exhausted within memory window, served anyway`
    : `novelty: unique (score=${chosenEvaluation.similarityScore.toFixed(2)} < threshold=${chosenEvaluation.threshold})`;
  const selectionReason = `static_round_robin: mechanic=${mechanicVersion.id} pool_index=${chosenIndex}/${pool.length}; ${noveltyNote}`;

  const now = Date.now();
  const momentId = uid('mo');
  db.prepare(`INSERT INTO moment (id,session_id,mechanic_version_id,sequence_index,status,created_at,selection_reason) VALUES (?,?,?,?,?,?,?)`)
    .run(momentId, session.id, mechanicVersion.id, session.ceiling_moments_used, 'served', now, selectionReason);
  const payloadId = uid('pv');
  db.prepare(`INSERT INTO payload_version (id,moment_id,rendered_payload_json,source,created_at) VALUES (?,?,?,?,?)`)
    .run(payloadId, momentId, JSON.stringify(content), 'approved_fallback', now);
  logExperienceEvent(session.id, momentId, 'moment_served', selectionReason);
  recordExposureAndEvaluation(profile.id, mechanic.id, content, momentId, chosenEvaluation);

  const newUsed = session.ceiling_moments_used + 1;
  db.prepare('UPDATE engage_session SET ceiling_moments_used = ? WHERE id = ?').run(newUsed, session.id);

  const sessionEnded = newUsed >= session.ceiling_moments_max;
  if (sessionEnded) {
    db.prepare(`UPDATE engage_session SET status = 'ended', ended_at = ? WHERE id = ?`).run(now, session.id);
    logExperienceEvent(session.id, null, 'session_end', 'ceiling_reached');
  }

  return { momentId, payload: content, ceilingUsed: newUsed, ceilingMax: session.ceiling_moments_max, sessionEnded };
}

/** Records the customer's response to a specific Moment — "what was the
 * outcome?" in the Ledger's own terms. Ownership is enforced explicitly:
 * the moment must belong to the session resolved from sessionAccessToken,
 * or this is rejected — closing the exact "session/pass ownership" boundary
 * called out for testing. idempotencyKey (optional) makes a retried
 * submission safe: the same key for the same moment returns the original
 * result instead of recording a second response_event, mirroring the same
 * pattern already proven for POST /api/orders/:id/refund. */
function submitResponse(sessionAccessToken, momentId, action, idempotencyKey) {
  if (typeof sessionAccessToken !== 'string' || !sessionAccessToken) { const e = new Error('accessToken is required'); e.status = 403; throw e; }
  const session = db.prepare('SELECT * FROM engage_session WHERE access_token = ?').get(sessionAccessToken);
  if (!session) { const e = new Error('Invalid or unknown access token'); e.status = 403; throw e; }

  const moment = db.prepare('SELECT * FROM moment WHERE id = ?').get(momentId);
  if (!moment) { const e = new Error('Moment not found'); e.status = 404; throw e; }
  if (moment.session_id !== session.id) {
    // OWNERSHIP: this session's valid token does not authorize acting on a
    // DIFFERENT session's moment, even though the token itself is genuine.
    const e = new Error('This moment does not belong to the authorized session'); e.status = 403; throw e;
  }
  if (!['completed', 'skipped'].includes(action)) { const e = new Error("action must be 'completed' or 'skipped'"); e.status = 400; throw e; }

  if (idempotencyKey) {
    const existing = db.prepare(`SELECT * FROM response_event WHERE moment_id = ? AND idempotency_key = ?`).get(momentId, idempotencyKey);
    if (existing) return { id: existing.id, idempotent: true };
  }

  const now = Date.now();
  const responseId = uid('re');
  db.prepare(`INSERT INTO response_event (id,moment_id,response_payload_json,idempotency_key,ts) VALUES (?,?,?,?,?)`)
    .run(responseId, momentId, JSON.stringify({ action }), idempotencyKey || null, now);
  db.prepare('UPDATE moment SET status = ? WHERE id = ?').run(action, momentId);
  logExperienceEvent(session.id, momentId, action === 'completed' ? 'moment_completed' : 'moment_skipped', null);

  return { id: responseId, idempotent: false };
}

function endSession(sessionAccessToken) {
  if (typeof sessionAccessToken !== 'string' || !sessionAccessToken) { const e = new Error('accessToken is required'); e.status = 403; throw e; }
  const session = db.prepare('SELECT * FROM engage_session WHERE access_token = ?').get(sessionAccessToken);
  if (!session) { const e = new Error('Invalid or unknown access token'); e.status = 403; throw e; }
  if (session.status === 'running') {
    db.prepare(`UPDATE engage_session SET status = 'ended', ended_at = ? WHERE id = ?`).run(Date.now(), session.id);
    logExperienceEvent(session.id, null, 'session_end', 'explicit_end');
  }
  return db.prepare('SELECT * FROM engage_session WHERE id = ?').get(session.id);
}

module.exports = { startSession, serveNextMoment, submitResponse, endSession };
