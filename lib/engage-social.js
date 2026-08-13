// lib/engage-social.js — Phase 5 P5-Inc-5: Social / Group Invite.
//
// Per §25.6 of the source spec: an invite is issued only from a valid
// Engage Pass/Session; the token is unguessable and reveals no sensitive
// ids; default expiry is 30 minutes OR the host session ending, whichever
// is first; default max participants is 8; join rejects cross-tenant/
// cross-property access and is rate limited; the invitee never needs a
// separate order and never gets order/payment permissions or the host's
// data.
'use strict';
const { db, uid } = require('../db.js');
const crypto = require('crypto');

const DEFAULT_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_PARTICIPANTS = 8;

// Join rate limiting — same in-memory sliding-window pattern already
// proven for login attempts in lib/auth.js, scoped to invite tokens
// instead of usernames: too many join attempts against ONE invite token
// (guessing games, abuse) are throttled without needing new infrastructure.
//
// PRODUCTION LIMITATION (documented explicitly, not silently assumed away):
// this Map is process-local, in-memory state. It is NOT shared/distributed
// across multiple Node instances (e.g. behind a load balancer running
// several app processes), and it resets to empty on every process restart.
// In a single-instance deployment (this project's current target, per
// docs/DEPLOYMENT.md) this is the correct, sufficient mechanism -- exactly
// like the login rate limiter it mirrors. If a future deployment runs
// multiple application instances, per-instance-only throttling means an
// attacker distributing requests across instances effectively multiplies
// the limit by the instance count. That is classified here explicitly as
// a Production Hardening requirement (shared store -- Redis or equivalent
// -- for this and the login limiter together), NOT something this
// increment builds preemptively without an actual multi-instance
// deployment to justify it.
//
// Bounded memory (corrective round): without cleanup, an entry is created
// per distinct invite token ever joined and NEVER removed once that token
// stops being touched (invites are one-off and expire in 30 minutes, so
// realistically every entry eventually goes stale) -- across long uptime
// with many invites, this Map would grow without bound. A periodic sweep
// (same setInterval + unref() pattern already used for the Engage Outbox
// Worker) removes any entry whose every recorded attempt has aged out of
// the window, so memory usage stays proportional to CURRENTLY ACTIVE
// invite activity, not lifetime invite count.
const joinAttempts = new Map(); // inviteToken -> [timestamps]
const MAX_JOIN_ATTEMPTS = 10, JOIN_WINDOW_MS = 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // sweep every 5 minutes
function isJoinRateLimited(inviteToken) {
  const attempts = (joinAttempts.get(inviteToken) || []).filter(t => Date.now() - t < JOIN_WINDOW_MS);
  joinAttempts.set(inviteToken, attempts);
  return attempts.length >= MAX_JOIN_ATTEMPTS;
}
function recordJoinAttempt(inviteToken) {
  const attempts = joinAttempts.get(inviteToken) || [];
  attempts.push(Date.now());
  joinAttempts.set(inviteToken, attempts);
}
function cleanupStaleJoinAttempts() {
  const now = Date.now();
  for (const [token, attempts] of joinAttempts) {
    const fresh = attempts.filter(t => now - t < JOIN_WINDOW_MS);
    if (fresh.length === 0) joinAttempts.delete(token);
    else if (fresh.length !== attempts.length) joinAttempts.set(token, fresh);
  }
}
let cleanupHandle = null;
function startJoinAttemptCleanup() {
  if (cleanupHandle) return;
  cleanupHandle = setInterval(cleanupStaleJoinAttempts, CLEANUP_INTERVAL_MS);
  if (cleanupHandle.unref) cleanupHandle.unref();
}
startJoinAttemptCleanup();

/** Creates a group invite for a valid, running host session. The token is
 * a fresh cryptographically random value (24 bytes, base64url) -- entirely
 * separate from the session's own access_token, so leaking an invite (by
 * design meant to be shared) never exposes the host's own session
 * capability. */
function createInvite(hostSessionAccessToken, maxParticipants) {
  if (typeof hostSessionAccessToken !== 'string' || !hostSessionAccessToken) { const e = new Error('accessToken is required'); e.status = 403; throw e; }
  const session = db.prepare('SELECT * FROM engage_session WHERE access_token = ?').get(hostSessionAccessToken);
  if (!session) { const e = new Error('Invalid or unknown access token'); e.status = 403; throw e; }
  if (session.status !== 'running') { const e = new Error(`Session is ${session.status}, not running -- cannot create an invite`); e.status = 409; throw e; }

  const max = (typeof maxParticipants === 'number' && maxParticipants > 0 && maxParticipants <= DEFAULT_MAX_PARTICIPANTS)
    ? Math.floor(maxParticipants) : DEFAULT_MAX_PARTICIPANTS; // never allow a caller to raise the ceiling above the default, only lower it
  const now = Date.now();
  const roomId = uid('gr');
  const inviteToken = crypto.randomBytes(24).toString('base64url');
  db.prepare(`INSERT INTO group_room (id,session_id,invite_token,max_participants,expires_at,created_at) VALUES (?,?,?,?,?,?)`)
    .run(roomId, session.id, inviteToken, max, now + DEFAULT_EXPIRY_MS, now);

  return { inviteToken, expiresAt: now + DEFAULT_EXPIRY_MS, maxParticipants: max };
}

/** Joins an existing, unexpired invite. Returns only what an invitee is
 * allowed to see: room-level metadata (personality, participant count) --
 * NEVER the host's order id, identity, or any order/payment capability.
 * The invitee does not need a Pass/Session of their own at all. */
function joinInvite(inviteToken, displayName) {
  if (typeof inviteToken !== 'string' || !inviteToken) { const e = new Error('inviteToken is required'); e.status = 400; throw e; }
  if (isJoinRateLimited(inviteToken)) { const e = new Error('Too many join attempts for this invite -- try again later'); e.status = 429; throw e; }
  recordJoinAttempt(inviteToken);

  const room = db.prepare('SELECT * FROM group_room WHERE invite_token = ?').get(inviteToken);
  if (!room) { const e = new Error('Invite not found or no longer valid'); e.status = 404; throw e; }

  const hostSession = db.prepare('SELECT * FROM engage_session WHERE id = ?').get(room.session_id);
  const isTimeExpired = Date.now() > room.expires_at;
  const isHostSessionEnded = !hostSession || hostSession.status !== 'running';
  if (isTimeExpired || isHostSessionEnded) {
    // "30 minutes OR host session ending, whichever is first" -- both
    // conditions collapse to the same 404 the caller sees for a genuinely
    // unknown token, deliberately: an invite that has simply expired is
    // not distinguishable from one that never existed, from the outside.
    const e = new Error('Invite not found or no longer valid'); e.status = 404; throw e;
  }

  // Concurrency-safe capacity check (corrective round): the previous
  // implementation did a separate COUNT(*) then INSERT as two statements --
  // a real TOCTOU race in principle (two simultaneous joins with one seat
  // remaining could both observe the same count before either inserts),
  // even though it never actually reproduced within a single Node process
  // due to node:sqlite's synchronous execution model and the JS event
  // loop's non-preemptive scheduling. Rather than rely on that ambient
  // property staying true across engine/deployment changes, capacity is
  // now checked and enforced as ONE atomic SQL statement: SQLite guarantees
  // a single statement's read-then-write is atomic regardless of what else
  // is contending for the same file, exactly the same principle already
  // relied on for the Transactional Outbox fix in the Inc-1 corrective
  // round. `changes` tells us definitively whether the WHERE clause let
  // the row through or blocked it -- no separate read to race against.
  const participantId = uid('epa');
  const now = Date.now();
  const insertResult = db.prepare(`
    INSERT INTO engage_participant (id, group_room_id, role, display_name, joined_at)
    SELECT ?, ?, 'invitee', ?, ?
    WHERE (SELECT COUNT(*) FROM engage_participant WHERE group_room_id = ?) < (SELECT max_participants FROM group_room WHERE id = ?)
  `).run(participantId, room.id, (displayName || '').slice(0, 60) || null, now, room.id, room.id);

  if (insertResult.changes === 0) {
    // The atomic check found the room already full at the instant this
    // statement executed -- correct even under real concurrent contention,
    // not just the happy-path count we might have read a moment earlier.
    const e = new Error('This group is full'); e.status = 409; throw e;
  }
  const currentCount = db.prepare('SELECT COUNT(*) c FROM engage_participant WHERE group_room_id = ?').get(room.id).c;

  return {
    participantId,
    personality: hostSession.personality,
    participantCount: currentCount,
    maxParticipants: room.max_participants,
  };
}

module.exports = {
  createInvite, joinInvite, DEFAULT_EXPIRY_MS, DEFAULT_MAX_PARTICIPANTS,
  // Exposed for direct testing of the bounded-memory cleanup behavior only
  // -- not part of the public HTTP API surface.
  _cleanupStaleJoinAttempts: cleanupStaleJoinAttempts,
  _getJoinAttemptsMapSize: () => joinAttempts.size,
  _recordJoinAttemptForTest: recordJoinAttempt,
  _setRawJoinAttemptsForTest: (token, timestamps) => joinAttempts.set(token, timestamps),
};
