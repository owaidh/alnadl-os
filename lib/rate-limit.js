// lib/rate-limit.js — Public endpoint rate limiting (Go-Live P0 §3.9 / P0-6).
//
// SCOPE: this protects PUBLIC/GUEST endpoints, which are unauthenticated by
// design (a guest scans a QR and orders; there is no login to throttle
// behind). Staff login already has its own per-username limiter in
// lib/auth.js -- that is deliberately left alone rather than replaced, per
// the instruction to extend existing security rather than build a parallel
// path beside it.
//
// STORE CHOICE AND ITS HONEST LIMIT
// This is an in-memory sliding window. On a SINGLE instance it is a real,
// working limiter. On MULTI-INSTANCE deployments each process would hold
// its own counters, so the effective limit becomes N x the configured
// value -- which is a genuine weakening, not a rounding error. That is why
// the store is behind an interface: swapping in Redis is a driver change,
// not a rewrite. Production multi-instance MUST set RATE_LIMIT_STORE=redis
// (not implemented here -- no redis client is available in this
// environment) or run behind a single instance. server.js warns loudly at
// boot if it detects the unsafe combination.
'use strict';

const WINDOWS = {
  // Ordering is the expensive, state-changing path -- tightest budget.
  order_create:     { limit: 10,  windowMs: 60_000 },
  // Loyalty lookups read a value-bearing balance keyed on a phone number;
  // an unthrottled endpoint here is a phone-number enumeration oracle.
  loyalty_lookup:   { limit: 20,  windowMs: 60_000 },
  // OTP send/verify: deliberately strict. These are the classic brute-force
  // and SMS-cost-abuse targets, and lib/verification.js already enforces
  // per-challenge attempt limits -- this is the per-caller layer above it.
  verification:     { limit: 5,   windowMs: 300_000 },
  // Engage pass discovery hands out a capability token when proof matches;
  // throttling blunts offline guessing against the paymentRef.
  engage_discovery: { limit: 30,  windowMs: 60_000 },
  // Everything else public: generous, present mainly to stop trivial floods.
  public_default:   { limit: 120, windowMs: 60_000 },
};

function envOverride(bucket, field, fallback) {
  const key = `RATE_LIMIT_${bucket.toUpperCase()}_${field.toUpperCase()}`;
  const raw = process.env[key];
  const n = raw != null ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** In-memory sliding window. Keyed by (bucket, caller). */
class MemoryStore {
  constructor() { this.hits = new Map(); this.name = 'memory'; }
  /** Returns { allowed, remaining, retryAfterSec }. */
  check(key, limit, windowMs) {
    const now = Date.now();
    const arr = (this.hits.get(key) || []).filter(t => now - t < windowMs);
    if (arr.length >= limit) {
      const oldest = arr[0];
      this.hits.set(key, arr);
      return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) };
    }
    arr.push(now);
    this.hits.set(key, arr);
    return { allowed: true, remaining: limit - arr.length, retryAfterSec: 0 };
  }
  reset() { this.hits.clear(); }
  /** Bounded memory: drop windows nothing has touched recently. */
  sweep(maxWindowMs) {
    const now = Date.now();
    for (const [k, arr] of this.hits) {
      if (!arr.length || now - arr[arr.length - 1] > maxWindowMs) this.hits.delete(k);
    }
  }
}

const store = new MemoryStore();

/* ---------------------------------------------------------------------------
   R4-B / PB-2 — Trusted proxy policy.

   ما كان خطأً: X-Forwarded-For كان يُقرأ بلا شرط. أثبت تدقيق R4-A أن ذلك
   يُلغي كل حدود المعدل بترويسة واحدة -- 429 بلا ترويسة، و200 ثمانيًا مع
   قيمة مُزوَّرة متغيّرة. الترويسة يكتبها **العميل** ما لم يمسحها وكيل
   أمامه، فالثقة بها افتراضيًا هي الثقة بالمهاجم.

   القاعدة الآن: تُقبل XFF **فقط** إذا كان الاتصال المباشر (عنوان المقبس)
   قادمًا من عنوان مُدرَج صراحة في TRUSTED_PROXY_IPS. الافتراضي: لا ثقة.

   ولا يُستخدم أي ترويسة أخرى لإثبات أن الوكيل موثوق -- كل ترويسة قابلة
   للتزوير من العميل. الإثبات الوحيد المقبول هو **عنوان المقبس نفسه**،
   وهو ما لا يستطيع العميل تزويره على اتصال TCP قائم.
--------------------------------------------------------------------------- */
function normaliseIp(ip) {
  if (!ip) return '';
  // ::ffff:127.0.0.1 و 127.0.0.1 هما نفس المضيف
  return String(ip).replace(/^::ffff:/, '').trim();
}

function trustedProxies() {
  return String(process.env.TRUSTED_PROXY_IPS || '')
    .split(',').map(x => normaliseIp(x)).filter(Boolean);
}

/** هل الاتصال المباشر قادم من وكيل موثوق مُعلَن؟ */
function isFromTrustedProxy(req) {
  const list = trustedProxies();
  if (!list.length) return false; // الافتراضي: لا ثقة
  const direct = normaliseIp(req.socket && req.socket.remoteAddress);
  return !!direct && list.includes(direct);
}

/**
 * يُحدّد المتصل.
 * - من وكيل موثوق: يُؤخذ **آخر** عنوان أضافه الوكيل الموثوق، لا أول عنصر.
 *   الأول يكتبه العميل ويمكن حشوه بسلسلة مزيفة (multi-hop spoofing)؛
 *   والوكيل الموثوق يُلحق العنوان الحقيقي في النهاية.
 * - خلاف ذلك: عنوان المقبس، وهو الوحيد غير القابل للتزوير.
 */
function callerKey(req) {
  const direct = normaliseIp(req.socket && req.socket.remoteAddress) || 'unknown';
  if (!isFromTrustedProxy(req)) return direct;
  const xff = req.headers['x-forwarded-for'];
  if (!xff) return direct;
  const hops = String(xff).split(',').map(x => normaliseIp(x)).filter(Boolean);
  if (!hops.length) return direct;
  // آخر عنصر أضافه الوكيل الموثوق = العميل الحقيقي بالنسبة إليه.
  return hops[hops.length - 1];
}

function isDisabled() {
  // Tests and local development need to exercise flows far above these
  // budgets. Production can never disable it: the flag is ignored there.
  return process.env.RATE_LIMIT_DISABLED === '1' && process.env.NODE_ENV !== 'production';
}

/**
 * @returns {null} when the request may proceed, or
 *          { retryAfterSec } when it must be rejected with 429.
 */
function checkLimit(bucket, req) {
  if (isDisabled()) return null;
  const cfg = WINDOWS[bucket] || WINDOWS.public_default;
  const limit = envOverride(bucket, 'limit', cfg.limit);
  const windowMs = envOverride(bucket, 'window_ms', cfg.windowMs);
  const result = store.check(`${bucket}:${callerKey(req)}`, limit, windowMs);
  return result.allowed ? null : { retryAfterSec: result.retryAfterSec };
}

function resetAll() { store.reset(); }
function storeName() { return store.name; }
function sweep() { store.sweep(600_000); }

module.exports = { checkLimit, resetAll, storeName, sweep, WINDOWS, callerKey, isFromTrustedProxy, trustedProxies };
