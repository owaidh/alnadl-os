// lib/plan.js — SaaS packaging & feature gating (Concept doc §12: OPERATE / SMART / PLATFORM).
// A partner's subscribed plan controls which capabilities their tenant can
// use — this is what makes the product a SaaS offering rather than a single
// bespoke build: upgrading a partner's plan turns features on with no code
// change, and a partner on OPERATE genuinely cannot reach QR ordering
// endpoints until they upgrade.
'use strict';
const { db } = require('../db.js');

function getSubscription(partnerId) {
  const sub = db.prepare(`
    SELECT s.*, p.code AS plan_code, p.name_ar, p.name_en, p.monthly_fee, p.tech_fee_rate, p.features_json
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.partner_id = ?`).get(partnerId);
  if (!sub) return null;
  sub.features = JSON.parse(sub.features_json);
  return sub;
}

function requireFeature(partnerId, feature) {
  const sub = getSubscription(partnerId);
  if (!sub || sub.status !== 'Active' || !sub.features[feature]) {
    const e = new Error(`This capability (${feature}) requires an active plan that includes it. Current plan: ${sub ? sub.plan_code : 'none'}.`);
    e.status = 402; // Payment Required — apt for a plan-gating failure
    throw e;
  }
  return sub;
}

module.exports = { getSubscription, requireFeature };
