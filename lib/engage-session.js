// lib/engage-session.js — Phase 5 P5-Inc-2: Session creation linked to an
// Engage Pass, Moment serving from Approved Static/Fallback Content, and
// strict Engagement Ceiling enforcement.
'use strict';
const { db, uid } = require('../db.js');
const { resolvePersonality, resolveCeiling } = require('./engage-personality.js');

/** Starts a session for a pass, or returns the ALREADY-EXISTING session for
 * that pass if one exists — regardless of whether it is still running or
 * has already ended. This is deliberate and load-bearing: a Pass maps to
 * exactly ONE session for the lifetime of Inc-2's scope. Without this, a
 * customer (or a buggy/malicious client) could call startSession() again
 * after their RESET session auto-ends at ceiling=1 and receive a FRESH
 * session with a fresh ceiling counter — silently bypassing "one experience
 * only, no replay" by simply re-entering. Checking only status='running'
 * (an earlier draft of this function did exactly that) does NOT catch this,
 * because the first session's status is 'ended' by the time the bypass
 * attempt happens — the check must cover ANY prior session for this pass. */
function startSession(passId) {
  const pass = db.prepare('SELECT * FROM engage_pass WHERE id = ?').get(passId);
  if (!pass) { const e = new Error('Pass not found'); e.status = 404; throw e; }
  const isExpired = pass.status === 'active' && Date.now() > pass.expires_at;
  if (pass.status !== 'active' || isExpired) { const e = new Error('Pass is not active'); e.status = 409; throw e; }

  const existing = db.prepare(`SELECT * FROM engage_session WHERE pass_id = ? ORDER BY started_at ASC LIMIT 1`).get(passId);
  if (existing) return existing;

  const snapshot = JSON.parse(pass.context_snapshot_json);
  const personality = resolvePersonality(snapshot.propertyId, snapshot.zoneId);
  const ceilingMax = resolveCeiling(personality, snapshot.partnerId, snapshot.propertyId, snapshot.zoneId);

  const sessionId = uid('es');
  const now = Date.now();
  db.prepare(`INSERT INTO engage_session (id,pass_id,personality,ceiling_moments_used,ceiling_moments_max,status,started_at) VALUES (?,?,?,0,?,?,?)`)
    .run(sessionId, passId, personality, ceilingMax, 'running', now);
  return db.prepare('SELECT * FROM engage_session WHERE id = ?').get(sessionId);
}

/** Serves the next Moment for a running session from the personality's
 * Approved Static/Fallback pool, or throws a 409 if the Ceiling has been
 * reached (including the RESET special case: ceiling_moments_max is
 * ALREADY hard-clamped to 1 at session creation, so this is one uniform
 * check, not a personality-specific branch). */
function serveNextMoment(sessionId) {
  const session = db.prepare('SELECT * FROM engage_session WHERE id = ?').get(sessionId);
  if (!session) { const e = new Error('Session not found'); e.status = 404; throw e; }
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

  const schema = JSON.parse(mechanicVersion.schema_json);
  const pool = schema.pool;
  // Simple round-robin through the static pool by sequence index — enough
  // variety for Inc-2's static content; Inc-4/Inc-7 add real novelty/semantic
  // anti-repetition on top of this same moment/payload structure.
  const content = pool[session.ceiling_moments_used % pool.length];

  const now = Date.now();
  const momentId = uid('mo');
  db.prepare(`INSERT INTO moment (id,session_id,mechanic_version_id,sequence_index,status,created_at) VALUES (?,?,?,?,?,?)`)
    .run(momentId, sessionId, mechanicVersion.id, session.ceiling_moments_used, 'served', now);
  const payloadId = uid('pv');
  db.prepare(`INSERT INTO payload_version (id,moment_id,rendered_payload_json,source,created_at) VALUES (?,?,?,?,?)`)
    .run(payloadId, momentId, JSON.stringify(content), 'approved_fallback', now);

  const newUsed = session.ceiling_moments_used + 1;
  db.prepare('UPDATE engage_session SET ceiling_moments_used = ? WHERE id = ?').run(newUsed, sessionId);

  // Reaching the ceiling on THIS serve ends the session automatically —
  // "إنهاء Session/Ceiling بصورة صحيحة" per the approval message.
  if (newUsed >= session.ceiling_moments_max) {
    db.prepare(`UPDATE engage_session SET status = 'ended', ended_at = ? WHERE id = ?`).run(now, sessionId);
  }

  return { momentId, payload: content, ceilingUsed: newUsed, ceilingMax: session.ceiling_moments_max, sessionEnded: newUsed >= session.ceiling_moments_max };
}

function endSession(sessionId) {
  const session = db.prepare('SELECT * FROM engage_session WHERE id = ?').get(sessionId);
  if (!session) { const e = new Error('Session not found'); e.status = 404; throw e; }
  if (session.status === 'running') {
    db.prepare(`UPDATE engage_session SET status = 'ended', ended_at = ? WHERE id = ?`).run(Date.now(), sessionId);
  }
  return db.prepare('SELECT * FROM engage_session WHERE id = ?').get(sessionId);
}

module.exports = { startSession, serveNextMoment, endSession };
