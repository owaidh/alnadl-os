// lib/engage-ai-orchestrator.js — Phase 5 P5-Inc-7: ties together Provider
// abstraction + timeout + single-retry + Safety gate + Semantic Novelty +
// Approved Fallback, per §25.4/§25.5.
//
// generateModeration(): the ONLY function serveNextMoment() calls for the
// AI path. Every error condition (timeout, provider error, malformed
// response, safety rejection, semantic duplicate, total exhaustion) is
// caught HERE and converted to a graceful fallback -- server.js and the
// customer never see a raw provider error under any circumstance.
'use strict';
const { db, uid } = require('../db.js');
const { createDefaultProviders, GENERATION_TIMEOUT_MS } = require('./engage-ai-provider.js');
const { evaluateSafety } = require('./engage-safety.js');
const { checkNoveltySemantic, recordExposureAndEvaluation } = require('./engage-novelty.js');

const providers = createDefaultProviders();

/** Races a provider call against the 4-second timeout. Resolves with
 * either the provider's real result, or a synthetic {timedOut:true}
 * marker if the timeout wins the race -- the provider call itself is NOT
 * cancelled (Mock/most real HTTP clients can't truly abort mid-flight
 * either), it is simply no longer awaited by the caller. */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ __timedOut: true }), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function attemptProvider(provider, mechanicSchema, context, momentId) {
  const start = Date.now();
  try {
    const result = await withTimeout(provider.generate(mechanicSchema, context), GENERATION_TIMEOUT_MS);
    if (result && result.__timedOut) {
      recordProviderCall(momentId, provider.name, null, null, null, GENERATION_TIMEOUT_MS, 'timeout', null);
      return { ok: false, reason: 'timeout' };
    }
    if (!result || !result.payload || typeof result.payload !== 'object') {
      recordProviderCall(momentId, provider.name, result?.model, result?.modelVersion, null, result?.latencyMs ?? (Date.now() - start), 'error', result?.costEstimate);
      return { ok: false, reason: 'malformed' };
    }
    const safety = evaluateSafety(result.payload);
    if (!safety.passed) {
      recordProviderCall(momentId, provider.name, result.model, result.modelVersion, null, result.latencyMs, 'success', result.costEstimate);
      return { ok: false, reason: 'unsafe', providerResult: result, safety };
    }
    const providerCallId = recordProviderCall(momentId, provider.name, result.model, result.modelVersion, null, result.latencyMs, 'success', result.costEstimate);
    return { ok: true, result, providerCallId, safety };
  } catch (e) {
    // A raw provider error (e.g. "rate limit exceeded") is caught HERE and
    // never propagates further -- this is the enforcement point for "no
    // raw provider error reaches the client", not a promise kept only by
    // convention at the route layer.
    recordProviderCall(momentId, provider.name, null, null, null, Date.now() - start, 'error', null);
    return { ok: false, reason: 'error' };
  }
}

function recordProviderCall(momentId, provider, model, modelVersion, policyVersion, latencyMs, result, costEstimate) {
  const id = uid('apc');
  db.prepare(`INSERT INTO engage_provider_call (id,moment_id,provider,model,model_version,policy_version,latency_ms,result,cost_estimate,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, momentId, provider, model || null, modelVersion || null, policyVersion || null, latencyMs || null, result, costEstimate || null, Date.now());
  return id;
}

/** The full orchestration: try primary (4s timeout) -> on failure, ONE
 * alternate provider (also 4s timeout) -> on failure OR safety rejection
 * OR semantic duplicate at BOTH attempts, fall back to the Approved
 * Fallback pool the caller supplies. Returns { content, source, safety,
 * novelty } -- source is 'ai_generated' only if a provider's content
 * genuinely passed both Safety and Novelty; 'approved_fallback' in every
 * other case, silently and gracefully from the caller's perspective. */
async function generateWithOrchestration({ mechanicSchema, context, momentId, profileId, partnerId, propertyId, zoneId, fallbackContent }) {
  const attempts = [providers.primary, providers.secondary]; // "one alternate provider" = exactly one retry after primary
  for (const provider of attempts) {
    const attempt = await attemptProvider(provider, mechanicSchema, context, momentId);
    if (!attempt.ok) continue; // timeout/error/malformed/unsafe -> try next, or fall through to fallback after the loop
    // Safety already checked inside attemptProvider; now Semantic Novelty:
    const novelty = checkNoveltySemantic(profileId, attempt.result.payload, partnerId, propertyId, zoneId);
    if (novelty.isDuplicate) continue; // semantically duplicate -> try next provider, or fall through to fallback
    return {
      content: attempt.result.payload, source: 'ai_generated',
      safety: attempt.safety, novelty, providerCallId: attempt.providerCallId,
    };
  }
  // Total exhaustion (both providers failed, or both produced only unsafe
  // or duplicate content) -- Approved Fallback, evaluated with the SAME
  // Safety gate (defense in depth) and the ORIGINAL text_similarity
  // Novelty method (Inc-4), since this content did not come from AI.
  const { checkNovelty } = require('./engage-novelty.js');
  const fallbackSafety = evaluateSafety(fallbackContent);
  const fallbackNovelty = checkNovelty(profileId, fallbackContent, partnerId, propertyId, zoneId);
  return { content: fallbackContent, source: 'approved_fallback', safety: fallbackSafety, novelty: fallbackNovelty, providerCallId: null };
}

module.exports = { generateWithOrchestration, attemptProvider, recordProviderCall };
