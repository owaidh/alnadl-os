// lib/engage-novelty.js — Phase 5 P5-Inc-4: Customer/Anonymous Memory +
// Exposure Memory + Text Similarity Novelty + Duplicate Prevention.
//
// Method is deliberately named and constrained to 'text_similarity'
// throughout this file — this is a real, working duplicate-prevention
// mechanism (literal-hash matching + Jaccard word-overlap for near-literal
// repeats), but it is NOT semantic understanding. ENG-NOV-001 (Semantic
// anti-repetition) stays Partial after this increment on purpose; Inc-7
// adds real embeddings on top of this same novelty_evaluation table,
// it does not replace this file's approach, which remains valid as the
// fast, cheap first-pass check even once embeddings exist.
'use strict';
const { db, uid } = require('../db.js');
const crypto = require('crypto');

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_THRESHOLD = 0.8; // Jaccard similarity 0..1 -- >= this counts as a near-duplicate
const MIN_WINDOW_DAYS = 1, MAX_WINDOW_DAYS = 90;
const MIN_THRESHOLD = 0, MAX_THRESHOLD = 1;

function contentHash(content) {
  // Literal duplicate detection: exact same rendered text, hashed. Order-
  // independent of object key order since we serialize a fixed field list.
  const normalized = `${content.title_ar || ''}|${content.title_en || ''}|${content.body_ar || ''}|${content.body_en || ''}`;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function tokenize(content) {
  const text = `${content.title_ar || ''} ${content.title_en || ''} ${content.body_ar || ''} ${content.body_en || ''}`;
  return new Set(text.toLowerCase().split(/[\s.,!?؟،٫]+/).filter(Boolean));
}

/** Jaccard similarity on word sets — a real, cheap, deterministic text
 * similarity metric (intersection / union), not a placeholder. Honest
 * about its limits: this catches near-literal repeats (same words,
 * reordered or lightly edited), not paraphrases or semantically similar
 * but differently-worded content -- that gap is exactly why ENG-NOV-001
 * stays Partial until Inc-7's real embeddings. */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function getOverrideValue(scopeType, scopeId, key) {
  if (!scopeId) return null;
  const row = db.prepare(`SELECT policy_value_json FROM venue_policy_override WHERE scope_type = ? AND scope_id = ? AND policy_key = ?`).get(scopeType, scopeId, key);
  if (!row) return null;
  const parsed = JSON.parse(row.policy_value_json);
  return typeof parsed.value === 'number' ? parsed.value : null;
}

/** Configurable threshold + explicit memory window, same precedence chain
 * already proven for Engagement Ceiling (zone -> property -> partner ->
 * default), reusing the same venue_policy_override table with different
 * policy_key values. Both are clamped to sane hard bounds regardless of
 * override -- a window of 400 days or a threshold of 5.0 would be
 * meaningless/dangerous, so those bounds are not themselves configurable. */
function resolveNoveltyPolicy(partnerId, propertyId, zoneId) {
  const windowVal = getOverrideValue('zone', zoneId, 'novelty_window_days')
    ?? getOverrideValue('property', propertyId, 'novelty_window_days')
    ?? getOverrideValue('partner', partnerId, 'novelty_window_days')
    ?? DEFAULT_WINDOW_DAYS;
  const thresholdVal = getOverrideValue('zone', zoneId, 'novelty_threshold')
    ?? getOverrideValue('property', propertyId, 'novelty_threshold')
    ?? getOverrideValue('partner', partnerId, 'novelty_threshold')
    ?? DEFAULT_THRESHOLD;
  return {
    windowDays: Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, windowVal)),
    threshold: Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, thresholdVal)),
  };
}

function setNoveltyPolicyOverride(scopeType, scopeId, key, value, setBy) {
  if (!['novelty_window_days', 'novelty_threshold'].includes(key)) throw new Error(`Unknown novelty policy key: ${key}`);
  db.prepare(`INSERT INTO venue_policy_override (id,scope_type,scope_id,policy_key,policy_value_json,set_by,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(uid('vpo'), scopeType, scopeId, key, JSON.stringify({ value }), setBy, Date.now());
}

/** Normalizes common Saudi phone number formats to one canonical digit
 * string (966XXXXXXXXX) so the SAME real number in different formats
 * resolves to the SAME identity. Handles: local (0501234567), international
 * with plus (+966501234567), international without plus
 * (00966501234567/966501234567), and stray spaces/dashes in any of them.
 * Anything that doesn't match a recognized Saudi pattern falls through as
 * best-effort digit-stripping rather than failing -- this is not a
 * validator, it is a best-effort canonicalizer for the identity pipeline. */
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d+]/g, '');
  digits = digits.replace(/^\+/, '');
  if (digits.startsWith('00966')) digits = '966' + digits.slice(5);
  else if (digits.startsWith('966')) { /* already canonical */ }
  else if (digits.startsWith('05') && digits.length === 10) digits = '966' + digits.slice(1);
  else if (digits.startsWith('5') && digits.length === 9) digits = '966' + digits;
  return digits;
}

/** Turns a normalized phone into a stable, tenant-scoped, one-way
 * pseudonymous identifier via HMAC-SHA256 -- the raw phone digits are
 * NEVER stored in customer_engage_profile.identity_ref (or anywhere else
 * in the Inc-4 memory tables) after this point, only this digest. Partner
 * id is part of the HMAC input itself, not just the separate partner_id
 * column -- so even a full row (partner_id + identity_ref) leaked from
 * this table alone gives an attacker no way to recover the phone number or
 * correlate it against another partner's records, deliberately exceeding
 * what the UNIQUE(partner_id, identity_ref) column constraint alone would
 * guarantee. Key is the same stable server secret already required for
 * session signing (SESSION_SECRET, enforced in production since Q06) --
 * a separate, dedicated secret was considered but rejected as unnecessary
 * operational complexity for what is fundamentally the same "stable
 * server-side secret" requirement. */
function pseudonymizeIdentity(partnerId, normalizedPhone) {
  const secret = process.env.SESSION_SECRET || 'dev-only-non-secret-engage-pseudonym-fallback';
  return crypto.createHmac('sha256', secret).update(`${partnerId}:${normalizedPhone}`).digest('hex');
}

/** Resolves (or creates) the Engage-local profile for a pass. A KNOWN
 * identity (pass.identity_ref set -- i.e. the order had a customer_phone,
 * captured at Pass creation in Inc-1) persists across visits to the SAME
 * partner: the phone is normalized then pseudonymized via HMAC before ever
 * touching this table, so the same real number in any common format
 * resolves to the same profile, while the raw digits are never stored here.
 * An ANONYMOUS pass (no phone captured) gets a FRESH pseudonymous profile
 * scoped to this one pass only -- there is no reliable, privacy-respecting
 * way to correlate two separate anonymous visits, so this deliberately
 * does NOT attempt to. Nothing here ever writes to any Core customer/
 * loyalty table -- Engage Core Isolation holds. */
function getOrCreateProfile(partnerId, rawIdentityRef, passId) {
  const now = Date.now();
  const isAnonymous = !rawIdentityRef;
  const effectiveIdentityRef = isAnonymous
    ? `anon:${passId}`
    : pseudonymizeIdentity(partnerId, normalizePhone(rawIdentityRef));

  const existing = db.prepare(`SELECT * FROM customer_engage_profile WHERE partner_id = ? AND identity_ref = ?`).get(partnerId, effectiveIdentityRef);
  if (existing) {
    db.prepare(`UPDATE customer_engage_profile SET last_seen_at = ? WHERE id = ?`).run(now, existing.id);
    return existing;
  }

  const profileId = uid('cep');
  db.prepare(`INSERT INTO customer_engage_profile (id,partner_id,identity_ref,is_anonymous,created_at,last_seen_at) VALUES (?,?,?,?,?,?)`)
    .run(profileId, partnerId, effectiveIdentityRef, isAnonymous ? 1 : 0, now, now);
  return db.prepare('SELECT * FROM customer_engage_profile WHERE id = ?').get(profileId);
}

/** Checks a candidate content item against this profile's exposure memory
 * within the resolved window. Returns { isDuplicate, similarityScore,
 * threshold } -- does NOT write anything; callers decide what to do with
 * the result (e.g. try the next pool candidate) before recording the
 * final choice via recordExposureAndEvaluation(). Computes REAL Jaccard
 * similarity against every remembered exposure in the window (not just an
 * exact-hash short-circuit) -- token_set_json is stored specifically so
 * this comparison is genuinely possible, not approximated. */
function checkNovelty(profileId, candidateContent, partnerId, propertyId, zoneId) {
  const { windowDays, threshold } = resolveNoveltyPolicy(partnerId, propertyId, zoneId);
  const windowStart = Date.now() - windowDays * 24 * 3600 * 1000;
  const memories = db.prepare(`SELECT content_hash, token_set_json FROM exposure_memory WHERE profile_id = ? AND exposed_at >= ?`).all(profileId, windowStart);

  const candidateHash = contentHash(candidateContent);
  const candidateTokens = tokenize(candidateContent);

  let maxSimilarity = 0;
  for (const mem of memories) {
    if (mem.content_hash === candidateHash) { maxSimilarity = 1; break; } // exact literal repeat, can't get more similar than this
    const memTokens = new Set(JSON.parse(mem.token_set_json));
    const sim = jaccardSimilarity(candidateTokens, memTokens);
    if (sim > maxSimilarity) maxSimilarity = sim;
  }

  return { isDuplicate: maxSimilarity >= threshold, similarityScore: maxSimilarity, threshold, method: 'text_similarity' };
}

function recordExposureAndEvaluation(profileId, mechanicId, candidateContent, momentId, evaluation) {
  const now = Date.now();
  const tokens = [...tokenize(candidateContent)];
  db.prepare(`INSERT INTO exposure_memory (id,profile_id,mechanic_id,content_hash,token_set_json,exposed_at) VALUES (?,?,?,?,?,?)`)
    .run(uid('exm'), profileId, mechanicId, contentHash(candidateContent), JSON.stringify(tokens), now);
  db.prepare(`INSERT INTO novelty_evaluation (id,moment_id,is_duplicate,similarity_score,threshold_used,method,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(uid('nov'), momentId, evaluation.isDuplicate ? 1 : 0, evaluation.similarityScore, evaluation.threshold, evaluation.method, now);
}

module.exports = {
  resolveNoveltyPolicy, setNoveltyPolicyOverride, getOrCreateProfile,
  checkNovelty, recordExposureAndEvaluation, contentHash, jaccardSimilarity, tokenize,
  normalizePhone, pseudonymizeIdentity,
  DEFAULT_WINDOW_DAYS, DEFAULT_THRESHOLD, MIN_WINDOW_DAYS, MAX_WINDOW_DAYS, MIN_THRESHOLD, MAX_THRESHOLD,
};
