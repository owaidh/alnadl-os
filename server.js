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
const { getOrCreateAccount, earnPoints, quoteRedemption, commitRedemption } = require('./lib/loyalty.js');
const { getWallet, quoteCoverage, commitSpend } = require('./lib/wallet.js');
const { getActiveModel, computeAmounts, recordOrderRevenue, recordRefundRevenue } = require('./lib/revenue-engine.js');
const gateway = getGateway();

const PORT = process.env.PORT || 8787;
const PUBLIC_DIR = path.join(__dirname, 'public');

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
function on(method, pattern, roles, handler) {
  // pattern like '/api/orders/:id/pay' -> regex with named groups
  const names = [];
  const rx = '^' + pattern.replace(/:[a-zA-Z]+/g, (m) => { names.push(m.slice(1)); return '([^/]+)'; }) + '$';
  routes.push({ method, regex: new RegExp(rx), names, roles, handler });
}

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
on('GET', '/api/demo/points', null, async (req, res) => {
  const rows = db.prepare(`
    SELECT pt.id, pt.label, z.name_ar AS zone_ar, z.name_en AS zone_en, qr.token
    FROM points pt JOIN zones z ON z.id = pt.zone_id JOIN qr_tokens qr ON qr.point_id = pt.id
    WHERE pt.active = 1 AND qr.active = 1`).all();
  sendJSON(res, 200, rows);
});

/* ------------------------------ QR / CONTEXT --------------------------------- */
on('GET', '/api/qr/:token', null, async (req, res, p) => {
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

/* ------------------------------ LOYALTY (Phase 3, §15) --------------------------------- */
on('GET', '/api/loyalty/:phone', null, async (req, res, p) => {
  const acct = getOrCreateAccount(p.phone);
  sendJSON(res, 200, { pointsBalance: acct ? acct.points_balance : 0 });
});
on('GET', '/api/loyalty/:phone/history', null, async (req, res, p) => {
  const acct = db.prepare('SELECT * FROM loyalty_accounts WHERE customer_key = ?').get(p.phone);
  if (!acct) return sendJSON(res, 200, []);
  sendJSON(res, 200, db.prepare('SELECT * FROM loyalty_transactions WHERE account_id = ? ORDER BY created_at DESC LIMIT 50').all(acct.id));
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
    requireFeature(property.partner_id, 'loyalty');
    const q = quoteRedemption(customerPhone, parseInt(body.redeemPoints) || 0, subtotal - discountAmount);
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
    cardResult = await gateway.capture(intent.intentId, !!body.simulateFail);
  }
  // --- a real provider would return here with intent/redirectUrl and confirm asynchronously
  //     via POST /api/payments/webhook instead of capturing synchronously; kept synchronous
  //     here only because the sandbox has no real card network to redirect to.

  const succeeded = cardResult.status === 'Captured';
  if (succeeded && walletCovered > 0) commitSpend(order.wallet_id, order.id, walletCovered);
  if (walletCovered > 0) {
    db.prepare(`INSERT INTO payments (id,order_id,gateway_ref,amount,status,method,fees,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(uid('pay'), order.id, 'wallet:' + order.wallet_id, walletCovered, succeeded ? 'Captured' : 'Failed', 'wallet', 0, Date.now());
  }
  if (cardAmount > 0) {
    db.prepare(`INSERT INTO payments (id,order_id,gateway_ref,amount,status,method,fees,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(uid('pay'), order.id, cardResult.gatewayRef, cardAmount, cardResult.status, method, cardResult.fees || 0, Date.now());
  }

  const newStatus = succeeded ? 'Paid' : 'Failed';
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
  const amount = Math.round((parseFloat(body.amount) || 0) * 100) / 100;

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
  const rows = db.prepare(`
    SELECT o.*, pt.label AS point_label FROM orders o LEFT JOIN points pt ON pt.id = o.point_id
    WHERE o.status IN ('Paid','Accepted','Preparing','Ready','Out for Delivery') ORDER BY o.created_at ASC`).all();
  const result = [];
  for (const o of rows) {
    const children = db.prepare('SELECT * FROM child_orders WHERE parent_order_id = ?').all(o.id);
    if (children.length === 0) {
      // Legacy single-outlet path — identical shape to every version before Phase 4.
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
      result.push({ ...o, itemsSummary: items.map(i => `${i.qty}× ${i.name_ar}`).join(', ') });
    } else {
      // Unified Cart (§8, §13): the Parent itself isn't independently
      // actionable once split — each Outlet's portion is its own ticket.
      // Filtering by ?stationId lets a KDS screen show only its own station.
      for (const c of children) {
        if (['Paid', 'Accepted', 'Preparing', 'Ready', 'Out for Delivery'].indexOf(c.status) === -1) continue;
        if (query.stationId && c.station_id !== query.stationId) continue;
        const outlet = db.prepare('SELECT name_ar, name_en FROM outlets WHERE id = ?').get(c.outlet_id);
        const items = db.prepare('SELECT * FROM order_items WHERE child_order_id = ?').all(c.id);
        result.push({
          id: c.id, status: c.status, created_at: c.created_at, point_label: o.point_label,
          itemsSummary: items.map(i => `${i.qty}× ${i.name_ar}`).join(', '),
          isChild: true, parentOrderId: o.id, outletId: c.outlet_id,
          outletName: outlet ? outlet.name_ar : null, outletNameEn: outlet ? outlet.name_en : null,
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

  db.prepare('UPDATE orders SET status=?, updated_at=?, cancel_reason=? WHERE id=?')
    .run(to, Date.now(), to === 'Cancelled' ? body.reason : order.cancel_reason, order.id);

  const fulfillmentCol = { Accepted: 'accepted_at', Preparing: 'preparing_at', Ready: 'ready_at', 'Out for Delivery': 'out_at', Delivered: 'delivered_at' }[to];
  if (fulfillmentCol) {
    db.prepare(`INSERT INTO fulfillment (order_id, ${fulfillmentCol}) VALUES (?, ?)
                ON CONFLICT(order_id) DO UPDATE SET ${fulfillmentCol} = excluded.${fulfillmentCol}`).run(order.id, Date.now());
  }
  audit(session.username, session.role, 'status_change', order.id, { status: order.status }, { status: to }, body.reason || null);
  const notifyEvent = { Accepted:'order_accepted', Ready:'order_ready', 'Out for Delivery':'order_out', Delivered:'order_delivered', Cancelled:'order_cancelled' }[to];
  if (notifyEvent) notify(notifyEvent, order.id, 'push');
  // Loyalty: earn points on successful delivery (§15) — only if the partner's plan includes loyalty
  let loyaltyEarned = null;
  if (to === 'Delivered' && order.customer_phone) {
    const sub = getSubscription(order.partner_id);
    if (sub && sub.features.loyalty) loyaltyEarned = earnPoints(order.customer_phone, order.id, order.total);
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
  db.prepare('UPDATE child_orders SET status=?, updated_at=?, cancel_reason=? WHERE id=?')
    .run(to, Date.now(), to === 'Cancelled' ? body.reason : child.cancel_reason, child.id);
  audit(session.username, session.role, 'child_status_change', child.id, { status: child.status }, { status: to }, body.reason || null);
  deriveParentStatus(child.parent_order_id);
  sendJSON(res, 200, { id: child.id, status: to, parentOrderId: child.parent_order_id });
});

/* ------------------------------ RUNNER --------------------------------- */
on('GET', '/api/runner/queue', ['Runner', 'SuperAdmin'], async (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, pt.label AS point_label FROM orders o LEFT JOIN points pt ON pt.id = o.point_id
    WHERE o.status IN ('Ready','Out for Delivery','Partially Ready','Partially Delivered') ORDER BY o.updated_at ASC`).all();
  const result = [];
  for (const o of rows) {
    const property = db.prepare('SELECT delivery_grouping FROM properties WHERE id = ?').get(o.property_id);
    const grouping = (property && property.delivery_grouping) || 'grouped';
    const children = db.prepare('SELECT * FROM child_orders WHERE parent_order_id = ?').all(o.id);

    if (children.length === 0) {
      // Legacy single-outlet path — unaffected by grouping policy, exactly as before Q01.
      if (['Ready', 'Out for Delivery'].includes(o.status)) result.push(o);
      continue;
    }

    if (grouping === 'grouped') {
      // Grouped (§13, Q01 default — matches pre-Q01 behavior exactly): Runner
      // only ever sees the whole order once every child has reached Ready.
      if (o.status === 'Ready' || o.status === 'Out for Delivery') result.push(o);
    } else {
      // Separate (§13, Q01): each outlet's portion can be claimed and
      // delivered independently the moment IT is ready, without waiting
      // for siblings still preparing.
      for (const c of children) {
        if (!['Ready', 'Out for Delivery'].includes(c.status)) continue;
        const outlet = db.prepare('SELECT name_ar, name_en FROM outlets WHERE id = ?').get(c.outlet_id);
        result.push({
          id: c.id, status: c.status, updated_at: c.updated_at, point_label: o.point_label,
          isChild: true, parentOrderId: o.id, outletId: c.outlet_id,
          outletName: outlet ? outlet.name_ar : null, outletNameEn: outlet ? outlet.name_en : null,
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
    .run(id, b.name_ar, b.name_en, b.legal_name, b.contract_ref, 'Active');
  audit(session.username, session.role, 'create', id, null, b, null);
  sendJSON(res, 201, { id });
});

/* ---- SaaS onboarding: create Partner + Property + Subscription in one call ---- */
on('POST', '/api/admin/onboard', ['SuperAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  const plan = db.prepare('SELECT * FROM plans WHERE code = ?').get(b.planCode);
  if (!plan) return sendJSON(res, 400, { error: 'Unknown plan code' });
  const partnerId = uid('pt');
  db.prepare('INSERT INTO partners (id,name_ar,name_en,legal_name,contract_ref,status) VALUES (?,?,?,?,?,?)')
    .run(partnerId, b.partnerNameAr, b.partnerNameEn, b.legalName || b.partnerNameEn, b.contractRef || ('CNT-' + Date.now()), 'Active');
  const propertyId = uid('prop');
  db.prepare(`INSERT INTO properties (id,partner_id,name_ar,name_en,timezone,address,status) VALUES (?,?,?,?,?,?,?)`)
    .run(propertyId, partnerId, b.propertyNameAr || b.partnerNameAr, b.propertyNameEn || b.partnerNameEn, 'Asia/Riyadh', b.address || '', 'Active');
  const now = Date.now();
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
  let outletId = b.outletId || null;
  if (!outletId) {
    const category = db.prepare('SELECT property_id FROM categories WHERE id = ?').get(b.categoryId);
    const fallbackOutlet = category ? db.prepare(`SELECT id FROM outlets WHERE property_id = ? ORDER BY created_at ASC LIMIT 1`).get(category.property_id) : null;
    outletId = fallbackOutlet ? fallbackOutlet.id : null;
  }
  db.prepare("INSERT INTO products (id,category_id,outlet_id,sku,name_ar,name_en,base_price,status) VALUES (?,?,?,?,?,?,?,'Active')")
    .run(id, b.categoryId, outletId, b.sku || id, b.name_ar, b.name_en, b.basePrice);
  audit(session.username, session.role, 'create', id, null, b, null);
  sendJSON(res, 201, { id });
});
on('PATCH', '/api/admin/products/:id', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  assertTenantWrite(session, productPartnerId(p.id));
  const before = db.prepare('SELECT status FROM products WHERE id=?').get(p.id);
  db.prepare('UPDATE products SET status=? WHERE id=?').run(b.status, p.id);
  audit(session.username, session.role, 'update_status', p.id, before, { status: b.status }, null);
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

  sendJSON(res, 200, { grossSales: round2(gross), orders: orders.length, aov: round2(aov), topZones, crossOutletBasketRate, outletPerformance });
});
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
on('POST', '/api/admin/users', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  if (session.role === 'PartnerAdmin') { b.partner_scope = session.scope; if (!['Operator', 'Runner', 'SiteManager', 'PartnerViewer'].includes(b.role)) { const e = new Error('PartnerAdmin can only create site-level roles'); e.status = 403; throw e; } }
  const id = uid('u');
  db.prepare(`INSERT INTO users (id,username,password_hash,role,partner_scope,active,created_at) VALUES (?,?,?,?,?,1,?)`)
    .run(id, b.username, hashPbkdf2(b.username), b.role, b.partner_scope || null, Date.now());
  audit(session.username, session.role, 'user_create', id, null, { username: b.username, role: b.role }, null);
  sendJSON(res, 201, { id, note: 'Password defaults to the username in this sandbox demo' });
});
on('PATCH', '/api/admin/users/:id', ['SuperAdmin', 'PartnerAdmin'], async (req, res, p, q, session) => {
  const b = await readBody(req);
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(p.id);
  if (!target) return sendJSON(res, 404, { error: 'Not found' });
  if (session.role === 'PartnerAdmin' && target.partner_scope !== session.scope) { const e = new Error('Forbidden'); e.status = 403; throw e; }
  db.prepare('UPDATE users SET active=? WHERE id=?').run(b.active ? 1 : 0, p.id);
  audit(session.username, session.role, 'user_toggle', p.id, { active: target.active }, { active: b.active }, null);
  sendJSON(res, 200, { ok: true });
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
        if (hm < r.time_from || hm > r.time_to) return false;
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
function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

/* --------------------------------- server --------------------------------- */
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = pathname.match(r.regex);
    if (!m) continue;
    const params = {};
    r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
    try {
      let session = null;
      if (r.roles) {
        session = requireRole(authenticate(req), r.roles);
      }
      await r.handler(req, res, params, parsed.query, session);
    } catch (e) {
      sendJSON(res, e.status || 500, { error: e.message || 'Server error' });
    }
    return;
  }
  sendJSON(res, 404, { error: 'No such route' });
});

server.listen(PORT, () => {
  console.log(`Alnadl Hospitality OS backend listening on http://localhost:${PORT}`);
  console.log(`Demo users (password = username): customer_demo, operator, runner, manager, partner, finance, admin`);
  if (!process.env.SESSION_SECRET) {
    console.warn('\n⚠️  WARNING (Q06): SESSION_SECRET is not set — using a random per-process secret.');
    console.warn('    Every restart invalidates every active session. This is fine for local/demo use');
    console.warn('    but MUST be set to a fixed, secret value from a secret manager before any real');
    console.warn('    deployment. See docs/DEPLOYMENT.md "الأمان" section.\n');
  }
});
