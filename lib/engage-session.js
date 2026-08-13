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
const { resolveAIGenerationEnabled } = require('./engage-flags.js');
const { getSubscription } = require('./plan.js');
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
 * inference.
 *
 * Inc-7: now async, and branches on the engage_ai_generation Feature Flag
 * (full Global->Contract->Property->Zone precedence, same as
 * engage_enabled). When OFF (the default for every plan today), this is
 * the EXACT unchanged Inc-2/4 static round-robin + text_similarity path --
 * byte-for-byte the same logic, same behavior, same tests. When ON, the
 * AI orchestrator (lib/engage-ai-orchestrator.js) is given the first shot,
 * with the static pool's natural round-robin choice kept ready as the
 * Approved Fallback if AI generation is exhausted for any reason (timeout,
 * error, safety rejection, or semantic duplicate on both the primary and
 * the one allowed alternate provider) -- the customer is served *something*
 * appropriate either way, never a raw error and never silence. */
async function serveNextMoment(sessionAccessToken) {
  if (typeof sessionAccessToken !== 'string' || !sessionAccessToken) { const e = new Error('accessToken is required'); e.status = 403; throw e; }
  const session = db.prepare('SELECT * FROM engage_session WHERE access_token = ?').get(sessionAccessToken);
  if (!session) { const e = new Error('Invalid or unknown access token'); e.status = 403; throw e; }
  if (session.status !== 'running') { const e = new Error(`Session is ${session.status}, not running`); e.status = 409; throw e; }

  // Concurrency-safe Ceiling claim (corrective round, discovered on this
  // increment's OWN first real concurrency test run): now that this
  // function is genuinely async (it awaits the AI orchestrator, which can
  // take up to ~4s per provider attempt), a plain "read ceiling_moments_used,
  // check, act" is no longer atomic with respect to other calls -- the JS
  // event loop CAN interleave two concurrent serveNextMoment() calls between
  // the read and the eventual write, letting both see the same
  // pre-increment count and both pass the check. This is the exact same
  // class of bug already fixed for Inc-5's participant ceiling (an atomic
  // SQL statement, not a separate read-then-write), applied here: the slot
  // is claimed with ONE atomic UPDATE, synchronously, BEFORE any await --
  // by the time this function reaches its first `await` (inside the AI
  // orchestrator), the ceiling accounting for THIS call is already
  // permanently settled at the database level, immune to whatever any
  // concurrently-running call does.
  const claim = db.prepare(`UPDATE engage_session SET ceiling_moments_used = ceiling_moments_used + 1 WHERE id = ? AND status = 'running' AND ceiling_moments_used < ceiling_moments_max`).run(session.id);
  if (claim.changes === 0) {
    const e = new Error('Engagement Ceiling reached for this session'); e.status = 409; e.ceilingReached = true; throw e;
  }
  const claimedSession = db.prepare('SELECT * FROM engage_session WHERE id = ?').get(session.id);
  const myMomentIndex = claimedSession.ceiling_moments_used - 1; // 0-based slot this call just atomically claimed

  const mechanicVersion = db.prepare(`
    SELECT mv.* FROM mechanic_version mv JOIN mechanic m ON m.id = mv.mechanic_id
    WHERE m.category = 'static_fallback' AND mv.lifecycle_state = 'promoted'
      AND json_extract(mv.schema_json, '$.personality') = ?
    LIMIT 1`).get(session.personality);
  if (!mechanicVersion) { const e = new Error(`No approved content available for personality ${session.personality}`); e.status = 500; throw e; }
  const mechanic = db.prepare('SELECT * FROM mechanic WHERE id = ?').get(mechanicVersion.mechanic_id);

  const pass = db.prepare('SELECT * FROM engage_pass WHERE id = ?').get(session.pass_id);
  const snapshot = JSON.parse(pass.context_snapshot_json);
  const profile = getOrCreateProfile(snapshot.partnerId, pass.identity_ref, pass.id);

  const schema = JSON.parse(mechanicVersion.schema_json);
  const pool = schema.pool;
  const startIndex = myMomentIndex % pool.length;
  const naturalFallbackContent = pool[startIndex];

  // The moment row is created FIRST, before content is decided -- Inc-7's
  // engage_provider_call/safety_evaluation rows carry a real FK to
  // moment(id), so they cannot be written before this row exists. This is
  // a genuine sequencing requirement discovered and fixed during this
  // increment's own build, not a stylistic choice: mechanic_version_id,
  // sequence_index, and created_at are all already known at this point
  // regardless of which content path is about to be taken, so creating
  // the row now (with selection_reason filled in afterward, once the
  // outcome is known) is the correct order, not a workaround.
  const now = Date.now();
  const momentId = uid('mo');
  db.prepare(`INSERT INTO moment (id,session_id,mechanic_version_id,sequence_index,status,created_at) VALUES (?,?,?,?,?,?)`)
    .run(momentId, session.id, mechanicVersion.id, myMomentIndex, 'served', now);

  const sub = getSubscription(snapshot.partnerId);
  const contractAIEnabled = !!(sub && sub.status === 'Active' && sub.features && sub.features.engage_ai_generation === true);
  const aiEnabled = resolveAIGenerationEnabled(contractAIEnabled, snapshot.partnerId, snapshot.propertyId, snapshot.zoneId);

  let content, source, selectionReason, finalEvaluation;

  if (aiEnabled) {
    const { generateWithOrchestration } = require('./engage-ai-orchestrator.js');
    const orchResult = await generateWithOrchestration({
      mechanicSchema: schema, context: { personality: session.personality, variantIndex: startIndex },
      momentId, profileId: profile.id, partnerId: snapshot.partnerId, propertyId: snapshot.propertyId, zoneId: snapshot.zoneId,
      fallbackContent: naturalFallbackContent,
    });
    content = orchResult.content;
    source = orchResult.source;
    finalEvaluation = orchResult.novelty;
    selectionReason = source === 'ai_generated'
      ? `ai_generated: provider_call=${orchResult.providerCallId}, safety=passed, novelty=unique(method=semantic_embedding,score=${orchResult.novelty.similarityScore.toFixed(2)})`
      : `ai_generation_exhausted_fallback -> static_round_robin: mechanic=${mechanicVersion.id} pool_index=${startIndex}/${pool.length}`;

    db.prepare(`INSERT INTO safety_evaluation (id,moment_id,passed,gates_checked_json,policy_version,created_at) VALUES (?,?,?,?,?,?)`)
      .run(uid('sfe'), momentId, orchResult.safety.passed ? 1 : 0, JSON.stringify(orchResult.safety.gatesChecked), orchResult.safety.policyVersion, Date.now());
    if (source === 'ai_generated' && orchResult.providerCallId) {
      db.prepare(`INSERT INTO generation_evaluation (id,moment_id,provider_call_id,policy_version,created_at) VALUES (?,?,?,?,?)`)
        .run(uid('gne'), momentId, orchResult.providerCallId, 'v1', Date.now());
    }
  } else {
    // Byte-for-byte the same Inc-2/4 static path -- unchanged.
    let chosenIndex = startIndex, chosenEvaluation = null;
    for (let i = 0; i < pool.length; i++) {
      const candidateIndex = (startIndex + i) % pool.length;
      const evaluation = checkNovelty(profile.id, pool[candidateIndex], snapshot.partnerId, snapshot.propertyId, snapshot.zoneId);
      if (!evaluation.isDuplicate) { chosenIndex = candidateIndex; chosenEvaluation = evaluation; break; }
      if (i === 0) chosenEvaluation = evaluation;
    }
    content = pool[chosenIndex];
    source = 'approved_fallback';
    finalEvaluation = chosenEvaluation;
    const noveltyNote = chosenEvaluation.isDuplicate
      ? `novelty: duplicate (score=${chosenEvaluation.similarityScore.toFixed(2)} >= threshold=${chosenEvaluation.threshold}), pool exhausted within memory window, served anyway`
      : `novelty: unique (score=${chosenEvaluation.similarityScore.toFixed(2)} < threshold=${chosenEvaluation.threshold})`;
    selectionReason = `static_round_robin: mechanic=${mechanicVersion.id} pool_index=${chosenIndex}/${pool.length}; ${noveltyNote}`;
  }

  db.prepare('UPDATE moment SET selection_reason = ? WHERE id = ?').run(selectionReason, momentId);
  const payloadId = uid('pv');
  db.prepare(`INSERT INTO payload_version (id,moment_id,rendered_payload_json,source,created_at) VALUES (?,?,?,?,?)`)
    .run(payloadId, momentId, JSON.stringify(content), source, now);
  logExperienceEvent(session.id, momentId, 'moment_served', selectionReason);
  recordExposureAndEvaluation(profile.id, mechanic.id, content, momentId, finalEvaluation);

  // Ceiling was already atomically incremented by the claim at the top of
  // this function -- claimedSession.ceiling_moments_used IS the correct,
  // final, race-proof count for this call. No second increment here.
  const newUsed = claimedSession.ceiling_moments_used;
  const sessionEnded = newUsed >= claimedSession.ceiling_moments_max;
  if (sessionEnded) {
    db.prepare(`UPDATE engage_session SET status = 'ended', ended_at = ? WHERE id = ?`).run(now, session.id);
    logExperienceEvent(session.id, null, 'session_end', 'ceiling_reached');
  }

  return { momentId, payload: content, source, ceilingUsed: newUsed, ceilingMax: claimedSession.ceiling_moments_max, sessionEnded };
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
