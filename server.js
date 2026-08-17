// server.js — Alnadl Hospitality OS backend.
// Zero external dependencies (Node's built-in http + node:sqlite only), so
// it runs anywhere with `node server.js` — no npm install required.
'use strict';
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { db, uid, hash, hashPbkdf2 } = require('./db.js');
const { login, authenticate, requireRole, assertPartnerScope } = require('./lib/auth.js');
const { canTransition, actorAllowed, TRANSITIONS } = require('./lib/statemachine.js');
const { computeSettlement, saveSettlement } = require('./lib/settlement.js');
const { getSubscription, requireFeature } = require('./lib/plan.js');
const { getGateway } = require('./lib/payment.js');
const { getOrCreateAccount, findAccount, getHistory, earnPoints, quoteRedemption, commitRedemption, isLoyaltyEnabled, isRedeemEnabled, redeemPolicy } = require('./lib/loyalty.js');
const { sendChallenge, verifyChallenge, isVerificationAvailable } = require('./lib/verification.js');
const { checkLimit, storeName: rateLimitStore, sweep: sweepRateLimits } = require('./lib/rate-limit.js');
const { log, correlationId } = require('./lib/logger.js');
const { assertCanManageUser, assertNotLastSuperAdmin, assignableRoles, issueActivationToken, peekActivation, consumeActivation, ROLE_SUMMARY } = require('./lib/iam.js');
const { resolveEngageEnabled, getGlobalKillSwitchState, getAIGenerationGlobalKillSwitchState } = require('./lib/engage-flags.js');
const partnerStatus = require('./lib/partner-status.js');
const { getWallet, quoteCoverage, commitSpend } = require('./lib/wallet.js');
const { getActiveModel, computeAmounts, recordOrderRevenue, recordRefundRevenue } = require('./lib/revenue-engine.js');
const { processOutboxOnce, startEngageWorker, stopEngageWorker } = require('./lib/engage-worker.js');
const { startSession, serveNextMoment, submitResponse, endSession } = require('./lib/engage-session.js');
const { createInvite, joinInvite } = require('./lib/engage-social.js');
const { getFullLedger, getAdminOverview, getPartnerOverview } = require('./lib/engage-ledger.js');
const gateway = getGateway();

const PORT = process.env.PORT || 8787;
const PUBLIC_DIR = path.join(__dirname, 'public');
// UX-2: matches the existing default already used at outlet creation
// (`b.slaPrepMin || 8`) — a legacy order whose outlet can't be resolved
// (or a genuinely outlet-less order) falls back to this same number
// rather than a second, different guess.
const DEFAULT_SLA_PREP_MIN = 8;
// UX-3 corrective round: the spec asks for "unusual refunds", not "any
// refund". A refund is only surfaced as an attention item when the last
// 7 days' refund value reaches this share of the same period's delivered
// gross. 5% is a deliberate, documented starting point (not derived from
// this system's own history, which is too small to calibrate against
// yet) -- it is a single named constant precisely so it can be tuned or
// made partner-configurable later without hunting through the logic.
const REFUND_ATTENTION_RATE = 5;

/* ---------------------------- small utilities ---------------------------- */
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}
function audit(actor, role, action, entity, before, after, reason) {
  db.prepare(`INSERT INTO audit_log (actor,role,action,entity,before,after,reason,ts) VALUES (?,?,?,?,?,?,?,?)`)
    .run(actor, role, action, entity, before != null ? JSON.stringify(before) : null, after != null ? JSON.stringify(after) : null, reason || null, Date.now());
}
// QR analytics (§5): records a raw scan/order event per token. Deliberately
// NOT deduplicated or throttled here — a real "unique visitor" definition
// is a product decision for later; this table is the raw event log
// everything else (Last Scan, Conversion Rate...) is computed from.
function logQrEvent(token, eventType, orderId) {
  db.prepare(`INSERT INTO qr_analytics_events (token,event_type,order_id,ts) VALUES (?,?,?,?)`).run(token, eventType, orderId || null, Date.now());
}
// Notification log (§16 من المواصفات). No real SMS/email/push provider is
// wired up — this records the *event* so the extension point exists and is
// visible in the admin UI; swapping in a real provider (Twilio, SES, FCM…)
// means calling that provider's API from inside this one function.
const NOTIFY_MATRIX = { // event -> which roles would receive it in production
  order_created: ['Customer'], payment_success: ['Customer'], payment_failed: ['Customer'],
  order_accepted: ['Customer'], order_ready: ['Customer', 'Runner'], order_out: ['Customer'],
  order_delivered: ['Customer'], order_cancelled: ['Customer', 'SiteManager'], sla_breach: ['SiteManager'],
  order_refunded: ['Customer', 'AlnadlFinance'],
};
// Q16: this records notification EVENTS to a database log — it is NOT a
// working SMS/Email/Push notification service. No message is ever actually
// sent to anyone. Status: INTEGRATION PENDING (matches the same
// architecture pattern as lib/payment.js — one clear extension point, not
// wired to a real provider). A real integration would replace/extend this
// function to call an actual provider SDK (Twilio, SendGrid, FCM...) after
// writing the log row, and should handle provider failures/retries
// separately from the log write itself.
function notify(event, orderId, channel) {
  const recipients = NOTIFY_MATRIX[event] || [];
  for (const role of recipients) {
    db.prepare(`INSERT INTO notifications (event,order_id,recipient_role,channel,payload,created_at) VALUES (?,?,?,?,?,?)`)
      .run(event, orderId, role, channel || 'push', JSON.stringify({ orderId }), Date.now());
  }
}
function orderPublicView(order, items) {
  return {
    id: order.id, status: order.status, total: order.total, subtotal: order.subtotal, vat: order.vat,
    pointLabel: order.point_label, zoneLabel: order.zone_label,
    items: items.map(i => ({ name_ar: i.name_ar, name_en: i.name_en, qty: i.qty, lineTotal: i.line_total, notes: i.notes })),
    createdAt: order.created_at,
  };
}
function getOrderWithContext(id) {
  const o = db.prepare(`
    SELECT o.*, pt.label AS point_label, z.name_ar AS zone_name_ar, z.name_en AS zone_name_en
    FROM orders o LEFT JOIN points pt ON pt.id = o.point_id LEFT JOIN zones z ON z.id = o.zone_id
    WHERE o.id = ?`).get(id);
  if (!o) return null;
  o.zone_label = o.zone_name_ar; // default; frontend picks ar/en itself from a richer endpoint if needed
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
  return { order: o, items };
}

/* ------------------------------- routing --------------------------------- */
const routes = [];
/* ---------------------------------------------------------------------------
   حاجز ربط المعلمات (Root-cause fix, F04 diagnostics)
   السبب الجذري لرسالة "Server error" في شاشة الشركاء والباقات: حقل مفقود
   في جسم الطلب (planCode حين تكون قائمة الباقات فارغة) كان يصل مباشرة إلى
   db.prepare(...).get(undefined)، فيرمي السائق TypeError -- وهو خطأ 500
   يظهر للمستخدم كرسالة مبهمة، بينما هو في حقيقته **مُدخل ناقص** أي 400.

   القاعدة: أي حقل مطلوب يُتحقَّق منه صراحةً قبل أي لمسة لقاعدة البيانات،
   ويُعاد 400 برسالة تقول للمشغّل ما الناقص بالضبط. هذا يُصلح السبب لا العرض:
   الخطأ يبقى خطأ، لكنه يُصنَّف ويُشرح بصدق بدل أن يتنكّر بزيّ عطل خادم.

   لماذا حارس صريح بدل مُعالجة عامة للاستثناء: المعالجة العامة كانت ستُخفي
   الخلل، أما هذا فيمنع وصول القيمة غير الصالحة إلى السائق أصلًا. */
function requireFields(body, fields) {
  const missing = [];
  for (const f of fields) {
    const v = body ? body[f] : undefined;
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) missing.push(f);
  }
  if (missing.length) {
    const e = new Error(`Missing required field(s): ${missing.join(', ')}`);
    e.status = 400;
    throw e;
  }
}

function on(method, pattern, roles, handler, opts) {
  // pattern like '/api/orders/:id/pay' -> regex with named groups
  const names = [];
  const rx = '^' + pattern.replace(/:[a-zA-Z]+/g, (m) => { names.push(m.slice(1)); return '([^/]+)'; }) + '$';
  routes.push({ method, pattern, regex: new RegExp(rx), names, roles, handler, limit: (opts && opts.limit) || null });
}

/* Go-Live P0 §3.9 / P0-6 — which rate-limit bucket a public route falls in.
   Resolved centrally from the route pattern rather than annotated at each
   of the 26 public endpoints one by one, so a NEW public route inherits a
   sensible default instead of silently shipping unthrottled. Authenticated
   admin/staff routes are not limited here: they already sit behind a role
   check, and throttling a busy KDS would be an operational hazard, not a
   safeguard. */
function bucketForPublicRoute(method, pattern) {
  if (method === 'POST' && pattern === '/api/orders') return 'order_create';
  if (pattern.startsWith('/api/loyalty/verify')) return 'verification';
  if (pattern.startsWith('/api/loyalty/')) return 'loyalty_lookup';
  if (pattern.endsWith('/engage-pass') || pattern.startsWith('/api/engage/pass')) return 'engage_discovery';
  // Webhooks are called by the payment provider, not by guests; throttling
  // them would drop legitimate provider retries and break reconciliation.
  if (pattern === '/api/payments/webhook') return null;
  // Staff login keeps its own dedicated per-username limiter in lib/auth.js.
  if (pattern === '/api/auth/login') return null;
  return 'public_default';
}

/* ---------------- P1 §4.1 — Health & Readiness ----------------------------
   Two endpoints with deliberately different meanings:
     /health  — is this PROCESS alive? Never touches the database, so an
                orchestrator does not kill a healthy process just because a
                dependency is briefly unavailable (that is what /ready is for).
     /ready   — should this instance receive TRAFFIC? Actually exercises the
                database and reports 503 when it cannot serve.
   Neither reveals secrets, versions of dependencies, connection strings or
   internal paths (§4.1: "لا تكشف endpoints أسرارًا"). */
on('GET', '/health', null, async (req, res) => {
  sendJSON(res, 200, { status: 'ok', uptimeSec: Math.floor(process.uptime()) });
});
on('GET', '/ready', null, async (req, res) => {
  const checks = {};
  let ok = true;
  // A draining instance must be pulled out of rotation immediately (§4.5).
  if (typeof isShuttingDown === 'function' && isShuttingDown()) {
    return sendJSON(res, 503, { status: 'draining', checks: { database: 'draining' } });
  }
  try {
    db.prepare('SELECT 1 AS ok').get();
    checks.database = 'ok';
  } catch (e) {
    checks.database = 'unavailable'; ok = false; // never echo the driver error
  }
  try {
    const pending = db.prepare(`SELECT COUNT(*) c FROM engage_outbox WHERE status = 'pending'`).get().c;
    checks.engageWorker = pending >= 0 ? 'ok' : 'unknown';
  } catch (e) {
    checks.engageWorker = 'unknown'; // Engage is optional; never fails readiness
  }
  sendJSON(res, ok ? 200 : 503, { status: ok ? 'ready' : 'not_ready', checks });
});

/* ------------------------------ AUTH --------------------------------- */
on('POST', '/api/auth/login', null, async (req, res) => {
  const { username, password } = await readBody(req);
  const result = login(username, password);
  if (!result) return sendJSON(res, 401, { error: 'Invalid credentials' });
  sendJSON(res, 200, result);
});

/* ------------------------------ DEMO ONLY --------------------------------- */
// A real deployment never lists points publicly — customers only ever arrive
// via a scanned QR that already encodes one token. This endpoint exists
// purely so the prototype's "scan a QR" screen has something to simulate
// with, since we cannot print & scan physical QR codes in this sandbox.
//
// UX-0 (spec §3.3, P0): genuine environment separation, not CSS hiding —
// this route does not exist at all when NODE_ENV=production, the same
// "resolves to nothing" pattern already used for unauthorized access
// elsewhere in this codebase (a 404 here is indistinguishable from the
// route never having been registered, because it wasn't).
on('GET', '/api/demo/points', null, async (req, res) => {
  if (process.env.NODE_ENV === 'production') return sendJSON(res, 404, { error: 'No such route' });
  const rows = db.prepare(`
    SELECT pt.id, pt.label, z.name_ar AS zone_ar, z.name_en AS zone_en, qr.token
    FROM points pt JOIN zones z ON z.id = pt.zone_id JOIN qr_tokens qr ON qr.point_id = pt.id
    WHERE pt.active = 1 AND qr.active = 1`).all();
  sendJSON(res, 200, rows);
});

// UX-0 (spec §3.3): the ONE signal the client is allowed to use to decide
// whether it is running in production — asserted by the server (which
// cannot be spoofed by editing client-side JS, unlike a hardcoded client
// flag) and backed by the SAME NODE_ENV check the route above already
// enforces server-side, so client and server can never disagree about
// which mode they're in.
on('GET', '/api/env', null, async (req, res) => {
  sendJSON(res, 200, { production: process.env.NODE_ENV === 'production' });
});

/* ------------------------------ QR / CONTEXT --------------------------------- */
on('GET', '/api/qr/:token', null, async (req, res, p) => {
  // §4 — الإنفاذ عبر المُحلِّل المركزي، لا شرط منثور. رسالة محايدة عمدًا:
  // الضيف لا يُخبَر أن السبب تجاري أو أن الشريك موقوف.
  const qrPartner = db.prepare(`
    SELECT pr.partner_id FROM qr_tokens q JOIN points pt ON pt.id = q.point_id
    JOIN zones z ON z.id = pt.zone_id JOIN properties pr ON pr.id = z.property_id
    WHERE q.token = ?`).get(p.token);
  if (qrPartner) partnerStatus.assertCan(qrPartner.partner_id, 'qrResolves', { guestFacing: true });
  // G3: منطقة معطّلة تمنع الرحلات الجديدة عبرها -- بنفس الرسالة المحايدة
  // التي يراها الضيف عند إيقاف الشريك، فلا يُكشف سبب تشغيلي داخلي.
  const qrZone = db.prepare(`
    SELECT z.status FROM qr_tokens q JOIN points pt ON pt.id = q.point_id
    JOIN zones z ON z.id = pt.zone_id WHERE q.token = ?`).get(p.token);
  if (qrZone && qrZone.status === 'Inactive') {
    return sendJSON(res, 409, { error: partnerStatus.GUEST_UNAVAILABLE_EN });
  }
  const row = db.prepare('SELECT * FROM qr_tokens WHERE token = ?').get(p.token);
  if (!row || !row.active) return sendJSON(res, 404, { error: 'QR غير صالح / Invalid QR' });
  logQrEvent(p.token, 'scan', null);
  const point = db.prepare('SELECT * FROM points WHERE id = ?').get(row.point_id);
  if (!point || !point.active) return sendJSON(res, 409, { error: 'Point unavailable' });
  const zone = db.prepare('SELECT * FROM zones WHERE id = ?').get(point.zone_id);
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(zone.property_id);
  const partner = db.prepare('SELECT * FROM partners WHERE id = ?').get(property.partner_id);
  const sub = getSubscription(property.partner_id);
  const features = sub ? sub.features : {};
  const branding = features.whiteLabel ? getBranding(property.partner_id) : { partner_id: property.partner_id, mode: 'alnadl', show_powered_by: 1 };
  sendJSON(res, 200, { partner, property, zone, point, token: p.token, features, branding });
});

/* ------------------------------ CATALOG --------------------------------- */
on('GET', '/api/catalog', null, async (req, res, p, query) => {
  const propertyId = query.propertyId;
  const cats = db.prepare(`SELECT * FROM categories WHERE property_id = ? AND status='Active' ORDER BY sort_order`).all(propertyId);
  const products = db.prepare(`SELECT * FROM products WHERE category_id IN (SELECT id FROM categories WHERE property_id = ?)`).all(propertyId);
  const merchants = db.prepare('SELECT * FROM merchants WHERE property_id = ? AND status=\'Active\'').all(propertyId);
  const partner = db.prepare('SELECT partner_id FROM properties WHERE id = ?').get(propertyId);
  const marketplaceOn = partner ? getSubscription(partner.partner_id)?.features?.marketplace : false;
  for (const prod of products) {
    prod.variants = db.prepare('SELECT * FROM variants WHERE product_id = ?').all(prod.id);
    prod.addons = db.prepare('SELECT * FROM addons WHERE product_id = ?').all(prod.id);
    prod.available = prod.status === 'Active';
  }
  // Marketplace/Restaurant Integration (§9, §15 of the spec — MVP scope explicitly
  // allows exposing multiple merchants under one property without a full
  // separate marketplace checkout). Partner-owned merchants only show up if
  // the property's plan includes the `marketplace` feature; the property's
  // own Alnadl-operated merchant always shows.
  const visibleMerchants = marketplaceOn ? merchants : merchants.filter(m => m.kind === 'alnadl');
  const visibleMerchantIds = new Set(visibleMerchants.map(m => m.id));
  sendJSON(res, 200, { categories: cats, products: products.filter(p => visibleMerchantIds.has(p.merchant_id)), merchants: visibleMerchants });
});

/* ------------------------------ LOYALTY (Phase 3 §15; Go-Live P0 §3.4-§3.8) ---------
   Both endpoints are now PARTNER-SCOPED. The partner is derived server-side
   from the guest's own QR token -- never from a client-supplied partnerId,
   which would defeat the isolation entirely. A guest without a QR context
   has no partner scope and therefore no loyalty view at all.

   §3.8: these are read paths on a value-bearing balance, so they never
   create an account (findAccount, not getOrCreateAccount) -- merely asking
   about a number must not materialise one -- and they do not confirm
   whether a number is known. An unknown number and a known one with no
   activity return the same shape. */
function partnerScopeFromQrToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT pr.partner_id FROM qr_tokens q
    JOIN points pt ON pt.id = q.point_id
    JOIN zones z ON z.id = pt.zone_id
    JOIN properties pr ON pr.id = z.property_id
    WHERE q.token = ? AND q.active = 1`).get(token);
  return row ? row.partner_id : null;
}

on('GET', '/api/loyalty/:phone', null, async (req, res, p, query) => {
  const partnerId = partnerScopeFromQrToken(query.t);
  if (!partnerId) return sendJSON(res, 200, { pointsBalance: 0 });
  const acct = findAccount(partnerId, p.phone);
  sendJSON(res, 200, { pointsBalance: acct ? acct.points_balance : 0 });
});
on('GET', '/api/loyalty/:phone/history', null, async (req, res, p, query) => {
  const partnerId = partnerScopeFromQrToken(query.t);
  if (!partnerId) return sendJSON(res, 200, []);
  const acct = findAccount(partnerId, p.phone);
  if (!acct) return sendJSON(res, 200, []);
  sendJSON(res, 200, getHistory(acct.id));
});

/* --------------- GUEST VERIFICATION (Go-Live P0 §3.6) ---------------------
   Provider-agnostic by construction: these two endpoints talk to
   lib/verification.js, which owns expiry / attempt limits / cooldown /
   replay protection ONCE so no future provider reimplements them. With no
   provider configured (the default today) sendChallenge reports
   no_provider, which is exactly what keeps §3.8's 'verified_only'
   redemption policy honest rather than nominal.

   Partner scope comes from the guest's QR token, never from the request. */
on('POST', '/api/loyalty/verify/start', null, async (req, res) => {
  const body = await readBody(req);
  const partnerId = partnerScopeFromQrToken(body.t);
  if (!partnerId) return sendJSON(res, 200, { ok: false, reason: 'invalid_request' });
  const result = await sendChallenge(partnerId, body.phone, body.channel || 'sms');
  // Deliberately no internal detail beyond a stable machine reason, and
  // never the code itself (§7: no OTP in DOM or logs).
  sendJSON(res, 200, { ok: result.ok, reason: result.reason });
});
on('POST', '/api/loyalty/verify/confirm', null, async (req, res) => {
  const body = await readBody(req);
  const partnerId = partnerScopeFromQrToken(body.t);
  if (!partnerId) return sendJSON(res, 200, { ok: false, reason: 'invalid_request' });
  const result = verifyChallenge(partnerId, body.phone, body.code);
  sendJSON(res, 200, { ok: result.ok, reason: result.reason });
});

/* ------------------------------ ORDERS (customer) --------------------------------- */
on('POST', '/api/orders', null, async (req, res) => {
  const body = await readBody(req);
  const { pointId, items, customerName, customerPhone } = body;
  const point = db.prepare('SELECT * FROM points WHERE id = ?').get(pointId);
  if (!point || !point.active) return sendJSON(res, 409, { error: 'Point unavailable' });
  const zone = db.prepare('SELECT * FROM zones WHERE id = ?').get(point.zone_id);
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(zone.property_id);
  requireFeature(property.partner_id, 'qrOrdering'); // SaaS plan gate — OPERATE-tier partners have no QR ordering
  // §4 — منع الالتزامات الجديدة. يُفحص عبر المُحلِّل المركزي وليس بشرط
  // منثور، ورسالته محايدة للضيف. الطلبات المفتوحة لا تتأثر إطلاقًا.
  partnerStatus.assertCan(property.partner_id, 'createOrder', { guestFacing: true });
  // G3: لا طلب جديد من منطقة معطّلة. الطلبات القائمة لا تتأثر إطلاقًا --
  // فهي تحمل zone_id بنفسها والطابور يقرأ عبر LEFT JOIN.
  if (zone && zone.status === 'Inactive') {
    return sendJSON(res, 409, { error: partnerStatus.GUEST_UNAVAILABLE_EN });
  }

  if (!Array.isArray(items) || items.length === 0) return sendJSON(res, 400, { error: 'Empty cart' });

  let subtotal = 0;
  const resolvedItems = [];
  for (const it of items) {
    const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(it.productId);
    if (!prod || prod.status !== 'Active') return sendJSON(res, 409, { error: `Product unavailable: ${it.productId}` });
    let unit = prod.base_price;
    let variant = null;
    if (it.variantId) {
      variant = db.prepare('SELECT * FROM variants WHERE id = ?').get(it.variantId);
      if (variant) unit += variant.price_delta;
    }
    const addonRows = (it.addonIds || []).map(aid => db.prepare('SELECT * FROM addons WHERE id = ?').get(aid)).filter(Boolean);
    unit += addonRows.reduce((s, a) => s + a.price, 0);
    const qty = Math.max(1, parseInt(it.qty) || 1);
    const lineTotal = unit * qty;
    subtotal += lineTotal;
    resolvedItems.push({ prod, variant, addonRows, unit, qty, lineTotal, notes: it.notes || '' });
  }

  let discountAmount = 0, appliedCode = null;
  if (body.promoCode) {
    const now2 = Date.now();
    const promo = db.prepare(`SELECT * FROM promotions WHERE code = ? AND property_id = ? AND active = 1 AND valid_from <= ? AND valid_to >= ?`)
      .get(body.promoCode.toUpperCase(), property.id, now2, now2);
    if (!promo) return sendJSON(res, 400, { error: 'Invalid or expired promo code' });
    discountAmount = promo.discount_type === 'percent' ? subtotal * (promo.discount_value / 100) : Math.min(promo.discount_value, subtotal);
    appliedCode = promo.code;
  }

  // Loyalty redemption (Phase 3, §15) — gated by the partner's plan.
  let loyaltyDiscount = 0, loyaltyPointsUsed = 0, loyaltyAccountId = null;
  if (body.redeemPoints) {
    // Entitlement is checked inside quoteRedemption via feature flags now
    // (§3.7), so a plan rename can never silently disable loyalty. The
    // partner comes from the resolved property, never from the request.
    // §4: الاستبدال يقع داخل رحلة طلب؛ فإن منعت الحالة الطلب فلا مسار
    // تشغيلي صالح له. الأرصدة تُحفظ ولا تُلغى -- لا يُفتح استبدال جديد فقط.
    const q = partnerStatus.can(property.partner_id, 'loyaltyRedeem')
      ? quoteRedemption(property.partner_id, customerPhone, parseInt(body.redeemPoints) || 0, subtotal - discountAmount)
      : { discount: 0, pointsUsed: 0, blockedReason: 'partner_status' };
    loyaltyDiscount = q.discount; loyaltyPointsUsed = q.pointsUsed; loyaltyAccountId = q.accountId || null;
  }

  const eligibleSubtotal = Math.max(0, subtotal - discountAmount - loyaltyDiscount);
  const vat = eligibleSubtotal * 0.15;
  const total = eligibleSubtotal + vat;
  const id = 'ORD-' + (1800 + db.prepare('SELECT COUNT(*) c FROM orders').get().c + 1);
  const paymentRef = uid('pay');
  const now = Date.now();

  db.prepare(`INSERT INTO orders (id,partner_id,property_id,zone_id,point_id,customer_name,customer_phone,status,subtotal,vat,total,payment_ref,promo_code,discount_amount,loyalty_points_used,loyalty_account_id,wallet_id,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, property.partner_id, property.id, zone.id, point.id, customerName || null, customerPhone || null, 'Created', subtotal, vat, total, paymentRef, appliedCode, discountAmount + loyaltyDiscount, loyaltyPointsUsed, loyaltyAccountId, body.walletId || null, now, now);
  const insertedItemIds = [];
  for (const ri of resolvedItems) {
    const itemId = uid('oi');
    db.prepare(`INSERT INTO order_items (id,order_id,product_id,merchant_id,outlet_id,name_ar,name_en,qty,unit_price,variant_json,addons_json,notes,line_total)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(itemId, id, ri.prod.id, ri.prod.merchant_id, ri.prod.outlet_id || null, ri.prod.name_ar, ri.prod.name_en, ri.qty, ri.unit, JSON.stringify(ri.variant), JSON.stringify(ri.addonRows), ri.notes, ri.lineTotal);
    insertedItemIds.push({ itemId, outletId: ri.prod.outlet_id || null });
  }

  // Unified Cart (Phase 4 §8): if this cart's items span more than one Outlet
  // AND the partner's plan includes unifiedCart, fan the order out into
  // child_orders — one per outlet — so KDS can route each independently.
  // A single-outlet cart (or a plan without unifiedCart) creates ZERO
  // child_orders and behaves 100% exactly like every order before Phase 4.
  const distinctOutlets = [...new Set(insertedItemIds.map(x => x.outletId).filter(Boolean))];
  const sub4 = getSubscription(property.partner_id);
  if (distinctOutlets.length > 1 && sub4 && sub4.features.unifiedCart) {
    for (const outletId of distinctOutlets) {
      const outlet = db.prepare('SELECT * FROM outlets WHERE id = ?').get(outletId);
      const childId = 'CHD-' + uid('');
      const childSubtotal = insertedItemIds.filter(x => x.outletId === outletId)
        .reduce((s, x) => s + (db.prepare('SELECT line_total FROM order_items WHERE id=?').get(x.itemId)?.line_total || 0), 0);
      db.prepare(`INSERT INTO child_orders (id,parent_order_id,outlet_id,status,subtotal,station_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(childId, id, outletId, 'Created', childSubtotal, outlet ? outlet.station_id : null, now, now);
      for (const x of insertedItemIds.filter(x => x.outletId === outletId)) {
        db.prepare('UPDATE order_items SET child_order_id = ? WHERE id = ?').run(childId, x.itemId);
      }
    }
    audit('system', 'System', 'unified_cart_split', id, null, { outlets: distinctOutlets.length }, null);
  }

  // Created -> Payment Pending (system-driven, matches §10 first transition)
  db.prepare(`UPDATE orders SET status='Payment Pending', updated_at=? WHERE id=?`).run(Date.now(), id);
  audit('system', 'System', 'order_create', id, null, { status: 'Payment Pending' }, null);
  const activeToken = db.prepare('SELECT token FROM qr_tokens WHERE point_id = ? AND active = 1').get(pointId);
  if (activeToken) logQrEvent(activeToken.token, 'order', id);
  notify('order_created', id, 'push');

  sendJSON(res, 201, { id, paymentRef, total: Math.round(total * 100) / 100, status: 'Payment Pending', loyaltyPointsUsed, loyaltyDiscount: Math.round(loyaltyDiscount * 100) / 100 });
});

on('POST', '/api/orders/:id/pay', null, async (req, res, p) => {
  const body = await readBody(req);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(p.id);
  if (!order) return sendJSON(res, 404, { error: 'Order not found' });
  requireFeature(order.partner_id, 'digitalPayment');

  // Idempotency: if already resolved (Paid/Failed) for this payment_ref, return the same result — no duplicate order/payment is created.
  const existingPayment = db.prepare('SELECT * FROM payments WHERE order_id = ?').get(order.id);
  if (existingPayment && ['Captured', 'Failed'].includes(existingPayment.status)) {
    return sendJSON(res, 200, { id: order.id, status: order.status, idempotent: true });
  }

  let method = body.method || 'card';
  let cardAmount = order.total, walletCovered = 0;

  // Corporate Wallet split payment (§14 "Split Payment" — wallet covers part, employee pays the rest)
  if (method === 'wallet' && order.wallet_id) {
    requireFeature(order.partner_id, 'corporateWallet');
    const quote = quoteCoverage(order.wallet_id, order.total);
    if (!quote.wallet) return sendJSON(res, 409, { error: 'Wallet unavailable or inactive' });
    walletCovered = quote.covered;
    cardAmount = quote.remainder;
    if (cardAmount > 0) method = 'split'; // wallet + card
  }

  // --- everything below this line goes through the gateway abstraction (lib/payment.js) ---
  let cardResult = { gatewayRef: null, status: 'Captured', fees: 0 };
  if (cardAmount > 0) {
    const intent = await gateway.createIntent({ orderId: order.id, amount: cardAmount, method });
    // UX-1 (spec §16 P0 "payment/error ambiguity", §20-style audit finding):
    // body.simulateFail was a raw, unauthenticated client-supplied flag with
    // NO environment gating at all -- any real customer's browser could
    // reach it, and the corresponding "Simulate payment failure (test)"
    // button was sitting directly in the production checkout screen. Same
    // severity class as the protobar/demo-picker finding, same fix: in
    // production this flag is never honored, full stop, regardless of what
    // the request body contains. Non-production keeps it (dev-tools.js's
    // demo button, and this codebase's own test suite, both still need a
    // way to exercise the failure path against the Mock gateway).
    const honorSimulateFail = process.env.NODE_ENV !== 'production' && !!body.simulateFail;
    cardResult = await gateway.capture(intent.intentId, honorSimulateFail);
  }
  // --- a real provider would return here with intent/redirectUrl and confirm asynchronously
  //     via POST /api/payments/webhook instead of capturing synchronously; kept synchronous
  //     here only because the sandbox has no real card network to redirect to.

  const succeeded = cardResult.status === 'Captured';

  // Transactional Outbox (P5-Inc-1 corrective round): everything from here
  // to the engage_outbox write is now ONE atomic unit. Before this fix, each
  // db.prepare(...).run() below auto-committed independently — a crash
  // between the order status UPDATE and the engage_outbox INSERT could leave
  // a genuinely confirmed/Paid order with no Engage event ever recorded,
  // silently. Now: either every write below lands together, or (on any
  // exception) none of them do — the order stays in its PRE-payment state
  // and the client-facing error reflects that honestly, rather than reporting
  // success on a half-committed state.
  db.exec('BEGIN');
  let newStatus;
  try {
    if (succeeded && walletCovered > 0) commitSpend(order.wallet_id, order.id, walletCovered);
    if (walletCovered > 0) {
      db.prepare(`INSERT INTO payments (id,order_id,gateway_ref,amount,status,method,fees,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(uid('pay'), order.id, 'wallet:' + order.wallet_id, walletCovered, succeeded ? 'Captured' : 'Failed', 'wallet', 0, Date.now());
    }
    if (cardAmount > 0) {
      db.prepare(`INSERT INTO payments (id,order_id,gateway_ref,amount,status,method,fees,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(uid('pay'), order.id, cardResult.gatewayRef, cardAmount, cardResult.status, method, cardResult.fees || 0, Date.now());
    }

    newStatus = succeeded ? 'Paid' : 'Failed';
    db.prepare('UPDATE orders SET status=?, updated_at=?, wallet_covered=? WHERE id=?').run(newStatus, Date.now(), walletCovered, order.id);
    audit('gateway:' + gateway.name, 'Gateway', 'payment_webhook', order.id, { status: order.status }, { status: newStatus }, null);
    notify(newStatus === 'Paid' ? 'payment_success' : 'payment_failed', order.id, 'push');
    // Unified Cart: cascade Paid to every child order fanned out at creation (§8).
    // If payment failed, children stay in 'Created' — nothing to cascade, since
    // they were never sent to KDS in the first place.
    if (succeeded) {
      db.prepare(`UPDATE child_orders SET status='Paid', updated_at=? WHERE parent_order_id=? AND status='Created'`).run(Date.now(), order.id);
    }

    // Loyalty: commit any point redemption now that payment actually succeeded (§15)
    if (succeeded && order.loyalty_points_used > 0 && order.loyalty_account_id) {
      commitRedemption(order.loyalty_account_id, order.loyalty_points_used, order.id);
    }

    // Revenue Model Engine (§9/§10): allocate this order's revenue to each
    // outlet involved, the moment payment succeeds — not later, and not
    // retroactively rewritable once written (each row snapshots the model it used).
    if (succeeded) recordOrderRevenue(order.id);

    // Phase 5 P5-Inc-1: this is Core's ENTIRE involvement with Engage — one
    // unconditional local INSERT, no awareness of engage_enabled or any other
    // Engage-specific decision (those live exclusively in lib/engage-worker.js).
    // order.confirmed is the Event/Data Flow direction Core -> Engage; the
    // Foreign-Key Dependency direction remains strictly Engage -> Core
    // (engage_pass.order_id REFERENCES orders(id), never the reverse).
    // Committing this in the SAME transaction as the order status change is
    // exactly the "transactional outbox" pattern: the confirmation and its
    // event either both land or neither does.
    if (succeeded) {
      db.prepare(`INSERT INTO engage_outbox (id,order_id,event_type,status,created_at) VALUES (?,?,?,?,?)`)
        .run(uid('eo'), order.id, 'order.confirmed', 'pending', Date.now());
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  sendJSON(res, 200, { id: order.id, status: newStatus, walletCovered, cardCharged: cardAmount });
});

/* Provider-agnostic webhook receiver — this is the URL a real gateway would
   call asynchronously to confirm/deny a payment. Kept here, wired to the
   abstraction, and unused by the synchronous demo flow above so it is
   ready the day a real provider is configured. */
on('POST', '/api/payments/webhook', null, async (req, res) => {
  const raw = await readBody(req);
  if (!gateway.verifyWebhook(raw, req.headers)) return sendJSON(res, 401, { error: 'Invalid signature' });
  sendJSON(res, 200, { received: true });
});

on('GET', '/api/orders/:id', null, async (req, res, p) => {
  const ctx = getOrderWithContext(p.id);
  if (!ctx) return sendJSON(res, 404, { error: 'Not found' });
  sendJSON(res, 200, orderPublicView(ctx.order, ctx.items));
});

/* ------------------------------ ENGAGE (Phase 5, P5-Inc-1) --------------------------------- */
// Read-only. No pass/session can be created, modified, or listed through the
// API in Inc-1 — only the Worker (lib/engage-worker.js) creates a pass, and
// only in response to a real order.confirmed event. This endpoint exists
// purely so a future customer-facing screen (Inc-2+) has something to poll.
on('GET', '/api/engage/pass/:token', null, async (req, res, p) => {
  // Corrective round: keyed by access_token, not the internal id, for the
  // same reason as the session endpoints below.
  const pass = db.prepare('SELECT * FROM engage_pass WHERE access_token = ?').get(p.token);
  if (!pass) return sendJSON(res, 403, { error: 'Invalid or unknown access token' });
  const isExpired = pass.status === 'active' && Date.now() > pass.expires_at;
  sendJSON(res, 200, { id: pass.id, status: isExpired ? 'expired' : pass.status, expiresAt: pass.expires_at, createdAt: pass.created_at });
});

/* UX-5: a guest's ONLY way to discover they have an Engage pass.
   Until now nothing connected an order to its pass from the guest side:
   the Worker creates the pass asynchronously (order.confirmed outbox
   event), and every other Engage endpoint already requires the pass
   token you would only have if something had already told you it. That
   made the entire Engage experience unreachable for a real customer --
   the missing first link in the chain, not a styling gap.

   AUTHORIZATION (corrective round). The first version keyed this on
   order_id alone, which was a real flaw: order ids are generated as
   'ORD-' + (1800 + COUNT(*)) -- strictly sequential and trivially
   enumerable. That would have let anyone walk ORD-1801, ORD-1802... and
   harvest Engage CAPABILITY tokens, each of which can start a real
   session. That is a materially weaker gate than the capability model
   Phase 5 was built on, so knowing an order id is deliberately NOT
   sufficient here.

   The caller must also present the order's payment_ref -- a
   crypto.randomBytes-derived value returned to the guest (and only the
   guest) in the order-creation response, never derivable from the id.
   This reuses proof the legitimate guest already holds rather than
   inventing a guest login, and keeps the capability chain intact:
   possession of a real secret is what yields a capability, exactly as
   everywhere else in Engage.

   Every rejection -- unknown order, wrong ref, no pass, expired,
   ineligible -- returns the SAME { eligible: false }. That satisfies
   "do not expose policy internals to the guest" (§11) and additionally
   avoids confirming whether an order id exists at all, so this endpoint
   cannot be used as an order-enumeration oracle either. */
on('GET', '/api/orders/:id/engage-pass', null, async (req, res, p, query) => {
  const SAFE_NO = { eligible: false };
  const providedRef = query.paymentRef;
  if (!providedRef) return sendJSON(res, 200, SAFE_NO);
  const order = db.prepare('SELECT payment_ref FROM orders WHERE id = ?').get(p.id);
  if (!order || !order.payment_ref) return sendJSON(res, 200, SAFE_NO);
  // Compare length first, then timing-safe equality -- timingSafeEqual
  // throws on length mismatch, and a naive === is a poor habit to set on
  // a secret comparison even when the window is small.
  const a = Buffer.from(String(order.payment_ref));
  const b = Buffer.from(String(providedRef));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return sendJSON(res, 200, SAFE_NO);

  const pass = db.prepare('SELECT access_token, status, expires_at FROM engage_pass WHERE order_id = ?').get(p.id);
  if (!pass) return sendJSON(res, 200, SAFE_NO);
  if (pass.status !== 'active' || Date.now() > pass.expires_at) return sendJSON(res, 200, SAFE_NO);
  sendJSON(res, 200, { eligible: true, accessToken: pass.access_token, expiresAt: pass.expires_at });
});

/* Phase 5 P5-Inc-2 (corrective round): Venue Policy Override — Ceiling and
   other precedence-chain settings (partner/property/zone scoped). RBAC-gated:
   SuperAdmin can set at any scope; PartnerAdmin only within their own
   tenant, at property/zone scope belonging to that tenant — never at
   'partner' scope for anyone else's contract, and never a bare customer
   request (no role at all reaches this route). */
on('GET', '/api/admin/engage/policy-overrides', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, query, session) => {
  let rows = db.prepare('SELECT * FROM venue_policy_override ORDER BY created_at DESC').all();
  if (session.role === 'PartnerAdmin') {
    // A PartnerAdmin may only see overrides that plausibly belong to their
    // own tenant: their own partner-scope row, or any property/zone that
    // resolves back to their partner_id.
    rows = rows.filter(r => {
      if (r.scope_type === 'partner') return r.scope_id === session.scope;
      if (r.scope_type === 'property') return propertyPartnerId(r.scope_id) === session.scope;
      if (r.scope_type === 'zone') return zonePartnerId(r.scope_id) === session.scope;
      return false;
    });
  }
  sendJSON(res, 200, rows);
});
on('POST', '/api/admin/engage/policy-overrides', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  if (!['partner', 'property', 'zone'].includes(b.scopeType)) return sendJSON(res, 400, { error: 'scopeType must be partner, property, or zone' });

  // Tenant isolation: a PartnerAdmin can only ever write a policy that
  // resolves back to their own partner_id, at any scope level. Checked
  // once, before either branch below, so neither can bypass it.
  if (session.role === 'PartnerAdmin') {
    const ownerPartnerId = b.scopeType === 'partner' ? b.scopeId
      : b.scopeType === 'property' ? propertyPartnerId(b.scopeId)
      : zonePartnerId(b.scopeId);
    assertTenantWrite(session, ownerPartnerId);
  }

  if (b.personality !== undefined) {
    // Existing Engagement Ceiling override (Inc-2)
    const { PERSONALITIES, setPolicyOverride } = require('./lib/engage-personality.js');
    if (!PERSONALITIES.includes(b.personality)) return sendJSON(res, 400, { error: `personality must be one of ${PERSONALITIES.join(', ')}` });
    if (typeof b.max !== 'number' || b.max < 0) return sendJSON(res, 400, { error: 'max must be a non-negative number' });
    setPolicyOverride(b.scopeType, b.scopeId, b.personality, b.max, session.username);
    audit(session.username, session.role, 'engage_policy_override_set', b.scopeId, null, { scopeType: b.scopeType, personality: b.personality, max: b.max }, null);
    return sendJSON(res, 201, { ok: true });
  }

  if (b.policyKey !== undefined) {
    // Inc-4: configurable Novelty window/threshold, same override table,
    // same tenant-isolation check above, different (non-personality-scoped) key.
    // Corrective round: out-of-range values are REJECTED with a clear 400,
    // never silently accepted and clamped later at read-time -- the
    // read-time clamp in resolveNoveltyPolicy() remains as defense-in-depth
    // for any value that reaches the table by another path, but the write
    // path itself must refuse bad input outright.
    // Inc-7 corrective round: embedding_threshold added -- same bounds
    // validation discipline as novelty_threshold, controls the genuine
    // vector-embedding similarity cutoff (checkNoveltyEmbedding()) rather
    // than the concept/text methods' threshold.
    const { setNoveltyPolicyOverride, MIN_WINDOW_DAYS, MAX_WINDOW_DAYS, MIN_THRESHOLD, MAX_THRESHOLD, MIN_EMBEDDING_THRESHOLD, MAX_EMBEDDING_THRESHOLD } = require('./lib/engage-novelty.js');
    if (!['novelty_window_days', 'novelty_threshold', 'embedding_threshold'].includes(b.policyKey)) return sendJSON(res, 400, { error: 'policyKey must be novelty_window_days, novelty_threshold, or embedding_threshold' });
    if (typeof b.value !== 'number' || Number.isNaN(b.value)) return sendJSON(res, 400, { error: 'value must be a number' });
    if (b.policyKey === 'novelty_threshold' && (b.value < MIN_THRESHOLD || b.value > MAX_THRESHOLD)) {
      return sendJSON(res, 400, { error: `novelty_threshold must be between ${MIN_THRESHOLD} and ${MAX_THRESHOLD} inclusive` });
    }
    if (b.policyKey === 'embedding_threshold' && (b.value < MIN_EMBEDDING_THRESHOLD || b.value > MAX_EMBEDDING_THRESHOLD)) {
      return sendJSON(res, 400, { error: `embedding_threshold must be between ${MIN_EMBEDDING_THRESHOLD} and ${MAX_EMBEDDING_THRESHOLD} inclusive` });
    }
    if (b.policyKey === 'novelty_window_days' && (b.value < MIN_WINDOW_DAYS || b.value > MAX_WINDOW_DAYS || !Number.isInteger(b.value))) {
      return sendJSON(res, 400, { error: `novelty_window_days must be a whole number between ${MIN_WINDOW_DAYS} and ${MAX_WINDOW_DAYS} inclusive` });
    }
    try {
      setNoveltyPolicyOverride(b.scopeType, b.scopeId, b.policyKey, b.value, session.username);
    } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    audit(session.username, session.role, 'engage_policy_override_set', b.scopeId, null, { scopeType: b.scopeType, policyKey: b.policyKey, value: b.value }, null);
    return sendJSON(res, 201, { ok: true });
  }

  if (b.enabled !== undefined) {
    // Inc-6: engage_enabled Property/Zone override -- part of the full
    // Global Safety -> Contract -> Property -> Zone precedence chain (see
    // lib/engage-flags.js). Global itself is deliberately NOT settable
    // through this shared endpoint -- see the dedicated SuperAdmin-only
    // kill-switch route below, kept separate so tenant-scoped PartnerAdmin
    // write access (checked above) can never reach the platform-wide lever.
    if (!['property', 'zone'].includes(b.scopeType)) return sendJSON(res, 400, { error: 'engage_enabled overrides apply at property or zone scope only (Contract is set via the plan; Global uses the kill-switch endpoint)' });
    if (typeof b.enabled !== 'boolean') return sendJSON(res, 400, { error: 'enabled must be a boolean' });
    const { setEngageEnabledOverride } = require('./lib/engage-flags.js');
    setEngageEnabledOverride(b.scopeType, b.scopeId, b.enabled, session.username);
    audit(session.username, session.role, 'engage_policy_override_set', b.scopeId, null, { scopeType: b.scopeType, policyKey: 'engage_enabled', enabled: b.enabled }, null);
    return sendJSON(res, 201, { ok: true });
  }

  return sendJSON(res, 400, { error: 'request must include personality+max (Ceiling), policyKey+value (Novelty), or enabled (engage_enabled)' });
});

/* Phase 5 P5-Inc-6: Global Safety kill switch for Engage. SuperAdmin ONLY
   -- deliberately its own route, not folded into the shared
   policy-overrides endpoint above, so no tenant-scoped role can ever reach
   the platform-wide lever even if a future refactor loosened that
   endpoint's role list. */
on('POST', '/api/admin/engage/kill-switch', ['SuperAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  if (typeof b.enabled !== 'boolean') return sendJSON(res, 400, { error: 'enabled must be a boolean' });
  const { setGlobalKillSwitch } = require('./lib/engage-flags.js');
  setGlobalKillSwitch(b.enabled, session.username);
  audit(session.username, session.role, 'engage_global_kill_switch_set', 'system', null, { enabled: b.enabled }, null);
  sendJSON(res, 200, { ok: true, enabled: b.enabled });
});
on('GET', '/api/admin/engage/kill-switch', ['SuperAdmin'], async (req, res) => {
  const { getGlobalKillSwitchState } = require('./lib/engage-flags.js');
  sendJSON(res, 200, { enabled: getGlobalKillSwitchState() });
});

/* Phase 5 P5-Inc-8: Mechanic Lab + Lifecycle Governance.
   ProductAdmin (§14 scope: "mechanics/learning/analytics") drives the
   normal lifecycle (propose/simulate/transition). Kill Switch stays
   SuperAdmin-only, same lock-down as the engage_enabled/engage_ai_generation
   kill switches. Safety incident resolution is SafetyReviewer/SuperAdmin
   (§14 scope: "ledger/reports/safety actions"). */
on('GET', '/api/admin/mechanics', ['SuperAdmin', 'ProductAdmin', 'SafetyReviewer'], async (req, res) => {
  const rows = db.prepare(`
    SELECT mv.id, mv.mechanic_id, mv.version_number, mv.lifecycle_state, mv.canary_percentage, mv.created_at,
           m.name, m.category, m.created_by
    FROM mechanic_version mv JOIN mechanic m ON m.id = mv.mechanic_id
    ORDER BY mv.created_at DESC`).all();
  sendJSON(res, 200, rows);
});
on('GET', '/api/admin/mechanics/:id', ['SuperAdmin', 'ProductAdmin', 'SafetyReviewer'], async (req, res, p) => {
  const { metricsSnapshot } = require('./lib/engage-mechanic-lab.js');
  const mv = db.prepare('SELECT * FROM mechanic_version WHERE id = ?').get(p.id);
  if (!mv) return sendJSON(res, 404, { error: 'Mechanic version not found' });
  const events = db.prepare('SELECT * FROM mechanic_lifecycle_event WHERE mechanic_version_id = ? ORDER BY created_at DESC').all(p.id);
  sendJSON(res, 200, { ...mv, metrics: metricsSnapshot(p.id), lifecycleEvents: events });
});
on('POST', '/api/admin/mechanics/propose', ['SuperAdmin', 'ProductAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  if (!b.name || !b.category || !b.personality || !Array.isArray(b.pool) || b.pool.length === 0) {
    return sendJSON(res, 400, { error: 'name, category, personality, and a non-empty pool array are required' });
  }
  const { proposeMechanicFromAI } = require('./lib/engage-mechanic-lab.js');
  const mv = proposeMechanicFromAI(b.name, b.category, b.personality, { pool: b.pool });
  audit(session.username, session.role, 'mechanic_proposed', mv.id, null, { name: b.name, personality: b.personality }, null);
  sendJSON(res, 201, mv);
});
on('POST', '/api/admin/mechanics/:id/simulate', ['SuperAdmin', 'ProductAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  const sampleCount = typeof b.sampleCount === 'number' ? b.sampleCount : 10;
  if (sampleCount < 1 || sampleCount > 10000 || !Number.isInteger(sampleCount)) {
    return sendJSON(res, 400, { error: 'sampleCount must be a whole number between 1 and 10000' });
  }
  const { runSimulation } = require('./lib/engage-mechanic-lab.js');
  try {
    const result = await runSimulation(p.id, sampleCount, session.username);
    audit(session.username, session.role, 'mechanic_simulation_run', p.id, null, { sampleCount, safetyPassCount: result.safety_pass_count, safetyFailCount: result.safety_fail_count }, null);
    sendJSON(res, 201, result);
  } catch (e) { sendJSON(res, e.status || 500, { error: e.message }); }
});
on('POST', '/api/admin/mechanics/:id/transition', ['SuperAdmin', 'ProductAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  if (!b.toState) return sendJSON(res, 400, { error: 'toState is required' });
  const { transitionLifecycle } = require('./lib/engage-mechanic-lab.js');
  try {
    const mv = transitionLifecycle(p.id, b.toState, session.username, b.reason, { canaryPercentage: b.canaryPercentage });
    audit(session.username, session.role, 'mechanic_lifecycle_transition', p.id, null, { toState: b.toState, reason: b.reason }, null);
    sendJSON(res, 200, mv);
  } catch (e) { sendJSON(res, e.status || 500, { error: e.message, gate: e.gate }); }
});
on('POST', '/api/admin/mechanics/:id/kill-switch', ['SuperAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  if (!['held', 'rejected'].includes(b.toState)) return sendJSON(res, 400, { error: 'toState must be held or rejected for the kill switch' });
  const { killSwitchMechanic } = require('./lib/engage-mechanic-lab.js');
  try {
    const mv = killSwitchMechanic(p.id, b.toState, session.username, b.reason);
    audit(session.username, session.role, 'mechanic_kill_switch', p.id, null, { toState: b.toState, reason: b.reason }, null);
    sendJSON(res, 200, mv);
  } catch (e) { sendJSON(res, e.status || 500, { error: e.message }); }
});
on('GET', '/api/admin/mechanics/:id/safety-incidents', ['SuperAdmin', 'ProductAdmin', 'SafetyReviewer'], async (req, res, p) => {
  const rows = db.prepare('SELECT * FROM mechanic_safety_incident WHERE mechanic_version_id = ? ORDER BY created_at DESC').all(p.id);
  sendJSON(res, 200, rows);
});
on('POST', '/api/admin/mechanics/safety-incidents/:incidentId/resolve', ['SuperAdmin', 'SafetyReviewer'], async (req, res, p, q, session) => {
  const { resolveSafetyIncident } = require('./lib/engage-mechanic-lab.js');
  try {
    const incident = resolveSafetyIncident(p.incidentId, session.username);
    audit(session.username, session.role, 'mechanic_safety_incident_resolved', p.incidentId, null, null, null);
    sendJSON(res, 200, incident);
  } catch (e) { sendJSON(res, e.status || 500, { error: e.message }); }
});
on('POST', '/api/admin/engage/mechanic-min-sample', ['SuperAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  const { setMinSampleOverride } = require('./lib/engage-mechanic-lab.js');
  try {
    setMinSampleOverride(b.value, session.username);
    audit(session.username, session.role, 'mechanic_min_sample_set', 'system', null, { value: b.value }, null);
    sendJSON(res, 200, { ok: true, value: b.value });
  } catch (e) { sendJSON(res, 400, { error: e.message }); }
});
on('GET', '/api/admin/engage/mechanic-min-sample', ['SuperAdmin', 'ProductAdmin'], async (req, res) => {
  const { resolveMinSample } = require('./lib/engage-mechanic-lab.js');
  sendJSON(res, 200, { value: resolveMinSample() });
});

/* Phase 5 P5-Inc-2 (corrective round): Session lifecycle + Moment serving.
   Authorization is capability-token based throughout — see
   migrations/007_engage_session_auth.js and lib/engage-session.js for the
   full rationale. Internal ids (engage_pass.id, engage_session.id) are
   NEVER accepted as client input on these routes; only the unguessable
   access_token issued at Pass/Session creation is. This mirrors the
   already-proven QR token pattern (GET /api/qr/:token) rather than
   inventing a new authorization architecture. */
on('POST', '/api/engage/session/start', null, async (req, res) => {
  const b = await readBody(req);
  try {
    const session = startSession(b.accessToken);
    sendJSON(res, 200, {
      id: session.id, sessionToken: session.access_token,
      personality: session.personality, ceilingMax: session.ceiling_moments_max,
      ceilingUsed: session.ceiling_moments_used, status: session.status,
    });
  } catch (e) { sendJSON(res, e.status || 500, { error: e.message }); }
});
on('POST', '/api/engage/session/:token/next-moment', null, async (req, res, p) => {
  try {
    const result = await serveNextMoment(p.token);
    sendJSON(res, 200, result);
  } catch (e) { sendJSON(res, e.status || 500, { error: e.message, ceilingReached: e.ceilingReached || false }); }
});
on('POST', '/api/engage/session/:token/end', null, async (req, res, p) => {
  try {
    const session = endSession(p.token);
    sendJSON(res, 200, { id: session.id, status: session.status });
  } catch (e) { sendJSON(res, e.status || 500, { error: e.message }); }
});
on('POST', '/api/engage/session/:token/moment/:momentId/respond', null, async (req, res, p) => {
  const b = await readBody(req);
  try {
    const result = submitResponse(p.token, p.momentId, b.action, b.idempotencyKey);
    sendJSON(res, 200, result);
  } catch (e) { sendJSON(res, e.status || 500, { error: e.message }); }
});

/* Phase 5 P5-Inc-5: Social / Group Invite. Creation requires the host's own
   session token (same capability-token pattern as everything else in
   Engage). Joining requires ONLY the invite token itself -- an invitee
   never needs a Pass/Session of their own, per §25.6. */
on('POST', '/api/engage/session/:token/invite/create', null, async (req, res, p) => {
  const b = await readBody(req);
  try {
    const invite = createInvite(p.token, b.maxParticipants);
    sendJSON(res, 200, invite);
  } catch (e) { sendJSON(res, e.status || 500, { error: e.message }); }
});
on('POST', '/api/engage/invite/:inviteToken/join', null, async (req, res, p) => {
  const b = await readBody(req);
  try {
    const result = joinInvite(p.inviteToken, b.displayName);
    sendJSON(res, 200, result);
  } catch (e) { sendJSON(res, e.status || 500, { error: e.message }); }
});

/* Phase 5 P5-Inc-3: Experience Ledger + Admin/Partner Visibility.
   Two structurally separate read paths -- see lib/engage-ledger.js for why
   this is deliberate, not an oversight to later "add a filter" to. */
on('GET', '/api/admin/engage/ledger', ['SuperAdmin', 'SafetyReviewer'], async (req, res, p, query) => {
  sendJSON(res, 200, getFullLedger({ partnerId: query.partnerId, limit: query.limit ? parseInt(query.limit) : undefined }));
});
on('GET', '/api/admin/engage/overview', ['SuperAdmin', 'ProductAdmin'], async (req, res) => {
  sendJSON(res, 200, getAdminOverview());
});
/* --------- ENGAGE EFFECTIVE STATE (Role Corrective R2 §1/§2) --------------
   المنطق الذي يقرر تشغيل Engage موجود منذ Inc-6 في lib/engage-flags.js،
   لكن **لم تكن هناك نقطة تكشفه**. النتيجة: مشغّل يرى Engage معطّلًا ولا
   يعرف أي طبقة عطّلته -- الباقة؟ الاشتراك؟ مفتاح الإيقاف؟ تقييد منطقة؟

   هذه النقطة لا تُعيد بناء أي منطق. تستدعي resolveEngageEnabled نفسها
   التي يستدعيها العامل، وتُفكّك الطبقات الأربع بأسبابها بلغة أعمال.
   PartnerAdmin/Viewer يُقيَّدان بشريكهما، ولا يريان حالة المفتاح العام
   كقيمة قابلة للتعديل -- فقط أثرها عليهم. */
on('GET', '/api/engage/effective-state', ['SuperAdmin', 'PartnerAdmin', 'PartnerViewer'], async (req, res, p, query, session) => {
  // عزل المستأجر: الشريك يُقيَّد بنطاقه من الجلسة. وإن مرّر مُعرّف شريك
  // آخر صراحةً فالرفض أوضح من الاستبدال الصامت -- الاستبدال يُعيد بيانات
  // صحيحة لكن لسؤال مختلف، وهو ما يُربك المشغّل ويُخفي محاولة التجاوز
  // عن التدقيق. اكتشف الاختبار هذا السلوك الغامض قبل أن يصل للإنتاج.
  let partnerId;
  if (session.role === 'SuperAdmin') {
    partnerId = query.partnerId || null;
  } else {
    if (query.partnerId && query.partnerId !== session.scope) {
      const e = new Error('Forbidden: cannot read another partner\'s state');
      e.status = 403; throw e;
    }
    partnerId = session.scope;
  }
  if (!partnerId) return sendJSON(res, 400, { error: 'partnerId is required' });

  const sub = db.prepare(`
    SELECT s.status, pl.code, pl.features_json FROM subscriptions s
    JOIN plans pl ON pl.id = s.plan_id WHERE s.partner_id = ? ORDER BY s.started_at DESC LIMIT 1`).get(partnerId);
  const features = sub ? (JSON.parse(sub.features_json || '{}')) : {};
  const contractEnabled = features.engage_enabled === true;
  const subscriptionActive = !!sub && sub.status === 'Active';
  const killSwitchOn = getGlobalKillSwitchState(); // true = المنصة مسموحة

  // التقييدات التي تخصّ هذا الشريك فقط
  const overrides = db.prepare(`SELECT * FROM venue_policy_override WHERE policy_key = 'engage_enabled' ORDER BY created_at DESC`).all()
    .filter(r => {
      if (r.scope_type === 'property') return propertyPartnerId(r.scope_id) === partnerId;
      if (r.scope_type === 'zone') return zonePartnerId(r.scope_id) === partnerId;
      return false;
    })
    .map(r => ({ scopeType: r.scope_type, scopeId: r.scope_id, enabled: JSON.parse(r.policy_value_json || '{}').enabled === true, setBy: r.set_by, at: r.created_at }));

  // الحالة الفعّالة على مستوى الشريك = نفس دالة العامل، لا نسخة موازية
  const effective = subscriptionActive && resolveEngageEnabled(contractEnabled, partnerId, null, null);

  // أول سبب مانع بالترتيب الحاكم — هذا ما يحتاجه المشغّل، لا قائمة أعلام
  let blockedBy = null;
  if (!subscriptionActive) blockedBy = 'subscription_inactive';
  else if (!contractEnabled) blockedBy = 'not_in_plan';
  else if (!killSwitchOn) blockedBy = 'global_kill_switch';
  else if (!effective) blockedBy = 'scope_override';

  const payload = {
    partnerId,
    effective,
    blockedBy,
    layers: {
      plan: { code: sub ? sub.code : null, entitlement: contractEnabled },
      subscription: { status: sub ? sub.status : null, active: subscriptionActive },
      // الشريك يرى أثر المفتاح العام، لا يملك تعديله (§1: المفتاح لـSuperAdmin فقط)
      globalKillSwitch: { allowed: killSwitchOn, controlledBy: 'SuperAdmin' },
      scopeOverrides: overrides,
    },
  };
  if (session.role === 'SuperAdmin') {
    payload.layers.aiGeneration = {
      entitlement: features.engage_ai_generation === true,
      globalAllowed: getAIGenerationGlobalKillSwitchState(),
    };
  }
  sendJSON(res, 200, payload);
});

on('GET', '/api/partner/engage/overview', ['PartnerAdmin', 'PartnerViewer'], async (req, res, p, query, session) => {
  sendJSON(res, 200, getPartnerOverview(session.scope));
});

/* ------------------------------ REFUNDS (Q03) --------------------------------- */
on('POST', '/api/orders/:id/refund', ['AlnadlFinance', 'SiteManager', 'SuperAdmin'], async (req, res, p, q, session) => {
  const body = await readBody(req);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(p.id);
  if (!order) return sendJSON(res, 404, { error: 'Order not found' });

  // Idempotency: an optional client-supplied key. A repeated call with the
  // SAME key returns the original result rather than refunding twice —
  // distinct from two legitimately separate partial refunds, which use
  // different keys (or none).
  if (body.idempotencyKey) {
    const existing = db.prepare('SELECT * FROM refunds WHERE order_id = ? AND reason = ?').get(p.id, '__idem__' + body.idempotencyKey);
    if (existing) return sendJSON(res, 200, { id: existing.id, status: order.status, idempotent: true });
  }

  // Refund authorization comes from the route-level role guard
  // (AlnadlFinance/SiteManager/SuperAdmin) — NOT from actorAllowed() against
  // the order's current status, which governs ordinary KDS/Runner
  // transitions and would incorrectly reject e.g. AlnadlFinance acting on
  // a 'Paid' order (a state AlnadlFinance has no normal transition from).
  // The state check below is what actually governs whether THIS order can
  // be refunded right now.
  if (!['Delivered', 'Partially Refunded', 'Cancelled'].includes(order.status)) {
    return sendJSON(res, 409, { error: `Order in status ${order.status} is not refundable` });
  }

  const totalPaid = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE order_id = ? AND status = 'Captured'`).get(p.id).s;
  const alreadyRefunded = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE order_id = ? AND status = 'Refunded'`).get(p.id).s;
  const remaining = Math.round((totalPaid - alreadyRefunded) * 100) / 100;

  // Corrective: حذف `amount` يعني **الرصيد المتبقي القابل للاسترجاع**، لا صفرًا.
  // كانت الواجهة تقول "اترك المبلغ فارغًا لاسترجاع كامل" بينما يرفضه الخادم
  // بـ400 -- تناقض حقيقي بين ما وُعِد به المشغّل وما ينفّذه النظام. المصدر
  // الوحيد للمبلغ الكامل هو `remaining` المحسوب أعلاه، فلا يمكن للعميل أن
  // يتجاوزه ولا أن يخمّنه.
  const amountOmitted = body.amount === undefined || body.amount === null || body.amount === '';
  const amount = amountOmitted
    ? remaining
    : Math.round((parseFloat(body.amount) || 0) * 100) / 100;

  if (remaining <= 0) return sendJSON(res, 409, { error: 'Nothing left to refund on this order' });
  if (amount <= 0) return sendJSON(res, 400, { error: 'Refund amount must be positive' });
  if (amount > remaining + 0.01) return sendJSON(res, 409, { error: `Refund amount (${amount}) exceeds remaining refundable balance (${remaining}) — prevents double/over-refund` });
  if (!body.reason) return sendJSON(res, 400, { error: 'Refund reason is required for the audit trail' });

  // --- gateway call (Q03: prevent double capture/refund; real adapters
  //     must also verify the webhook and handle provider timeouts here) ---
  const gatewayResult = await gateway.refund(order.payment_ref, amount);
  if (gatewayResult.status !== 'Refunded') {
    return sendJSON(res, 502, { error: 'Payment provider declined or failed to process the refund' });
  }

  const isFull = Math.abs(remaining - amount) < 0.01;
  const targetStatus = isFull ? 'Refunded' : 'Partially Refunded';
  const refundId = uid('rf');
  db.prepare(`INSERT INTO refunds (id,order_id,amount,type,reason,gateway_ref,status,actor,actor_role,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(refundId, p.id, amount, isFull ? 'full' : 'partial', body.idempotencyKey ? '__idem__' + body.idempotencyKey : body.reason, gatewayResult.refundRef, 'Refunded', session.username, session.role, Date.now());

  if (targetStatus !== order.status) {
    if (!canTransition(order.status, targetStatus)) return sendJSON(res, 409, { error: `Invalid transition ${order.status} → ${targetStatus}` });
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(targetStatus, Date.now(), p.id);
  }
  audit(session.username, session.role, 'refund', p.id, { status: order.status, alreadyRefunded }, { status: targetStatus, refundAmount: amount, reason: body.reason }, body.reason);

  // Q03: reverse the Revenue Ledger proportionally so this refund is never
  // counted in a future settlement's Eligible Base. VAT is a pass-through
  // tax, never part of eligible_base to begin with (see recordOrderRevenue),
  // so the refund must be converted to its pre-VAT equivalent before being
  // reversed — refunding the VAT-inclusive amount directly would over-correct
  // the ledger by the VAT portion.
  recordRefundRevenue(p.id, amount / 1.15);

  notify('order_refunded', p.id, 'push');
  sendJSON(res, 200, { id: refundId, orderId: p.id, amount, status: targetStatus, remaining: Math.round((remaining - amount) * 100) / 100 });
});

on('GET', '/api/orders/:id/refunds', ['AlnadlFinance', 'SiteManager', 'SuperAdmin'], async (req, res, p) => {
  sendJSON(res, 200, db.prepare('SELECT * FROM refunds WHERE order_id = ? ORDER BY created_at DESC').all(p.id));
});

/* ------------------------------ OPERATIONS (KDS) --------------------------------- */
on('GET', '/api/ops/queue', ['Operator', 'SiteManager', 'SuperAdmin'], async (req, res, p, query, session) => {
  // UX-2 (spec K02 hierarchy #2 "Zone + Point/Table"; K04 "SLA... amber/
  // red thresholds"): zone name and a real per-outlet prep-time SLA
  // (outlets.sla_prep_min, already a real configured column — was never
  // surfaced to the KDS at all, which hardcoded 5/8-minute guesses
  // client-side instead of using it) are now both included so the
  // client never has to invent either.
  const rows = db.prepare(`
    SELECT o.*, pt.label AS point_label, z.name_ar AS zone_name_ar, z.name_en AS zone_name_en
    FROM orders o LEFT JOIN points pt ON pt.id = o.point_id LEFT JOIN zones z ON z.id = pt.zone_id
    WHERE o.status IN ('Paid','Accepted','Preparing','Ready','Out for Delivery') ORDER BY o.created_at ASC`).all();
  const result = [];
  for (const o of rows) {
    const children = db.prepare('SELECT * FROM child_orders WHERE parent_order_id = ?').all(o.id);
    if (children.length === 0) {
      // Legacy single-outlet path — identical shape to every version before Phase 4.
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
      const legacyOutletId = items.find(i => i.outlet_id)?.outlet_id || null;
      const legacyOutlet = legacyOutletId ? db.prepare('SELECT sla_prep_min FROM outlets WHERE id = ?').get(legacyOutletId) : null;
      result.push({ ...o, itemsSummary: items.map(i => `${i.qty}× ${i.name_ar}`).join(', '), itemCount: items.reduce((s, i) => s + i.qty, 0), slaPrepMin: legacyOutlet ? legacyOutlet.sla_prep_min : DEFAULT_SLA_PREP_MIN });
    } else {
      // Unified Cart (§8, §13): the Parent itself isn't independently
      // actionable once split — each Outlet's portion is its own ticket.
      // Filtering by ?stationId lets a KDS screen show only its own station.
      for (const c of children) {
        if (['Paid', 'Accepted', 'Preparing', 'Ready', 'Out for Delivery'].indexOf(c.status) === -1) continue;
        if (query.stationId && c.station_id !== query.stationId) continue;
        const outlet = db.prepare('SELECT name_ar, name_en, sla_prep_min FROM outlets WHERE id = ?').get(c.outlet_id);
        const items = db.prepare('SELECT * FROM order_items WHERE child_order_id = ?').all(c.id);
        result.push({
          id: c.id, status: c.status, created_at: c.created_at, point_label: o.point_label,
          zone_name_ar: o.zone_name_ar, zone_name_en: o.zone_name_en,
          itemsSummary: items.map(i => `${i.qty}× ${i.name_ar}`).join(', '), itemCount: items.reduce((s, i) => s + i.qty, 0),
          isChild: true, parentOrderId: o.id, outletId: c.outlet_id,
          outletName: outlet ? outlet.name_ar : null, outletNameEn: outlet ? outlet.name_en : null,
          slaPrepMin: outlet ? outlet.sla_prep_min : DEFAULT_SLA_PREP_MIN,
        });
      }
    }
  }
  sendJSON(res, 200, result);
});

on('POST', '/api/orders/:id/transition', ['Operator', 'SiteManager', 'Runner', 'AlnadlFinance', 'SuperAdmin'], async (req, res, p, query, session) => {
  const body = await readBody(req);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(p.id);
  if (!order) return sendJSON(res, 404, { error: 'Order not found' });
  const to = body.to;
  if (!canTransition(order.status, to)) return sendJSON(res, 409, { error: `Invalid transition ${order.status} → ${to}` });
  if (session.role !== 'SuperAdmin' && !actorAllowed(order.status, session.role)) {
    return sendJSON(res, 403, { error: `Role ${session.role} cannot perform this transition` });
  }
  if (to === 'Cancelled' && !body.reason) return sendJSON(res, 400, { error: 'Cancellation requires a reason' });
  // UX-2 (spec R03: "Delivery exception — reason required; audit-safe"):
  // same discipline already proven for Cancelled — a Runner marking a
  // delivery as failed must supply why, recorded auditable and visible
  // to SiteManager/SuperAdmin later, exactly like a cancellation reason.
  if (to === 'Delivery Failed' && !body.reason) return sendJSON(res, 400, { error: 'Delivery failure requires a reason' });

  db.prepare('UPDATE orders SET status=?, updated_at=?, cancel_reason=? WHERE id=?')
    .run(to, Date.now(), ['Cancelled', 'Delivery Failed'].includes(to) ? body.reason : order.cancel_reason, order.id);

  const fulfillmentCol = { Accepted: 'accepted_at', Preparing: 'preparing_at', Ready: 'ready_at', 'Out for Delivery': 'out_at', Delivered: 'delivered_at' }[to];
  if (fulfillmentCol) {
    db.prepare(`INSERT INTO fulfillment (order_id, ${fulfillmentCol}) VALUES (?, ?)
                ON CONFLICT(order_id) DO UPDATE SET ${fulfillmentCol} = excluded.${fulfillmentCol}`).run(order.id, Date.now());
  }
  audit(session.username, session.role, 'status_change', order.id, { status: order.status }, { status: to }, body.reason || null);
  const notifyEvent = { Accepted:'order_accepted', Ready:'order_ready', 'Out for Delivery':'order_out', Delivered:'order_delivered', Cancelled:'order_cancelled' }[to];
  if (notifyEvent) notify(notifyEvent, order.id, 'push');
  // Loyalty: earn points on successful delivery (§15). The entitlement check
  // now lives inside earnPoints as a feature flag (§3.7) rather than a plan
  // name here, and the account is scoped to this order's own partner (§3.4).
  let loyaltyEarned = null;
  if (to === 'Delivered' && order.customer_phone) {
    // §4: التراكم الجديد يتوقف مع التوقف التجاري -- لكن الطلب نفسه يُكمل.
    if (partnerStatus.can(order.partner_id, 'loyaltyEarn')) {
      loyaltyEarned = earnPoints(order.partner_id, order.customer_phone, order.id, order.total);
    }
  }
  sendJSON(res, 200, { id: order.id, status: to, loyaltyEarned: loyaltyEarned ? loyaltyEarned.points_balance : undefined });
});

/* Derive the Parent order's status from its children (§13 design in Gap
   Analysis §3.3): the Parent is only as advanced as its LEAST advanced
   active child — an order isn't "Ready" until every outlet's portion is
   ready. All-Delivered → Delivered. All-Cancelled → Cancelled. Only called
   for orders that actually have child_orders; legacy single-outlet orders
   never enter this path and keep managing their own status exactly as
   before Phase 4. */
function deriveParentStatus(parentOrderId) {
  const children = db.prepare('SELECT status FROM child_orders WHERE parent_order_id = ?').all(parentOrderId);
  if (!children.length) return;
  const order = ['Paid', 'Accepted', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered'];
  const active = children.filter(c => c.status !== 'Cancelled');
  let newStatus;
  if (active.length === 0) {
    newStatus = 'Cancelled';
  } else if (active.every(c => c.status === 'Delivered')) {
    newStatus = 'Delivered';
  } else if (active.some(c => c.status === 'Delivered')) {
    // Q04: some outlets' portions handed over, others still in flight.
    newStatus = 'Partially Delivered';
  } else if (active.every(c => ['Ready', 'Out for Delivery'].includes(c.status))) {
    newStatus = 'Ready'; // every portion dispatched/ready, none delivered yet — matches pre-Q01 behavior exactly
  } else if (active.some(c => ['Ready', 'Out for Delivery'].includes(c.status))) {
    // Q04: at least one outlet ready while another is still preparing.
    newStatus = 'Partially Ready';
  } else {
    let minIdx = order.length;
    for (const c of active) { const idx = order.indexOf(c.status); if (idx >= 0 && idx < minIdx) minIdx = idx; }
    newStatus = minIdx < order.length ? order[minIdx] : active[0].status;
  }
  const before = db.prepare('SELECT status FROM orders WHERE id = ?').get(parentOrderId);
  if (before && before.status !== newStatus) {
    db.prepare('UPDATE orders SET status=?, updated_at=? WHERE id=?').run(newStatus, Date.now(), parentOrderId);
    audit('system', 'System', 'parent_status_derive', parentOrderId, { status: before.status }, { status: newStatus }, null);
    const notifyEvent = { Ready: 'order_ready', 'Partially Ready': 'order_ready', 'Out for Delivery': 'order_out',
      Delivered: 'order_delivered', 'Partially Delivered': 'order_out', Cancelled: 'order_cancelled' }[newStatus];
    if (notifyEvent) notify(notifyEvent, parentOrderId, 'push');
  }
}

/* Child-order transitions (§8, §13) — a separate endpoint from the legacy
   /api/orders/:id/transition above, which is left completely untouched.
   Same state machine, same role rules, applied to a child_order row instead
   of an orders row, then the Parent's derived status is recomputed. */
on('POST', '/api/child-orders/:id/transition', ['Operator', 'SiteManager', 'Runner', 'AlnadlFinance', 'SuperAdmin'], async (req, res, p, query, session) => {
  const body = await readBody(req);
  const child = db.prepare('SELECT * FROM child_orders WHERE id = ?').get(p.id);
  if (!child) return sendJSON(res, 404, { error: 'Child order not found' });
  const to = body.to;
  if (!canTransition(child.status, to)) return sendJSON(res, 409, { error: `Invalid transition ${child.status} → ${to}` });
  if (session.role !== 'SuperAdmin' && !actorAllowed(child.status, session.role)) {
    return sendJSON(res, 403, { error: `Role ${session.role} cannot perform this transition` });
  }
  if (to === 'Cancelled' && !body.reason) return sendJSON(res, 400, { error: 'Cancellation requires a reason' });
  if (to === 'Delivery Failed' && !body.reason) return sendJSON(res, 400, { error: 'Delivery failure requires a reason' });
  db.prepare('UPDATE child_orders SET status=?, updated_at=?, cancel_reason=? WHERE id=?')
    .run(to, Date.now(), ['Cancelled', 'Delivery Failed'].includes(to) ? body.reason : child.cancel_reason, child.id);
  audit(session.username, session.role, 'child_status_change', child.id, { status: child.status }, { status: to }, body.reason || null);
  deriveParentStatus(child.parent_order_id);
  sendJSON(res, 200, { id: child.id, status: to, parentOrderId: child.parent_order_id });
});

/* ------------------------------ RUNNER --------------------------------- */
on('GET', '/api/runner/queue', ['Runner', 'SuperAdmin'], async (req, res) => {
  // UX-2 (spec R01 hierarchy: "Destination > pickup outlet > order# >
  // wait"): zone name (the actual destination) and pickup outlet name are
  // now both included — neither existed in this response before, which
  // is why the Runner queue previously had no way to show either without
  // inventing data.
  const rows = db.prepare(`
    SELECT o.*, pt.label AS point_label, z.name_ar AS zone_name_ar, z.name_en AS zone_name_en
    FROM orders o LEFT JOIN points pt ON pt.id = o.point_id LEFT JOIN zones z ON z.id = pt.zone_id
    WHERE o.status IN ('Ready','Out for Delivery','Partially Ready','Partially Delivered') ORDER BY o.updated_at ASC`).all();
  const result = [];
  for (const o of rows) {
    const property = db.prepare('SELECT delivery_grouping FROM properties WHERE id = ?').get(o.property_id);
    const grouping = (property && property.delivery_grouping) || 'grouped';
    const children = db.prepare('SELECT * FROM child_orders WHERE parent_order_id = ?').all(o.id);

    if (children.length === 0) {
      // Legacy single-outlet path — unaffected by grouping policy, exactly as before Q01.
      if (['Ready', 'Out for Delivery'].includes(o.status)) {
        const legacyOutletId = db.prepare('SELECT outlet_id FROM order_items WHERE order_id = ? AND outlet_id IS NOT NULL LIMIT 1').get(o.id)?.outlet_id;
        const legacyOutlet = legacyOutletId ? db.prepare('SELECT name_ar, name_en FROM outlets WHERE id = ?').get(legacyOutletId) : null;
        const itemCount = db.prepare('SELECT COALESCE(SUM(qty),0) c FROM order_items WHERE order_id = ?').get(o.id).c;
        result.push({ ...o, outletName: legacyOutlet ? legacyOutlet.name_ar : null, outletNameEn: legacyOutlet ? legacyOutlet.name_en : null, itemCount });
      }
      continue;
    }

    if (grouping === 'grouped') {
      // Grouped (§13, Q01 default — matches pre-Q01 behavior exactly): Runner
      // only ever sees the whole order once every child has reached Ready.
      // A grouped multi-outlet order can genuinely have more than one
      // pickup outlet — shown honestly as a count rather than picking one
      // arbitrarily, since naming just the first would misrepresent it.
      if (o.status === 'Ready' || o.status === 'Out for Delivery') {
        const distinctOutlets = [...new Set(children.map(c => c.outlet_id))];
        const singleOutlet = distinctOutlets.length === 1 ? db.prepare('SELECT name_ar, name_en FROM outlets WHERE id = ?').get(distinctOutlets[0]) : null;
        const itemCount = children.reduce((s, c) => s + (db.prepare('SELECT COALESCE(SUM(qty),0) c FROM order_items WHERE child_order_id = ?').get(c.id).c), 0);
        result.push({ ...o, outletName: singleOutlet ? singleOutlet.name_ar : null, outletNameEn: singleOutlet ? singleOutlet.name_en : null, multiOutletCount: distinctOutlets.length > 1 ? distinctOutlets.length : null, itemCount });
      }
    } else {
      // Separate (§13, Q01): each outlet's portion can be claimed and
      // delivered independently the moment IT is ready, without waiting
      // for siblings still preparing.
      for (const c of children) {
        if (!['Ready', 'Out for Delivery'].includes(c.status)) continue;
        const outlet = db.prepare('SELECT name_ar, name_en FROM outlets WHERE id = ?').get(c.outlet_id);
        const itemCount = db.prepare('SELECT COALESCE(SUM(qty),0) c FROM order_items WHERE child_order_id = ?').get(c.id).c;
        result.push({
          id: c.id, status: c.status, updated_at: c.updated_at, point_label: o.point_label,
          zone_name_ar: o.zone_name_ar, zone_name_en: o.zone_name_en,
          isChild: true, parentOrderId: o.id, outletId: c.outlet_id,
          outletName: outlet ? outlet.name_ar : null, outletNameEn: outlet ? outlet.name_en : null, itemCount,
        });
      }
    }
  }
  sendJSON(res, 200, result);
});

function propertyPartnerId(propertyId) { return (db.prepare('SELECT partner_id FROM properties WHERE id=?').get(propertyId) || {}).partner_id; }
function zonePartnerId(zoneId) { const z = db.prepare('SELECT property_id FROM zones WHERE id=?').get(zoneId); return z ? propertyPartnerId(z.property_id) : null; }
function pointPartnerId(pointId) { const pt = db.prepare('SELECT zone_id FROM points WHERE id=?').get(pointId); return pt ? zonePartnerId(pt.zone_id) : null; }
function categoryPartnerId(categoryId) { const c = db.prepare('SELECT property_id FROM categories WHERE id=?').get(categoryId); return c ? propertyPartnerId(c.property_id) : null; }
function productPartnerId(productId) { const pr = db.prepare('SELECT category_id FROM products WHERE id=?').get(productId); return pr ? categoryPartnerId(pr.category_id) : null; }
function assertTenantWrite(session, ownerPartnerId) {
  if (session.role === 'PartnerAdmin' && session.scope !== ownerPartnerId) {
    const e = new Error('Forbidden — you can only manage your own tenant'); e.status = 403; throw e;
  }
}

/* ------------- LOYALTY ADMINISTRATION (Role Corrective §5) -----------------
   سطح إداري فقط -- لا تغيير في قواعد الولاء المعتمدة، ولا Campaigns ولا
   Tiers ولا Network Rewards.

   العزل: partnerId يُشتق من الجلسة للأدوار المرتبطة بشريك ولا يُقرأ من
   الطلب أبدًا؛ وSuperAdmin وحده يُمرّره صراحةً. كل استعلام أدناه مُقيَّد
   بـpartner_id، فحساب شريك آخر غير قابل للوصول بأي معامل.

   الخصوصية (§6 من الوثيقة): أرقام الجوال **مُخفاة جزئيًا** في كل قائمة
   إدارية. الرقم الكامل ليس لازمًا لقرار إداري، وقائمة إدارية تعرض آلاف
   الأرقام الكاملة هي قاعدة بيانات تواصل، لا أداة تشغيل. */
function maskPhoneAdmin(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 4 ? `••••${d.slice(-4)}` : '••••';
}

function resolveLoyaltyScope(session, query) {
  if (session.role === 'SuperAdmin') {
    if (!query.partnerId) { const e = new Error('partnerId is required'); e.status = 400; throw e; }
    return query.partnerId;
  }
  // النطاق يأتي من الجلسة حصرًا. لكن **تجاهل** معامل مخالف صامتًا خطأ:
  // كشفه الاختبار -- طلب يحمل partnerId لشريك آخر كان يُرجع 200 ببيانات
  // الشريك الصحيح، فيبدو للمهاجم أن المحاولة "نجحت" بينما هي انزلقت. الرفض
  // الصريح يجعل محاولة العبور مرئية وقابلة للرصد بدل أن تُبتلع بهدوء.
  if (query.partnerId && query.partnerId !== session.scope) {
    const e = new Error('Forbidden: cannot read another partner\'s loyalty data');
    e.status = 403;
    throw e;
  }
  return session.scope;
}

on('GET', '/api/admin/loyalty/summary', ['SuperAdmin', 'PartnerAdmin', 'PartnerViewer'], async (req, res, p, query, session) => {
  const partnerId = resolveLoyaltyScope(session, query);
  assertPartnerScope(session, partnerId);

  const accounts = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(points_balance),0) bal FROM loyalty_accounts WHERE partner_id = ?`).get(partnerId);
  const verified = db.prepare(`SELECT COUNT(*) c FROM loyalty_accounts WHERE partner_id = ? AND verification_status = 'verified'`).get(partnerId).c;
  const quarantined = db.prepare(`SELECT COUNT(*) c FROM loyalty_accounts WHERE partner_id IS NULL AND migration_status != 'active'`).get().c;

  const ids = db.prepare(`SELECT id FROM loyalty_accounts WHERE partner_id = ?`).all(partnerId).map(r => r.id);
  let earned = 0, redeemed = 0, txns = 0;
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    const e = db.prepare(`SELECT COALESCE(SUM(points_delta),0) v, COUNT(*) c FROM loyalty_transactions WHERE account_id IN (${ph}) AND points_delta > 0`).get(...ids);
    const r = db.prepare(`SELECT COALESCE(SUM(points_delta),0) v, COUNT(*) c FROM loyalty_transactions WHERE account_id IN (${ph}) AND points_delta < 0`).get(...ids);
    earned = e.v; redeemed = Math.abs(r.v); txns = e.c + r.c;
  }

  sendJSON(res, 200, {
    partnerId,
    entitlements: {
      loyaltyEnabled: isLoyaltyEnabled(partnerId),
      redeemEnabled: isRedeemEnabled(partnerId),
      redeemPolicy: redeemPolicy(),
      // §4: حالة الشريك قد تُغلق الاستبدال حتى لو سمحت الباقة -- تُعرض
      // صراحةً حتى لا يبدو الأمر تناقضًا غير مفسَّر.
      blockedByPartnerStatus: !partnerStatus.can(partnerId, 'loyaltyRedeem'),
      partnerStatus: partnerStatus.getPartnerStatus(partnerId),
    },
    accounts: { total: accounts.c, verified, unverified: accounts.c - verified, totalBalance: accounts.bal },
    activity: { pointsEarned: earned, pointsRedeemed: redeemed, transactions: txns },
    // معلومة تشغيلية لـSuperAdmin فقط: حسابات قديمة لم تُنسب لشريك (مهاجرة 015)
    ...(session.role === 'SuperAdmin' ? { quarantinedLegacyAccounts: quarantined } : {}),
  });
});

on('GET', '/api/admin/loyalty/accounts', ['SuperAdmin', 'PartnerAdmin', 'PartnerViewer'], async (req, res, p, query, session) => {
  const partnerId = resolveLoyaltyScope(session, query);
  assertPartnerScope(session, partnerId);
  const limit = Math.min(parseInt(query.limit, 10) || 50, 200);
  const rows = db.prepare(`SELECT id, customer_key, points_balance, verification_status, created_at
                           FROM loyalty_accounts WHERE partner_id = ? ORDER BY points_balance DESC LIMIT ?`).all(partnerId, limit);
  sendJSON(res, 200, rows.map(r => ({
    id: r.id,
    customerMasked: maskPhoneAdmin(r.customer_key), // الرقم الكامل لا يُعاد أبدًا في قائمة
    pointsBalance: r.points_balance,
    verificationStatus: r.verification_status,
    createdAt: r.created_at,
  })));
});

on('GET', '/api/admin/loyalty/accounts/:id/history', ['SuperAdmin', 'PartnerAdmin', 'PartnerViewer'], async (req, res, p, query, session) => {
  const acct = db.prepare('SELECT * FROM loyalty_accounts WHERE id = ?').get(p.id);
  if (!acct) return sendJSON(res, 404, { error: 'Account not found' });
  // العزل يُفحص على الحساب نفسه: تمرير مُعرّف حساب شريك آخر يُرفض.
  assertPartnerScope(session, acct.partner_id);
  sendJSON(res, 200, {
    account: {
      id: acct.id, customerMasked: maskPhoneAdmin(acct.customer_key),
      pointsBalance: acct.points_balance, verificationStatus: acct.verification_status,
    },
    history: getHistory(acct.id, 100).map(t => ({
      orderId: t.order_id, pointsDelta: t.points_delta, reason: t.reason, at: t.created_at,
    })),
  });
});

/* ------------- PARTNER LIFECYCLE (Role Corrective §4) ----------------------
   Partner Status مستقل عن Subscription Status: الأول قرار تعاقدي/تشغيلي
   من النادل، والثاني حالة اشتراك. كلاهما يُفحص ولا يُشتق أحدهما من الآخر.

   القرار محصور بـSuperAdmin: تغيير حالة شريك يوقف أعماله الجديدة، وهذا
   ليس قرارًا يملكه الشريك على نفسه. والسبب إلزامي لأن الحالة تُقرأ لاحقًا
   في التدقيق والنزاعات المالية، فبلا سبب تصبح سجلًا بلا معنى. */
on('GET', '/api/admin/partners/:id/status', ['SuperAdmin', 'PartnerAdmin', 'PartnerViewer'], async (req, res, p, q, session) => {
  assertPartnerScope(session, p.id);
  const summary = partnerStatus.statusSummary(p.id);
  if (!summary) return sendJSON(res, 404, { error: 'Partner not found' });
  // الشريك يرى حالته وقدراته، ولا يُعرض له مسار تغيير لا يملكه.
  if (session.role !== 'SuperAdmin') return sendJSON(res, 200, { status: summary.status, capabilities: summary.capabilities });
  sendJSON(res, 200, summary);
});

on('POST', '/api/admin/partners/:id/status', ['SuperAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  requireFields(b, ['status', 'reason']);
  const current = partnerStatus.getPartnerStatus(p.id);
  if (!current) return sendJSON(res, 404, { error: 'Partner not found' });
  if (!partnerStatus.STATUSES.includes(b.status)) {
    return sendJSON(res, 400, { error: `status must be one of ${partnerStatus.STATUSES.join(', ')}` });
  }
  if (b.status === current) return sendJSON(res, 200, { status: current, unchanged: true });
  if (!partnerStatus.canTransition(current, b.status)) {
    return sendJSON(res, 409, { error: `Cannot move a partner from ${current} to ${b.status}` });
  }
  // الشرط الحاكم يُستشار من نموذج دورة الحياة، لا يُكرَّر هنا. النقطة لا
  // تعرف شيئًا عن الطلبات المفتوحة -- تسأل النموذج فقط.
  const pre = partnerStatus.checkTransitionPreconditions(p.id, current, b.status);
  if (!pre.ok) {
    // لا شيء يُكتب: الحالة كما هي، ولا طلب يُلغى أو تُغيَّر حالته.
    return sendJSON(res, 409, { error: pre.code, code: pre.code, openOrders: pre.openOrders, remedy: pre.remedy });
  }
  const reason = String(b.reason).trim();
  if (reason.length < 4) return sendJSON(res, 400, { error: 'reason must be at least 4 characters' });

  db.prepare('UPDATE partners SET status = ? WHERE id = ?').run(b.status, p.id);
  audit(session.username, session.role, 'partner_status_change', p.id,
    { status: current }, { status: b.status }, reason);
  // لا حذف ولا مساس بأي بيانات: الطلبات والتسويات والاسترجاعات والأرصدة
  // والتدقيق تبقى كاملة. Closed ليس Delete.
  sendJSON(res, 200, { status: b.status, previous: current, reason });
});

/* ------------- ADMIN: PLANS & ENTITLEMENTS (Go-Live P0-2) ------------------
   THE BLOCKER THIS CLOSES
   A fresh production database seeds a SuperAdmin account and nothing else --
   deliberately, since no demo data belongs in production. But there was no
   endpoint to create a PLAN either, and a partner cannot hold a
   subscription without one. The result: a genuinely new production
   deployment could not activate its first paying customer at all without
   someone opening the database by hand. That is the gap this closes.

   SuperAdmin only. Entitlements are free-form booleans on purpose -- new
   capability flags (loyalty_enabled, engage_enabled, future ones) can be
   introduced without a schema change or a code deploy, which is exactly
   what §3.7 asks for. Values are coerced to real booleans so a stray
   "false" string can never read as truthy at a feature gate. */
const RESERVED_PLAN_CODES = new Set(['OPERATE', 'SMART', 'CONNECT', 'PLATFORM']);

function coerceEntitlements(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k)) continue; // ignore malformed keys
    out[k] = v === true || v === 'true' || v === 1 || v === '1';
  }
  return out;
}

on('GET', '/api/admin/plans', ['SuperAdmin'], async (req, res) => {
  const rows = db.prepare('SELECT * FROM plans ORDER BY monthly_fee ASC').all();
  sendJSON(res, 200, rows.map(r => ({
    id: r.id, code: r.code, name_ar: r.name_ar, name_en: r.name_en,
    monthlyFee: r.monthly_fee, techFeeRate: r.tech_fee_rate,
    entitlements: JSON.parse(r.features_json || '{}'),
    subscribers: db.prepare('SELECT COUNT(*) c FROM subscriptions WHERE plan_id = ?').get(r.id).c,
  })));
});

on('POST', '/api/admin/plans', ['SuperAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  const code = String(b.code || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(code)) return sendJSON(res, 400, { error: 'code must be 2-32 chars, A-Z 0-9 _' });
  if (db.prepare('SELECT 1 FROM plans WHERE code = ?').get(code)) return sendJSON(res, 409, { error: 'A plan with that code already exists' });
  const monthlyFee = Number(b.monthlyFee);
  const techFeeRate = Number(b.techFeeRate);
  if (!Number.isFinite(monthlyFee) || monthlyFee < 0) return sendJSON(res, 400, { error: 'monthlyFee must be a non-negative number' });
  if (!Number.isFinite(techFeeRate) || techFeeRate < 0 || techFeeRate > 1) return sendJSON(res, 400, { error: 'techFeeRate must be between 0 and 1' });

  const id = uid('plan');
  const entitlements = coerceEntitlements(b.entitlements);
  db.prepare(`INSERT INTO plans (id,code,name_ar,name_en,monthly_fee,tech_fee_rate,features_json) VALUES (?,?,?,?,?,?,?)`)
    .run(id, code, b.name_ar || code, b.name_en || code, monthlyFee, techFeeRate, JSON.stringify(entitlements));
  audit(session.username, session.role, 'plan_create', id, null, { code, monthlyFee, techFeeRate, entitlements }, null);
  sendJSON(res, 201, { id, code, entitlements });
});

on('PATCH', '/api/admin/plans/:id', ['SuperAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  const before = db.prepare('SELECT * FROM plans WHERE id = ?').get(p.id);
  if (!before) return sendJSON(res, 404, { error: 'Plan not found' });

  // Pricing and entitlements are editable; the CODE is not. Subscriptions,
  // the revenue ledger and settlements all reference a plan by identity --
  // letting a code be rewritten under live subscribers would silently
  // change what an existing contract means.
  const monthlyFee = b.monthlyFee !== undefined ? Number(b.monthlyFee) : before.monthly_fee;
  const techFeeRate = b.techFeeRate !== undefined ? Number(b.techFeeRate) : before.tech_fee_rate;
  if (!Number.isFinite(monthlyFee) || monthlyFee < 0) return sendJSON(res, 400, { error: 'monthlyFee must be a non-negative number' });
  if (!Number.isFinite(techFeeRate) || techFeeRate < 0 || techFeeRate > 1) return sendJSON(res, 400, { error: 'techFeeRate must be between 0 and 1' });

  // Entitlements MERGE rather than replace, so a partial update cannot
  // silently strip capabilities a live subscriber depends on.
  const merged = { ...JSON.parse(before.features_json || '{}'), ...coerceEntitlements(b.entitlements) };
  db.prepare('UPDATE plans SET name_ar=?, name_en=?, monthly_fee=?, tech_fee_rate=?, features_json=? WHERE id=?')
    .run(b.name_ar || before.name_ar, b.name_en || before.name_en, monthlyFee, techFeeRate, JSON.stringify(merged), p.id);
  audit(session.username, session.role, 'plan_update', p.id,
    { monthlyFee: before.monthly_fee, techFeeRate: before.tech_fee_rate, entitlements: JSON.parse(before.features_json || '{}') },
    { monthlyFee, techFeeRate, entitlements: merged }, null);
  sendJSON(res, 200, { id: p.id, entitlements: merged });
});

on('DELETE', '/api/admin/plans/:id', ['SuperAdmin'], async (req, res, p, q, session) => {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(p.id);
  if (!plan) return sendJSON(res, 404, { error: 'Plan not found' });
  const subscribers = db.prepare('SELECT COUNT(*) c FROM subscriptions WHERE plan_id = ?').get(p.id).c;
  // Refuse rather than cascade: deleting a plan under live subscribers
  // would leave partners with a dangling subscription and no entitlements.
  if (subscribers > 0) return sendJSON(res, 409, { error: `Plan has ${subscribers} active subscription(s) — reassign them first` });
  db.prepare('DELETE FROM plans WHERE id = ?').run(p.id);
  audit(session.username, session.role, 'plan_delete', p.id, { code: plan.code }, null, null);
  sendJSON(res, 200, { ok: true });
});

/* ------------------------------ ADMIN: partners/properties/zones/points --------------------------------- */
on('GET', '/api/admin/partners', ['SuperAdmin'], async (req, res) => {
  const partners = db.prepare('SELECT * FROM partners').all();
  for (const pt of partners) {
    const sub = db.prepare(`SELECT s.status, p.code AS plan_code, p.monthly_fee FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.partner_id = ?`).get(pt.id);
    pt.subscription = sub || null;
  }
  sendJSON(res, 200, partners);
});
on('GET', '/api/admin/properties', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, query, session) => {
  let rows = db.prepare('SELECT * FROM properties').all();
  if (session.role === 'PartnerAdmin') rows = rows.filter(pr => pr.partner_id === session.scope);
  sendJSON(res, 200, rows);
});
on('PATCH', '/api/admin/properties/:id', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  // Q01: Grouped vs Separate delivery policy lives on the property.
  const b = await readBody(req);
  const before = db.prepare('SELECT partner_id, delivery_grouping FROM properties WHERE id = ?').get(p.id);
  if (!before) return sendJSON(res, 404, { error: 'Property not found' });
  if (session.role === 'PartnerAdmin' && before.partner_id !== session.scope) { const e = new Error('Forbidden'); e.status = 403; throw e; }
  if (!['grouped', 'separate'].includes(b.deliveryGrouping)) return sendJSON(res, 400, { error: 'deliveryGrouping must be "grouped" or "separate"' });
  db.prepare('UPDATE properties SET delivery_grouping = ? WHERE id = ?').run(b.deliveryGrouping, p.id);
  audit(session.username, session.role, 'delivery_grouping_change', p.id, { deliveryGrouping: before.delivery_grouping }, { deliveryGrouping: b.deliveryGrouping }, null);
  sendJSON(res, 200, { ok: true });
});
on('POST', '/api/admin/partners', ['SuperAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  const id = uid('pt');
  db.prepare('INSERT INTO partners (id,name_ar,name_en,legal_name,contract_ref,status) VALUES (?,?,?,?,?,?)')
    // §4: يبدأ Draft لا Active — الشريك لا يصبح Live بمجرد إنشائه.
    // مرحلة الإعداد (الباقة، العقار، المنافذ، المناطق، QR، المنتجات،
    // المستخدمون، Branding، Loyalty، Engage) تسبق التفعيل، والتفعيل قرار
    // صريح من SuperAdmin عبر نقطة تغيير الحالة.
    .run(id, b.name_ar, b.name_en, b.legal_name, b.contract_ref, 'Draft');
  audit(session.username, session.role, 'create', id, null, b, null);
  sendJSON(res, 201, { id });
});

/* ---- SaaS onboarding: create Partner + Property + Subscription in one call ---- */
on('POST', '/api/admin/onboard', ['SuperAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  // مُثبَت بإعادة إنتاج: بدون هذا التحقق، planCode المفقود يصل إلى الربط
  // فيرمي TypeError ويظهر كـ500 "Server error" بدل 400 مفهوم.
  requireFields(b, ['partnerNameAr', 'partnerNameEn', 'planCode']);
  const plan = db.prepare('SELECT * FROM plans WHERE code = ?').get(b.planCode);
  if (!plan) {
    // رسالة تُرشد المشغّل للسبب الحقيقي حين لا توجد باقات إطلاقًا -- وهي
    // الحالة الفعلية على البيئة المرفوعة (/api/plans رجعت [] فارغة).
    const total = db.prepare('SELECT COUNT(*) c FROM plans').get().c;
    return sendJSON(res, 400, {
      error: total === 0
        ? 'No plans exist yet — create a plan first (Plans screen), then onboard a partner'
        : 'Unknown plan code',
    });
  }
  const partnerId = uid('pt');
  db.prepare('INSERT INTO partners (id,name_ar,name_en,legal_name,contract_ref,status) VALUES (?,?,?,?,?,?)')
    .run(partnerId, b.partnerNameAr, b.partnerNameEn, b.legalName || b.partnerNameEn, b.contractRef || ('CNT-' + Date.now()), 'Draft');
  const propertyId = uid('prop');
  db.prepare(`INSERT INTO properties (id,partner_id,name_ar,name_en,timezone,address,status) VALUES (?,?,?,?,?,?,?)`)
    .run(propertyId, partnerId, b.propertyNameAr || b.partnerNameAr, b.propertyNameEn || b.partnerNameEn, 'Asia/Riyadh', b.address || '', 'Active');
  const now = Date.now();
  // P0-2: a property with no merchant and no outlet can never render a
  // catalog -- GET /api/catalog filters products by visible merchant, and
  // Unified Cart routes by outlet. Onboarding therefore provisions the
  // property's own Alnadl-operated merchant and default outlet, so the
  // first tenant is genuinely orderable rather than merely existing.
  const defaultMerchantId = uid('m');
  db.prepare(`INSERT INTO merchants (id,property_id,name_ar,name_en,kind,commission_rate,status) VALUES (?,?,?,?,'alnadl',0,'Active')`)
    .run(defaultMerchantId, propertyId, b.propertyNameAr || b.partnerNameAr, b.propertyNameEn || b.partnerNameEn);
  db.prepare(`INSERT INTO outlets (id,property_id,name_ar,name_en,type,operator,delivery_mode,sla_prep_min,sla_delivery_min,commission_rate,status,created_at)
              VALUES (?,?,?,?,'coffee','alnadl','runner',8,10,0,'Active',?)`)
    .run(uid('out'), propertyId, b.propertyNameAr || b.partnerNameAr, b.propertyNameEn || b.partnerNameEn, Date.now());

  db.prepare(`INSERT INTO subscriptions (id,partner_id,plan_id,status,started_at,renews_at) VALUES (?,?,?,?,?,?)`)
    .run(uid('sub'), partnerId, plan.id, 'Active', now, now + 30 * 86400000);
  audit(session.username, session.role, 'tenant_onboard', partnerId, null, { partnerId, propertyId, plan: plan.code }, null);
  sendJSON(res, 201, { partnerId, propertyId, plan: plan.code });
});

/* ---- SaaS plans/subscriptions ---- */
on('GET', '/api/plans', null, async (req, res) => {
  const rows = db.prepare('SELECT * FROM plans').all().map(p => ({ ...p, features: JSON.parse(p.features_json) }));
  sendJSON(res, 200, rows);
});
on('GET', '/api/admin/subscription', ['SuperAdmin', 'AlnadlFinance', 'PartnerViewer', 'PartnerAdmin'], async (req, res, p, query, session) => {
  const partnerId = query.partnerId;
  if (session.role === 'PartnerViewer' || session.role === 'PartnerAdmin') assertPartnerScope(session, partnerId);
  const sub = getSubscription(partnerId);
  if (!sub) return sendJSON(res, 404, { error: 'No subscription' });
  sendJSON(res, 200, sub);
});
on('POST', '/api/admin/subscription', ['SuperAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  const plan = db.prepare('SELECT * FROM plans WHERE code = ?').get(b.planCode);
  if (!plan) return sendJSON(res, 400, { error: 'Unknown plan code' });
  const before = getSubscription(b.partnerId);
  db.prepare(`INSERT INTO subscriptions (id,partner_id,plan_id,status,started_at,renews_at) VALUES (?,?,?,?,?,?)
              ON CONFLICT(partner_id) DO UPDATE SET plan_id=excluded.plan_id, status='Active', started_at=excluded.started_at, renews_at=excluded.renews_at`)
    .run(uid('sub'), b.partnerId, plan.id, 'Active', Date.now(), Date.now() + 30 * 86400000);
  audit(session.username, session.role, 'plan_change', b.partnerId, before, { plan: plan.code }, b.reason || null);
  sendJSON(res, 200, { partnerId: b.partnerId, plan: plan.code });
});

on('GET', '/api/admin/zones', ['SuperAdmin', 'SiteManager', 'PartnerAdmin'], async (req, res, p, query, session) => {
  let rows = db.prepare('SELECT * FROM zones').all();
  if (session.role === 'PartnerAdmin') rows = rows.filter(z => propertyPartnerId(z.property_id) === session.scope);
  sendJSON(res, 200, rows);
});
on('POST', '/api/admin/zones', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  assertTenantWrite(session, propertyPartnerId(b.propertyId));
  const id = uid('z');
  db.prepare("INSERT INTO zones (id,property_id,name_ar,name_en,type,status) VALUES (?,?,?,?,?,'Active')")
    .run(id, b.propertyId, b.name_ar, b.name_en, b.type);
  audit(session.username, session.role, 'create', id, null, b, null);
  sendJSON(res, 201, { id });
});

on('GET', '/api/admin/points', ['SuperAdmin', 'SiteManager', 'PartnerAdmin'], async (req, res, p, query, session) => {
  let points = db.prepare('SELECT * FROM points').all();
  if (session.role === 'PartnerAdmin') points = points.filter(pt => pointPartnerId(pt.id) === session.scope);
  for (const pt of points) pt.token = (db.prepare('SELECT token FROM qr_tokens WHERE point_id = ? AND active=1').get(pt.id) || {}).token;
  sendJSON(res, 200, points);
});
/* ---- G3: Zone lifecycle (Role Corrective R3) ------------------------------
   zones.status كان موجودًا في المخطط **وغير مُنفَّذ إطلاقًا** -- نفس نمط
   partners.status قبل R2: وسم بلا أثر.

   تدقيق العلاقات قبل التصميم (كما طُلب):
     * الطلب يحمل zone_id و point_id **بنفسه**، والطابور يقرأ عبر LEFT JOIN
       -> تعطيل منطقة **لا يكسر أي طلب قائم** ولا يُخفيه من KDS/Runner
     * رحلة الضيف تمرّ عبر point.active و qr.active، لا عبر zone.status
       -> فالإنفاذ يجب أن يُضاف صراحةً عند حلّ QR وإنشاء الطلب
     * لا Hard Delete إطلاقًا: حذف منطقة يقطع مرجع تاريخي في orders

   لذلك: نموذج حالة (Active/Inactive) بأثر Server-side على **الرحلات الجديدة
   فقط**، والتاريخ والطلبات المفتوحة تبقى سليمة تمامًا. */
on('PATCH', '/api/admin/zones/:id', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  const before = db.prepare('SELECT * FROM zones WHERE id = ?').get(p.id);
  if (!before) return sendJSON(res, 404, { error: 'Zone not found' });
  assertTenantWrite(session, zonePartnerId(p.id));

  const nextStatus = b.status !== undefined ? b.status : before.status;
  if (!['Active', 'Inactive'].includes(nextStatus)) {
    return sendJSON(res, 400, { error: 'status must be Active or Inactive' });
  }
  const nameAr = b.name_ar !== undefined ? String(b.name_ar).trim() : before.name_ar;
  const nameEn = b.name_en !== undefined ? String(b.name_en).trim() : before.name_en;
  if (!nameAr || !nameEn) return sendJSON(res, 400, { error: 'name_ar and name_en cannot be empty' });
  const type = b.type !== undefined ? b.type : before.type;

  db.prepare('UPDATE zones SET name_ar=?, name_en=?, type=?, status=? WHERE id=?')
    .run(nameAr, nameEn, type, nextStatus, p.id);
  audit(session.username, session.role, 'zone_update', p.id,
    { name_ar: before.name_ar, name_en: before.name_en, type: before.type, status: before.status },
    { name_ar: nameAr, name_en: nameEn, type, status: nextStatus }, b.reason || null);

  // ما لم يحدث عمدًا: لا حذف، ولا مساس بالنقاط أو الرموز أو الطلبات.
  // النقاط تبقى كما هي -- تعطيل المنطقة يمنع الرحلات الجديدة عبرها فقط.
  const openOrders = db.prepare(`
    SELECT COUNT(*) c FROM orders o JOIN points pt ON pt.id = o.point_id
    WHERE pt.zone_id = ? AND o.status NOT IN ('Delivered','Cancelled','Refunded','Delivery Failed')`).get(p.id).c;
  sendJSON(res, 200, { id: p.id, status: nextStatus, openOrdersUnaffected: openOrders });
});

on('POST', '/api/admin/points', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  assertTenantWrite(session, zonePartnerId(b.zoneId));
  const id = 'PT-' + crypto.randomBytes(2).toString('hex').toUpperCase();
  db.prepare('INSERT INTO points (id,zone_id,code,label,type,active) VALUES (?,?,?,?,?,1)')
    .run(id, b.zoneId, id, b.label, b.type);
  const token = crypto.randomBytes(6).toString('hex');
  db.prepare('INSERT INTO qr_tokens (id,point_id,token,active,created_at) VALUES (?,?,?,1,?)').run(uid('qr'), id, token, Date.now());
  audit(session.username, session.role, 'create', id, null, { ...b, token }, null);
  sendJSON(res, 201, { id, token });
});
/* ---- G2: Bulk QR generation (Role Corrective R3) --------------------------
   دليل النظام يَعِد صراحةً بـ«توليد بالجملة: حتى 50 رمزًا دفعة واحدة»،
   والمسار لم يكن موجودًا -- **وعد في الوثائق بما لا يوجد**، وهو أسوأ من
   نقص صامت لأن المشغّل يخطّط على أساسه.

   يُنفَّذ بنفس منطق الإنشاء المفرد حرفيًا (نفس شكل المُعرّف، نفس الرمز،
   نفس التدقيق) -- لا منطق موازٍ يمكن أن ينحرف عنه لاحقًا. الحد 50 من
   التوثيق نفسه، ويُفرض على الخادم لا على الواجهة. */
const BULK_POINTS_MAX = 50;

on('POST', '/api/admin/points/bulk', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  requireFields(b, ['zoneId', 'count']);
  const zone = db.prepare('SELECT id, status FROM zones WHERE id = ?').get(b.zoneId);
  if (!zone) return sendJSON(res, 404, { error: 'Zone not found' });
  assertTenantWrite(session, zonePartnerId(b.zoneId));

  const count = parseInt(b.count, 10);
  if (!Number.isFinite(count) || count < 1) return sendJSON(res, 400, { error: 'count must be at least 1' });
  if (count > BULK_POINTS_MAX) {
    return sendJSON(res, 400, { error: `count cannot exceed ${BULK_POINTS_MAX} per batch` });
  }
  // التسمية: بادئة + ترقيم متسلسل. تُنظَّف لأنها تظهر للضيف على الشاشة.
  const prefix = String(b.labelPrefix || b.prefix || 'Table').trim().slice(0, 24);
  if (!prefix) return sendJSON(res, 400, { error: 'labelPrefix cannot be empty' });
  const startAt = Number.isFinite(parseInt(b.startAt, 10)) ? parseInt(b.startAt, 10) : 1;
  const type = b.type || 'Table';

  const created = [];
  const now = Date.now();
  // معاملة واحدة: إما تُنشأ الدفعة كاملة أو لا شيء -- دفعة نصف مكتملة
  // تترك المشغّل يخمّن أي الرموز طُبع وأيها لم يُنشأ.
  db.exec('BEGIN');
  try {
    for (let i = 0; i < count; i++) {
      // تصادم المُعرّفات: النمط القائم 'PT-' + بايتين = 65,536 احتمالًا فقط،
      // وهو مقبول للإنشاء المفرد لكنه يفشل حتمًا في دفعات متتابعة (اكتشفه
      // اختبار count=50 على قاعدة تحمل نقاطًا سابقة). تُعاد المحاولة حتى
      // يُعثر على مُعرّف حرّ بدل إسقاط الدفعة كاملة على تصادم عشوائي.
      let id = null;
      for (let attempt = 0; attempt < 40 && !id; attempt++) {
        const candidate = 'PT-' + crypto.randomBytes(3).toString('hex').toUpperCase();
        if (!db.prepare('SELECT 1 FROM points WHERE id = ?').get(candidate)) id = candidate;
      }
      if (!id) throw new Error('could not allocate a unique point id');
      const label = `${prefix} ${startAt + i}`;
      db.prepare('INSERT INTO points (id,zone_id,code,label,type,active) VALUES (?,?,?,?,?,1)')
        .run(id, b.zoneId, id, label, type);
      const token = crypto.randomBytes(6).toString('hex');
      db.prepare('INSERT INTO qr_tokens (id,point_id,token,active,created_at) VALUES (?,?,?,1,?)')
        .run(uid('qr'), id, token, now);
      created.push({ id, label, token });
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return sendJSON(res, 500, { error: 'Bulk generation failed and was rolled back' });
  }
  audit(session.username, session.role, 'points_bulk_create', b.zoneId, null,
    { count, prefix, startAt, type, ids: created.map(c => c.id) }, null);
  sendJSON(res, 201, { zoneId: b.zoneId, count: created.length, points: created });
});

on('PATCH', '/api/admin/points/:id', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  assertTenantWrite(session, pointPartnerId(p.id));
  const before = db.prepare('SELECT active FROM points WHERE id=?').get(p.id);
  db.prepare('UPDATE points SET active=? WHERE id=?').run(b.active ? 1 : 0, p.id);
  audit(session.username, session.role, 'toggle_active', p.id, before, { active: b.active }, null);
  sendJSON(res, 200, { ok: true });
});

/* ------------------------------ QR: BULK GENERATE + ANALYTICS (§5) --------------------------------- */
on('POST', '/api/admin/qr/bulk', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  assertTenantWrite(session, zonePartnerId(b.zoneId));
  const count = Math.min(50, Math.max(1, parseInt(b.count) || 1)); // sane cap for a single bulk batch
  const qrType = ['table', 'office', 'room', 'zone', 'counter_pickup'].includes(b.type) ? b.type : 'table';
  const created = [];
  for (let i = 0; i < count; i++) {
    const id = 'PT-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const label = b.labelPrefix ? `${b.labelPrefix} ${i + 1}` : `${qrType} ${i + 1}`;
    db.prepare('INSERT INTO points (id,zone_id,code,label,type,active) VALUES (?,?,?,?,?,1)').run(id, b.zoneId, id, label, qrType);
    const token = crypto.randomBytes(6).toString('hex');
    db.prepare('INSERT INTO qr_tokens (id,point_id,token,active,created_at,qr_type) VALUES (?,?,?,1,?,?)').run(uid('qr'), id, token, Date.now(), qrType);
    created.push({ id, token, label });
  }
  audit(session.username, session.role, 'qr_bulk_generate', b.zoneId, null, { count, type: qrType }, null);
  sendJSON(res, 201, { created, count: created.length });
});

on('GET', '/api/admin/qr/:pointId/analytics', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  assertTenantWrite(session, pointPartnerId(p.pointId));
  const tokenRow = db.prepare('SELECT token FROM qr_tokens WHERE point_id = ? ORDER BY created_at DESC LIMIT 1').get(p.pointId);
  if (!tokenRow) return sendJSON(res, 404, { error: 'No QR token for this point' });
  const events = db.prepare('SELECT * FROM qr_analytics_events WHERE token = ? ORDER BY ts DESC').all(tokenRow.token);
  const scans = events.filter(e => e.event_type === 'scan');
  const orders = events.filter(e => e.event_type === 'order');
  const orderIds = orders.map(o => o.order_id).filter(Boolean);
  const paidOrders = orderIds.length ? db.prepare(`SELECT id, total, status FROM orders WHERE id IN (${orderIds.map(() => '?').join(',')}) AND status NOT IN ('Cancelled','Failed')`).all(...orderIds) : [];
  const totalSales = paidOrders.reduce((s, o) => s + (o.total || 0), 0);
  sendJSON(res, 200, {
    scans: scans.length, orders: orders.length,
    conversionRate: scans.length ? Math.round((orders.length / scans.length) * 1000) / 10 : 0,
    lastScan: scans[0] ? scans[0].ts : null, lastOrder: orders[0] ? orders[0].ts : null,
    totalSales: Math.round(totalSales * 100) / 100,
  });
});

/* ------------------------------ ADMIN: catalog --------------------------------- */
on('GET', '/api/admin/categories', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, query, session) => {
  let rows = db.prepare('SELECT * FROM categories').all();
  if (session.role === 'PartnerAdmin') rows = rows.filter(c => propertyPartnerId(c.property_id) === session.scope);
  sendJSON(res, 200, rows);
});
on('POST', '/api/admin/categories', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  assertTenantWrite(session, propertyPartnerId(b.propertyId));
  const id = uid('cat');
  db.prepare("INSERT INTO categories (id,property_id,name_ar,name_en,sort_order,status) VALUES (?,?,?,?,?,'Active')")
    .run(id, b.propertyId, b.name_ar, b.name_en, b.sortOrder || 0);
  audit(session.username, session.role, 'create', id, null, b, null);
  sendJSON(res, 201, { id });
});
on('GET', '/api/admin/products', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, query, session) => {
  let rows = db.prepare('SELECT * FROM products').all();
  if (session.role === 'PartnerAdmin') rows = rows.filter(pr => productPartnerId(pr.id) === session.scope);
  sendJSON(res, 200, rows);
});
on('POST', '/api/admin/products', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  assertTenantWrite(session, categoryPartnerId(b.categoryId));
  const id = uid('p');
  // Default to the property's first Outlet if none specified (§17 backward
  // compatibility — admin catalog UI doesn't ask for an outlet yet, so every
  // product still needs to land in a valid one for Unified Cart to route it).
  const category = db.prepare('SELECT property_id FROM categories WHERE id = ?').get(b.categoryId);
  let outletId = b.outletId || null;
  if (!outletId) {
    const fallbackOutlet = category ? db.prepare(`SELECT id FROM outlets WHERE property_id = ? ORDER BY created_at ASC LIMIT 1`).get(category.property_id) : null;
    outletId = fallbackOutlet ? fallbackOutlet.id : null;
  }
  // P0-2: merchant_id was never defaulted, and GET /api/catalog filters
  // products by visible merchant -- so a product created through the admin
  // API was invisible to guests even though ordering it directly worked.
  // Caught by the onboarding test, not by review. Defaults to the
  // property's own Alnadl-operated merchant, the same fallback shape
  // already used for outlets above.
  let merchantId = b.merchantId || null;
  if (!merchantId && category) {
    const fallbackMerchant = db.prepare(`SELECT id FROM merchants WHERE property_id = ? AND kind = 'alnadl' AND status = 'Active' ORDER BY rowid ASC LIMIT 1`).get(category.property_id)
      || db.prepare(`SELECT id FROM merchants WHERE property_id = ? AND status = 'Active' ORDER BY rowid ASC LIMIT 1`).get(category.property_id);
    merchantId = fallbackMerchant ? fallbackMerchant.id : null;
  }
  // UX-1: imageUrl is optional and URL-based (a link to an already-hosted
  // image — a real file-upload/storage pipeline is a separate, much
  // larger piece of infrastructure this delivery does not build). A
  // product with no image set still renders correctly via the UX-0
  // monogram fallback on the guest side.
  db.prepare("INSERT INTO products (id,category_id,merchant_id,outlet_id,sku,name_ar,name_en,base_price,image_url,status) VALUES (?,?,?,?,?,?,?,?,?,'Active')")
    .run(id, b.categoryId, merchantId, outletId, b.sku || id, b.name_ar, b.name_en, b.basePrice, b.imageUrl || null);
  audit(session.username, session.role, 'create', id, null, b, null);
  sendJSON(res, 201, { id });
});
on('PATCH', '/api/admin/products/:id', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  assertTenantWrite(session, productPartnerId(p.id));
  const before = db.prepare('SELECT status, image_url FROM products WHERE id=?').get(p.id);
  if (!before) return sendJSON(res, 404, { error: 'Product not found' });
  const nextStatus = b.status !== undefined ? b.status : before.status;
  const nextImageUrl = b.imageUrl !== undefined ? (b.imageUrl || null) : before.image_url;
  db.prepare('UPDATE products SET status=?, image_url=? WHERE id=?').run(nextStatus, nextImageUrl, p.id);
  audit(session.username, session.role, 'update', p.id, before, { status: nextStatus, imageUrl: nextImageUrl }, null);
  sendJSON(res, 200, { ok: true });
});

/* ------------------------------ PARTNER overview --------------------------------- */
on('GET', '/api/partner/overview', ['PartnerViewer', 'PartnerAdmin', 'SuperAdmin', 'AlnadlFinance'], async (req, res, p, query, session) => {
  const partnerId = query.partnerId;
  if (session.role === 'PartnerViewer' || session.role === 'PartnerAdmin') { assertPartnerScope(session, partnerId); requireFeature(partnerId, 'partnerDashboard'); }
  const orders = db.prepare(`SELECT * FROM orders WHERE partner_id = ?`).all(partnerId);
  const delivered = orders.filter(o => o.status === 'Delivered');
  const gross = delivered.reduce((s, o) => s + o.total, 0);
  const aov = orders.length ? orders.reduce((s, o) => s + o.total, 0) / orders.length : 0;
  const zoneCounts = {};
  for (const o of orders) {
    const zone = db.prepare('SELECT name_ar,name_en FROM zones WHERE id=?').get(o.zone_id);
    if (zone) { const key = zone.name_en; zoneCounts[key] = (zoneCounts[key] || 0) + 1; }
  }
  const topZones = Object.entries(zoneCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([zone, count]) => ({ zone, count }));

  // Cross-Outlet Basket Rate (§14) — % of orders that genuinely spanned more
  // than one outlet (i.e. have child_orders), a real product metric that only
  // became meaningful once Unified Cart existed.
  const ordersWithChildren = orders.filter(o => db.prepare('SELECT COUNT(*) c FROM child_orders WHERE parent_order_id = ?').get(o.id).c > 0);
  const crossOutletBasketRate = orders.length ? round2((ordersWithChildren.length / orders.length) * 100) : 0;

  // Per-outlet performance breakdown, from the Revenue Ledger (§10) — the
  // authoritative record of what was actually allocated, not re-derived
  // from raw order totals.
  const outlets = db.prepare('SELECT * FROM outlets WHERE property_id IN (SELECT id FROM properties WHERE partner_id = ?)').all(partnerId);
  const outletPerformance = outlets.map(o => {
    const ledgerRows = db.prepare('SELECT * FROM revenue_ledger WHERE outlet_id = ?').all(o.id);
    const orderIds = [...new Set(ledgerRows.map(r => r.order_id))];
    const grossTotal = ledgerRows.reduce((s, r) => s + r.gross_amount, 0);
    const partnerTotal = ledgerRows.reduce((s, r) => s + r.partner_amount, 0);
    const alnadlTotal = ledgerRows.reduce((s, r) => s + r.alnadl_amount, 0);
    // Average feedback rating for orders that included this outlet
    const stars = orderIds.length
      ? db.prepare(`SELECT AVG(stars) avg FROM feedback WHERE order_id IN (${orderIds.map(() => '?').join(',') || "''"})`).get(...orderIds).avg
      : null;
    return {
      outletId: o.id, name_ar: o.name_ar, name_en: o.name_en, type: o.type,
      orders: orderIds.length, gross: round2(grossTotal), partnerAmount: round2(partnerTotal), alnadlAmount: round2(alnadlTotal),
      avgRating: stars ? round2(stars) : null,
    };
  }).sort((a, b) => b.gross - a.gross);

  sendJSON(res, 200, { grossSales: round2(gross), orders: orders.length, aov: round2(aov), topZones, crossOutletBasketRate, outletPerformance, ...partnerDecisionLayers(partnerId, orders, delivered, outletPerformance) });
});

/* ---------------------------------------------------------------------------
   UX-3 (spec §8 "Partner Dashboard — Decision UX"): the overview above
   answered "what are my totals?" but not the spec's actual question --
   "How are my locations performing and what needs attention?". Every
   value below is computed from data this system genuinely already
   records (fulfillment timestamps, feedback rows, refunds, settlements,
   points.active, outlets.sla_prep_min) -- nothing here is invented or
   estimated. Where a signal genuinely cannot be computed from existing
   data, it is omitted entirely rather than faked.

   Partner privacy (§8 "Partner privacy rule"): this function only ever
   reads rows already scoped to THIS partnerId (the caller has already
   passed assertPartnerScope above), and returns only aggregates the
   partner is entitled to. It never touches Engage internals, mechanic
   reasoning, AI payloads, or any other tenant's rows.
--------------------------------------------------------------------------- */
function partnerDecisionLayers(partnerId, orders, delivered, outletPerformance) {
  const now = Date.now();
  const DAY = 86400000;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  // ---- Today snapshot (spec: "Gross sales, orders, AOV, service SLA, rating, active outlets, current incidents") ----
  const todayOrders = orders.filter(o => o.created_at >= todayMs);
  const todayDelivered = todayOrders.filter(o => o.status === 'Delivered');
  const todayGross = todayDelivered.reduce((s, o) => s + o.total, 0);
  const todayAov = todayOrders.length ? todayOrders.reduce((s, o) => s + o.total, 0) / todayOrders.length : 0;

  /* ---- Service SLA (corrective round) ----------------------------------
     Two real problems in the first version, both confirmed against the
     schema before fixing:

     1) MULTI-OUTLET CORRECTNESS. The old lookup ended in `LIMIT 1`, so an
        order spanning several outlets was judged against whichever
        outlet's sla_prep_min happened to come back first -- a 4-minute
        coffee budget could silently be applied to an order that also
        contained a 20-minute kitchen item, or vice versa. There is also
        no per-child timing to fix this with: `fulfillment` is keyed by
        order_id ONLY, and `child_orders` carries no accepted_at/ready_at
        columns at all. So a genuinely correct per-outlet SLA for a split
        order is NOT COMPUTABLE from the data that exists today.

        Rather than keep quietly producing a wrong number, multi-outlet
        orders are now EXCLUDED from the SLA calculation and counted
        separately (slaExcludedMultiOutlet), which the UI states openly.
        For single-outlet orders -- where the measurement is genuinely
        sound -- the budget now comes from the MAX sla_prep_min across the
        order's items rather than an arbitrary first row, so even a
        single-outlet order with mixed item sourcing is judged against the
        slowest thing in it, never a luckier one.

     2) "TODAY" HONESTY. The value was labelled "today" but computed over
        the partner's ENTIRE order history. Both SLA and rating are now
        genuinely windowed to today, and the all-time figures are
        returned alongside them under explicit names so the UI can label
        each correctly instead of one masquerading as the other.
  --------------------------------------------------------------------- */
  function slaStatsFor(orderList) {
    let met = 0, total = 0, excludedMultiOutlet = 0;
    for (const o of orderList) {
      const f = db.prepare('SELECT accepted_at, ready_at FROM fulfillment WHERE order_id = ?').get(o.id);
      if (!f || !f.ready_at) continue; // no recorded timing -- never assumed
      const childCount = db.prepare('SELECT COUNT(*) c FROM child_orders WHERE parent_order_id = ?').get(o.id).c;
      if (childCount > 0) { excludedMultiOutlet++; continue; } // see note above
      const startedAt = f.accepted_at || o.created_at;
      const budgetRow = db.prepare(`SELECT MAX(ou.sla_prep_min) AS budget FROM order_items oi JOIN outlets ou ON ou.id = oi.outlet_id WHERE oi.order_id = ?`).get(o.id);
      const budgetMin = (budgetRow && budgetRow.budget) || DEFAULT_SLA_PREP_MIN;
      total++;
      if ((f.ready_at - startedAt) / 60000 <= budgetMin) met++;
    }
    return { percent: total ? round2((met / total) * 100) : null, measured: total, excludedMultiOutlet };
  }
  const slaToday = slaStatsFor(todayOrders);
  const slaAllTime = slaStatsFor(orders);

  function ratingStatsFor(orderList) {
    const ids = orderList.map(o => o.id);
    if (!ids.length) return { avg: null, count: 0 };
    const row = db.prepare(`SELECT AVG(stars) avg, COUNT(*) c FROM feedback WHERE order_id IN (${ids.map(() => '?').join(',')})`).get(...ids);
    return { avg: row.avg ? round2(row.avg) : null, count: row.c };
  }
  const ratingToday = ratingStatsFor(todayOrders);
  const ratingAllTime = ratingStatsFor(orders);

  const orderIdsAll = orders.map(o => o.id);
  const activeOutlets = db.prepare(`SELECT COUNT(*) c FROM outlets WHERE status='Active' AND property_id IN (SELECT id FROM properties WHERE partner_id = ?)`).get(partnerId).c;

  // ---- Attention (spec: "SLA breaches, offline/disabled points, unusual refunds, low rating, settlement issue") ----
  const attention = [];

  // Open SLA breaches use the same MAX-budget rule as above. Multi-outlet
  // orders are included here deliberately and correctly: "has this order
  // been sitting past the slowest budget any of its outlets committed to"
  // is a sound question even without per-child timings, because it reads
  // the parent's own created_at, not a per-outlet completion time.
  const openBreaches = orders.filter(o => {
    if (!['Paid', 'Accepted', 'Preparing'].includes(o.status)) return false;
    const budgetRow = db.prepare(`SELECT MAX(ou.sla_prep_min) AS budget FROM order_items oi JOIN outlets ou ON ou.id = oi.outlet_id WHERE oi.order_id = ?`).get(o.id);
    const budgetMin = (budgetRow && budgetRow.budget) || DEFAULT_SLA_PREP_MIN;
    return (now - o.created_at) / 60000 > budgetMin;
  }).length;
  if (openBreaches > 0) attention.push({ kind: 'sla_breach', severity: 'high', count: openBreaches });

  const disabledPoints = db.prepare(`SELECT COUNT(*) c FROM points WHERE active = 0 AND zone_id IN (SELECT id FROM zones WHERE property_id IN (SELECT id FROM properties WHERE partner_id = ?))`).get(partnerId).c;
  if (disabledPoints > 0) attention.push({ kind: 'disabled_points', severity: 'medium', count: disabledPoints });

  /* Refunds (corrective round): the spec's wording is "unusual refunds",
     but the first version raised this on ANY refund at all and merely
     labelled it "refunds in 7 days" -- which is a plain activity report,
     not an exception worth a partner's attention. There is now a real
     threshold with a defensible definition: refunds in the last 7 days
     are flagged only when they exceed REFUND_ATTENTION_RATE of the same
     period's delivered gross. The rate and the period's gross are both
     returned so the UI can state WHY it fired rather than just that it
     did. Below the threshold, nothing is raised -- a routine refund is
     not an incident. */
  const refundRows = orderIdsAll.length
    ? db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) total FROM refunds WHERE order_id IN (${orderIdsAll.map(() => '?').join(',')}) AND created_at >= ?`).get(...orderIdsAll, now - 7 * DAY)
    : { c: 0, total: 0 };
  const gross7d = delivered.filter(o => o.created_at >= now - 7 * DAY).reduce((s, o) => s + o.total, 0);
  if (refundRows.c > 0 && gross7d > 0) {
    const refundRate = round2((refundRows.total / gross7d) * 100);
    if (refundRate >= REFUND_ATTENTION_RATE) {
      attention.push({ kind: 'refunds_elevated', severity: 'medium', count: refundRows.c, amount: round2(refundRows.total), ratePercent: refundRate, thresholdPercent: REFUND_ATTENTION_RATE });
    }
  }

  if (ratingAllTime.avg != null && ratingAllTime.avg < 3.5 && ratingAllTime.count >= 3) {
    attention.push({ kind: 'low_rating', severity: 'high', value: ratingAllTime.avg, ratingCount: ratingAllTime.count });
  }

  const disputed = db.prepare(`SELECT COUNT(*) c FROM settlements WHERE partner_id = ? AND status = 'Disputed'`).get(partnerId).c;
  if (disputed > 0) attention.push({ kind: 'settlement_disputed', severity: 'high', count: disputed });

  // ---- Performance (spec: "Top/bottom outlet, top/bottom zone, trend vs prior comparable period") ----
  const ranked = outletPerformance.filter(o => o.orders > 0);
  const topOutlet = ranked.length ? ranked[0] : null;
  const bottomOutlet = ranked.length > 1 ? ranked[ranked.length - 1] : null;

  // Bottom zone (corrective round): the spec asks for "top/bottom zone"
  // and topZones was already computed by the caller from real order
  // counts -- the bottom simply was not being surfaced. Only meaningful
  // with at least two zones to compare, so it stays null below that.
  const zoneCounts = {};
  for (const o of orders) {
    const zone = db.prepare('SELECT name_ar,name_en FROM zones WHERE id=?').get(o.zone_id);
    if (zone) { const key = zone.name_en; zoneCounts[key] = (zoneCounts[key] || 0) + 1; }
  }
  const zonesRanked = Object.entries(zoneCounts).sort((a, b) => b[1] - a[1]).map(([zone, count]) => ({ zone, count }));
  const topZone = zonesRanked.length ? zonesRanked[0] : null;
  const bottomZone = zonesRanked.length > 1 ? zonesRanked[zonesRanked.length - 1] : null;

  const last7 = delivered.filter(o => o.created_at >= now - 7 * DAY).reduce((s, o) => s + o.total, 0);
  const prev7 = delivered.filter(o => o.created_at >= now - 14 * DAY && o.created_at < now - 7 * DAY).reduce((s, o) => s + o.total, 0);
  // Only report a trend when there is a genuine prior period to compare
  // against -- a "+100%" against zero baseline would be meaningless.
  const trendPercent = prev7 > 0 ? round2(((last7 - prev7) / prev7) * 100) : null;

  // ---- Money (spec: "Partner share, pending settlement, refunds/discounts, next settlement") ----
  const partnerShareTotal = outletPerformance.reduce((s, o) => s + o.partnerAmount, 0);
  const pendingSettlements = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(partner_share),0) total FROM settlements WHERE partner_id = ? AND status NOT IN ('Paid')`).get(partnerId);
  const discountsTotal = orders.reduce((s, o) => s + (o.discount_amount || 0), 0);
  const refundsAllTime = orderIdsAll.length
    ? db.prepare(`SELECT COALESCE(SUM(amount),0) total FROM refunds WHERE order_id IN (${orderIdsAll.map(() => '?').join(',')})`).get(...orderIdsAll).total
    : 0;

  /* Next settlement (corrective round): the spec asks for it, and the
     data DOES support a real answer -- the oldest not-yet-Paid settlement
     is genuinely the next one due, with its real period and workflow
     status. What this system has NO data for is a scheduled future
     settlement DATE (there is no billing-cycle/next-run-date column
     anywhere), so no date is invented; the UI shows the period and where
     it currently sits in the Draft->Reviewed->Approved->Paid workflow.
     When nothing is outstanding, this is null and the UI says so. */
  const nextSettlement = db.prepare(`SELECT id, period, partner_share, status FROM settlements WHERE partner_id = ? AND status != 'Paid' ORDER BY created_at ASC LIMIT 1`).get(partnerId) || null;

  return {
    today: {
      grossSales: round2(todayGross), orders: todayOrders.length, aov: round2(todayAov),
      slaPercent: slaToday.percent, slaMeasured: slaToday.measured, slaExcludedMultiOutlet: slaToday.excludedMultiOutlet,
      avgRating: ratingToday.avg, ratingCount: ratingToday.count,
      activeOutlets, openIncidents: attention.filter(a => a.severity === 'high').length,
    },
    allTime: {
      slaPercent: slaAllTime.percent, slaMeasured: slaAllTime.measured, slaExcludedMultiOutlet: slaAllTime.excludedMultiOutlet,
      avgRating: ratingAllTime.avg, ratingCount: ratingAllTime.count,
    },
    attention,
    performance: { topOutlet, bottomOutlet, topZone, bottomZone, trendPercent, last7Gross: round2(last7), prev7Gross: round2(prev7) },
    money: {
      partnerShare: round2(partnerShareTotal),
      pendingSettlementCount: pendingSettlements.c, pendingSettlementAmount: round2(pendingSettlements.total),
      discounts: round2(discountsTotal), refunds: round2(refundsAllTime),
      nextSettlement: nextSettlement ? { period: nextSettlement.period, amount: round2(nextSettlement.partner_share), status: nextSettlement.status } : null,
    },
  };
}
function round2(n) { return Math.round(n * 100) / 100; }

/* ------------------------------ SETTLEMENT (quick preview, does not persist) --------------------------------- */
// This is a read-only calculator for a quick number check. The persisted,
// stateful settlement record with its Draft→...→Paid workflow lives under
// /api/admin/settlements below — use that for anything that needs to be
// approved, disputed, or paid.
on('GET', '/api/settlement', ['PartnerViewer', 'PartnerAdmin', 'AlnadlFinance', 'SuperAdmin'], async (req, res, p, query, session) => {
  const partnerId = query.partnerId;
  if (session.role === 'PartnerViewer' || session.role === 'PartnerAdmin') assertPartnerScope(session, partnerId);
  const period = query.period || new Date().toISOString().slice(0, 7);
  const calc = computeSettlement(partnerId, period);
  sendJSON(res, 200, calc);
});

/* ------------------------------ AUDIT LOG --------------------------------- */
on('GET', '/api/audit', ['SuperAdmin', 'AlnadlFinance'], async (req, res, p, query) => {
  const limit = Math.min(500, parseInt(query.limit) || 100);
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?').all(limit);
  sendJSON(res, 200, rows);
});

/* ------------------------------ PROMOTIONS --------------------------------- */
on('GET', '/api/promotions/validate', null, async (req, res, p, query) => {
  const now = Date.now();
  const promo = db.prepare(`SELECT * FROM promotions WHERE code = ? AND property_id = ? AND active = 1 AND valid_from <= ? AND valid_to >= ?`)
    .get((query.code || '').toUpperCase(), query.propertyId, now, now);
  if (!promo) return sendJSON(res, 404, { valid: false });
  sendJSON(res, 200, { valid: true, code: promo.code, discountType: promo.discount_type, discountValue: promo.discount_value });
});

/* ------------------------------ FEEDBACK (C08) --------------------------------- */
on('POST', '/api/orders/:id/feedback', null, async (req, res, p) => {
  const body = await readBody(req);
  const order = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(p.id);
  if (!order) return sendJSON(res, 404, { error: 'Order not found' });
  if (order.status !== 'Delivered') return sendJSON(res, 409, { error: 'Feedback is only accepted after delivery' });
  db.prepare(`INSERT INTO feedback (id,order_id,stars,tags_json,comment,created_at) VALUES (?,?,?,?,?,?)`)
    .run(uid('fb'), p.id, Math.max(1, Math.min(5, parseInt(body.stars) || 5)), JSON.stringify(body.tags || []), body.comment || '', Date.now());
  sendJSON(res, 201, { ok: true });
});

/* ------------------------------ NOTIFICATIONS LOG (§16) --------------------------------- */
on('GET', '/api/admin/notifications', ['SuperAdmin', 'SiteManager', 'AlnadlFinance'], async (req, res, p, query) => {
  const limit = Math.min(500, parseInt(query.limit) || 100);
  sendJSON(res, 200, db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?').all(limit));
});

/* ------------------------------ M01: SITE MANAGER LIVE DASHBOARD --------------------------------- */
on('GET', '/api/manager/live', ['SiteManager', 'Operator', 'SuperAdmin'], async (req, res, p, query) => {
  const propertyId = query.propertyId;
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const todayOrders = db.prepare(`SELECT * FROM orders WHERE property_id = ? AND created_at >= ?`).all(propertyId, dayStart.getTime());
  const salesToday = todayOrders.filter(o => o.status !== 'Cancelled' && o.status !== 'Failed').reduce((s, o) => s + o.total, 0);
  const counts = { New: 0, Preparing: 0, Ready: 0, Delayed: 0 };
  const now = Date.now();
  for (const o of todayOrders) {
    if (o.status === 'Paid') counts.New++;
    else if (['Accepted', 'Preparing'].includes(o.status)) counts.Preparing++;
    else if (['Ready', 'Out for Delivery'].includes(o.status)) counts.Ready++;
    if (['Paid', 'Accepted', 'Preparing'].includes(o.status) && now - o.created_at > 8 * 60000) counts.Delayed++;
  }
  const delivered = todayOrders.filter(o => o.status === 'Delivered');
  const fulfillments = delivered.map(o => db.prepare('SELECT * FROM fulfillment WHERE order_id = ?').get(o.id)).filter(Boolean);
  const avgPrep = fulfillments.length ? fulfillments.reduce((s, f) => s + ((f.ready_at || 0) - (f.accepted_at || f.preparing_at || f.ready_at)), 0) / fulfillments.length / 60000 : 0;
  const avgDelivery = fulfillments.length ? fulfillments.reduce((s, f) => s + ((f.delivered_at || 0) - (f.ready_at || f.delivered_at)), 0) / fulfillments.length / 60000 : 0;
  const zoneCounts = {};
  for (const o of todayOrders) { const z = db.prepare('SELECT name_en FROM zones WHERE id=?').get(o.zone_id); if (z) zoneCounts[z.name_en] = (zoneCounts[z.name_en] || 0) + 1; }
  const topZone = Object.entries(zoneCounts).sort((a, b) => b[1] - a[1])[0];
  sendJSON(res, 200, {
    salesToday: Math.round(salesToday * 100) / 100, ordersToday: todayOrders.length, counts,
    avgPrepMin: Math.round(avgPrep * 10) / 10, avgDeliveryMin: Math.round(avgDelivery * 10) / 10,
    topZone: topZone ? topZone[0] : null,
  });
});

/* ------------------------------ A01: PORTFOLIO DASHBOARD (SuperAdmin) --------------------------------- */
on('GET', '/api/admin/portfolio', ['SuperAdmin'], async (req, res) => {
  const partners = db.prepare('SELECT * FROM partners').all();
  const sites = partners.map(pt => {
    const orders = db.prepare('SELECT * FROM orders WHERE partner_id = ?').all(pt.id);
    const gmv = orders.filter(o => o.status === 'Delivered').reduce((s, o) => s + o.total, 0);
    return { partnerId: pt.id, name_ar: pt.name_ar, name_en: pt.name_en, gmv: Math.round(gmv * 100) / 100, orders: orders.length };
  });
  const totalGmv = sites.reduce((s, x) => s + x.gmv, 0);
  const totalOrders = sites.reduce((s, x) => s + x.orders, 0);
  const sorted = [...sites].sort((a, b) => b.gmv - a.gmv);
  const alerts = db.prepare(`SELECT COUNT(*) c FROM orders WHERE status IN ('Paid','Accepted','Preparing') AND created_at < ?`).get(Date.now() - 8 * 60000).c;
  sendJSON(res, 200, { totalGmv: Math.round(totalGmv * 100) / 100, sites: sites.length, totalOrders, topSite: sorted[0] || null, lowestSite: sorted[sorted.length - 1] || null, alerts, bySite: sorted });
});

/* ------------------------------ A05: USERS & ROLES --------------------------------- */
on('GET', '/api/admin/users', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, query, session) => {
  let rows = db.prepare('SELECT id,username,role,partner_scope,active,last_login,created_at FROM users').all();
  if (session.role === 'PartnerAdmin') rows = rows.filter(u => u.partner_scope === session.scope);
  sendJSON(res, 200, rows);
});
/* --------- IDENTITY & ACCESS MANAGEMENT (Role Corrective §3.1/§3.2) --------
   ما تغيّر ولماذا: كان الإنشاء ينفّذ hashPbkdf2(b.username) ويُعيد ملاحظة
   بأن كلمة المرور هي اسم المستخدم. عمليًا ذلك يعني أن كلمة مرور كل حساب
   معروفة لأي شخص يعرف اسمه -- ثغرة إنتاج، لا عيب تجربة.

   الآن: يُنشأ الحساب بلا كلمة مرور إطلاقًا (password_hash = NULL) وبحالة
   pending_activation، فلا يستطيع الدخول. يُصدَر رمز تفعيل لمرة واحدة
   يُعاد **مرة واحدة فقط** لينسخه المسؤول (§3.1: لا مزوّد خارجي في هذه
   الجولة)، والمستخدم وحده يعيّن كلمة مروره. لا يعرف المسؤول كلمة المرور
   النهائية في أي لحظة. */
on('POST', '/api/admin/users', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  requireFields(b, ['username', 'role']);
  const username = String(b.username).trim();
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) return sendJSON(res, 400, { error: 'username must be 3-32 chars: letters, digits, . _ -' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return sendJSON(res, 409, { error: 'Username already exists' });

  // النطاق يُفرض من الخادم: PartnerAdmin لا يستطيع إنشاء مستخدم خارج شريكه
  // مهما أرسل في الجسم (§3.2: الواجهة ليست مصدر ثقة).
  const partnerScope = session.role === 'PartnerAdmin' ? session.scope : (b.partner_scope || null);
  assertCanManageUser(session, null, { role: b.role, partner_scope: partnerScope });

  const id = uid('u');
  db.prepare(`INSERT INTO users (id,username,password_hash,role,partner_scope,active,created_at,status)
              VALUES (?,?,NULL,?,?,1,?,'pending_activation')`)
    .run(id, username, b.role, partnerScope, Date.now());
  const { token, expiresAt } = issueActivationToken(id, session.username);
  audit(session.username, session.role, 'user_create', id, null,
    { username, role: b.role, partner_scope: partnerScope, status: 'pending_activation' }, null);
  // الرمز الصريح يُعاد هنا فقط، ولا يُخزَّن ولا يُسجَّل ولا يمكن استرجاعه.
  sendJSON(res, 201, { id, username, status: 'pending_activation', activationToken: token, expiresAt });
});

/* إعادة إصدار رمز تفعيل / استعادة وصول دون كشف كلمة مرور (§3.1). */
on('POST', '/api/admin/users/:id/activation', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(p.id);
  if (!target) return sendJSON(res, 404, { error: 'Not found' });
  assertCanManageUser(session, target, null);
  const { token, expiresAt } = issueActivationToken(target.id, session.username);
  // إعادة التعيين تُعيد الحساب لحالة الانتظار وتُبطل كلمة المرور الحالية،
  // فلا يبقى وصول قديم صالحًا بعد طلب الاستعادة.
  db.prepare(`UPDATE users SET status='pending_activation', password_hash=NULL WHERE id=?`).run(target.id);
  audit(session.username, session.role, 'user_activation_reissued', target.id,
    { status: target.status }, { status: 'pending_activation' }, null);
  sendJSON(res, 200, { activationToken: token, expiresAt });
});

/* التفعيل نفسه: عامّ عمدًا -- المستخدم لا يملك حسابًا يسجّل به بعد.
   الرمز هو الإثبات الوحيد، وهو لمرة واحدة ومنتهي الصلاحية. */
on('GET', '/api/activate/:token', null, async (req, res, p) => {
  const found = peekActivation(p.token);
  // لا يُكشف سبب الرفض: رمز خاطئ ومنتهٍ ومستهلَك كلها استجابة واحدة.
  if (!found) return sendJSON(res, 200, { valid: false });
  sendJSON(res, 200, { valid: true, username: found.user.username, role: found.user.role });
});

on('POST', '/api/activate/:token', null, async (req, res, p) => {
  const b = await readBody(req);
  const result = consumeActivation(p.token, b.password, hashPbkdf2);
  if (!result.ok) {
    return sendJSON(res, 400, {
      error: result.reason === 'weak_password'
        ? `Password must be at least ${result.minLength} characters`
        : 'This activation link is invalid, expired, or already used',
    });
  }
  audit(result.username, 'System', 'user_activated', result.userId, { status: 'pending_activation' }, { status: 'active' }, null);
  sendJSON(res, 200, { ok: true, username: result.username });
});
/* تعديل مستخدم: الدور والنطاق والحالة -- كان يغيّر active فقط (§3.1).
   كل مسار هنا يمرّ بفحص عدم التصعيد وحماية آخر SuperAdmin. */
on('PATCH', '/api/admin/users/:id', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(p.id);
  if (!target) return sendJSON(res, 404, { error: 'Not found' });

  const intended = {};
  if (b.role !== undefined) intended.role = b.role;
  if (b.partner_scope !== undefined) intended.partner_scope = b.partner_scope;
  assertCanManageUser(session, target, intended);

  const nextRole  = b.role !== undefined ? b.role : target.role;
  const nextScope = b.partner_scope !== undefined ? b.partner_scope : target.partner_scope;
  let nextStatus = target.status;
  let nextActive = target.active;
  if (b.status !== undefined) {
    if (!['active', 'suspended'].includes(b.status)) return sendJSON(res, 400, { error: 'status must be active or suspended' });
    // لا يُقفز على التفعيل: حساب لم يُفعّل بعد لا يصبح active بضغطة إدارية.
    if (b.status === 'active' && target.status === 'pending_activation') {
      return sendJSON(res, 409, { error: 'User has not activated yet — reissue an activation link instead' });
    }
    nextStatus = b.status;
    nextActive = b.status === 'active' ? 1 : 0;
  } else if (b.active !== undefined) {
    nextActive = b.active ? 1 : 0;
    if (target.status !== 'pending_activation') nextStatus = b.active ? 'active' : 'suspended';
  }

  assertNotLastSuperAdmin(target, { role: nextRole, status: nextStatus, active: nextActive });

  db.prepare('UPDATE users SET role=?, partner_scope=?, status=?, active=? WHERE id=?')
    .run(nextRole, nextScope, nextStatus, nextActive, p.id);
  audit(session.username, session.role, 'user_update', p.id,
    { role: target.role, partner_scope: target.partner_scope, status: target.status, active: target.active },
    { role: nextRole, partner_scope: nextScope, status: nextStatus, active: nextActive }, null);
  sendJSON(res, 200, { ok: true, role: nextRole, partner_scope: nextScope, status: nextStatus });
});

/* ملخص الصلاحيات بلغة أعمال (§3.2 / §13) -- قراءة فقط، بلا Permission Builder. */
on('GET', '/api/admin/roles', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const allowed = assignableRoles(session.role);
  sendJSON(res, 200, allowed.map(r => ({ role: r, ...(ROLE_SUMMARY[r] || { scope: 'site', ar: [], en: [] }) })));
});

/* ------------------------------ A06: SETTLEMENT CENTER (full workflow) --------------------------------- */
const SETTLEMENT_FLOW = { Draft: ['Reviewed'], Reviewed: ['Partner Review'], 'Partner Review': ['Approved', 'Disputed'], Disputed: ['Reviewed'], Approved: ['Paid'] };
on('GET', '/api/admin/settlements', ['SuperAdmin', 'AlnadlFinance', 'PartnerViewer', 'PartnerAdmin'], async (req, res, p, query, session) => {
  let rows = db.prepare('SELECT * FROM settlements ORDER BY created_at DESC').all();
  if (session.role === 'PartnerViewer' || session.role === 'PartnerAdmin') rows = rows.filter(s => s.partner_id === session.scope);
  sendJSON(res, 200, rows);
});
on('POST', '/api/admin/settlements', ['AlnadlFinance', 'SuperAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  const calc = computeSettlement(b.partnerId, b.period, b.shareRate);
  const id = saveSettlement(calc);
  audit(session.username, session.role, 'settlement_create', id, null, calc, null);
  sendJSON(res, 201, { id, ...calc, status: 'Draft' });
});
on('POST', '/api/admin/settlements/:id/transition', ['AlnadlFinance', 'SuperAdmin', 'PartnerViewer', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  const row = db.prepare('SELECT * FROM settlements WHERE id=?').get(p.id);
  if (!row) return sendJSON(res, 404, { error: 'Not found' });
  if ((session.role === 'PartnerViewer' || session.role === 'PartnerAdmin')) {
    assertPartnerScope(session, row.partner_id);
    if (!['Approved', 'Disputed'].includes(b.to)) { const e = new Error('Partners may only approve or dispute'); e.status = 403; throw e; }
  }
  const allowed = SETTLEMENT_FLOW[row.status] || [];
  if (!allowed.includes(b.to)) return sendJSON(res, 409, { error: `Invalid settlement transition ${row.status} → ${b.to}` });
  db.prepare('UPDATE settlements SET status=? WHERE id=?').run(b.to, p.id);
  db.prepare('INSERT INTO settlement_events (settlement_id,from_status,to_status,actor,ts) VALUES (?,?,?,?,?)').run(p.id, row.status, b.to, session.username, Date.now());
  audit(session.username, session.role, 'settlement_transition', p.id, { status: row.status }, { status: b.to }, b.reason || null);
  sendJSON(res, 200, { id: p.id, status: b.to });
});

/* ------------------------------ PHASE 4 — OUTLET ARCHITECTURE (§6, §7) --------------------------------- */
function outletPartnerId(outletId) { const o = db.prepare('SELECT property_id FROM outlets WHERE id=?').get(outletId); return o ? propertyPartnerId(o.property_id) : null; }

on('GET', '/api/admin/outlets', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, query, session) => {
  let rows = db.prepare('SELECT * FROM outlets').all();
  if (session.role === 'PartnerAdmin') rows = rows.filter(o => propertyPartnerId(o.property_id) === session.scope);
  else if (query.propertyId) rows = rows.filter(o => o.property_id === query.propertyId);
  sendJSON(res, 200, rows);
});
on('POST', '/api/admin/outlets', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  const partnerId = propertyPartnerId(b.propertyId);
  assertTenantWrite(session, partnerId);
  // Creating an ADDITIONAL outlet (property already has >= 1 from migration) requires the multiOutlet feature.
  // The property's original migrated outlet is never blocked by this — only new ones are gated.
  const existingCount = db.prepare('SELECT COUNT(*) c FROM outlets WHERE property_id = ?').get(b.propertyId).c;
  if (existingCount >= 1) requireFeature(partnerId, 'multiOutlet');
  const id = uid('out');
  db.prepare(`INSERT INTO outlets (id,property_id,name_ar,name_en,type,operator,branding_json,operating_hours_json,station_id,delivery_mode,sla_prep_min,sla_delivery_min,commission_rate,status,created_at)
              VALUES (?,?,?,?,?,?,'{}','{}',?,?,?,?,?,'Active',?)`)
    .run(id, b.propertyId, b.name_ar, b.name_en, b.type || 'coffee', b.operator || 'partner', b.stationId || null, b.deliveryMode || 'runner', b.slaPrepMin || 8, b.slaDeliveryMin || 10, b.commissionRate || 0, Date.now());
  audit(session.username, session.role, 'create', id, null, b, null);
  sendJSON(res, 201, { id });
});
on('PATCH', '/api/admin/outlets/:id', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  assertTenantWrite(session, outletPartnerId(p.id));
  const before = db.prepare('SELECT status FROM outlets WHERE id=?').get(p.id);
  if (!before) return sendJSON(res, 404, { error: 'Outlet not found' });
  const fields = [], values = [];
  for (const [k, col] of [['status', 'status'], ['name_ar', 'name_ar'], ['name_en', 'name_en'], ['stationId', 'station_id'], ['deliveryMode', 'delivery_mode']]) {
    if (b[k] !== undefined) { fields.push(`${col}=?`); values.push(b[k]); }
  }
  if (fields.length) { values.push(p.id); db.prepare(`UPDATE outlets SET ${fields.join(',')} WHERE id=?`).run(...values); }
  audit(session.username, session.role, 'update', p.id, before, b, null);
  sendJSON(res, 200, { ok: true });
});

/* Outlet Availability rules (§5, Q02) — day/time windows that restrict
   WHERE and WHEN an outlet appears in the Service Hub. An outlet with zero
   rules is available everywhere/always (the default every migrated
   Increment-1 outlet has, requiring zero configuration). */
on('GET', '/api/admin/outlets/:id/availability', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  assertTenantWrite(session, outletPartnerId(p.id));
  sendJSON(res, 200, db.prepare('SELECT * FROM outlet_availability WHERE outlet_id = ?').all(p.id));
});
on('POST', '/api/admin/outlets/:id/availability', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  assertTenantWrite(session, outletPartnerId(p.id));
  if ((b.timeFrom && !/^\d{2}:\d{2}$/.test(b.timeFrom)) || (b.timeTo && !/^\d{2}:\d{2}$/.test(b.timeTo))) {
    return sendJSON(res, 400, { error: 'timeFrom/timeTo must be HH:MM (24h)' });
  }
  const id = uid('oa');
  db.prepare(`INSERT INTO outlet_availability (id,outlet_id,zone_id,point_id,day_of_week,time_from,time_to) VALUES (?,?,?,?,?,?,?)`)
    .run(id, p.id, b.zoneId || null, b.pointId || null, b.dayOfWeek != null ? b.dayOfWeek : null, b.timeFrom || null, b.timeTo || null);
  audit(session.username, session.role, 'outlet_availability_add', id, null, b, null);
  sendJSON(res, 201, { id });
});
on('DELETE', '/api/admin/outlets/:id/availability/:ruleId', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  assertTenantWrite(session, outletPartnerId(p.id));
  db.prepare('DELETE FROM outlet_availability WHERE id = ? AND outlet_id = ?').run(p.ruleId, p.id);
  audit(session.username, session.role, 'outlet_availability_remove', p.ruleId, null, null, null);
  sendJSON(res, 200, { ok: true });
});

/* Service Hub (§7) — the screen the customer sees right after QR scan when a
   property has more than one active/available outlet. When there is exactly
   one, this behaves identically to /api/qr/:token so existing single-outlet
   properties (all of them, until multiOutlet is deliberately used) see zero
   change in their flow — matching acceptance criterion §20.16 exactly. */
on('GET', '/api/service-hub/:token', null, async (req, res, p) => {
  const row = db.prepare('SELECT * FROM qr_tokens WHERE token = ?').get(p.token);
  if (!row || !row.active) return sendJSON(res, 404, { error: 'QR غير صالح / Invalid QR' });
  logQrEvent(p.token, 'scan', null);
  const point = db.prepare('SELECT * FROM points WHERE id = ?').get(row.point_id);
  if (!point || !point.active) return sendJSON(res, 409, { error: 'Point unavailable' });
  const zone = db.prepare('SELECT * FROM zones WHERE id = ?').get(point.zone_id);
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(zone.property_id);
  const partner = db.prepare('SELECT * FROM partners WHERE id = ?').get(property.partner_id);
  const sub = getSubscription(property.partner_id);
  const features = sub ? sub.features : {};

  let outlets = db.prepare(`SELECT * FROM outlets WHERE property_id = ? AND status = 'Active'`).all(property.id);
  // Availability filter (§5): a row in outlet_availability restricts an outlet
  // to specific zone/point + time window; an outlet with NO rows is available
  // everywhere/always (this is what keeps every migrated single-outlet
  // property working with zero configuration).
  const now = new Date();
  outlets = outlets.filter(o => {
    const rules = db.prepare('SELECT * FROM outlet_availability WHERE outlet_id = ?').all(o.id);
    if (rules.length === 0) return true;
    return rules.some(r => {
      if (r.zone_id && r.zone_id !== zone.id) return false;
      if (r.point_id && r.point_id !== point.id) return false;
      if (r.day_of_week != null && r.day_of_week !== now.getDay()) return false;
      if (r.time_from && r.time_to) {
        const hm = now.toTimeString().slice(0, 5);
        const overnight = r.time_from > r.time_to; // e.g. 22:00 -> 06:00 wraps past midnight
        const inWindow = overnight ? (hm >= r.time_from || hm <= r.time_to) : (hm >= r.time_from && hm <= r.time_to);
        if (!inWindow) return false;
      }
      return true;
    });
  });

  const branding = features.whiteLabel ? getBranding(property.partner_id) : { partner_id: property.partner_id, mode: 'alnadl', show_powered_by: 1 };
  const base = { partner, property, zone, point, token: p.token, features, branding };
  if (outlets.length <= 1) {
    // Single (or zero, defensively — falls back to base context) outlet: skip the hub entirely.
    return sendJSON(res, 200, { ...base, hub: false, outlet: outlets[0] || null });
  }
  if (!features.multiOutlet) {
    // Property has multiple outlet rows but the partner's plan doesn't include
    // multiOutlet — degrade gracefully to the first one rather than error,
    // since this is a display capability, not a chargeable action.
    return sendJSON(res, 200, { ...base, hub: false, outlet: outlets[0] });
  }
  sendJSON(res, 200, { ...base, hub: true, outlets });
});

/* ------------------------------ WHITE LABEL / MULTI-TENANT BRANDING (§11, §12) --------------------------------- */
function getBranding(partnerId) {
  const b = db.prepare('SELECT * FROM partner_branding WHERE partner_id = ?').get(partnerId);
  return b || { partner_id: partnerId, mode: 'alnadl', show_powered_by: 1 };
}
on('GET', '/api/admin/branding', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, query, session) => {
  const partnerId = session.role === 'PartnerAdmin' ? session.scope : query.partnerId;
  sendJSON(res, 200, getBranding(partnerId));
});
on('POST', '/api/admin/branding', ['SuperAdmin'], async (req, res, p, q, session) => {
  // White Label mode/domain changes are Admin-only by design (§19 Security) —
  // a PartnerAdmin can request a look via support, but cannot self-service
  // switch their own tenant to full white-label without Alnadl approving the
  // commercial fee model attached to it.
  const b = await readBody(req);
  requireFeature(b.partnerId, 'whiteLabel');
  const before = getBranding(b.partnerId);
  db.prepare(`INSERT INTO partner_branding (partner_id,mode,logo_text,primary_color,welcome_text_ar,welcome_text_en,show_powered_by,custom_domain,fee_model,setup_fee_amount,recurring_fee_amount,recurring_cycle,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(partner_id) DO UPDATE SET mode=excluded.mode, logo_text=excluded.logo_text, primary_color=excluded.primary_color,
                welcome_text_ar=excluded.welcome_text_ar, welcome_text_en=excluded.welcome_text_en, show_powered_by=excluded.show_powered_by,
                custom_domain=excluded.custom_domain, fee_model=excluded.fee_model, setup_fee_amount=excluded.setup_fee_amount,
                recurring_fee_amount=excluded.recurring_fee_amount, recurring_cycle=excluded.recurring_cycle, updated_at=excluded.updated_at`)
    .run(b.partnerId, b.mode || 'alnadl', b.logoText || null, b.primaryColor || null, b.welcomeTextAr || null, b.welcomeTextEn || null,
         b.showPoweredBy !== false ? 1 : 0, b.customDomain || null, b.feeModel || 'included', b.setupFeeAmount || 0, b.recurringFeeAmount || 0,
         b.recurringCycle || 'monthly', Date.now());
  audit(session.username, session.role, 'branding_update', b.partnerId, before, b, null);
  sendJSON(res, 200, { ok: true });
});

/* ------------------------------ REVENUE MODEL ENGINE (§9, §10) --------------------------------- */
on('GET', '/api/admin/revenue-models', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, query, session) => {
  let rows = db.prepare('SELECT * FROM revenue_models WHERE outlet_id = ? AND active = 1 ORDER BY created_at DESC').all(query.outletId || '');
  if (session.role === 'PartnerAdmin') rows = rows.filter(m => outletPartnerId(m.outlet_id) === session.scope);
  // Also surface the implicit fallback model so the admin UI can show
  // "using default commission" instead of an empty list for outlets that
  // have never had an explicit model configured.
  if (rows.length === 0 && query.outletId) {
    const implicitModel = getActiveModel(query.outletId);
    if (implicitModel.implicit) return sendJSON(res, 200, [implicitModel]);
  }
  sendJSON(res, 200, rows);
});
on('POST', '/api/admin/revenue-models', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  assertTenantWrite(session, outletPartnerId(b.outletId));
  if (!['share', 'commission', 'fixed', 'hybrid'].includes(b.type)) return sendJSON(res, 400, { error: 'Invalid revenue model type' });
  // Deactivate any prior model for this outlet — only one active model per
  // outlet at a time; history is preserved (active=0), never deleted, since
  // past ledger rows already snapshot whatever was active when they were written.
  const before = db.prepare('SELECT * FROM revenue_models WHERE outlet_id = ? AND active = 1').all(b.outletId);
  db.prepare('UPDATE revenue_models SET active = 0 WHERE outlet_id = ?').run(b.outletId);
  const id = uid('rm');
  db.prepare(`INSERT INTO revenue_models (id,outlet_id,type,share_rate,commission_rate,fixed_amount,fixed_cycle,calculation_base,active,created_at)
              VALUES (?,?,?,?,?,?,?,?,1,?)`)
    .run(id, b.outletId, b.type, b.shareRate || null, b.commissionRate || null, b.fixedAmount || null, b.fixedCycle || 'per_order', b.calculationBase || 'gross', Date.now());
  audit(session.username, session.role, 'revenue_model_set', id, before, b, null);
  sendJSON(res, 201, { id });
});

on('GET', '/api/admin/revenue-ledger', ['SuperAdmin', 'PartnerAdmin', 'PartnerViewer', 'AlnadlFinance'], async (req, res, p, query, session) => {
  let rows = db.prepare('SELECT * FROM revenue_ledger ORDER BY created_at DESC LIMIT 200').all();
  if (session.role === 'PartnerAdmin' || session.role === 'PartnerViewer') {
    rows = rows.filter(r => outletPartnerId(r.outlet_id) === session.scope);
  }
  if (query.outletId) rows = rows.filter(r => r.outlet_id === query.outletId);
  sendJSON(res, 200, rows);
});

/* ------------------------------ CORPORATE WALLET (Phase 3, §8/§14) --------------------------------- */
on('GET', '/api/wallets/lookup', null, async (req, res, p, query) => {
  // Public lookup by owner_ref — a real deployment would resolve this from an
  // authenticated employee session (SSO), not a query param; kept simple here
  // since this MVP has no corporate employee login flow yet.
  const w = db.prepare('SELECT * FROM wallet_accounts WHERE owner_ref = ? AND status=\'Active\'').get(query.ownerRef);
  if (!w) return sendJSON(res, 404, { error: 'No wallet found' });
  sendJSON(res, 200, { id: w.id, ownerName: w.owner_name, remaining: Math.round((w.monthly_budget - w.spent_this_period) * 100) / 100, policy: JSON.parse(w.policy_json || '{}') });
});
on('GET', '/api/admin/wallets', ['SuperAdmin', 'PartnerAdmin', 'PartnerViewer'], async (req, res, p, query, session) => {
  let rows = db.prepare('SELECT * FROM wallet_accounts').all();
  if (session.role !== 'SuperAdmin') rows = rows.filter(w => w.partner_id === session.scope);
  sendJSON(res, 200, rows);
});
on('POST', '/api/admin/wallets', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  const partnerId = session.role === 'PartnerAdmin' ? session.scope : b.partnerId;
  requireFeature(partnerId, 'corporateWallet');
  const id = uid('wal');
  db.prepare(`INSERT INTO wallet_accounts (id,partner_id,owner_name,owner_ref,monthly_budget,spent_this_period,period_start,policy_json,status,created_at)
              VALUES (?,?,?,?,?,0,?,?,'Active',?)`)
    .run(id, partnerId, b.ownerName, b.ownerRef, b.monthlyBudget || 0, Date.now(), JSON.stringify({ perOrderCap: b.perOrderCap || null }), Date.now());
  audit(session.username, session.role, 'create', id, null, b, null);
  sendJSON(res, 201, { id });
});

/* ------------------------------ MERCHANTS / MARKETPLACE (Phase 3, §9) --------------------------------- */
on('GET', '/api/admin/merchants', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, query, session) => {
  let rows = db.prepare('SELECT * FROM merchants').all();
  if (session.role === 'PartnerAdmin') rows = rows.filter(m => propertyPartnerId(m.property_id) === session.scope);
  sendJSON(res, 200, rows);
});
on('POST', '/api/admin/merchants', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  const partnerId = propertyPartnerId(b.propertyId);
  assertTenantWrite(session, partnerId);
  requireFeature(partnerId, 'marketplace');
  const id = uid('mer');
  db.prepare(`INSERT INTO merchants (id,property_id,name_ar,name_en,kind,commission_rate,status) VALUES (?,?,?,?,?,?,'Active')`)
    .run(id, b.propertyId, b.name_ar, b.name_en, b.kind || 'partner_restaurant', b.commissionRate || 0.1);
  audit(session.username, session.role, 'create', id, null, b, null);
  sendJSON(res, 201, { id });
});

/* ------------------------------ Variants & Add-ons admin CRUD --------------------------------- */
on('GET', '/api/admin/products/:id/options', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  assertTenantWrite(session, productPartnerId(p.id));
  sendJSON(res, 200, {
    variants: db.prepare('SELECT * FROM variants WHERE product_id=?').all(p.id),
    addons: db.prepare('SELECT * FROM addons WHERE product_id=?').all(p.id),
  });
});
on('POST', '/api/admin/products/:id/variants', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  assertTenantWrite(session, productPartnerId(p.id));
  const id = uid('vr');
  db.prepare('INSERT INTO variants (id,product_id,name_ar,name_en,price_delta) VALUES (?,?,?,?,?)').run(id, p.id, b.name_ar, b.name_en, b.priceDelta || 0);
  audit(session.username, session.role, 'create', id, null, b, null);
  sendJSON(res, 201, { id });
});
on('POST', '/api/admin/products/:id/addons', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  assertTenantWrite(session, productPartnerId(p.id));
  const id = uid('ad');
  db.prepare('INSERT INTO addons (id,product_id,name_ar,name_en,price,required) VALUES (?,?,?,?,?,?)').run(id, p.id, b.name_ar, b.name_en, b.price || 0, b.required ? 1 : 0);
  audit(session.username, session.role, 'create', id, null, b, null);
  sendJSON(res, 201, { id });
});

/* ------------------------------- static files --------------------------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
// UX-0 corrective round: genuine production/demo separation at the
// static-serving level, not just runtime branching in app.js.
//
// GET /dev-tools.js: in production this is a real 404, the exact same
// "route/resource does not exist" pattern already proven for
// /api/demo/points -- the demo login chooser and QR-point picker code
// (public/dev-tools.js) never reaches a production client's browser at
// all, not merely hidden by a client-side check the file's own code
// could still contain.
//
// index.html: the <!--DEV-ONLY-->...<!--/DEV-ONLY--> block (currently
// just the <script src="/dev-tools.js"> tag) is stripped out of the
// response entirely in production, via a plain string search -- so a
// production deployment's HTML does not even reference a URL that would
// 404. This is the one piece of server-side "templating" in this
// no-build-step architecture, deliberately minimal (a single marked
// block, not a general template engine) because it is the one thing
// that must differ between the two HTML responses.
const DEV_ONLY_BLOCK = /<!--DEV-ONLY-->[\s\S]*?<!--\/DEV-ONLY-->\n?/;
function serveStatic(req, res, pathname) {
  if (pathname === '/dev-tools.js' && process.env.NODE_ENV === 'production') {
    res.writeHead(404); return res.end('Not found');
  }
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    if (filePath === path.join(PUBLIC_DIR, 'index.html') && process.env.NODE_ENV === 'production') {
      data = Buffer.from(data.toString('utf8').replace(DEV_ONLY_BLOCK, ''), 'utf8');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

/* --------------------------------- server --------------------------------- */
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // /health and /ready are registered routes, not static assets — they must
  // reach the dispatcher below rather than being looked up on disk.
  const OPS_ROUTES = new Set(['/health', '/ready']);
  if (!pathname.startsWith('/api/') && !OPS_ROUTES.has(pathname)) return serveStatic(req, res, pathname);

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = pathname.match(r.regex);
    if (!m) continue;
    const params = {};
    r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
    // §4.2 correlation id: minted (or inherited from the proxy) once per
    // request and echoed back, so a guest-reported problem can be traced
    // across logs without guessing at timestamps.
    const reqId = correlationId(req);
    res.setHeader('X-Request-Id', reqId);
    const startedAt = Date.now();
    try {
      // Public routes are throttled BEFORE any handler work or DB access,
      // so a flood costs a Map lookup rather than a query (§3.9).
      if (!r.roles) {
        const bucket = bucketForPublicRoute(r.method, r.pattern);
        if (bucket) {
          const limited = checkLimit(bucket, req);
          if (limited) {
            res.setHeader('Retry-After', String(limited.retryAfterSec));
            log.warn('rate_limited', { reqId, route: r.pattern, bucket });
            return sendJSON(res, 429, { error: 'Too many requests' });
          }
        }
      }
      let session = null;
      if (r.roles) {
        session = requireRole(authenticate(req), r.roles);
      }
      await r.handler(req, res, params, parsed.query, session);
      const ms = Date.now() - startedAt;
      // Only slow requests are logged at info on the happy path -- logging
      // every 200 on a polling KDS would bury the signal in noise.
      if (ms > 1000) log.warn('slow_request', { reqId, route: r.pattern, method: r.method, ms });
    } catch (e) {
      const status = e.status || 500;
      // 5xx is a real defect and always logged; 4xx is the API working as
      // designed (bad input, forbidden) and is not an operational alert.
      if (status >= 500) {
        log.error('request_failed', { reqId, route: r.pattern, method: r.method, status, ms: Date.now() - startedAt }, e);
      }
      // The client never receives an internal message on a 500 (§4.2).
      sendJSON(res, status, { error: status >= 500 ? 'Server error' : (e.message || 'Request failed') });
    }
    return;
  }
  sendJSON(res, 404, { error: 'No such route' });
});

/* ---------------- P1 §4.5 — Graceful shutdown & worker safety -------------
   On SIGTERM/SIGINT: stop accepting NEW connections, let in-flight requests
   finish, then close the database cleanly. The Engage worker is stopped
   first so it cannot begin new outbox work mid-teardown -- any row it had
   not yet claimed simply stays 'pending' and is picked up by the next
   instance, which is exactly the property the outbox pattern exists for.
   A hard-exit timer guarantees the process still dies if a request hangs,
   so an orchestrator never has to SIGKILL a wedged pod. */
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ level: 'info', event: 'shutdown_start', signal }));

  const forceTimer = setTimeout(() => {
    console.log(JSON.stringify({ level: 'warn', event: 'shutdown_forced', reason: 'in-flight requests exceeded grace period' }));
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  try { if (typeof stopEngageWorker === 'function') stopEngageWorker(); } catch (e) {}

  server.close(() => {
    try { db.close(); } catch (e) {}
    console.log(JSON.stringify({ level: 'info', event: 'shutdown_complete', signal }));
    clearTimeout(forceTimer);
    process.exit(0);
  });
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/* §4.5: readiness must flip BEFORE the process goes away, so a load
   balancer stops routing to a draining instance instead of racing it. */
function isShuttingDown() { return shuttingDown; }

server.listen(PORT, () => {
  console.log(`Alnadl Hospitality OS backend listening on http://localhost:${PORT}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Demo users (password = username): customer_demo, operator, runner, manager, partner, finance, admin`);
  }
  // Phase 5 P5-Inc-1: the Engage Outbox Worker runs independently of the
  // request/response cycle. Its failure (or being stopped entirely) has
  // zero effect on anything above this line — proven by ENG-ISO-001 in
  // tests/engage-inc1.js, which stops it and re-runs the full Phase 1-4
  // suite unchanged.
  startEngageWorker();
  // Keep the in-memory rate-limit windows bounded (§3.9).
  const rlSweep = setInterval(() => { try { sweepRateLimits(); } catch (e) {} }, 300_000);
  rlSweep.unref();
  // §3.9: an in-memory limiter across several instances multiplies the
  // effective limit by the instance count. Warn loudly rather than let a
  // multi-instance production deployment believe it is protected.
  if (process.env.NODE_ENV === 'production' && process.env.APP_INSTANCES && Number(process.env.APP_INSTANCES) > 1) {
    console.warn(JSON.stringify({ level: 'warn', event: 'rate_limit_store_unsafe',
      detail: 'in-memory rate limiting with APP_INSTANCES>1 multiplies the effective limit; use a shared store' }));
  }
  // Q06 (2nd round): the hard NODE_ENV=production check now happens at
  // lib/auth.js module load time (resolveSessionSecret()), before the
  // server ever reaches listen() — the process exits before this point if
  // production has no strong secret. This dev/demo-only notice just
  // clarifies non-production behavior for anyone reading the logs.
  if (!process.env.SESSION_SECRET && process.env.NODE_ENV !== 'production') {
    console.warn('\n⚠️  NOTE (Q06): SESSION_SECRET is not set — using a random per-process secret.');
    console.warn('    Every restart invalidates every active session. Fine for local/demo use.');
    console.warn('    NODE_ENV=production refuses to start at all without a real one (enforced).\n');
  }
});
