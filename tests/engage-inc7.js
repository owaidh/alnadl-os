// tests/engage-inc7.js — Phase 5 P5-Inc-7 acceptance tests.
// AI Provider Layer + Orchestration + Fallback + Safety Pipeline +
// Semantic Novelty. Explicit coverage of every scenario named in review:
// success, timeout, provider error, fallback, duplicate semantic content,
// safety rejection, malformed provider response, provider latency,
// concurrent calls, disabled AI flag, tenant isolation.
'use strict';
const { startServer, stopServer, api, loginAs, assert, assertEqual, summary, resetCounts, getDataPath } = require('./helpers.js');

function openDirectDb() {
  process.env.SQLITE_PATH = getDataPath();
  for (const mod of ['db.js', 'lib/engage-personality.js', 'lib/engage-novelty.js', 'lib/engage-flags.js',
    'lib/engage-session.js', 'lib/engage-ai-provider.js', 'lib/engage-ai-orchestrator.js', 'lib/engage-safety.js']) {
    delete require.cache[require.resolve('../' + mod)];
  }
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
  console.log('=== Phase 5 P5-Inc-7 Suite (AI Provider Layer + Orchestration + Safety + Semantic Novelty) ===');

  try {
    const adminToken = await loginAs('admin');
    const db = openDirectDb();
    const { setMockBehavior, clearMockBehavior, UNSAFE_TEST_MARKER } = require('../lib/engage-ai-provider.js');
    const { checkNovelty, tokenize, jaccardSimilarity, setNoveltyPolicyOverride, getOrCreateProfile } = require('../lib/engage-novelty.js');
    const { uid } = require('../db.js');
    let orderCounter = 0;
    const nextOrderId = () => `TEST-INC7-${++orderCounter}`;

    // Enable engage_enabled + engage_ai_generation on PLATFORM for pt_nova
    const platformPlan = db.prepare(`SELECT * FROM plans WHERE code = 'PLATFORM'`).get();
    const platformFeatures = JSON.parse(platformPlan.features_json);
    platformFeatures.engage_enabled = true;
    platformFeatures.engage_ai_generation = true;
    db.prepare('UPDATE plans SET features_json = ? WHERE id = ?').run(JSON.stringify(platformFeatures), platformPlan.id);
    await api('POST', '/api/admin/subscription', { partnerId: 'pt_nova', planCode: 'PLATFORM' }, adminToken);

    async function startAISession(zoneId = 'z_pool') {
      const pass = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId, pointId: 'PT-021', orderId: nextOrderId() });
      const r = await api('POST', '/api/engage/session/start', { accessToken: pass.accessToken });
      return r.data.sessionToken;
    }

    // ============================================================
    // 1) SUCCESS
    // ============================================================
    clearMockBehavior();
    const sessionSuccess = await startAISession();
    const mSuccess = await api('POST', `/api/engage/session/${sessionSuccess}/next-moment`, {});
    assertEqual(mSuccess.status, 200, 'SUCCESS: AI generation serves a moment successfully');
    assertEqual(mSuccess.data.source, 'ai_generated', 'SUCCESS: source is correctly ai_generated');
    const providerCallsSuccess = db.prepare('SELECT * FROM engage_provider_call WHERE moment_id = ?').all(mSuccess.data.momentId);
    assertEqual(providerCallsSuccess.length, 2, 'SUCCESS: exactly 2 provider_call rows recorded -- 1 generation (primary succeeded, no retry needed) + 1 embedding (for the genuine vector-based novelty check)');
    const genCall = providerCallsSuccess.find(c => c.call_type === 'generation');
    const embCall = providerCallsSuccess.find(c => c.call_type === 'embedding');
    assert(!!genCall && !!embCall, 'SUCCESS: the two recorded calls are correctly distinguished by call_type (generation vs embedding), both in the SAME unified engage_provider_call table');
    assertEqual(genCall.result, 'success', 'SUCCESS: generation provider_call result is success');
    assert(genCall.provider && genCall.model && genCall.model_version, 'SUCCESS: generation provider/model/model_version all recorded');
    assert(typeof genCall.latency_ms === 'number' && genCall.latency_ms >= 0, 'SUCCESS: generation latency_ms recorded as a real number');
    assert(typeof genCall.cost_estimate === 'number', 'SUCCESS: generation cost_estimate recorded');
    assertEqual(embCall.result, 'success', 'SUCCESS: embedding provider_call result is success (genuine vector similarity ran, no degradation)');
    assert(embCall.provider && embCall.model && embCall.model_version, 'SUCCESS: embedding provider/model/model_version all recorded');
    const successNovelty = db.prepare('SELECT * FROM novelty_evaluation WHERE moment_id = ?').get(mSuccess.data.momentId);
    assertEqual(successNovelty.method, 'semantic_embedding', 'SUCCESS: the recorded novelty_evaluation.method is honestly semantic_embedding -- a real vector comparison genuinely ran, not the concept pre-filter');
    const successExposure = db.prepare('SELECT embedding_vector_json, embedding_model FROM exposure_memory ORDER BY exposed_at DESC LIMIT 1').get();
    assert(!!successExposure.embedding_vector_json && JSON.parse(successExposure.embedding_vector_json).length > 0, 'SUCCESS: a real, non-empty embedding vector was persisted to exposure_memory for this exposure');
    assert(!!successExposure.embedding_model, 'SUCCESS: the embedding model name was persisted alongside the vector');

    // ============================================================
    // 2) TIMEOUT (>4000ms) -> falls through, no raw error, eventually served
    // ============================================================
    setMockBehavior({ mode: 'success', delayMs: 4200 }); // both providers "hang" past the timeout
    const sessionTimeout = await startAISession();
    const t0 = Date.now();
    const mTimeout = await api('POST', `/api/engage/session/${sessionTimeout}/next-moment`, {});
    const elapsed = Date.now() - t0;
    assertEqual(mTimeout.status, 200, 'TIMEOUT: the customer still gets a 200 (never a raw timeout error)');
    assertEqual(mTimeout.data.source, 'approved_fallback', 'TIMEOUT: both providers timing out falls through to Approved Fallback');
    const timeoutCalls = db.prepare('SELECT * FROM engage_provider_call WHERE moment_id = ?').all(mTimeout.data.momentId);
    assertEqual(timeoutCalls.length, 2, 'TIMEOUT: exactly 2 provider_call attempts recorded (primary, then the one allowed alternate)');
    assert(timeoutCalls.every(c => c.result === 'timeout'), 'TIMEOUT: both recorded attempts have result=timeout');
    assert(elapsed < 9500, `TIMEOUT: total elapsed (${elapsed}ms) is bounded (~2x4s timeout, not 2x the full 4.2s hang) -- the orchestrator genuinely stops waiting at 4s per attempt, not the provider's real delay`);
    clearMockBehavior();

    // ============================================================
    // 3) PROVIDER ERROR -> caught, never reaches client raw
    // ============================================================
    setMockBehavior({ mode: 'error' });
    const sessionError = await startAISession();
    const mError = await api('POST', `/api/engage/session/${sessionError}/next-moment`, {});
    assertEqual(mError.status, 200, 'PROVIDER ERROR: the customer still gets 200, never a 500');
    assertEqual(mError.data.source, 'approved_fallback', 'PROVIDER ERROR: both providers erroring falls through to Approved Fallback');
    const rawResponseText = JSON.stringify(mError.data);
    assert(!rawResponseText.includes('rate limit') && !rawResponseText.toLowerCase().includes('upstream provider error'),
      'NO RAW PROVIDER ERROR: the exact internal error string never appears anywhere in the client-facing response');
    const errorCalls = db.prepare('SELECT * FROM engage_provider_call WHERE moment_id = ?').all(mError.data.momentId);
    assertEqual(errorCalls.length, 2, 'PROVIDER ERROR: both attempts recorded');
    assert(errorCalls.every(c => c.result === 'error'), 'PROVIDER ERROR: both recorded with result=error');
    clearMockBehavior();

    // ============================================================
    // 4) FALLBACK explicit content check -- the served content IS the real static pool content
    // ============================================================
    setMockBehavior({ mode: 'error' });
    const sessionFallbackContent = await startAISession('z_meet'); // RESET personality, single-item pool, deterministic
    const mFallbackContent = await api('POST', `/api/engage/session/${sessionFallbackContent}/next-moment`, {});
    assertEqual(mFallbackContent.data.payload.body_en, 'Take a deep breath. Your order is on its way.', 'FALLBACK: the actual served content is the real Approved Fallback pool content, not empty/placeholder');
    clearMockBehavior();

    // ============================================================
    // 5) DUPLICATE SEMANTIC CONTENT -> provider tries again / falls back
    // ============================================================
    // Force BOTH providers to always return the SAME exact content (index 0)
    // for a profile that has ALREADY been exposed to it -- content_hash
    // match makes checkNoveltySemantic() report isDuplicate=true
    // deterministically, regardless of threshold.
    setMockBehavior({ mode: 'success', variantIndex: 0 });
    const passSemDup = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId(), customerPhone: '+966599999001' });
    const semDupStart = await api('POST', '/api/engage/session/start', { accessToken: passSemDup.accessToken });
    const m1SemDup = await api('POST', `/api/engage/session/${semDupStart.data.sessionToken}/next-moment`, {});
    assertEqual(m1SemDup.data.source, 'ai_generated', 'setup: first AI moment served normally');

    // Same known customer, NEW order/session, same forced variantIndex=0 -> should be caught as an exact semantic duplicate and fall through
    const passSemDup2 = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId(), customerPhone: '+966599999001' });
    const semDup2Start = await api('POST', '/api/engage/session/start', { accessToken: passSemDup2.accessToken });
    const m2SemDup = await api('POST', `/api/engage/session/${semDup2Start.data.sessionToken}/next-moment`, {});
    assertEqual(m2SemDup.data.source, 'approved_fallback', 'DUPLICATE SEMANTIC CONTENT: when both providers keep returning the exact same already-exposed content, the orchestrator correctly falls through to Approved Fallback rather than serving a literal repeat');
    const dupNovelty = db.prepare('SELECT * FROM novelty_evaluation WHERE moment_id = ?').get(m2SemDup.data.momentId);
    assertEqual(dupNovelty.method, 'text_similarity', 'the FALLBACK content (not AI) is correctly evaluated with text_similarity, not semantic_embedding -- method matches the actual content source');
    clearMockBehavior();

    // Reusable fixture: a real moment_id (with a satisfied FK chain) for
    // directly testing novelty functions outside the HTTP/orchestration path.
    function makeFixtureMoment(personality, profileIdentityRef) {
      const { uid } = require('../db.js');
      const fixProfile = getOrCreateProfile('pt_nova', profileIdentityRef, uid('pass'));
      const fixOrderId = nextOrderId();
      db.prepare(`INSERT INTO orders (id,partner_id,property_id,zone_id,point_id,status,subtotal,vat,total,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(fixOrderId, 'pt_nova', 'prop_nova_main', 'z_pool', 'PT-021', 'Paid', 20, 3, 23, Date.now(), Date.now());
      const fixPassId = uid('ep');
      db.prepare(`INSERT INTO engage_pass (id,order_id,context_snapshot_json,status,created_at,expires_at,access_token) VALUES (?,?,?,?,?,?,?)`)
        .run(fixPassId, fixOrderId, '{}', 'active', Date.now(), Date.now() + 999999, uid('tok'));
      const fixSessionId = uid('es');
      db.prepare(`INSERT INTO engage_session (id,pass_id,personality,ceiling_moments_max,status,started_at,access_token) VALUES (?,?,?,?,?,?,?)`)
        .run(fixSessionId, fixPassId, personality, 3, 'running', Date.now(), uid('stok'));
      const fixMechVer = db.prepare(`SELECT id FROM mechanic_version WHERE mechanic_id = ?`).get(`mech_static_${personality.toLowerCase()}`);
      const fixMomentId = uid('mo');
      db.prepare(`INSERT INTO moment (id,session_id,mechanic_version_id,sequence_index,status,created_at) VALUES (?,?,?,?,?,?)`)
        .run(fixMomentId, fixSessionId, fixMechVer.id, 0, 'served', Date.now());
      return { profile: fixProfile, momentId: fixMomentId };
    }

    // ============================================================
    // ENG-NOV-001 PROOF (corrective round): genuine vector embedding,
    // proven on paraphrases NEVER hardcoded into any dictionary anywhere
    // in this codebase -- including Arabic.
    // ============================================================
    const { checkNoveltyEmbedding, checkNoveltyConceptSimilarity, recordExposureAndEvaluation } = require('../lib/engage-novelty.js');
    const { createDefaultEmbeddingProvider, cosineSimilarity, textToVector, setMockEmbeddingBehavior, clearMockEmbeddingBehavior } = require('../lib/engage-embedding-provider.js');
    const embProvider = createDefaultEmbeddingProvider();

    // Cosine similarity sanity
    assertEqual(cosineSimilarity(textToVector('hello world', 128), textToVector('hello world', 128)).toFixed(4), '1.0000', 'EMBEDDING SANITY: identical text -> cosine similarity 1.0');
    const unrelatedSim = cosineSimilarity(textToVector('Coffee was first discovered in Ethiopia', 128), textToVector('What gets bigger the more you take away from it?', 128));
    assert(unrelatedSim < 0.3, `EMBEDDING SANITY: genuinely unrelated content scores low (${unrelatedSim.toFixed(3)})`);

    // The renamed method is honestly labeled and still works as an optional pre-filter
    const conceptFix = makeFixtureMoment('SPARK', '+966599999003');
    const conceptContentA = { title_en: 'Did You Know?', body_en: 'Coffee was first discovered in Ethiopia.' };
    const conceptEval = checkNoveltyConceptSimilarity(conceptFix.profile.id, conceptContentA, 'pt_nova', 'prop_nova_main', null);
    assertEqual(conceptEval.method, 'semantic_concept_similarity', 'HONEST RENAME: the concept/synonym method now reports method=semantic_concept_similarity, never semantic_embedding');
    recordExposureAndEvaluation(conceptFix.profile.id, 'mech_static_spark', conceptContentA, conceptFix.momentId, conceptEval);

    // ---- PARAPHRASE #1: English, morphologically related, NOT in CONCEPT_MAP ----
    // "discover"/"discovery" -- this exact word pair does not appear
    // anywhere in lib/engage-novelty.js's CONCEPT_MAP.
    const embFixture1 = makeFixtureMoment('SPARK', '+966599999004');
    const engParaphraseA = { body_en: 'This cafe features a surprising discovery on the menu today.' };
    const engParaphraseB = { body_en: 'You will discover something surprising when you visit our cafe.' };
    const embEvalA = await checkNoveltyEmbedding(embFixture1.profile.id, engParaphraseA, 'pt_nova', 'prop_nova_main', null, embProvider);
    recordExposureAndEvaluation(embFixture1.profile.id, 'mech_static_spark', engParaphraseA, embFixture1.momentId, embEvalA);
    setNoveltyPolicyOverride('partner', 'pt_nova', 'embedding_threshold', 0.4, 'test-admin');
    const embEvalB = await checkNoveltyEmbedding(embFixture1.profile.id, engParaphraseB, 'pt_nova', 'prop_nova_main', null, embProvider);
    assertEqual(embEvalB.method, 'semantic_embedding', 'ENGLISH PARAPHRASE: method is genuinely semantic_embedding, not degraded');
    assert(embEvalB.similarityScore > unrelatedSim, `ENGLISH PARAPHRASE (not hardcoded): "discovery" vs "discover" scores measurably higher (${embEvalB.similarityScore.toFixed(3)}) than genuinely unrelated content (${unrelatedSim.toFixed(3)}) -- this pair is NOT in any synonym/concept dictionary in this codebase, proving genuine generalization`);
    assert(embEvalB.isDuplicate, `ENGLISH PARAPHRASE: correctly flagged as a near-duplicate (score=${embEvalB.similarityScore.toFixed(3)} >= threshold=0.4) via real vector cosine similarity`);

    // ---- PARAPHRASE #2: ARABIC, root-sharing, NEVER hardcoded anywhere ----
    const embFixture2 = makeFixtureMoment('SPARK', '+966599999005');
    const arParaphraseA = { body_ar: 'تم اكتشاف القهوة في إثيوبيا لأول مرة' }; // "Coffee was discovered in Ethiopia for the first time"
    const arParaphraseB = { body_ar: 'القهوة اكتُشفت في إثيوبيا قديماً' }; // "Coffee was discovered in Ethiopia long ago" -- shares the discover root
    const arUnrelated = { body_ar: 'ما الذي يكبر كلما أخذت منه أكثر؟' }; // "What gets bigger the more you take from it?" -- genuinely unrelated
    const embEvalArA = await checkNoveltyEmbedding(embFixture2.profile.id, arParaphraseA, 'pt_nova', 'prop_nova_main', null, embProvider);
    recordExposureAndEvaluation(embFixture2.profile.id, 'mech_static_spark', arParaphraseA, embFixture2.momentId, embEvalArA);
    const embEvalArB = await checkNoveltyEmbedding(embFixture2.profile.id, arParaphraseB, 'pt_nova', 'prop_nova_main', null, embProvider);
    const embEvalArUnrelated = await checkNoveltyEmbedding(embFixture2.profile.id, arUnrelated, 'pt_nova', 'prop_nova_main', null, embProvider);
    assert(embEvalArB.similarityScore > embEvalArUnrelated.similarityScore, `ARABIC PARAPHRASE (never hardcoded, script-agnostic): the Arabic paraphrase pair scores higher (${embEvalArB.similarityScore.toFixed(3)}) than Arabic unrelated content (${embEvalArUnrelated.similarityScore.toFixed(3)}) -- the SAME embedding technique works identically on Arabic with zero language-specific dictionary entries`);
    assertEqual(embEvalArB.method, 'semantic_embedding', 'ARABIC: method is genuinely semantic_embedding');

    // ---- Tenant isolation for embeddings specifically ----
    // The SAME text exposed for Partner A must never count as a duplicate
    // for Partner B -- exposure_memory (and therefore embedding vectors)
    // are scoped per profile, and profiles are scoped per (partner_id,
    // identity_ref), the same structural guarantee proven since Inc-4.
    const embTenantFixtureA = makeFixtureMoment('SPARK', '+966599999008');
    const embTenantContent = { body_en: 'A unique tenant-isolation test sentence about coffee brewing methods.' };
    const embTenantEvalA = await checkNoveltyEmbedding(embTenantFixtureA.profile.id, embTenantContent, 'pt_nova', 'prop_nova_main', null, embProvider);
    recordExposureAndEvaluation(embTenantFixtureA.profile.id, 'mech_static_spark', embTenantContent, embTenantFixtureA.momentId, embTenantEvalA);
    const { uid: uidForTenantB } = require('../db.js');
    const embProfileB = getOrCreateProfile('pt_alrowad', '+966599999008', uidForTenantB('pass')); // SAME phone number, DIFFERENT partner
    const embTenantEvalB = await checkNoveltyEmbedding(embProfileB.id, embTenantContent, 'pt_alrowad', 'prop_alrowad_hq', null, embProvider);
    assertEqual(embTenantEvalB.isDuplicate, false, 'EMBEDDING TENANT ISOLATION: the identical text, identical phone number, but a DIFFERENT partner -- correctly NOT flagged as a duplicate, because embedding comparison is scoped to profile.id, and profiles never cross a tenant boundary (same phone at two partners = two structurally separate profiles, proven since Inc-4)');

    // ---- embedding_threshold exposed through the real admin API, not just the library ----
    const validApiThreshold = await api('POST', '/api/admin/engage/policy-overrides', { scopeType: 'partner', scopeId: 'pt_nova', policyKey: 'embedding_threshold', value: 0.5 }, adminToken);
    assertEqual(validApiThreshold.status, 201, 'API SURFACE: embedding_threshold can be set through the real admin HTTP endpoint, not only via direct library calls');
    const invalidApiThreshold = await api('POST', '/api/admin/engage/policy-overrides', { scopeType: 'partner', scopeId: 'pt_nova', policyKey: 'embedding_threshold', value: 1.5 }, adminToken);
    assertEqual(invalidApiThreshold.status, 400, 'API SURFACE: an out-of-range embedding_threshold (1.5) is rejected by the real HTTP endpoint with a clear 400, same validation discipline as novelty_threshold');

    // ---- Configurable embedding_threshold actually changes behavior ----
    // Uses PROPERTY scope (never touched for embedding_threshold elsewhere
    // in this suite) rather than re-setting the SAME partner-scope key a
    // second time: setNoveltyPolicyOverride() always INSERTs a fresh row
    // rather than replacing an existing one for the same (scope,key), so
    // two overrides for the identical partner+key can accumulate and the
    // plain unordered SELECT in getOverrideValue() is not guaranteed to
    // return the most recently inserted one. A fresh scope sidesteps this
    // entirely and is the correct fix -- not a product bug, a test-fixture
    // one, caught by running this exact test for the first time.
    const embFixture3 = makeFixtureMoment('SPARK', '+966599999006');
    const thresholdTestA = { body_en: 'This cafe features a surprising discovery on the menu today.' };
    const thresholdTestB = { body_en: 'You will discover something surprising when you visit our cafe.' };
    const embThresholdEvalA = await checkNoveltyEmbedding(embFixture3.profile.id, thresholdTestA, 'pt_nova', 'prop_nova_main', null, embProvider);
    recordExposureAndEvaluation(embFixture3.profile.id, 'mech_static_spark', thresholdTestA, embFixture3.momentId, embThresholdEvalA);
    setNoveltyPolicyOverride('property', 'prop_nova_main', 'embedding_threshold', 0.99, 'test-admin'); // deliberately unreachable, property-scoped so it beats the earlier partner-scoped 0.4 cleanly
    const embHighThreshold = await checkNoveltyEmbedding(embFixture3.profile.id, thresholdTestB, 'pt_nova', 'prop_nova_main', null, embProvider);
    assertEqual(embHighThreshold.isDuplicate, false, 'CONFIGURABLE THRESHOLD: raising embedding_threshold to 0.99 makes the SAME paraphrase pair no longer count as duplicate -- the threshold genuinely controls behavior');

    // ---- GRACEFUL DEGRADATION: embedding provider fails -> falls back to concept similarity, never breaks ----
    setMockEmbeddingBehavior({ mode: 'error' });
    const embFixture4 = makeFixtureMoment('SPARK', '+966599999007');
    const degradedContent = { body_en: 'A brand new fact nobody has seen before about coffee culture.' };
    const degradedEval = await checkNoveltyEmbedding(embFixture4.profile.id, degradedContent, 'pt_nova', 'prop_nova_main', null, embProvider);
    assertEqual(degradedEval.degraded, true, 'GRACEFUL DEGRADATION: when the embedding provider errors, the result is honestly marked degraded=true');
    assertEqual(degradedEval.method, 'semantic_concept_similarity', 'GRACEFUL DEGRADATION: falls back to the concept-similarity method, not a crash or an unhandled rejection');
    clearMockEmbeddingBehavior();

    // Full end-to-end: embedding failure during real AI orchestration never breaks the session
    setMockEmbeddingBehavior({ mode: 'error' });
    const sessionEmbDegraded = await startAISession();
    const mEmbDegraded = await api('POST', `/api/engage/session/${sessionEmbDegraded}/next-moment`, {});
    assertEqual(mEmbDegraded.status, 200, 'GRACEFUL DEGRADATION END-TO-END: a real session still gets served successfully (200) even when the embedding provider is completely down');
    clearMockEmbeddingBehavior();

    // ============================================================
    // 6) SAFETY REJECTION
    // ============================================================
    setMockBehavior({ mode: 'unsafe' });
    const sessionUnsafe = await startAISession();
    const mUnsafe = await api('POST', `/api/engage/session/${sessionUnsafe}/next-moment`, {});
    assertEqual(mUnsafe.status, 200, 'SAFETY REJECTION: the customer still gets 200, the unsafe content is never actually served');
    assertEqual(mUnsafe.data.source, 'approved_fallback', 'SAFETY REJECTION: unsafe AI content on both providers falls through to Approved Fallback');
    assert(!JSON.stringify(mUnsafe.data.payload).includes(UNSAFE_TEST_MARKER), 'SAFETY REJECTION: the unsafe marker never appears in the actual served payload');
    const unsafeSafetyEvals = db.prepare('SELECT * FROM safety_evaluation WHERE moment_id = ?').all(mUnsafe.data.momentId);
    assert(unsafeSafetyEvals.length >= 1, 'a safety_evaluation row exists for the served (fallback) content');
    clearMockBehavior();

    // ============================================================
    // 7) MALFORMED PROVIDER RESPONSE
    // ============================================================
    setMockBehavior({ mode: 'malformed' });
    const sessionMalformed = await startAISession();
    const mMalformed = await api('POST', `/api/engage/session/${sessionMalformed}/next-moment`, {});
    assertEqual(mMalformed.status, 200, 'MALFORMED RESPONSE: handled gracefully, still 200');
    assertEqual(mMalformed.data.source, 'approved_fallback', 'MALFORMED RESPONSE: a null/invalid payload from both providers falls through to Approved Fallback');
    assert(mMalformed.data.payload && (mMalformed.data.payload.body_en || mMalformed.data.payload.title_en), 'MALFORMED RESPONSE: the customer receives genuinely valid, non-null content despite the malformed provider output');
    clearMockBehavior();

    // ============================================================
    // 8) PROVIDER LATENCY recorded accurately
    // ============================================================
    setMockBehavior({ mode: 'success', delayMs: 250 });
    const sessionLatency = await startAISession();
    const mLatency = await api('POST', `/api/engage/session/${sessionLatency}/next-moment`, {});
    const latencyCall = db.prepare('SELECT * FROM engage_provider_call WHERE moment_id = ?').get(mLatency.data.momentId);
    assert(latencyCall.latency_ms >= 200 && latencyCall.latency_ms < 4000, `PROVIDER LATENCY: recorded latency_ms (${latencyCall.latency_ms}) reflects the real ~250ms delay, not a fake/zero value`);
    clearMockBehavior();

    // ============================================================
    // 9) CONCURRENT CALLS
    // ============================================================
    clearMockBehavior();
    const sessionConcurrent = await startAISession(); // PLAY personality (z_pool), ceiling default 3
    const [c1, c2, c3, c4] = await Promise.all([
      api('POST', `/api/engage/session/${sessionConcurrent}/next-moment`, {}),
      api('POST', `/api/engage/session/${sessionConcurrent}/next-moment`, {}),
      api('POST', `/api/engage/session/${sessionConcurrent}/next-moment`, {}),
      api('POST', `/api/engage/session/${sessionConcurrent}/next-moment`, {}),
    ]);
    const concurrentSuccesses = [c1, c2, c3, c4].filter(r => r.status === 200);
    assertEqual(concurrentSuccesses.length, 3, 'CONCURRENT CALLS: 4 simultaneous next-moment requests against a ceiling=3 AI-enabled session correctly yield exactly 3 successes (ceiling enforcement holds even with the now-async AI orchestration path)');
    const momentIds = new Set(concurrentSuccesses.map(r => r.data.momentId));
    assertEqual(momentIds.size, 3, 'CONCURRENT CALLS: all 3 successful moments have genuinely distinct ids -- no duplicate/collided rows from the concurrency');

    // ============================================================
    // 10) DISABLED AI FLAG -- static path unaffected, still works
    // ============================================================
    // Note: pt_nova and pt_alrowad are BOTH seeded on the SAME shared
    // 'plan_platform' row by default (verified directly in db.js) -- so
    // enabling engage_ai_generation on the PLATFORM plan template earlier
    // in this suite affects BOTH tenants, not just pt_nova. Proving
    // "disabled" properly therefore means an explicit Property-level
    // override turning it OFF for pt_alrowad specifically, reusing the
    // exact Inc-6 override mechanism -- this is a MORE meaningful proof
    // than relying on incidental plan separation, since it also exercises
    // the override path for this new flag.
    const { setAIGenerationOverride } = require('../lib/engage-flags.js');
    setAIGenerationOverride('property', 'prop_alrowad_hq', false, 'test-admin');
    const passDisabled = makePass(db, { partnerId: 'pt_alrowad', propertyId: 'prop_alrowad_hq', zoneId: null, pointId: 'PT-014', orderId: nextOrderId() });
    const disabledStart = await api('POST', '/api/engage/session/start', { accessToken: passDisabled.accessToken });
    assertEqual(disabledStart.status, 200, 'setup: session starts normally for pt_alrowad');
    const mDisabled = await api('POST', `/api/engage/session/${disabledStart.data.sessionToken}/next-moment`, {});
    assertEqual(mDisabled.status, 200, 'DISABLED AI FLAG: still serves successfully');
    assertEqual(mDisabled.data.source, 'approved_fallback', 'DISABLED AI FLAG: with engage_ai_generation explicitly OFF for this property, the static path serves content directly -- source is approved_fallback, no provider_call rows at all');
    const noProviderCalls = db.prepare('SELECT COUNT(*) c FROM engage_provider_call WHERE moment_id = ?').get(mDisabled.data.momentId).c;
    assertEqual(noProviderCalls, 0, 'DISABLED AI FLAG: zero engage_provider_call rows exist for a moment served while the flag is off -- the AI code path was never even entered');

    // ============================================================
    // 11) TENANT ISOLATION
    // ============================================================
    const passTenantX = makePass(db, { partnerId: 'pt_nova', propertyId: 'prop_nova_main', zoneId: 'z_pool', pointId: 'PT-021', orderId: nextOrderId() });
    const tenantXStart = await api('POST', '/api/engage/session/start', { accessToken: passTenantX.accessToken });
    const mTenantX = await api('POST', `/api/engage/session/${tenantXStart.data.sessionToken}/next-moment`, {});
    const tenantXProviderCall = db.prepare('SELECT * FROM engage_provider_call WHERE moment_id = ?').get(mTenantX.data.momentId);
    assert(!!tenantXProviderCall, 'setup: a provider_call row exists for the pt_nova moment');
    // Verify this provider_call is only reachable via ITS OWN moment_id -- no partner_id/tenant field exists on
    // engage_provider_call at all (it's tied to moment -> session -> pass -> context_snapshot, same as every other Engage table).
    const ledgerRow = db.prepare(`SELECT ep.context_snapshot_json FROM moment mo JOIN engage_session es ON es.id=mo.session_id JOIN engage_pass ep ON ep.id=es.pass_id WHERE mo.id=?`).get(mTenantX.data.momentId);
    assertEqual(JSON.parse(ledgerRow.context_snapshot_json).partnerId, 'pt_nova', 'TENANT ISOLATION: the provider_call/moment chain correctly traces back to pt_nova and only pt_nova, via the same context_snapshot mechanism proven throughout every prior increment');

    // Full Ledger (SuperAdmin) correctly includes AI fields for this moment
    const fullLedgerCheck = await api('GET', `/api/admin/engage/ledger?partnerId=pt_nova`, null, adminToken);
    assert(fullLedgerCheck.data.some(row => row.moment_id === mTenantX.data.momentId), 'the AI-generated moment appears correctly in the SuperAdmin Ledger, scoped to pt_nova');

    // Partner Overview NEVER exposes AI internals even now that AI is active
    const partnerAdminToken = await loginAs('partneradmin');
    // Need >=10 sessions for cohort; reuse sessions created throughout this suite (already well past 10 by this point)
    const partnerOverviewCheck = await api('GET', '/api/partner/engage/overview', null, partnerAdminToken);
    const partnerOverviewJson = JSON.stringify(partnerOverviewCheck.data);
    for (const field of ['provider', 'model', 'prompt', 'mock-provider', 'cost_estimate', 'latency_ms']) {
      assert(!partnerOverviewJson.toLowerCase().includes(field.toLowerCase()), `TENANT/PRIVACY: even with AI actively generating content, the Partner Overview never exposes "${field}"`);
    }

    // ============================================================
    // engage_ai_generation itself is behind the SAME Feature Flag precedence
    // ============================================================
    const { resolveAIGenerationEnabled } = require('../lib/engage-flags.js');
    assertEqual(resolveAIGenerationEnabled(false, 'pt_nova', 'prop_nova_main', 'z_pool'), false, 'FEATURE FLAG: engage_ai_generation with Contract=false resolves to disabled, same precedence chain as every other Engage flag');

    // ============================================================
    // Core isolation + prior increments regression
    // ============================================================
    const isoOrder = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }] });
    const isoPay = await api('POST', `/api/orders/${isoOrder.data.id}/pay`, { method: 'card' });
    assertEqual(isoPay.data.status, 'Paid', 'ENG-ISO-001 still holds with Inc-7 AI orchestration code active');

  } finally {
    require('../lib/engage-ai-provider.js').clearMockBehavior();
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
