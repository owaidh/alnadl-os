// tests/engage-inc2.js — Phase 5 P5-Inc-2 acceptance tests.
// Context Personality Engine + Engagement Ceiling + Approved Static/Fallback
// Content + Policy Precedence. Boundary tests throughout, not just happy path.
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
// worker entirely (Inc-1 already proved that path works) so these tests can
// deterministically control exactly which zone/property/partner context a
// session resolves against, for every one of the 5 personalities.
function makePass(db, { partnerId, propertyId, zoneId, pointId, orderId }) {
  const { uid } = require('../db.js');
  const now = Date.now();
  db.prepare(`INSERT INTO orders (id,partner_id,property_id,zone_id,point_id,status,subtotal,vat,total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(orderId, partnerId, propertyId, zoneId, pointId, 'Paid', 20, 3, 23, now, now);
  const passId = uid('ep');
  db.prepare(`INSERT INTO engage_pass (id,order_id,context_snapshot_json,status,created_at,expires_at) VALUES (?,?,?,?,?,?)`)
    .run(passId, orderId, JSON.stringify({ partnerId, propertyId, zoneId, orderId }), 'active', now, now + 3600000);
  return passId;
}

async function run() {
  resetCounts();
  await startServer();
  console.log('=== Phase 5 P5-Inc-2 Suite (Personality Engine + Ceiling + Precedence) ===');

  try {
    const adminToken = await loginAs('admin');
    const db = openDirectDb();
    const { setPolicyOverride } = require('../lib/engage-personality.js');
    let orderCounter = 0;
    const nextOrderId = () => `TEST-INC2-${++orderCounter}`;

    // ============================================================
    // Personality resolution — all 5, from real Core signals
    // ============================================================
    const passReset = makePass(db, { partnerId: 'pt_alrowad', propertyId: 'prop_alrowad_hq', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    let r = await api('POST', '/api/engage/session/start', { passId: passReset });
    assertEqual(r.data.personality, 'RESET', 'Corporate property (Al-Rowad HQ, no zone) resolves to RESET');
    assertEqual(r.data.ceilingMax, 1, 'RESET default ceiling is 1');

    const passResetZone = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_meet', pointId: 'PT-033', orderId: nextOrderId() });
    r = await api('POST', '/api/engage/session/start', { passId: passResetZone });
    assertEqual(r.data.personality, 'RESET', 'Business zone (meeting room) resolves to RESET even inside a Hotel property (zone signal wins over property)');

    const passDiscover = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_lobby', pointId: 'PT-014', orderId: nextOrderId() });
    r = await api('POST', '/api/engage/session/start', { passId: passDiscover });
    assertEqual(r.data.personality, 'DISCOVER', 'Hotel property, Lounge zone (no strong zone signal) falls back to property venue_context=hotel -> DISCOVER');
    assertEqual(r.data.ceilingMax, 2, 'DISCOVER default ceiling is 2');

    const passPlay = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId() });
    r = await api('POST', '/api/engage/session/start', { passId: passPlay });
    assertEqual(r.data.personality, 'PLAY', 'Leisure zone (pool deck) resolves to PLAY');
    assertEqual(r.data.ceilingMax, 3, 'PLAY default ceiling is 3');

    // SPARK and MIND have no natural match in seed data — set venue_context
    // directly (legitimate: Inc-2 tests the RESOLVER, not an admin UI to set
    // this, which is separate future scope).
    db.prepare(`UPDATE properties SET venue_context = 'coffee' WHERE id = 'prop_alrowad_hq'`).run();
    const passSpark = makePass(db, { partnerId: 'pt_alrowad', propertyId: 'prop_alrowad_hq', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    r = await api('POST', '/api/engage/session/start', { passId: passSpark });
    assertEqual(r.data.personality, 'SPARK', 'venue_context=coffee resolves to SPARK');
    assertEqual(r.data.ceilingMax, 3, 'SPARK default ceiling is 3');

    db.prepare(`UPDATE properties SET venue_context = 'vip_lounge' WHERE id = 'prop_alrowad_hq'`).run();
    const passMind = makePass(db, { partnerId: 'pt_alrowad', propertyId: 'prop_alrowad_hq', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    r = await api('POST', '/api/engage/session/start', { passId: passMind });
    assertEqual(r.data.personality, 'MIND', 'venue_context=vip_lounge resolves to MIND');
    assertEqual(r.data.ceilingMax, 1, 'MIND default ceiling is 1');
    db.prepare(`UPDATE properties SET venue_context = 'corporate' WHERE id = 'prop_alrowad_hq'`).run(); // restore for later tests

    // ============================================================
    // Boundary tests — every personality's ceiling, not just happy path
    // ============================================================
    // RESET: exactly 1, then blocked, verified via the actual bypass attempt
    // (re-calling session/start after the session auto-ends).
    const passResetFlow = makePass(db, { partnerId: 'pt_alrowad', propertyId: 'prop_alrowad_hq', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    const resetStart = await api('POST', '/api/engage/session/start', { passId: passResetFlow });
    const resetSessionId = resetStart.data.id;
    const resetM1 = await api('POST', `/api/engage/session/${resetSessionId}/next-moment`);
    assertEqual(resetM1.status, 200, 'RESET: first moment serves successfully');
    assert(resetM1.data.sessionEnded, 'RESET: session auto-ends immediately after the 1st moment (ceiling=1 reached)');
    const resetM2 = await api('POST', `/api/engage/session/${resetSessionId}/next-moment`);
    assertEqual(resetM2.status, 409, 'RESET: a 2nd moment on the same session is rejected (409)');
    const resetReEntry = await api('POST', '/api/engage/session/start', { passId: passResetFlow });
    assertEqual(resetReEntry.data.id, resetSessionId, 'RESET: re-calling session/start for the same pass returns the SAME (already-ended) session, not a fresh one -- this is the exact bypass this suite specifically checks for');
    const resetBypassAttempt = await api('POST', `/api/engage/session/${resetReEntry.data.id}/next-moment`);
    assertEqual(resetBypassAttempt.status, 409, 'RESET: serving a moment via the re-entry session is still blocked -- no replay bypass possible');
    const totalResetMoments = db.prepare('SELECT COUNT(*) c FROM moment WHERE session_id = ?').get(resetSessionId).c;
    assertEqual(totalResetMoments, 1, 'RESET: exactly 1 moment was EVER served for this pass, across all attempts');

    // SPARK: default ceiling 3 — serve exactly 3, 4th rejected
    const passSpark2 = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    db.prepare(`UPDATE properties SET venue_context = 'coffee' WHERE id = 'prop_nova_main'`).run();
    const sparkStart = await api('POST', '/api/engage/session/start', { passId: passSpark2 });
    for (let i = 1; i <= 3; i++) {
      const m = await api('POST', `/api/engage/session/${sparkStart.data.id}/next-moment`);
      assertEqual(m.status, 200, `SPARK: moment ${i}/3 serves successfully`);
    }
    const sparkOverflow = await api('POST', `/api/engage/session/${sparkStart.data.id}/next-moment`);
    assertEqual(sparkOverflow.status, 409, 'SPARK: the 4th moment (beyond ceiling=3) is rejected');
    db.prepare(`UPDATE properties SET venue_context = 'hotel' WHERE id = 'prop_nova_main'`).run(); // restore

    // MIND: default 1, then property override raises it to 2 for a NEW pass
    const passMind1 = makePass(db, { partnerId: 'pt_alrowad', propertyId: 'prop_alrowad_hq', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    db.prepare(`UPDATE properties SET venue_context = 'vip_lounge' WHERE id = 'prop_alrowad_hq'`).run();
    const mind1Start = await api('POST', '/api/engage/session/start', { passId: passMind1 });
    assertEqual(mind1Start.data.ceilingMax, 1, 'MIND: default ceiling 1 with no override');
    const mind1M1 = await api('POST', `/api/engage/session/${mind1Start.data.id}/next-moment`);
    assertEqual(mind1M1.data.sessionEnded, true, 'MIND: session ends after 1 moment at the default ceiling');

    setPolicyOverride('property', 'prop_alrowad_hq', 'MIND', 2, 'test-admin');
    const passMind2 = makePass(db, { partnerId: 'pt_alrowad', propertyId: 'prop_alrowad_hq', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    const mind2Start = await api('POST', '/api/engage/session/start', { passId: passMind2 });
    assertEqual(mind2Start.data.ceilingMax, 2, 'MIND: property override correctly RAISES the ceiling from default 1 to 2 (venue policy extending MIND, as the source spec explicitly allows)');
    const mind2M1 = await api('POST', `/api/engage/session/${mind2Start.data.id}/next-moment`);
    assertEqual(mind2M1.data.sessionEnded, false, 'MIND with override=2: session does NOT end after moment 1');
    const mind2M2 = await api('POST', `/api/engage/session/${mind2Start.data.id}/next-moment`);
    assertEqual(mind2M2.data.sessionEnded, true, 'MIND with override=2: session ends after moment 2');
    const mind2M3 = await api('POST', `/api/engage/session/${mind2Start.data.id}/next-moment`);
    assertEqual(mind2M3.status, 409, 'MIND with override=2: a 3rd moment is still rejected (respects the override ceiling, not the hard cap of 3)');

    // ============================================================
    // Policy Precedence — Global Safety, Contract prohibition, specificity
    // ============================================================
    // Global Safety: no override, at any level, can raise RESET above 1.
    setPolicyOverride('zone', 'z_meet', 'RESET', 5, 'test-admin');
    const passResetOverride = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_meet', pointId: 'PT-033', orderId: nextOrderId() });
    const resetOverrideStart = await api('POST', '/api/engage/session/start', { passId: passResetOverride });
    assertEqual(resetOverrideStart.data.ceilingMax, 1, 'GLOBAL SAFETY: a zone override attempting to set RESET ceiling=5 is clamped back to 1 -- Global Safety cannot be exceeded by any override');

    // Contract prohibition: Partner-level restriction blocks a more specific Property override from exceeding it.
    setPolicyOverride('partner', 'pt_nova', 'SPARK', 1, 'test-admin');
    setPolicyOverride('property', 'prop_nova_main', 'SPARK', 3, 'test-admin'); // property tries to raise back to 3
    db.prepare(`UPDATE properties SET venue_context = 'coffee' WHERE id = 'prop_nova_main'`).run();
    const passContractTest = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    const contractTestStart = await api('POST', '/api/engage/session/start', { passId: passContractTest });
    assertEqual(contractTestStart.data.ceilingMax, 1, 'CONTRACT PROHIBITION: Partner Contract sets SPARK ceiling=1; a more specific Property override trying to raise it to 3 is blocked -- the lower level cannot exceed Contract prohibition');
    db.prepare(`UPDATE properties SET venue_context = 'hotel' WHERE id = 'prop_nova_main'`).run(); // restore

    // Specificity: Zone wins over Property when both are more restrictive than default and neither is blocked by Contract.
    setPolicyOverride('property', 'prop_nova_main', 'PLAY', 2, 'test-admin');
    setPolicyOverride('zone', 'z_pool', 'PLAY', 1, 'test-admin');
    const passSpecificity = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId() });
    const specificityStart = await api('POST', '/api/engage/session/start', { passId: passSpecificity });
    assertEqual(specificityStart.data.ceilingMax, 1, 'SPECIFICITY: Zone override (1) wins over Property override (2) -- most specific level applies when nothing more restrictive blocks it');

    // ============================================================
    // Session/Pass linkage + termination correctness
    // ============================================================
    const linkCheck = db.prepare('SELECT pass_id FROM engage_session WHERE id = ?').get(specificityStart.data.id);
    assertEqual(linkCheck.pass_id, passSpecificity, 'engage_session.pass_id correctly links back to the Engage Pass that created it');

    const endResult = await api('POST', `/api/engage/session/${sparkStart.data.id}/end`);
    assertEqual(endResult.data.status, 'ended', 'explicit session/end sets status to ended');
    const endAgain = await api('POST', `/api/engage/session/${sparkStart.data.id}/end`);
    assertEqual(endAgain.status, 200, 'ending an already-ended session is idempotent, not an error');

    // Non-existent pass/session handled gracefully
    const badPass = await api('POST', '/api/engage/session/start', { passId: 'nonexistent-pass-xyz' });
    assertEqual(badPass.status, 404, 'starting a session for a nonexistent pass returns 404');
    const badSession = await api('POST', '/api/engage/session/nonexistent-session-xyz/next-moment');
    assertEqual(badSession.status, 404, 'serving a moment for a nonexistent session returns 404');

    // ============================================================
    // Regression: Inc-1 isolation still holds with Inc-2's new code loaded
    // ============================================================
    const isoOrder = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }] });
    const isoPay = await api('POST', `/api/orders/${isoOrder.data.id}/pay`, { method: 'card' });
    assertEqual(isoPay.data.status, 'Paid', 'ENG-ISO-001 still holds: ordinary payment unaffected by Inc-2 Personality/Session code');

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
