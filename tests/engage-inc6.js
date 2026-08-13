// tests/engage-inc6.js — Phase 5 P5-Inc-6 acceptance tests.
// Feature Flags + Engage Roles + Partner Dashboard / Partner Analytics
// Privacy. Negative/boundary cases throughout.
'use strict';
const { startServer, stopServer, api, loginAs, assert, assertEqual, summary, resetCounts, getDataPath } = require('./helpers.js');

function openDirectDb() {
  process.env.SQLITE_PATH = getDataPath();
  delete require.cache[require.resolve('../db.js')];
  delete require.cache[require.resolve('../lib/engage-personality.js')];
  delete require.cache[require.resolve('../lib/engage-novelty.js')];
  delete require.cache[require.resolve('../lib/engage-flags.js')];
  delete require.cache[require.resolve('../lib/engage-session.js')];
  delete require.cache[require.resolve('../lib/engage-ledger.js')];
  return require('../db.js').db;
}

function makePass(db, { partnerId, propertyId, zoneId, pointId, orderId, customerPhone }) {
  const { uid } = require('../db.js');
  const crypto = require('crypto');
  const now = Date.now();
  db.prepare(`INSERT INTO orders (id,partner_id,property_id,zone_id,point_id,customer_phone,status,subtotal,vat,total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(orderId, partnerId, propertyId, zoneId, pointId, customerPhone || null, 'Paid', 20, 3, 23, now, now);
  const passId = uid('ep');
  const accessToken = crypto.randomBytes(24).toString('base64url');
  db.prepare(`INSERT INTO engage_pass (id,order_id,identity_ref,context_snapshot_json,status,created_at,expires_at,access_token) VALUES (?,?,?,?,?,?,?,?)`)
    .run(passId, orderId, customerPhone || null, JSON.stringify({ partnerId, propertyId, zoneId, orderId }), 'active', now, now + 3600000, accessToken);
  return { passId, accessToken };
}

async function run() {
  resetCounts();
  await startServer();
  console.log('=== Phase 5 P5-Inc-6 Suite (Feature Flags + Roles + Partner Privacy) ===');

  try {
    const adminToken = await loginAs('admin');
    const partnerAdminToken = await loginAs('partneradmin');
    const partnerViewerToken = await loginAs('partner');
    const operatorToken = await loginAs('operator');
    const safetyReviewerToken = await loginAs('safetyreviewer');
    const productAdminToken = await loginAs('productadmin');
    const db = openDirectDb();
    let orderCounter = 0;
    const nextOrderId = () => `TEST-INC6-${++orderCounter}`;

    // ============================================================
    // Roles integrated into existing RBAC, not a separate system
    // ============================================================
    const noAuthLedger = await api('GET', '/api/admin/engage/ledger');
    assert([401, 403].includes(noAuthLedger.status), 'unauthenticated cannot access the Ledger');

    const safetyLedger = await api('GET', '/api/admin/engage/ledger', null, safetyReviewerToken);
    assertEqual(safetyLedger.status, 200, 'ROLES: SafetyReviewer CAN access the full Ledger (matches §14 scope: ledger/reports/safety actions)');

    const productLedgerAttempt = await api('GET', '/api/admin/engage/ledger', null, productAdminToken);
    assertEqual(productLedgerAttempt.status, 403, "ROLES: ProductAdmin CANNOT access the full Ledger (identifiable order_id/identity_ref/exact payload) -- matches §14's \"بيانات شخصية حسب الحاجة فقط\", not given by default");

    const productOverview = await api('GET', '/api/admin/engage/overview', null, productAdminToken);
    assertEqual(productOverview.status, 200, 'ROLES: ProductAdmin CAN access the aggregate Admin Overview (mechanics/analytics scope, no PII)');

    const safetyOverviewAttempt = await api('GET', '/api/admin/engage/overview', null, safetyReviewerToken);
    assertEqual(safetyOverviewAttempt.status, 403, 'ROLES: SafetyReviewer is scoped to the Ledger, not the mechanics/analytics Overview -- role scopes are distinct, not a blanket "any internal role sees everything"');

    const partnerAdminLedgerAttempt = await api('GET', '/api/admin/engage/ledger', null, partnerAdminToken);
    assertEqual(partnerAdminLedgerAttempt.status, 403, 'a PartnerAdmin (tenant-scoped role) still cannot access the internal Ledger, unaffected by the new internal roles being added');

    const operatorLedgerAttempt = await api('GET', '/api/admin/engage/ledger', null, operatorToken);
    assertEqual(operatorLedgerAttempt.status, 403, 'an ordinary Operator role (unrelated to Engage) still cannot access the Ledger');

    // Confirm this used the SAME users table / RBAC mechanism, not a parallel system
    const safetyUserRow = db.prepare(`SELECT role, partner_scope FROM users WHERE username = 'safetyreviewer'`).get();
    assertEqual(safetyUserRow.role, 'SafetyReviewer', 'INTEGRATED RBAC: the new role is a plain value in the SAME users.role column used by every other role, not a separate permissions table');

    // ============================================================
    // Partner Dashboard cohort threshold — the exact boundary: 9 / 10 / 11
    // ============================================================
    db.prepare(`UPDATE properties SET venue_context = 'coffee' WHERE id = 'prop_nova_main'`).run();

    // 9 sessions -- must be suppressed
    for (let i = 0; i < 9; i++) {
      const pass = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
      await api('POST', '/api/engage/session/start', { accessToken: pass.accessToken });
    }
    const overview9 = await api('GET', '/api/partner/engage/overview', null, partnerAdminToken);
    assertEqual(overview9.data.suppressed, true, 'COHORT BOUNDARY: with exactly 9 sessions (below the threshold of 10), the response is suppressed');
    assertEqual(overview9.data.offered, undefined, 'COHORT BOUNDARY: a suppressed response never includes the raw "offered" count, not even a small one');

    // 10th session -- must now show real data
    const pass10 = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    await api('POST', '/api/engage/session/start', { accessToken: pass10.accessToken });
    const overview10 = await api('GET', '/api/partner/engage/overview', null, partnerAdminToken);
    assertEqual(overview10.data.suppressed, false, 'COHORT BOUNDARY: with exactly 10 sessions (the threshold itself), the response is NOT suppressed');
    assertEqual(overview10.data.offered, 10, 'COHORT BOUNDARY: at exactly 10, the real count (10) is shown');

    // 11th session -- still shows real data
    const pass11 = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    await api('POST', '/api/engage/session/start', { accessToken: pass11.accessToken });
    const overview11 = await api('GET', '/api/partner/engage/overview', null, partnerAdminToken);
    assertEqual(overview11.data.suppressed, false, 'COHORT BOUNDARY: with 11 sessions (above threshold), still not suppressed');
    assertEqual(overview11.data.offered, 11, 'COHORT BOUNDARY: at 11, the real count is shown');
    db.prepare(`UPDATE properties SET venue_context = 'hotel' WHERE id = 'prop_nova_main'`).run();

    // ============================================================
    // Cross-tenant: Partner A cannot read Partner B's data via this endpoint
    // ============================================================
    // (Partner Overview is always scoped to session.scope, the CALLER's own
    // tenant -- there is no partnerId parameter in this route for an
    // attacker to supply at all, the same "no id to substitute" pattern
    // used throughout Engage's authorization.)
    const overviewRouteSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
    const partnerOverviewRouteBlock = overviewRouteSource.slice(overviewRouteSource.indexOf(`'/api/partner/engage/overview'`));
    assert(!partnerOverviewRouteBlock.slice(0, 400).includes('query.partnerId') && !partnerOverviewRouteBlock.slice(0, 400).includes('body.partnerId'),
      "CROSS-TENANT: the Partner Overview route never reads a partnerId from the request at all (query or body) -- it is structurally bound to session.scope only, so there is no parameter for Partner A to substitute Partner B's id into");

    // ============================================================
    // NEGATIVE: role not authorized for Partner Dashboard at all
    // ============================================================
    const operatorOverviewAttempt = await api('GET', '/api/partner/engage/overview', null, operatorToken);
    assertEqual(operatorOverviewAttempt.status, 403, 'an Operator role cannot access the Partner Dashboard endpoint');
    const noAuthOverview = await api('GET', '/api/partner/engage/overview');
    assert([401, 403].includes(noAuthOverview.status), 'unauthenticated cannot access the Partner Dashboard');

    // ============================================================
    // NEGATIVE: attempt to smuggle internal AI fields into the partner-safe response
    // ============================================================
    const rawOverviewJson = JSON.stringify(overview11.data);
    const forbiddenFields = ['prompt', 'model', 'provider', 'vector', 'embedding', 'mechanic_name', 'mechanic_id', 'rendered_payload', 'selection_reason', 'schema_json'];
    for (const field of forbiddenFields) {
      assert(!rawOverviewJson.toLowerCase().includes(field.toLowerCase()), `INTERNAL AI FIELDS: the Partner Overview response never contains "${field}" -- verified on the actual JSON, not just by code inspection`);
    }
    // Same check on Product Admin's aggregate Overview -- also must never leak these
    const productOverviewJson = JSON.stringify(productOverview.data);
    for (const field of ['prompt', 'provider', 'vector', 'embedding', 'rendered_payload']) {
      assert(!productOverviewJson.toLowerCase().includes(field.toLowerCase()), `INTERNAL AI FIELDS (ProductAdmin): the aggregate Admin Overview never contains "${field}" either -- mechanic lifecycle counts only, not internals`);
    }

    // ============================================================
    // Feature Flag precedence — Global Safety -> Contract -> Property -> Zone
    // ============================================================
    const { resolveEngageEnabled } = require('../lib/engage-flags.js');

    assertEqual(resolveEngageEnabled(true, 'pt_nova', 'prop_nova_main', 'z_pool'), true, 'PRECEDENCE baseline: Contract ON, no overrides -> enabled');
    assertEqual(resolveEngageEnabled(false, 'pt_nova', 'prop_nova_main', 'z_pool'), false, 'PRECEDENCE: Contract OFF -> disabled, nothing below can override it');

    // Contract prohibition: Property override cannot turn ON what Contract turned OFF
    const setContractOffOverride = await api('POST', '/api/admin/engage/policy-overrides', { scopeType: 'property', scopeId: 'prop_nova_main', enabled: true }, adminToken);
    assertEqual(setContractOffOverride.status, 201, 'setup: property override enabled=true is accepted at the write level');
    assertEqual(resolveEngageEnabled(false, 'pt_nova', 'prop_nova_main', 'z_pool'), false, 'CONTRACT PROHIBITION: even with a property override explicitly trying enabled=true, a Contract=false still wins -- the lower level cannot exceed Contract prohibition');

    // Property override CAN turn OFF what Contract left ON
    await api('POST', '/api/admin/engage/policy-overrides', { scopeType: 'property', scopeId: 'prop_alrowad_hq', enabled: false }, adminToken);
    assertEqual(resolveEngageEnabled(true, 'pt_alrowad', 'prop_alrowad_hq', null), false, 'PROPERTY RESTRICTION: Contract=true, but a Property override sets enabled=false -- the more specific level correctly restricts further');

    // ============================================================
    // GLOBAL SAFETY: kill switch wins over EVERYTHING, including a paying Contract
    // ============================================================
    const noAuthKillSwitch = await api('POST', '/api/admin/engage/kill-switch', { enabled: false });
    assert([401, 403].includes(noAuthKillSwitch.status), 'the Global kill switch requires authentication');

    const partnerAdminKillSwitchAttempt = await api('POST', '/api/admin/engage/kill-switch', { enabled: false }, partnerAdminToken);
    assertEqual(partnerAdminKillSwitchAttempt.status, 403, 'GLOBAL SAFETY: a PartnerAdmin (tenant-scoped) cannot touch the platform-wide kill switch, even for their own tenant -- this lever is SuperAdmin only, never delegatable');

    const killSwitchSet = await api('POST', '/api/admin/engage/kill-switch', { enabled: false }, adminToken);
    assertEqual(killSwitchSet.status, 200, 'a SuperAdmin CAN set the global kill switch');
    assertEqual(resolveEngageEnabled(true, 'pt_nova', 'prop_nova_main', 'z_pool'), false, 'GLOBAL SAFETY: with the kill switch OFF, Engage is disabled even for a partner whose Contract says enabled=true -- absolute, wins over every level below it');

    // Restore for cleanliness / to not affect anything after this suite
    await api('POST', '/api/admin/engage/kill-switch', { enabled: true }, adminToken);
    assertEqual(resolveEngageEnabled(true, 'pt_nova', 'prop_nova_main', 'z_lobby'), true, 'restoring the kill switch to ON allows Contract-level resolution to work normally again');

    // ============================================================
    // NEGATIVE: conflicting overrides (Zone vs Property, both restricting differently)
    // ============================================================
    await api('POST', '/api/admin/engage/policy-overrides', { scopeType: 'property', scopeId: 'prop_nova_main', enabled: true }, adminToken);
    await api('POST', '/api/admin/engage/policy-overrides', { scopeType: 'zone', scopeId: 'z_meet', enabled: false }, adminToken);
    assertEqual(resolveEngageEnabled(true, 'pt_nova', 'prop_nova_main', 'z_meet'), false, 'CONFLICTING OVERRIDES: Zone says OFF, Property says ON, Contract says ON -- the most specific restriction (Zone) wins, same precedence direction as Ceiling/Novelty');
    assertEqual(resolveEngageEnabled(true, 'pt_nova', 'prop_nova_main', 'z_pool'), true, 'a DIFFERENT zone with no override of its own still resolves via Property=ON normally');

    // ============================================================
    // CORRECTIVE ROUND: full truth table for resolveEngageEnabled()
    // ============================================================
    // Each row uses its OWN fresh, never-before-touched property_id/zone_id
    // strings so no row's override can leak into another's expected result
    // via a shared scope_id from earlier in this test file.
    const { setEngageEnabledOverride } = require('../lib/engage-flags.js');

    // Row 1: Global=OFF always wins, regardless of everything else being ON
    await api('POST', '/api/admin/engage/kill-switch', { enabled: false }, adminToken);
    assertEqual(resolveEngageEnabled(true, 'pt_nova', 'tt_prop_1', 'tt_zone_1'), false, 'TRUTH TABLE row 1: Global=OFF, Contract=ON, no overrides -> OFF (Global always wins)');
    await api('POST', '/api/admin/engage/kill-switch', { enabled: true }, adminToken);

    // Row 2: Contract=OFF always wins over unset Property/Zone
    assertEqual(resolveEngageEnabled(false, 'pt_nova', 'tt_prop_2', 'tt_zone_2'), false, 'TRUTH TABLE row 2: Global=ON, Contract=OFF, no overrides -> OFF (Contract always wins)');

    // Row 3: baseline -- Global ON, Contract ON, nothing set -> ON
    assertEqual(resolveEngageEnabled(true, 'pt_nova', 'tt_prop_3', 'tt_zone_3'), true, 'TRUTH TABLE row 3: Global=ON, Contract=ON, no Property/Zone override -> ON (Contract baseline stands)');

    // Row 4: Property=OFF, no Zone -> OFF
    setEngageEnabledOverride('property', 'tt_prop_4', false, 'test-admin');
    assertEqual(resolveEngageEnabled(true, 'pt_nova', 'tt_prop_4', 'tt_zone_4'), false, 'TRUTH TABLE row 4: Property=OFF, Zone unset -> OFF');

    // Row 5: Property=ON, Zone=OFF -> OFF (Zone more specific)
    setEngageEnabledOverride('property', 'tt_prop_5', true, 'test-admin');
    setEngageEnabledOverride('zone', 'tt_zone_5', false, 'test-admin');
    assertEqual(resolveEngageEnabled(true, 'pt_nova', 'tt_prop_5', 'tt_zone_5'), false, 'TRUTH TABLE row 5: Property=ON, Zone=OFF -> OFF (most specific explicit value wins)');

    // Row 6: *** the exact case flagged in review *** Property=OFF, Zone=ON -> ON
    setEngageEnabledOverride('property', 'tt_prop_6', false, 'test-admin');
    setEngageEnabledOverride('zone', 'tt_zone_6', true, 'test-admin');
    assertEqual(resolveEngageEnabled(true, 'pt_nova', 'tt_prop_6', 'tt_zone_6'), true, 'TRUTH TABLE row 6 (THE FIX): Property=OFF, Zone=ON -> ON -- the most specific explicit value (Zone) wins even when a LESS specific level (Property) says otherwise; this exact case previously resolved incorrectly to OFF before this corrective round');

    // Row 7: Property=ON, Zone=ON -> ON
    setEngageEnabledOverride('property', 'tt_prop_7', true, 'test-admin');
    setEngageEnabledOverride('zone', 'tt_zone_7', true, 'test-admin');
    assertEqual(resolveEngageEnabled(true, 'pt_nova', 'tt_prop_7', 'tt_zone_7'), true, 'TRUTH TABLE row 7: Property=ON, Zone=ON -> ON');

    // Confirms: Zone can NEVER override Global=OFF or Contract=OFF, even
    // with an explicit Zone=ON override in place (reusing row 7's property/zone).
    await api('POST', '/api/admin/engage/kill-switch', { enabled: false }, adminToken);
    assertEqual(resolveEngageEnabled(true, 'pt_nova', 'tt_prop_7', 'tt_zone_7'), false, 'TRUTH TABLE: Global=OFF still wins even with an explicit Zone=ON override in place -- Zone cannot override Global under any configuration');
    await api('POST', '/api/admin/engage/kill-switch', { enabled: true }, adminToken);
    assertEqual(resolveEngageEnabled(false, 'pt_nova', 'tt_prop_7', 'tt_zone_7'), false, 'TRUTH TABLE: Contract=OFF still wins even with an explicit Zone=ON override in place -- Zone cannot override Contract under any configuration');

    // ============================================================
    // NEGATIVE: disabled Engage end-to-end -- worker actually skips pass creation
    // ============================================================
    const platformPlan = db.prepare(`SELECT * FROM plans WHERE code = 'PLATFORM'`).get();
    const platformFeatures = JSON.parse(platformPlan.features_json);
    platformFeatures.engage_enabled = true;
    db.prepare('UPDATE plans SET features_json = ? WHERE id = ?').run(JSON.stringify(platformFeatures), platformPlan.id);
    await api('POST', '/api/admin/subscription', { partnerId: 'pt_alrowad', planCode: 'PLATFORM' }, adminToken);
    await api('POST', '/api/admin/engage/policy-overrides', { scopeType: 'property', scopeId: 'prop_alrowad_hq', enabled: false }, adminToken); // property-level disable, already set above but re-affirm

    const { processOutboxOnce } = require('../lib/engage-worker.js');
    const disabledOrderId = nextOrderId();
    db.prepare(`INSERT INTO orders (id,partner_id,property_id,zone_id,point_id,status,subtotal,vat,total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(disabledOrderId, 'pt_alrowad', 'prop_alrowad_hq', null, 'PT-014', 'Paid', 20, 3, 23, Date.now(), Date.now());
    const { uid } = require('../db.js');
    db.prepare(`INSERT INTO engage_outbox (id,order_id,event_type,status,created_at) VALUES (?,?,?,?,?)`)
      .run(uid('eo'), disabledOrderId, 'order.confirmed', 'pending', Date.now());
    processOutboxOnce();
    const passForDisabled = db.prepare('SELECT * FROM engage_pass WHERE order_id = ?').get(disabledOrderId);
    assert(!passForDisabled, 'DISABLED ENGAGE END-TO-END: with a property-level override disabling Engage, the worker genuinely does NOT create a pass, even though the partner Contract itself allows it');

    // ============================================================
    // Audit trail — every flag/policy change is recorded
    // ============================================================
    const policyAuditEntries = db.prepare(`SELECT * FROM audit_log WHERE action = 'engage_policy_override_set' ORDER BY id DESC LIMIT 5`).all();
    assert(policyAuditEntries.length > 0, 'AUDIT: policy override changes are recorded in the audit log');
    const killSwitchAuditEntries = db.prepare(`SELECT * FROM audit_log WHERE action = 'engage_global_kill_switch_set'`).all();
    assert(killSwitchAuditEntries.length >= 2, 'AUDIT: both kill-switch changes (off, then restored on) were recorded in the audit log');
    assert(killSwitchAuditEntries.every(e => e.actor === 'admin'), 'AUDIT: the kill-switch audit entries correctly attribute the SuperAdmin actor who made the change');

    // ============================================================
    // Core isolation + prior increments regression
    // ============================================================
    const isoOrder = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }] });
    const isoPay = await api('POST', `/api/orders/${isoOrder.data.id}/pay`, { method: 'card' });
    assertEqual(isoPay.data.status, 'Paid', 'ENG-ISO-001 still holds with Inc-6 Feature Flags/Roles code active');

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
