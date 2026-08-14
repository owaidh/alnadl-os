// lib/verification.js — Guest verification, provider-agnostic (Go-Live P0 §3.6).
//
// WHY THIS EXISTS AS AN ABSTRACTION AND NOT AN SMS CLIENT
// §3.6 is explicit: no SMS provider is being connected now, but loyalty
// redemption policy (§3.8) depends on whether a guest's phone can be
// PROVEN theirs. If the eventual provider were wired straight into the
// loyalty module, then choosing WhatsApp OTP or Email OTP or an external
// identity provider later would mean reopening account structure. So the
// seam is drawn here, once:
//
//   VerificationProvider = { name, sendChallenge(), verifyChallenge() }
//
// lib/loyalty.js never learns which provider exists. It only ever reads
// loyalty_accounts.verification_status. Adding a real provider later is a
// configuration change (VERIFICATION_PROVIDER=...), not a refactor.
//
// SECURITY PROPERTIES BUILT IN HERE ONCE, SO NO FUTURE PROVIDER HAS TO
// REIMPLEMENT THEM:
//   * the code is never stored in plain text -- only a salted hash
//   * expiry, attempt limit, resend cooldown, single-use consumption
//   * replay protection: a consumed or expired challenge can never verify
//   * failure of the provider must never break the order journey
'use strict';
const crypto = require('crypto');
const { db, uid } = require('../db.js');

const CODE_TTL_MS = 5 * 60 * 1000;   // a challenge is valid for 5 minutes
const MAX_ATTEMPTS = 5;              // wrong guesses before the challenge locks
const RESEND_COOLDOWN_MS = 60 * 1000; // minimum gap between sends

function hashCode(code, salt) {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
}
function codeSalt() {
  return process.env.SESSION_SECRET || 'dev-only-verification-salt';
}

/* ---------------------------------------------------------------------------
   NullProvider — the ACTIVE default while no external provider is connected.
   It does not pretend to deliver anything: sendChallenge reports
   { delivered: false, reason: 'no_provider' }. That is what keeps §3.8's
   'verified_only' redemption policy honest -- with no provider, nothing
   becomes verified, so self-service redemption stays closed while accrual
   continues working normally and the order journey is untouched.
--------------------------------------------------------------------------- */
class NullProvider {
  constructor() { this.name = 'null'; this.channel = 'none'; }
  async sendChallenge() { return { delivered: false, reason: 'no_provider' }; }
}

/* MockProvider — for tests and staging ONLY (§7 acceptance list requires a
   working send/verify lifecycle to be provable). It exposes the generated
   code through a table so a test can complete the flow. It refuses to load
   in production so it can never become a real bypass. */
class MockProvider {
  constructor() {
    this.name = 'mock'; this.channel = 'mock';
    db.exec(`CREATE TABLE IF NOT EXISTS _test_verification_codes (challenge_id TEXT PRIMARY KEY, code TEXT)`);
  }
  async sendChallenge({ challengeId, code }) {
    db.prepare(`INSERT OR REPLACE INTO _test_verification_codes (challenge_id, code) VALUES (?,?)`)
      .run(challengeId, code);
    return { delivered: true };
  }
}

function getProvider() {
  const name = process.env.VERIFICATION_PROVIDER || 'null';
  if (name === 'mock') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('VERIFICATION_PROVIDER=mock is refused in production');
    }
    return new MockProvider();
  }
  return new NullProvider(); // unknown names fall back to the safe default
}

function isVerificationAvailable() {
  return getProvider().name !== 'null';
}

/** Start a challenge. Returns { ok, reason } and NEVER throws into the
 *  caller's request path -- a provider outage must not break ordering. */
async function sendChallenge(partnerId, rawCustomerKey, channel = 'sms') {
  const { normalizeCustomerKey } = require('./loyalty.js');
  const customerKey = normalizeCustomerKey(rawCustomerKey);
  if (!partnerId || !customerKey) return { ok: false, reason: 'invalid_request' };

  const recent = db.prepare(`
    SELECT created_at FROM verification_challenges
    WHERE partner_id = ? AND customer_key = ? ORDER BY created_at DESC LIMIT 1`).get(partnerId, customerKey);
  if (recent && Date.now() - recent.created_at < RESEND_COOLDOWN_MS) {
    return { ok: false, reason: 'cooldown' };
  }

  const provider = getProvider();
  if (provider.name === 'null') return { ok: false, reason: 'no_provider' };

  // Supersede any still-open challenge so only one can ever be live.
  db.prepare(`UPDATE verification_challenges SET status='expired'
              WHERE partner_id = ? AND customer_key = ? AND status='pending'`).run(partnerId, customerKey);

  const code = String(crypto.randomInt(100000, 1000000)); // 6 digits
  const challengeId = uid('vc');
  const now = Date.now();
  db.prepare(`INSERT INTO verification_challenges
              (id,partner_id,customer_key,channel,code_hash,status,attempts,created_at,expires_at)
              VALUES (?,?,?,?,?,'pending',0,?,?)`)
    .run(challengeId, partnerId, customerKey, channel, hashCode(code, codeSalt()), now, now + CODE_TTL_MS);

  try {
    const result = await provider.sendChallenge({ challengeId, code, customerKey, channel });
    if (!result || result.delivered !== true) {
      db.prepare(`UPDATE verification_challenges SET status='expired' WHERE id = ?`).run(challengeId);
      return { ok: false, reason: (result && result.reason) || 'delivery_failed' };
    }
  } catch (e) {
    // Provider threw: fail closed on verification, but never surface the
    // provider's internal error to the guest (§4.2 log hygiene).
    db.prepare(`UPDATE verification_challenges SET status='expired' WHERE id = ?`).run(challengeId);
    return { ok: false, reason: 'delivery_failed' };
  }
  return { ok: true, challengeId, expiresAt: now + CODE_TTL_MS };
}

/** Verify a submitted code. Only a genuinely correct, unexpired, unconsumed
 *  challenge flips the account to 'verified'. */
function verifyChallenge(partnerId, rawCustomerKey, submittedCode) {
  const { normalizeCustomerKey } = require('./loyalty.js');
  const customerKey = normalizeCustomerKey(rawCustomerKey);
  if (!partnerId || !customerKey || !submittedCode) return { ok: false, reason: 'invalid_request' };

  const ch = db.prepare(`
    SELECT * FROM verification_challenges
    WHERE partner_id = ? AND customer_key = ? AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1`).get(partnerId, customerKey);
  if (!ch) return { ok: false, reason: 'no_pending_challenge' };

  if (Date.now() > ch.expires_at) {
    db.prepare(`UPDATE verification_challenges SET status='expired' WHERE id = ?`).run(ch.id);
    return { ok: false, reason: 'expired' };
  }
  if (ch.attempts >= MAX_ATTEMPTS) {
    db.prepare(`UPDATE verification_challenges SET status='locked' WHERE id = ?`).run(ch.id);
    return { ok: false, reason: 'locked' };
  }

  const expected = Buffer.from(ch.code_hash);
  const actual = Buffer.from(hashCode(String(submittedCode), codeSalt()));
  const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!matches) {
    const attempts = ch.attempts + 1;
    db.prepare(`UPDATE verification_challenges SET attempts = ?, status = ? WHERE id = ?`)
      .run(attempts, attempts >= MAX_ATTEMPTS ? 'locked' : 'pending', ch.id);
    return { ok: false, reason: attempts >= MAX_ATTEMPTS ? 'locked' : 'invalid_code' };
  }

  // Single use: consumed immediately, so the same code can never be replayed.
  db.prepare(`UPDATE verification_challenges SET status='verified', consumed_at=? WHERE id = ?`)
    .run(Date.now(), ch.id);
  const { getOrCreateAccount } = require('./loyalty.js');
  const acct = getOrCreateAccount(partnerId, customerKey);
  if (acct) {
    db.prepare(`UPDATE loyalty_accounts SET verification_status='verified' WHERE id = ?`).run(acct.id);
  }
  return { ok: true };
}

module.exports = {
  getProvider, isVerificationAvailable, sendChallenge, verifyChallenge,
  NullProvider, MockProvider, CODE_TTL_MS, MAX_ATTEMPTS, RESEND_COOLDOWN_MS,
};
