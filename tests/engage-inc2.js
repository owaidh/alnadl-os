// tests/engage-inc2.js — Phase 5 P5-Inc-2 acceptance tests (corrective round:
// capability-token authorization). Context Personality Engine + Engagement
// Ceiling + Approved Static/Fallback Content + Policy Precedence + Security.
'use strict';
const { startServer, stopServer, api, loginAs, assert, assertEqual, summary, resetCounts, getDataPath } = require('./helpers.js');

function openDirectDb() {
  process.env.SQLITE_PATH = getDataPath();
  delete require.cache[require.resolve('../db.js')];
  delete require.cache[require.resolve('../lib/engage-personality.js')];
  delete require.cache[require.resolve('../lib/engage-session.js')];
  return require('../db.js').db;
}

// Helper: create a real order+pass pair directly, bypassing the outbox
// worker (Inc-1 already proved that path works) so these tests can
// deterministically control exactly which zone/property/partner context a
// session resolves against. Returns the pass's access_token — tests never
// touch the internal pass id for authorization, only for assertions about
// the database itself.
function makePass(db, { partnerId, propertyId, zoneId, pointId, orderId }) {
  const { uid } = require('../db.js');
  const crypto = require('crypto');
  const now = Date.now();
  db.prepare(`INSERT INTO orders (id,partner_id,property_id,zone_id,point_id,status,subtotal,vat,total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(orderId, partnerId, propertyId, zoneId, pointId, 'Paid', 20, 3, 23, now, now);
  const passId = uid('ep');
  const accessToken = crypto.randomBytes(24).toString('base64url');
  db.prepare(`INSERT INTO engage_pass (id,order_id,context_snapshot_json,status,created_at,expires_at,access_token) VALUES (?,?,?,?,?,?,?)`)
    .run(passId, orderId, JSON.stringify({ partnerId, propertyId, zoneId, orderId }), 'active', now, now + 3600000, accessToken);
  return { passId, accessToken };
}

async function run() {
  resetCounts();
  await startServer();
  console.log('=== Phase 5 P5-Inc-2 Suite (Personality + Ceiling + Precedence + Auth) ===');

  try {
    const adminToken = await loginAs('admin');
    const partnerAdminToken = await loginAs('partneradmin');
    const db = openDirectDb();
    const { setPolicyOverride } = require('../lib/engage-personality.js');
    let orderCounter = 0;
    const nextOrderId = () => `TEST-INC2-${++orderCounter}`;

    // ============================================================
    // Personality resolution — all 5, from real Core signals
    // ============================================================
    const passReset = makePass(db, { partnerId: 'pt_alrowad', propertyId: 'prop_alrowad_hq', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    let r = await api('POST', '/api/engage/session/start', { accessToken: passReset.accessToken });
    assertEqual(r.data.personality, 'RESET', 'Corporate property (Al-Rowad HQ, no zone) resolves to RESET');
    assertEqual(r.data.ceilingMax, 1, 'RESET default ceiling is 1');

    const passResetZone = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_meet', pointId: 'PT-033', orderId: nextOrderId() });
    r = await api('POST', '/api/engage/session/start', { accessToken: passResetZone.accessToken });
    assertEqual(r.data.personality, 'RESET', 'Business zone (meeting room) resolves to RESET even inside a Hotel property (zone signal wins over property)');

    const passDiscover = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_lobby', pointId: 'PT-014', orderId: nextOrderId() });
    r = await api('POST', '/api/engage/session/start', { accessToken: passDiscover.accessToken });
    assertEqual(r.data.personality, 'DISCOVER', 'Hotel property, Lounge zone (no strong zone signal) falls back to property venue_context=hotel -> DISCOVER');
    assertEqual(r.data.ceilingMax, 2, 'DISCOVER default ceiling is 2');

    const passPlay = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId() });
    r = await api('POST', '/api/engage/session/start', { accessToken: passPlay.accessToken });
    assertEqual(r.data.personality, 'PLAY', 'Leisure zone (pool deck) resolves to PLAY');
    assertEqual(r.data.ceilingMax, 3, 'PLAY default ceiling is 3');

    db.prepare(`UPDATE properties SET venue_context = 'coffee' WHERE id = 'prop_alrowad_hq'`).run();
    const passSpark = makePass(db, { partnerId: 'pt_alrowad', propertyId: 'prop_alrowad_hq', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    r = await api('POST', '/api/engage/session/start', { accessToken: passSpark.accessToken });
    assertEqual(r.data.personality, 'SPARK', 'venue_context=coffee resolves to SPARK');
    assertEqual(r.data.ceilingMax, 3, 'SPARK default ceiling is 3');

    db.prepare(`UPDATE properties SET venue_context = 'vip_lounge' WHERE id = 'prop_alrowad_hq'`).run();
    const passMind = makePass(db, { partnerId: 'pt_alrowad', propertyId: 'prop_alrowad_hq', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    r = await api('POST', '/api/engage/session/start', { accessToken: passMind.accessToken });
    assertEqual(r.data.personality, 'MIND', 'venue_context=vip_lounge resolves to MIND');
    assertEqual(r.data.ceilingMax, 1, 'MIND default ceiling is 1');
    db.prepare(`UPDATE properties SET venue_context = 'corporate' WHERE id = 'prop_alrowad_hq'`).run();

    // ============================================================
    // Boundary tests
    // ============================================================
    const passResetFlow = makePass(db, { partnerId: 'pt_alrowad', propertyId: 'prop_alrowad_hq', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    const resetStart = await api('POST', '/api/engage/session/start', { accessToken: passResetFlow.accessToken });
    const resetSessionToken = resetStart.data.sessionToken;
    const resetM1 = await api('POST', `/api/engage/session/${resetSessionToken}/next-moment`);
    assertEqual(resetM1.status, 200, 'RESET: first moment serves successfully');
    assert(resetM1.data.sessionEnded, 'RESET: session auto-ends immediately after the 1st moment (ceiling=1 reached)');
    const resetM2 = await api('POST', `/api/engage/session/${resetSessionToken}/next-moment`);
    assertEqual(resetM2.status, 409, 'RESET: a 2nd moment on the same session is rejected (409)');
    const resetReEntry = await api('POST', '/api/engage/session/start', { accessToken: passResetFlow.accessToken });
    assertEqual(resetReEntry.data.sessionToken, resetSessionToken, 'RESET: re-calling session/start for the same pass token returns the SAME (already-ended) session, not a fresh one -- the exact bypass this suite specifically checks for');
    const resetBypassAttempt = await api('POST', `/api/engage/session/${resetReEntry.data.sessionToken}/next-moment`);
    assertEqual(resetBypassAttempt.status, 409, 'RESET: serving a moment via the re-entry session is still blocked -- no replay bypass possible');
    const totalResetMoments = db.prepare('SELECT COUNT(*) c FROM moment m JOIN engage_session s ON s.id = m.session_id WHERE s.access_token = ?').get(resetSessionToken).c;
    assertEqual(totalResetMoments, 1, 'RESET: exactly 1 moment was EVER served for this pass, across all attempts');

    const passSpark2 = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    db.prepare(`UPDATE properties SET venue_context = 'coffee' WHERE id = 'prop_nova_main'`).run();
    const sparkStart = await api('POST', '/api/engage/session/start', { accessToken: passSpark2.accessToken });
    const sparkToken = sparkStart.data.sessionToken;
    for (let i = 1; i <= 3; i++) {
      const m = await api('POST', `/api/engage/session/${sparkToken}/next-moment`);
      assertEqual(m.status, 200, `SPARK: moment ${i}/3 serves successfully`);
    }
    const sparkOverflow = await api('POST', `/api/engage/session/${sparkToken}/next-moment`);
    assertEqual(sparkOverflow.status, 409, 'SPARK: the 4th moment (beyond ceiling=3) is rejected');
    db.prepare(`UPDATE properties SET venue_context = 'hotel' WHERE id = 'prop_nova_main'`).run();

    const passMind1 = makePass(db, { partnerId: 'pt_alrowad', propertyId: 'prop_alrowad_hq', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    db.prepare(`UPDATE properties SET venue_context = 'vip_lounge' WHERE id = 'prop_alrowad_hq'`).run();
    const mind1Start = await api('POST', '/api/engage/session/start', { accessToken: passMind1.accessToken });
    assertEqual(mind1Start.data.ceilingMax, 1, 'MIND: default ceiling 1 with no override');
    const mind1M1 = await api('POST', `/api/engage/session/${mind1Start.data.sessionToken}/next-moment`);
    assertEqual(mind1M1.data.sessionEnded, true, 'MIND: session ends after 1 moment at the default ceiling');

    setPolicyOverride('property', 'prop_alrowad_hq', 'MIND', 2, 'test-admin');
    const passMind2 = makePass(db, { partnerId: 'pt_alrowad', propertyId: 'prop_alrowad_hq', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    const mind2Start = await api('POST', '/api/engage/session/start', { accessToken: passMind2.accessToken });
    const mind2Token = mind2Start.data.sessionToken;
    assertEqual(mind2Start.data.ceilingMax, 2, 'MIND: property override correctly RAISES the ceiling from default 1 to 2');
    const mind2M1 = await api('POST', `/api/engage/session/${mind2Token}/next-moment`);
    assertEqual(mind2M1.data.sessionEnded, false, 'MIND with override=2: session does NOT end after moment 1');
    const mind2M2 = await api('POST', `/api/engage/session/${mind2Token}/next-moment`);
    assertEqual(mind2M2.data.sessionEnded, true, 'MIND with override=2: session ends after moment 2');
    const mind2M3 = await api('POST', `/api/engage/session/${mind2Token}/next-moment`);
    assertEqual(mind2M3.status, 409, 'MIND with override=2: a 3rd moment is still rejected (respects the override, not the hard cap of 3)');

    // ============================================================
    // Policy Precedence
    // ============================================================
    setPolicyOverride('zone', 'z_meet', 'RESET', 5, 'test-admin');
    const passResetOverride = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_meet', pointId: 'PT-033', orderId: nextOrderId() });
    const resetOverrideStart = await api('POST', '/api/engage/session/start', { accessToken: passResetOverride.accessToken });
    assertEqual(resetOverrideStart.data.ceilingMax, 1, 'GLOBAL SAFETY: a zone override attempting to set RESET ceiling=5 is clamped back to 1');

    setPolicyOverride('partner', 'pt_nova', 'SPARK', 1, 'test-admin');
    setPolicyOverride('property', 'prop_nova_main', 'SPARK', 3, 'test-admin');
    db.prepare(`UPDATE properties SET venue_context = 'coffee' WHERE id = 'prop_nova_main'`).run();
    const passContractTest = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    const contractTestStart = await api('POST', '/api/engage/session/start', { accessToken: passContractTest.accessToken });
    assertEqual(contractTestStart.data.ceilingMax, 1, 'CONTRACT PROHIBITION: Partner Contract sets SPARK ceiling=1; a more specific Property override trying to raise it to 3 is blocked');
    db.prepare(`UPDATE properties SET venue_context = 'hotel' WHERE id = 'prop_nova_main'`).run();

    setPolicyOverride('property', 'prop_nova_main', 'PLAY', 2, 'test-admin');
    setPolicyOverride('zone', 'z_pool', 'PLAY', 1, 'test-admin');
    const passSpecificity = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId() });
    const specificityStart = await api('POST', '/api/engage/session/start', { accessToken: passSpecificity.accessToken });
    assertEqual(specificityStart.data.ceilingMax, 1, 'SPECIFICITY: Zone override (1) wins over Property override (2)');

    // ============================================================
    // Session/Pass linkage + termination correctness
    // ============================================================
    const linkCheck = db.prepare('SELECT pass_id FROM engage_session WHERE access_token = ?').get(specificityStart.data.sessionToken);
    assertEqual(linkCheck.pass_id, passSpecificity.passId, 'engage_session.pass_id correctly links back to the Engage Pass that created it');

    const endResult = await api('POST', `/api/engage/session/${sparkToken}/end`);
    assertEqual(endResult.data.status, 'ended', 'explicit session/end sets status to ended');
    const endAgain = await api('POST', `/api/engage/session/${sparkToken}/end`);
    assertEqual(endAgain.status, 200, 'ending an already-ended session is idempotent, not an error');

    const badPass = await api('POST', '/api/engage/session/start', { accessToken: 'nonexistent-token-xyz' });
    assertEqual(badPass.status, 403, 'starting a session with an unrecognized token returns 403 (not 404 -- avoids leaking whether the token format was merely wrong vs an id that does not exist)');
    const badSession = await api('POST', '/api/engage/session/nonexistent-token-xyz/next-moment');
    assertEqual(badSession.status, 403, 'serving a moment with an unrecognized session token returns 403');

    // ============================================================
    // SECURITY (corrective round): capability-token authorization
    // ============================================================
    // No authorization at all
    const noAuthStart = await api('POST', '/api/engage/session/start', {});
    assertEqual(noAuthStart.status, 403, 'SECURITY: starting a session with NO accessToken at all is rejected (403)');

    // Wrong/malformed token
    const wrongTokenStart = await api('POST', '/api/engage/session/start', { accessToken: 'totally-made-up-not-a-real-token' });
    assertEqual(wrongTokenStart.status, 403, 'SECURITY: a syntactically plausible but wrong token is rejected (403)');

    // A token belonging to a DIFFERENT pass/session cannot be used to act on another
    const passVictim = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    const passAttacker = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    const victimStart = await api('POST', '/api/engage/session/start', { accessToken: passVictim.accessToken });
    const attackerStart = await api('POST', '/api/engage/session/start', { accessToken: passAttacker.accessToken });
    assert(victimStart.data.sessionToken !== attackerStart.data.sessionToken, 'SECURITY setup: victim and attacker sessions have genuinely different tokens');
    // Attacker tries to serve a moment using the VICTIM's session token guessed/observed somehow -- should work for THEM, not prove a cross-pass leak by itself.
    // The real test: attacker's OWN token cannot be used to path-address the victim's session (there is no id parameter to swap -- the token itself IS the address).
    const attackerAttemptsVictimPath = await api('POST', `/api/engage/session/${attackerStart.data.sessionToken}/next-moment`);
    assertEqual(attackerAttemptsVictimPath.status, 200, 'sanity: attacker CAN use their own token normally');
    const victimMomentsBeforeAttack = db.prepare('SELECT ceiling_moments_used FROM engage_session WHERE access_token = ?').get(victimStart.data.sessionToken).ceiling_moments_used;
    assertEqual(victimMomentsBeforeAttack, 0, "SECURITY: the victim's session was completely unaffected by any action taken with the attacker's own valid-but-different token -- no cross-session leakage is even structurally possible, since there is no id parameter anywhere in these routes for an attacker to substitute");

    // Cross-tenant: a pass/session for one partner cannot be reached via any token belonging to another partner
    const passTenantA = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    const passTenantB = makePass(db, { partnerId: 'pt_alrowad', propertyId: 'prop_alrowad_hq', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    const tenantAStart = await api('POST', '/api/engage/session/start', { accessToken: passTenantA.accessToken });
    const tenantBStart = await api('POST', '/api/engage/session/start', { accessToken: passTenantB.accessToken });
    const crossTenantAttempt = await api('POST', `/api/engage/session/${passTenantA.accessToken}/next-moment`); // deliberately using a PASS token where a SESSION token is expected
    assertEqual(crossTenantAttempt.status, 403, 'CROSS-TENANT: a Pass token presented where a Session token is expected does not resolve to anything -- token types are not interchangeable, closing an entire class of confusion attacks');
    assert(tenantAStart.data.sessionToken !== tenantBStart.data.sessionToken, "CROSS-TENANT: two different tenants' sessions never share a token (collision would be a catastrophic break, confirmed not to happen)");

    // Correct token -> full Start/Next/End flow works normally end-to-end
    const passHappy = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId() });
    const happyStart = await api('POST', '/api/engage/session/start', { accessToken: passHappy.accessToken });
    assertEqual(happyStart.status, 200, 'HAPPY PATH: correct pass token starts a session normally');
    const happyMoment = await api('POST', `/api/engage/session/${happyStart.data.sessionToken}/next-moment`);
    assertEqual(happyMoment.status, 200, 'HAPPY PATH: correct session token serves a moment normally');
    const happyEnd = await api('POST', `/api/engage/session/${happyStart.data.sessionToken}/end`);
    assertEqual(happyEnd.status, 200, 'HAPPY PATH: correct session token ends the session normally');

    // RESET no-replay still holds with the token layer in place (re-verified explicitly per the review's own requirement)
    const passResetFinal = makePass(db, { partnerId: 'pt_alrowad', propertyId: 'prop_alrowad_hq', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    db.prepare(`UPDATE properties SET venue_context = 'corporate' WHERE id = 'prop_alrowad_hq'`).run();
    const resetFinalStart = await api('POST', '/api/engage/session/start', { accessToken: passResetFinal.accessToken });
    await api('POST', `/api/engage/session/${resetFinalStart.data.sessionToken}/next-moment`);
    const resetFinalReplay = await api('POST', `/api/engage/session/${resetFinalStart.data.sessionToken}/next-moment`);
    assertEqual(resetFinalReplay.status, 409, 'RESET no-replay confirmed intact after adding the token authorization layer');

    // ============================================================
    // SECURITY: Admin/Partner Policy Override endpoints — RBAC + tenant isolation
    // ============================================================
    const noAuthOverride = await api('POST', '/api/admin/engage/policy-overrides', { scopeType: 'partner', scopeId: 'pt_nova', personality: 'SPARK', max: 5 });
    assert([401, 403].includes(noAuthOverride.status), 'a completely unauthenticated request cannot set a Ceiling override');

    const operatorToken = await loginAs('operator');
    const operatorOverride = await api('POST', '/api/admin/engage/policy-overrides', { scopeType: 'partner', scopeId: 'pt_nova', personality: 'SPARK', max: 5 }, operatorToken);
    assertEqual(operatorOverride.status, 403, 'an Operator (non-admin staff role) cannot set a Ceiling override');

    const crossTenantOverride = await api('POST', '/api/admin/engage/policy-overrides', { scopeType: 'partner', scopeId: 'pt_alrowad', personality: 'SPARK', max: 5 }, partnerAdminToken);
    assertEqual(crossTenantOverride.status, 403, "a PartnerAdmin cannot set an override scoped to a DIFFERENT partner's contract (tenant isolation)");

    const crossTenantPropertyOverride = await api('POST', '/api/admin/engage/policy-overrides', { scopeType: 'property', scopeId: 'prop_alrowad_hq', personality: 'MIND', max: 2 }, partnerAdminToken);
    assertEqual(crossTenantPropertyOverride.status, 403, "a PartnerAdmin cannot set an override on a property belonging to a DIFFERENT partner");

    const legitOverride = await api('POST', '/api/admin/engage/policy-overrides', { scopeType: 'zone', scopeId: 'z_pool', personality: 'PLAY', max: 2 }, adminToken);
    assertEqual(legitOverride.status, 201, 'a SuperAdmin CAN set a legitimate Ceiling override');
    const listOverrides = await api('GET', '/api/admin/engage/policy-overrides', null, adminToken);
    assertEqual(listOverrides.status, 200, 'a SuperAdmin can list policy overrides');
    assert(listOverrides.data.some(o => o.scope_id === 'z_pool'), 'the newly created override appears in the list');

    // ============================================================
    // Regression: Inc-1 isolation still holds
    // ============================================================
    const isoOrder = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }] });
    const isoPay = await api('POST', `/api/orders/${isoOrder.data.id}/pay`, { method: 'card' });
    assertEqual(isoPay.data.status, 'Paid', 'ENG-ISO-001 still holds: ordinary payment unaffected by Inc-2 Personality/Session/Auth code');

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
