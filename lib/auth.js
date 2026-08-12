// lib/auth.js — minimal signed-session auth, no external deps.
// Production note: this hand-rolled HMAC session is adequate for a sandbox
// demo. A real deployment should sit behind a proper Identity Provider
// (per Screen Spec §18 — "Role-based access + scope-based access") and
// use HTTPS-only, rotated secrets, MFA for admin roles, etc.
'use strict';
const crypto = require('crypto');
const { db, hash, verifyPassword } = require('../db.js');

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'); // falls back to a per-process random secret if unset — fine for this sandbox demo, but set SESSION_SECRET before any real deployment or every restart invalidates all sessions

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
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordFailedAttempt(username);
    return null;
  }
  clearAttempts(username);
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), user.id);
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
