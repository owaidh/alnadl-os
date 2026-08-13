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
const joinAttempts = new Map(); // inviteToken -> [timestamps]
const MAX_JOIN_ATTEMPTS = 10, JOIN_WINDOW_MS = 60 * 1000;
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

  const currentCount = db.prepare('SELECT COUNT(*) c FROM engage_participant WHERE group_room_id = ?').get(room.id).c;
  if (currentCount >= room.max_participants) { const e = new Error('This group is full'); e.status = 409; throw e; }

  const participantId = uid('epa');
  const now = Date.now();
  db.prepare(`INSERT INTO engage_participant (id,group_room_id,role,display_name,joined_at) VALUES (?,?,?,?,?)`)
    .run(participantId, room.id, 'invitee', (displayName || '').slice(0, 60) || null, now);

  return {
    participantId,
    personality: hostSession.personality,
    participantCount: currentCount + 1,
    maxParticipants: room.max_participants,
  };
}

module.exports = { createInvite, joinInvite, DEFAULT_EXPIRY_MS, DEFAULT_MAX_PARTICIPANTS };
