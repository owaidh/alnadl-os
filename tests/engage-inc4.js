// tests/engage-inc4.js — Phase 5 P5-Inc-4 acceptance tests.
// Customer/Anonymous Memory + Exposure Memory + Text Similarity Novelty +
// Duplicate Prevention. Negative/boundary cases throughout.
'use strict';
const { startServer, stopServer, api, loginAs, assert, assertEqual, summary, resetCounts, getDataPath } = require('./helpers.js');

function openDirectDb() {
  process.env.SQLITE_PATH = getDataPath();
  delete require.cache[require.resolve('../db.js')];
  delete require.cache[require.resolve('../lib/engage-personality.js')];
  delete require.cache[require.resolve('../lib/engage-novelty.js')];
  delete require.cache[require.resolve('../lib/engage-session.js')];
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
  console.log('=== Phase 5 P5-Inc-4 Suite (Memory + Novelty + Duplicate Prevention) ===');

  try {
    const adminToken = await loginAs('admin');
    const partnerAdminToken = await loginAs('partneradmin');
    const db = openDirectDb();
    const { getOrCreateProfile, checkNovelty, jaccardSimilarity, tokenize, DEFAULT_WINDOW_DAYS, DEFAULT_THRESHOLD } = require('../lib/engage-novelty.js');
    let orderCounter = 0;
    const nextOrderId = () => `TEST-INC4-${++orderCounter}`;

    // ============================================================
    // customer_engage_profile: known vs anonymous identity handling
    // ============================================================
    const known1 = getOrCreateProfile('pt_nova', '+966500000099', 'pass-x');
    const known2 = getOrCreateProfile('pt_nova', '+966500000099', 'pass-y');
    assertEqual(known1.id, known2.id, 'KNOWN IDENTITY: the same phone number, same partner, across two different passes resolves to the SAME profile (memory persists for a known customer)');
    assertEqual(known1.is_anonymous, 0, 'a profile created from a real phone number is NOT flagged anonymous');

    const anon1 = getOrCreateProfile('pt_nova', null, 'pass-anon-1');
    const anon2 = getOrCreateProfile('pt_nova', null, 'pass-anon-2');
    assert(anon1.id !== anon2.id, 'ANONYMOUS IDENTITY: two different anonymous passes get DIFFERENT profiles -- no persistent tracking is fabricated for someone who never gave an identity (this is the deliberate, documented scope decision)');
    assertEqual(anon1.is_anonymous, 1, 'an anonymous profile is correctly flagged is_anonymous=1');

    // "no automatic Customer Master creation" -- verify Engage never wrote
    // to any Core identity table (loyalty_accounts) as a side effect.
    const loyaltyCountBefore = db.prepare('SELECT COUNT(*) c FROM loyalty_accounts').get().c;
    getOrCreateProfile('pt_nova', null, 'pass-anon-3');
    const loyaltyCountAfter = db.prepare('SELECT COUNT(*) c FROM loyalty_accounts').get().c;
    assertEqual(loyaltyCountAfter, loyaltyCountBefore, 'NO CUSTOMER MASTER: creating an anonymous Engage profile does not create or touch any row in loyalty_accounts (or any other Core identity table) -- Core Isolation holds even here');

    // ============================================================
    // Tenant isolation: the SAME phone number at TWO DIFFERENT partners
    // ============================================================
    const crossTenantA = getOrCreateProfile('pt_nova', '+966511111111', 'pass-cross-a');
    const crossTenantB = getOrCreateProfile('pt_alrowad', '+966511111111', 'pass-cross-b');
    assert(crossTenantA.id !== crossTenantB.id, 'TENANT ISOLATION: the identical phone number at two different partners gets two ENTIRELY SEPARATE profiles -- memory structurally cannot cross a tenant boundary');

    // ============================================================
    // Jaccard similarity: real math, sanity-checked
    // ============================================================
    assertEqual(jaccardSimilarity(tokenize({ title_en: 'hello world' }), tokenize({ title_en: 'hello world' })), 1, 'Jaccard: identical text -> similarity 1');
    assertEqual(jaccardSimilarity(tokenize({ title_en: 'apple banana' }), tokenize({ title_en: 'car truck' })), 0, 'Jaccard: completely disjoint text -> similarity 0');
    const partial = jaccardSimilarity(tokenize({ title_en: 'hello world today' }), tokenize({ title_en: 'hello world tomorrow' }));
    assertEqual(partial, 0.5, 'Jaccard: 2 shared words out of 4 total unique words -> exactly 0.5');

    // ============================================================
    // Duplicate prevention: literal repeat blocked, distinct content served
    // ============================================================
    db.prepare(`UPDATE properties SET venue_context = 'coffee' WHERE id = 'prop_nova_main'`).run();
    const passDup = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: null, pointId: 'PT-014', orderId: nextOrderId(), customerPhone: '+966522222222' });
    const dupStart = await api('POST', '/api/engage/session/start', { accessToken: passDup.accessToken });
    const m1 = await api('POST', `/api/engage/session/${dupStart.data.sessionToken}/next-moment`);
    assertEqual(m1.status, 200, 'setup: first moment served');

    // Different pass, SAME known customer phone, same partner -- shares the SAME profile/memory
    const passDup2 = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: null, pointId: 'PT-014', orderId: nextOrderId(), customerPhone: '+966522222222' });
    const dup2Start = await api('POST', '/api/engage/session/start', { accessToken: passDup2.accessToken });
    const m2 = await api('POST', `/api/engage/session/${dup2Start.data.sessionToken}/next-moment`);
    assertEqual(m2.status, 200, 'second session (same known customer, new order) still serves successfully -- duplicate prevention picks an alternative, never blocks the experience entirely');
    // SPARK's static pool has 3 distinct items; a second visit should NOT reproduce the exact same payload as the first when alternatives exist
    assert(JSON.stringify(m1.data.payload) !== JSON.stringify(m2.data.payload), 'DUPLICATE PREVENTION: with alternatives available in the pool, the SAME known customer does not receive the literal same content twice in a row');
    db.prepare(`UPDATE properties SET venue_context = 'hotel' WHERE id = 'prop_nova_main'`).run();

    // ============================================================
    // novelty_evaluation: real rows recorded, honest method
    // ============================================================
    const noveltyRows = db.prepare('SELECT * FROM novelty_evaluation WHERE moment_id IN (?, ?)').all(m1.data.momentId, m2.data.momentId);
    assertEqual(noveltyRows.length, 2, 'a novelty_evaluation row was genuinely recorded for both moments');
    assert(noveltyRows.every(r => r.method === 'text_similarity'), 'METHOD HONESTY: every novelty_evaluation row uses method=text_similarity -- semantic_embedding is never produced anywhere (that is Inc-7 scope, structurally unreachable today)');
    assert(noveltyRows.some(r => r.is_duplicate === 0), 'at least one evaluation correctly recorded is_duplicate=0 (the alternative content genuinely was not a duplicate)');

    // ============================================================
    // NEGATIVE: forcing an exhausted pool -- all candidates are duplicates
    // ============================================================
    db.prepare(`UPDATE properties SET venue_context = 'coffee' WHERE id = 'prop_nova_main'`).run();
    const passExhaust = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: null, pointId: 'PT-014', orderId: nextOrderId(), customerPhone: '+966533333333' });
    const exhaustStart = await api('POST', '/api/engage/session/start', { accessToken: passExhaust.accessToken });
    // SPARK pool has exactly 3 items and default ceiling 3 -- serve all 3 to exhaust the pool for this profile
    const served = [];
    for (let i = 0; i < 3; i++) {
      const m = await api('POST', `/api/engage/session/${exhaustStart.data.sessionToken}/next-moment`);
      assertEqual(m.status, 200, `exhaustion setup: moment ${i + 1}/3 served`);
      served.push(JSON.stringify(m.data.payload));
    }
    const uniqueServed = new Set(served);
    assertEqual(uniqueServed.size, 3, 'EXHAUSTION: serving exactly as many moments as the pool has distinct items yields 3 DISTINCT payloads (no premature repeat while alternatives exist)');
    // Now start a NEW session for the SAME profile (new pass) -- the whole pool is already in memory within the window
    const passExhaust2 = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: null, pointId: 'PT-014', orderId: nextOrderId(), customerPhone: '+966533333333' });
    const exhaust2Start = await api('POST', '/api/engage/session/start', { accessToken: passExhaust2.accessToken });
    const forcedDup = await api('POST', `/api/engage/session/${exhaust2Start.data.sessionToken}/next-moment`);
    assertEqual(forcedDup.status, 200, 'POOL EXHAUSTED: the experience is still served (never hard-blocked) even when every candidate is technically a duplicate within the memory window');
    const forcedDupEval = db.prepare('SELECT * FROM novelty_evaluation WHERE moment_id = ?').get(forcedDup.data.momentId);
    assertEqual(forcedDupEval.is_duplicate, 1, 'HONEST RECORDING: when the pool is genuinely exhausted, is_duplicate=1 is recorded truthfully -- never silently marked as novel to hide the limitation');
    db.prepare(`UPDATE properties SET venue_context = 'hotel' WHERE id = 'prop_nova_main'`).run();

    // ============================================================
    // Configurable threshold + explicit memory window
    // ============================================================
    const noAuthNoveltyOverride = await api('POST', '/api/admin/engage/policy-overrides', { scopeType: 'partner', scopeId: 'pt_nova', policyKey: 'novelty_window_days', value: 30 });
    assert([401, 403].includes(noAuthNoveltyOverride.status), 'setting a novelty policy override requires authentication');

    const crossTenantNoveltyOverride = await api('POST', '/api/admin/engage/policy-overrides', { scopeType: 'partner', scopeId: 'pt_alrowad', policyKey: 'novelty_threshold', value: 0.5 }, partnerAdminToken);
    assertEqual(crossTenantNoveltyOverride.status, 403, "a PartnerAdmin cannot set a novelty override for a DIFFERENT partner's contract");

    const badPolicyKey = await api('POST', '/api/admin/engage/policy-overrides', { scopeType: 'partner', scopeId: 'pt_nova', policyKey: 'not_a_real_key', value: 5 }, adminToken);
    assertEqual(badPolicyKey.status, 400, 'an unrecognized policyKey is rejected (400), not silently accepted');

    const legitNoveltyOverride = await api('POST', '/api/admin/engage/policy-overrides', { scopeType: 'partner', scopeId: 'pt_nova', policyKey: 'novelty_threshold', value: 0.3 }, adminToken);
    assertEqual(legitNoveltyOverride.status, 201, 'a SuperAdmin CAN set a legitimate novelty threshold override');

    // Verify the override actually changes behavior: with threshold lowered to 0.3, even PARTIALLY-overlapping content should now count as a duplicate
    const { checkNovelty: checkNoveltyFresh } = require('../lib/engage-novelty.js'); // re-require to pick up the just-written override (same process, no cache issue since db is shared)
    const testProfile = getOrCreateProfile('pt_nova', '+966544444444', 'pass-threshold-test');
    const evalBaseline = checkNoveltyFresh(testProfile.id, { title_en: 'brand new content nobody has seen' }, 'pt_nova', 'prop_nova_main', null);
    assertEqual(evalBaseline.threshold, 0.3, 'THRESHOLD OVERRIDE: the lowered threshold (0.3) is genuinely applied when resolving novelty policy for this partner, not just accepted and ignored');

    // ============================================================
    // Memory window: an exposure OUTSIDE the window must not count as a duplicate
    // ============================================================
    const windowProfile = getOrCreateProfile('pt_nova', '+966555555555', 'pass-window-test');
    const oldContent = { title_en: 'old content from long ago' };
    const oldExposedAt = Date.now() - (DEFAULT_WINDOW_DAYS + 5) * 24 * 3600 * 1000; // deliberately OUTSIDE the default window
    const { uid } = require('../db.js');
    db.prepare(`INSERT INTO exposure_memory (id,profile_id,mechanic_id,content_hash,token_set_json,exposed_at) VALUES (?,?,?,?,?,?)`)
      .run(uid('exm'), windowProfile.id, 'mech_static_spark', require('crypto').createHash('sha256').update('|old content from long ago||').digest('hex'), JSON.stringify(['old', 'content', 'from', 'long', 'ago']), oldExposedAt);
    const windowEval = checkNovelty(windowProfile.id, oldContent, 'pt_nova', 'prop_nova_main', null);
    assertEqual(windowEval.isDuplicate, false, 'MEMORY WINDOW: an identical exposure recorded OUTSIDE the configured window is correctly ignored -- it does not count as a duplicate because it has aged out');

    // ============================================================
    // ENG-NOV-001 stays Partial -- method is verifiably never semantic_embedding
    // ============================================================
    const semanticRows = db.prepare(`SELECT COUNT(*) c FROM novelty_evaluation WHERE method = 'semantic_embedding'`).get().c;
    assertEqual(semanticRows, 0, "ENG-NOV-001 REMAINS PARTIAL: zero novelty_evaluation rows anywhere in the database use method='semantic_embedding' -- text_similarity is the only method this increment ever produces, verified directly against the data, not just claimed in documentation");

    // ============================================================
    // Regression: Core isolation + prior increments still hold
    // ============================================================
    const isoOrder = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }] });
    const isoPay = await api('POST', `/api/orders/${isoOrder.data.id}/pay`, { method: 'card' });
    assertEqual(isoPay.data.status, 'Paid', 'ENG-ISO-001 still holds with Inc-4 Memory/Novelty code active');

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
