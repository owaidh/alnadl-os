// lib/auth.js — minimal signed-session auth, no external deps.
// Production note: this hand-rolled HMAC session is adequate for a sandbox
// demo. A real deployment should sit behind a proper Identity Provider
// (per Screen Spec §18 — "Role-based access + scope-based access") and
// use HTTPS-only, rotated secrets, MFA for admin roles, etc.
'use strict';
const crypto = require('crypto');
const { db, hash, hashPbkdf2, verifyPassword } = require('../db.js');

// Q06 (2nd corrective round): in production, a missing/weak SESSION_SECRET
// must be a hard startup failure, not a warning the process ignores.
// Development/demo still gets a safe random per-process fallback so the
// sandbox keeps working with zero setup.
function resolveSessionSecret() {
  const provided = process.env.SESSION_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    if (!provided || provided.length < 32) {
      console.error('\n❌ FATAL: NODE_ENV=production requires SESSION_SECRET to be set to a');
      console.error('   random value of at least 32 characters (e.g. `openssl rand -hex 32`).');
      console.error('   Refusing to start with a randomly-generated or missing secret in');
      console.error('   production -- every restart would silently invalidate every session.\n');
      process.exit(1);
    }
    return provided;
  }
  return provided || crypto.randomBytes(32).toString('hex'); // dev/demo fallback only
}
const SECRET = resolveSessionSecret();

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verify(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

// Q06: simple in-memory login rate limiter — 5 failed attempts per
// username per 15-minute window, then locked out. In-memory is fine for a
// single-process deployment; a real multi-instance production deployment
// should move this to a shared store (Redis) — noted in docs/DEPLOYMENT.md.
const loginAttempts = new Map(); // username -> [timestamps of failed attempts]
const MAX_ATTEMPTS = 5, WINDOW_MS = 15 * 60 * 1000;
function isRateLimited(username) {
  const attempts = (loginAttempts.get(username) || []).filter(t => Date.now() - t < WINDOW_MS);
  loginAttempts.set(username, attempts);
  return attempts.length >= MAX_ATTEMPTS;
}
function recordFailedAttempt(username) {
  const attempts = loginAttempts.get(username) || [];
  attempts.push(Date.now());
  loginAttempts.set(username, attempts);
}
function clearAttempts(username) { loginAttempts.delete(username); }

function login(username, password) {
  if (isRateLimited(username)) { const e = new Error('Too many failed login attempts — try again later'); e.status = 429; throw e; }
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  // Role Corrective §3.1 — دفاع في العمق على مسار الدخول نفسه.
  // حساب لم يُفعّل بعد يحمل password_hash = NULL. بدون هذا الفحص:
  //   (أ) verifyPassword قد تُقارن ضد null بسلوك غير محدد، و
  //   (ب) ترقية التجزئة الكسولة أدناه ترمي على null.startsWith().
  // الرفض هنا صريح ومبكر، ويُعامَل كفشل دخول عادي فلا يكشف أن الحساب
  // موجود لكنه غير مُفعّل -- وهو ما كان سيصبح أداة تعداد أسماء مستخدمين.
  if (!user || !user.password_hash || user.status === 'pending_activation') {
    recordFailedAttempt(username);
    return null;
  }
  if (!verifyPassword(password, user.password_hash)) {
    recordFailedAttempt(username);
    return null;
  }
  clearAttempts(username);
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), user.id);
  // Lazy hash upgrade: a legacy (pre-Q06) SHA-256 row is transparently
  // upgraded to PBKDF2 the moment it successfully authenticates — no batch
  // migration needed, and a user never has to reset their password for this.
  if (!user.password_hash.startsWith('pbkdf2:')) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPbkdf2(password), user.id);
  }
  const payload = { uid: user.id, username: user.username, role: user.role, scope: user.partner_scope, exp: Date.now() + 8 * 3600 * 1000 };
  return { token: sign(payload), user: { username: user.username, role: user.role, scope: user.partner_scope } };
}

function authenticate(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  return verify(token);
}

/** requireRole(['Operator','SiteManager']) — throws 401/403-shaped error object */
function requireRole(session, allowedRoles) {
  if (!session) { const e = new Error('Unauthorized'); e.status = 401; throw e; }
  if (allowedRoles && !allowedRoles.includes(session.role)) { const e = new Error('Forbidden'); e.status = 403; throw e; }
  return session;
}

/** Partner-scope isolation: PartnerViewer/Admin can only see their own partner_id (§18) */
function assertPartnerScope(session, partnerId) {
  if (session.role === 'PartnerViewer' || session.role === 'PartnerAdmin') {
    if (session.scope !== partnerId) { const e = new Error('Forbidden — partner scope mismatch'); e.status = 403; throw e; }
  }
}

module.exports = { login, authenticate, requireRole, assertPartnerScope };
