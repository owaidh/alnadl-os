// lib/engage-ai-provider.js — Phase 5 P5-Inc-7: AI Provider abstraction +
// MockAIProvider.
//
// This interface is deliberately provider-agnostic: generate(mechanicSchema,
// context) -> Promise<{payload, latencyMs, provider, model, modelVersion,
// costEstimate}>. A real provider adapter (OpenAI, Anthropic, whatever is
// eventually contracted) implements this SAME shape and can be swapped in
// without touching the orchestrator at all -- exactly the same pattern
// already proven for lib/payment.js's MockGateway, which let refunds be
// built and fully tested with zero payment credentials.
//
// MockAIProvider never calls any real network endpoint -- it is entirely
// deterministic-but-controllable, via setMockBehavior(), so tests can
// force success/timeout/error/malformed/unsafe outcomes on demand without
// depending on real infrastructure or non-determinism.
'use strict';
const crypto = require('crypto');

const GENERATION_TIMEOUT_MS = 4000; // §25.4

// Content bank: deliberately includes PAIRS of entries that are
// semantically equivalent but share very few literal words -- this is
// what proves semantic novelty (this increment) catches near-duplicates
// that raw text_similarity (Inc-4) cannot. See docs/PHASE5_GAP_ANALYSIS.md
// for the worked-out example and the exact numbers.
const CONTENT_BANK = {
  SPARK: [
    { title_en: 'Did You Know?', body_en: 'Coffee was first discovered in Ethiopia.' },
    { title_en: 'Fun Fact', body_en: 'Ethiopia is the birthplace of coffee.' }, // semantic paraphrase of the entry above
    { title_en: 'Quick Question', body_en: 'What is your favorite way to enjoy your coffee today?' },
  ],
  DISCOVER: [
    { title_en: 'Explore', body_en: 'This hotel features a rooftop garden with a city view.' },
    { title_en: 'Did You Notice?', body_en: 'A garden on the roof offers a view over the city here.' }, // semantic paraphrase
  ],
  PLAY: [
    { title_en: 'Riddle', body_en: 'What gets bigger the more you take away from it? A hole.' },
    { title_en: 'Brain Teaser', body_en: 'The more you remove from it, the larger it becomes -- what is it? A hole.' }, // semantic paraphrase
  ],
  RESET: [
    { title_en: 'A Moment of Calm', body_en: 'Take a deep breath. Your order is on its way.' },
  ],
  MIND: [
    { title_en: 'Quote', body_en: 'Calm is a superpower.' },
  ],
};

// A deliberately artificial, unmistakable marker used to test the Safety
// gate -- chosen specifically so no real unsafe/objectionable text ever
// needs to exist anywhere in this codebase, its tests, or its docs, while
// still proving the rejection path is genuinely exercised end-to-end.
const UNSAFE_TEST_MARKER = '[TEST-ONLY-UNSAFE-CONTENT-MARKER]';
const UNSAFE_TEST_CONTENT = { title_en: UNSAFE_TEST_MARKER, body_en: UNSAFE_TEST_MARKER };

// Test-only behavior injection. IMPORTANT: this is read from the SAME
// shared SQLite file the server (and its worker) use, NOT an in-memory
// JS variable -- an in-memory variable would live only in whichever
// process set it, and the real server always runs as a genuinely
// separate OS process (spawned via child_process in tests/helpers.js),
// never sharing memory with the test process that calls
// setMockBehavior(). This exact class of mistake was caught empirically
// on the FIRST real test run (every AI-orchestration test failed because
// the spawned server subprocess never saw the test process's in-memory
// setting), not discovered by code review -- fixed by moving the control
// signal into the database file both processes already share, the same
// cross-process test-control pattern already proven for join-attempt
// rate-limit state in lib/engage-social.js's test hooks.
const { db } = require('../db.js');
db.exec(`CREATE TABLE IF NOT EXISTS _test_mock_ai_behavior (id INTEGER PRIMARY KEY CHECK(id=1), config_json TEXT)`);

/** config: { mode: 'success'|'timeout'|'error'|'malformed'|'unsafe',
 * delayMs?, variantIndex?, providers?: ['mock-provider-primary', ...] }.
 * providers, if set, scopes the override to only the named provider(s) --
 * this is what lets a test simulate "primary fails, secondary succeeds"
 * (set providers:['mock-provider-primary'] with mode:'error'; the
 * secondary, not matched, falls through to normal default success). */
function setMockBehavior(config) {
  db.exec(`DELETE FROM _test_mock_ai_behavior WHERE id = 1`);
  db.prepare(`INSERT INTO _test_mock_ai_behavior (id, config_json) VALUES (1, ?)`).run(JSON.stringify(config));
}
function clearMockBehavior() {
  db.exec(`DELETE FROM _test_mock_ai_behavior WHERE id = 1`);
}
function getMockBehaviorFor(providerName) {
  const row = db.prepare(`SELECT config_json FROM _test_mock_ai_behavior WHERE id = 1`).get();
  if (!row) return { mode: 'success' };
  const config = JSON.parse(row.config_json);
  if (config.providers && !config.providers.includes(providerName)) return { mode: 'success' };
  return config;
}

class MockAIProvider {
  constructor({ name, model, modelVersion }) {
    this.name = name;
    this.model = model;
    this.modelVersion = modelVersion;
  }

  /** Always resolves (never used to directly throw for "timeout" -- the
   * ORCHESTRATOR is responsible for enforcing the 4s timeout via
   * Promise.race against a real elapsed delay here, exactly mirroring how
   * a real network call's timeout would actually be enforced by the
   * caller, not the provider pretending to time itself out). */
  async generate(mechanicSchema, context) {
    const start = Date.now();
    const decision = getMockBehaviorFor(this.name);
    const delayMs = decision.delayMs != null ? decision.delayMs : (20 + Math.floor(Math.random() * 80));
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    const latencyMs = Date.now() - start;

    if (decision.mode === 'error') {
      // A raw, provider-specific error -- the orchestrator must NEVER let
      // this string reach the client directly.
      throw new Error(`[${this.name}] upstream provider error: rate limit exceeded (internal diagnostic detail that must never reach a customer)`);
    }
    if (decision.mode === 'malformed') {
      return { payload: null, latencyMs, provider: this.name, model: this.model, modelVersion: this.modelVersion, costEstimate: 0.0008 };
    }
    if (decision.mode === 'unsafe') {
      return { payload: UNSAFE_TEST_CONTENT, latencyMs, provider: this.name, model: this.model, modelVersion: this.modelVersion, costEstimate: 0.0012 };
    }
    // 'success' (default)
    const pool = CONTENT_BANK[context.personality] || CONTENT_BANK.RESET;
    const index = (decision.variantIndex != null ? decision.variantIndex : (context.variantIndex || 0)) % pool.length;
    return { payload: pool[index], latencyMs, provider: this.name, model: this.model, modelVersion: this.modelVersion, costEstimate: 0.0015 };
  }
}

function createDefaultProviders() {
  return {
    primary: new MockAIProvider({ name: 'mock-provider-primary', model: 'mock-gpt', modelVersion: 'v1' }),
    secondary: new MockAIProvider({ name: 'mock-provider-secondary', model: 'mock-fallback-model', modelVersion: 'v1' }),
  };
}

module.exports = { MockAIProvider, createDefaultProviders, setMockBehavior, clearMockBehavior, GENERATION_TIMEOUT_MS, UNSAFE_TEST_MARKER, CONTENT_BANK };
