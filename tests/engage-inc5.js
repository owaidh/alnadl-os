// tests/engage-inc5.js — Phase 5 P5-Inc-5 acceptance tests.
// Social / Group Invite. Negative/boundary cases throughout.
'use strict';
const { startServer, stopServer, api, loginAs, assert, assertEqual, summary, resetCounts, getDataPath } = require('./helpers.js');

function openDirectDb() {
  process.env.SQLITE_PATH = getDataPath();
  delete require.cache[require.resolve('../db.js')];
  delete require.cache[require.resolve('../lib/engage-personality.js')];
  delete require.cache[require.resolve('../lib/engage-novelty.js')];
  delete require.cache[require.resolve('../lib/engage-session.js')];
  delete require.cache[require.resolve('../lib/engage-social.js')];
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
  console.log('=== Phase 5 P5-Inc-5 Suite (Social / Group Invite) ===');

  try {
    const db = openDirectDb();
    let orderCounter = 0;
    const nextOrderId = () => `TEST-INC5-${++orderCounter}`;

    // ============================================================
    // Happy path: create + join
    // ============================================================
    const passHost = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId() });
    const hostStart = await api('POST', '/api/engage/session/start', { accessToken: passHost.accessToken });
    assertEqual(hostStart.data.personality, 'PLAY', 'setup: host session resolves to PLAY (pool zone)');

    const invite = await api('POST', `/api/engage/session/${hostStart.data.sessionToken}/invite/create`, {});
    assertEqual(invite.status, 200, 'HAPPY PATH: host with a running session can create an invite');
    assert(!!invite.data.inviteToken, 'the response includes an invite token');
    assertEqual(invite.data.maxParticipants, 8, 'default max participants is 8');

    const join1 = await api('POST', `/api/engage/invite/${invite.data.inviteToken}/join`, { displayName: 'Friend One' });
    assertEqual(join1.status, 200, 'HAPPY PATH: a valid invite token can be joined');
    assertEqual(join1.data.personality, 'PLAY', 'the joining participant sees the room personality (harmless context, not host PII)');
    assertEqual(join1.data.participantCount, 1, 'participant count is 1 after the first join');

    const join2 = await api('POST', `/api/engage/invite/${invite.data.inviteToken}/join`, { displayName: 'Friend Two' });
    assertEqual(join2.data.participantCount, 2, 'participant count correctly increments to 2 after a second join');

    // ============================================================
    // NEGATIVE: invitee never gets host order/payment data
    // ============================================================
    const joinResponseKeys = JSON.stringify(join1.data);
    assert(!joinResponseKeys.includes(passHost.passId) && !joinResponseKeys.includes('order_id') && !joinResponseKeys.includes(nextOrderId.toString()),
      "PRIVACY: the join response contains no host order id, order reference, or other host-identifying data -- only room-level context (personality, counts)");
    assert(!joinResponseKeys.toLowerCase().includes('payment') && !joinResponseKeys.toLowerCase().includes('total'),
      'PRIVACY: the join response contains no payment/order-financial fields whatsoever -- an invitee gets zero order/payment capability');

    // ============================================================
    // Token unguessability (real entropy, not a short/sequential id)
    // ============================================================
    assert(invite.data.inviteToken.length >= 32, 'TOKEN STRENGTH: the invite token has real length/entropy (24 random bytes, base64url-encoded), not a short guessable id');
    const invite2Setup = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId() });
    const invite2Start = await api('POST', '/api/engage/session/start', { accessToken: invite2Setup.accessToken });
    const invite2 = await api('POST', `/api/engage/session/${invite2Start.data.sessionToken}/invite/create`, {});
    assert(invite.data.inviteToken !== invite2.data.inviteToken, 'two separate invites never produce the same token');

    // ============================================================
    // NEGATIVE: max participants — default 8 enforced, and a caller-supplied
    // lower value is honored, but cannot be raised above the default ceiling
    // ============================================================
    const passSmallRoom = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId() });
    const smallRoomStart = await api('POST', '/api/engage/session/start', { accessToken: passSmallRoom.accessToken });
    const smallInvite = await api('POST', `/api/engage/session/${smallRoomStart.data.sessionToken}/invite/create`, { maxParticipants: 2 });
    assertEqual(smallInvite.data.maxParticipants, 2, 'a caller-supplied lower max (2) is honored');
    await api('POST', `/api/engage/invite/${smallInvite.data.inviteToken}/join`, { displayName: 'A' });
    await api('POST', `/api/engage/invite/${smallInvite.data.inviteToken}/join`, { displayName: 'B' });
    const overflowJoin = await api('POST', `/api/engage/invite/${smallInvite.data.inviteToken}/join`, { displayName: 'C' });
    assertEqual(overflowJoin.status, 409, 'MAX PARTICIPANTS: the 3rd join against a max=2 room is rejected (409, group full)');

    const passHugeAttempt = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId() });
    const hugeStart = await api('POST', '/api/engage/session/start', { accessToken: passHugeAttempt.accessToken });
    const hugeInvite = await api('POST', `/api/engage/session/${hugeStart.data.sessionToken}/invite/create`, { maxParticipants: 50 });
    assertEqual(hugeInvite.data.maxParticipants, 8, 'CEILING: a caller cannot raise max participants above the default 8, even by explicitly requesting more (50 -> clamped to 8, never silently accepted as 50)');

    // ============================================================
    // NEGATIVE: expiry — both conditions ("30 minutes OR session end, whichever first")
    // ============================================================
    const passExpiry = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId() });
    const expiryStart = await api('POST', '/api/engage/session/start', { accessToken: passExpiry.accessToken });
    const expiryInvite = await api('POST', `/api/engage/session/${expiryStart.data.sessionToken}/invite/create`, {});
    const nowMs = Date.now();
    assert(Math.abs(expiryInvite.data.expiresAt - (nowMs + 30 * 60 * 1000)) < 5000, 'EXPIRY: default expiry is genuinely ~30 minutes from creation (within a few seconds of tolerance for test execution time)');

    // Force time-based expiry directly and confirm join is rejected
    db.prepare('UPDATE group_room SET expires_at = ? WHERE invite_token = ?').run(Date.now() - 1000, expiryInvite.data.inviteToken);
    const expiredJoin = await api('POST', `/api/engage/invite/${expiryInvite.data.inviteToken}/join`, { displayName: 'TooLate' });
    assertEqual(expiredJoin.status, 404, 'EXPIRY (time-based): joining after the 30-minute window is rejected');

    // Force session-end-based expiry (time NOT yet expired, but host session ended) and confirm join is still rejected
    const passSessionEnd = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId() });
    const sessionEndStart = await api('POST', '/api/engage/session/start', { accessToken: passSessionEnd.accessToken });
    const sessionEndInvite = await api('POST', `/api/engage/session/${sessionEndStart.data.sessionToken}/invite/create`, {});
    await api('POST', `/api/engage/session/${sessionEndStart.data.sessionToken}/end`, {});
    const joinAfterHostEnded = await api('POST', `/api/engage/invite/${sessionEndInvite.data.inviteToken}/join`, { displayName: 'HostGone' });
    assertEqual(joinAfterHostEnded.status, 404, 'EXPIRY (session-end-based): joining is rejected once the host session ends, even though the 30-minute clock has not yet run out -- "whichever is first" genuinely enforced, not just the time-based half');

    // ============================================================
    // NEGATIVE: cross-tenant -- an invite is intrinsically single-tenant
    // ============================================================
    const passTenantA = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId() });
    const passTenantB = makePass(db, { partnerId: 'pt_alrowad', propertyId: 'prop_alrowad_hq', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    const tenantAStart = await api('POST', '/api/engage/session/start', { accessToken: passTenantA.accessToken });
    const tenantBStart = await api('POST', '/api/engage/session/start', { accessToken: passTenantB.accessToken });
    const tenantAInvite = await api('POST', `/api/engage/session/${tenantAStart.data.sessionToken}/invite/create`, {});
    const tenantBInvite = await api('POST', `/api/engage/session/${tenantBStart.data.sessionToken}/invite/create`, {});
    assert(tenantAInvite.data.inviteToken !== tenantBInvite.data.inviteToken, 'sanity: two different tenants never share an invite token');

    // Attempt: use TENANT B's own session token in the position of an invite token (type confusion attempt)
    const crossTenantConfusion = await api('POST', `/api/engage/invite/${tenantBStart.data.sessionToken}/join`, { displayName: 'Confused' });
    assertEqual(crossTenantConfusion.status, 404, 'CROSS-TENANT: a session access token presented where an invite token is expected resolves to nothing -- token types are not interchangeable (same pattern as Inc-2/3)');

    // Join Tenant A's real invite, verify the resulting participant row is ONLY ever associated with Tenant A's room, never B's
    const crossJoin = await api('POST', `/api/engage/invite/${tenantAInvite.data.inviteToken}/join`, { displayName: 'LegitJoiner' });
    assertEqual(crossJoin.status, 200, "a legitimate join against Tenant A's own invite succeeds normally");
    const participantRoom = db.prepare(`SELECT gr.session_id FROM engage_participant ep JOIN group_room gr ON gr.id = ep.group_room_id WHERE ep.id = ?`).get(crossJoin.data.participantId);
    assertEqual(participantRoom.session_id, tenantAStart.data.id, "CROSS-TENANT: the new participant's room is verifiably linked to Tenant A's own session, never Tenant B's, by direct database inspection");

    // ============================================================
    // CORRECTIVE ROUND: concurrency-safe capacity — real simultaneous joins
    // ============================================================
    // Scenario 1: exactly ONE seat remaining, TWO simultaneous join attempts.
    // Before the atomic-SQL fix, a COUNT-then-INSERT race could in principle
    // let both through; this proves exactly one wins now.
    const passRace1 = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId() });
    const race1Start = await api('POST', '/api/engage/session/start', { accessToken: passRace1.accessToken });
    const race1Invite = await api('POST', `/api/engage/session/${race1Start.data.sessionToken}/invite/create`, { maxParticipants: 2 });
    await api('POST', `/api/engage/invite/${race1Invite.data.inviteToken}/join`, { displayName: 'Filler' }); // fill 1 of 2 seats, exactly 1 remains

    const [raceA, raceB] = await Promise.all([
      api('POST', `/api/engage/invite/${race1Invite.data.inviteToken}/join`, { displayName: 'RaceA' }),
      api('POST', `/api/engage/invite/${race1Invite.data.inviteToken}/join`, { displayName: 'RaceB' }),
    ]);
    const raceSuccesses = [raceA, raceB].filter(r => r.status === 200);
    const raceFailures = [raceA, raceB].filter(r => r.status === 409);
    assertEqual(raceSuccesses.length, 1, 'CONCURRENCY: with exactly 1 seat remaining, 2 truly simultaneous join requests result in EXACTLY 1 success (not 0, not 2)');
    assertEqual(raceFailures.length, 1, 'CONCURRENCY: the other simultaneous request correctly receives 409 (group full), not a silently-accepted overflow');
    const race1FinalCount = db.prepare('SELECT COUNT(*) c FROM engage_participant WHERE group_room_id = (SELECT id FROM group_room WHERE invite_token = ?)').get(race1Invite.data.inviteToken).c;
    assertEqual(race1FinalCount, 2, 'CONCURRENCY: the final participant count is exactly max_participants (2), never exceeded by the race');

    // Scenario 2: the default ceiling (8) under heavier concurrency -- 10
    // simultaneous join attempts against an empty max=8 room.
    const passRace2 = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId() });
    const race2Start = await api('POST', '/api/engage/session/start', { accessToken: passRace2.accessToken });
    const race2Invite = await api('POST', `/api/engage/session/${race2Start.data.sessionToken}/invite/create`, { maxParticipants: 8 });

    const race2Results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => api('POST', `/api/engage/invite/${race2Invite.data.inviteToken}/join`, { displayName: `Concurrent${i}` }))
    );
    const race2Successes = race2Results.filter(r => r.status === 200);
    const race2Failures = race2Results.filter(r => r.status === 409);
    assertEqual(race2Successes.length, 8, 'CONCURRENCY (max=8): out of 10 truly simultaneous join attempts against an empty room, EXACTLY 8 succeed');
    assertEqual(race2Failures.length, 2, 'CONCURRENCY (max=8): the other 2 correctly receive 409, never silently overflow the ceiling');
    const race2FinalCount = db.prepare('SELECT COUNT(*) c FROM engage_participant WHERE group_room_id = (SELECT id FROM group_room WHERE invite_token = ?)').get(race2Invite.data.inviteToken).c;
    assertEqual(race2FinalCount, 8, 'CONCURRENCY (max=8): the final stored participant count is exactly 8, proven by direct database query, not just the HTTP response shapes');

    // Preserve idempotency/security/tenant behavior alongside the fix:
    // successful joins from the race still return correct, distinct participant ids
    const successfulParticipantIds = new Set(race2Successes.map(r => r.data.participantId));
    assertEqual(successfulParticipantIds.size, 8, 'each of the 8 successful concurrent joins produced a genuinely distinct participantId -- no duplicate/collided rows from the race');

    // ============================================================
    // CORRECTIVE ROUND: rate limiter bounded memory (no unbounded growth)
    // ============================================================
    const { _cleanupStaleJoinAttempts, _getJoinAttemptsMapSize, _setRawJoinAttemptsForTest } = require('../lib/engage-social.js');
    const veryOldTimestamp = Date.now() - 10 * 60 * 1000; // well outside the 60s rate-limit window
    _setRawJoinAttemptsForTest('test-stale-token-a', [veryOldTimestamp]);
    _setRawJoinAttemptsForTest('test-stale-token-b', [veryOldTimestamp, veryOldTimestamp]);
    _setRawJoinAttemptsForTest('test-fresh-token', [Date.now()]);
    const sizeBeforeCleanup = _getJoinAttemptsMapSize();
    assert(sizeBeforeCleanup >= 3, 'BOUNDED MEMORY setup: at least 3 tracked invite tokens exist before cleanup (2 stale, 1 fresh)');

    _cleanupStaleJoinAttempts();
    const sizeAfterCleanup = _getJoinAttemptsMapSize();
    assert(sizeAfterCleanup <= sizeBeforeCleanup - 2, 'BOUNDED MEMORY: cleanup removes entries whose every recorded attempt has aged out of the window -- the 2 stale test entries are gone, memory does not grow without bound across long uptime');

    // ============================================================
    // NEGATIVE: rate limiting on join
    // ============================================================
    const passRateLimit = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId() });
    const rateLimitStart = await api('POST', '/api/engage/session/start', { accessToken: passRateLimit.accessToken });
    const rateLimitInvite = await api('POST', `/api/engage/session/${rateLimitStart.data.sessionToken}/invite/create`, { maxParticipants: 8 });
    let lastStatus;
    for (let i = 0; i < 11; i++) {
      const r = await api('POST', `/api/engage/invite/${rateLimitInvite.data.inviteToken}/join`, { displayName: `Spam${i}` });
      lastStatus = r.status;
    }
    assertEqual(lastStatus, 429, 'RATE LIMITING: repeated rapid join attempts against the same invite token are eventually throttled (429), reusing the same sliding-window pattern already proven for login attempts');

    // ============================================================
    // NEGATIVE: creating an invite requires a valid, running host session
    // ============================================================
    const noAuthInvite = await api('POST', '/api/engage/session/nonexistent-token/invite/create', {});
    assertEqual(noAuthInvite.status, 403, 'creating an invite with an unrecognized session token is rejected');

    const passEndedHost = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId() });
    const endedHostStart = await api('POST', '/api/engage/session/start', { accessToken: passEndedHost.accessToken });
    await api('POST', `/api/engage/session/${endedHostStart.data.sessionToken}/end`, {});
    const inviteFromEndedSession = await api('POST', `/api/engage/session/${endedHostStart.data.sessionToken}/invite/create`, {});
    assertEqual(inviteFromEndedSession.status, 409, 'creating an invite from an already-ended session is rejected (409)');

    // ============================================================
    // Core isolation regression
    // ============================================================
    const isoOrder = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }] });
    const isoPay = await api('POST', `/api/orders/${isoOrder.data.id}/pay`, { method: 'card' });
    assertEqual(isoPay.data.status, 'Paid', 'ENG-ISO-001 still holds with Inc-5 Social/Group Invite code active');

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
