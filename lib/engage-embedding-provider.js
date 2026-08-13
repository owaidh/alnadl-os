// lib/engage-embedding-provider.js — Phase 5 P5-Inc-7 corrective round:
// a genuine vector-embedding abstraction, independent of any vendor.
//
// EmbeddingProvider interface: embed(text) -> Promise<{vector: number[],
// model, modelVersion, dims}>. A real provider (OpenAI/Cohere/whatever is
// eventually contracted) implements this SAME shape -- no vendor name
// appears anywhere in the domain layer (lib/engage-novelty.js,
// lib/engage-ai-orchestrator.js never mention a specific vendor), exactly
// mirroring the discipline already proven for lib/engage-ai-provider.js's
// generation interface and lib/payment.js's MockGateway.
//
// MockEmbeddingProvider technique, stated plainly: character n-gram
// feature hashing (the "hashing trick") -- a real, legitimate, long-used
// lightweight vectorization technique (the same mechanism behind
// scikit-learn's HashingVectorizer and part of how fastText represents
// subword information), NOT a lookup table and NOT a trained neural
// model. It requires no curated dictionary of any kind -- it is a pure
// function of the characters in the input text, so it generalizes to any
// language or any paraphrase never seen before, including ones never
// enumerated anywhere in this codebase (see the Arabic and non-curated
// English test cases in tests/engage-inc7.js).
//
// Honest about its limits, stated once here rather than scattered: this
// technique captures LEXICAL/MORPHOLOGICAL similarity (shared substrings,
// shared roots) -- it does NOT capture pure synonym-level paraphrase where
// the words share no characters at all ("discovered" vs "birthplace").
// That deeper, meaning-based similarity genuinely requires a trained
// neural embedding model -- which is real AI provider infrastructure,
// exactly the kind of dependency classified as Pre-Go-Live/Integration
// Pending in docs/PHASE5_GAP_ANALYSIS.md, not something this Mock claims
// to already deliver.
'use strict';
const crypto = require('crypto');
const { db } = require('../db.js');

const EMBEDDING_TIMEOUT_MS = 2000;
const DEFAULT_DIMS = 128;
const NGRAM_SIZE = 3;

db.exec(`CREATE TABLE IF NOT EXISTS _test_mock_embedding_behavior (id INTEGER PRIMARY KEY CHECK(id=1), config_json TEXT)`);
function setMockEmbeddingBehavior(config) {
  db.exec(`DELETE FROM _test_mock_embedding_behavior WHERE id = 1`);
  db.prepare(`INSERT INTO _test_mock_embedding_behavior (id, config_json) VALUES (1, ?)`).run(JSON.stringify(config));
}
function clearMockEmbeddingBehavior() { db.exec(`DELETE FROM _test_mock_embedding_behavior WHERE id = 1`); }
function getMockEmbeddingBehavior() {
  const row = db.prepare(`SELECT config_json FROM _test_mock_embedding_behavior WHERE id = 1`).get();
  return row ? JSON.parse(row.config_json) : { mode: 'success' };
}

function hashToBucket(str, dims) {
  const h = crypto.createHash('md5').update(str).digest();
  return h.readUInt32BE(0) % dims;
}

/** Pure function: normalized text -> fixed-length vector. No dictionary,
 * no language-specific rules beyond whitespace normalization -- works
 * identically for Arabic, English, or any other script. */
function textToVector(text, dims) {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const vector = new Array(dims).fill(0);
  for (let i = 0; i <= normalized.length - NGRAM_SIZE; i++) {
    const ngram = normalized.slice(i, i + NGRAM_SIZE);
    vector[hashToBucket(ngram, dims)] += 1;
  }
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  return norm === 0 ? vector : vector.map(v => v / norm);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // Both vectors are already L2-normalized by textToVector(), so the dot
  // product IS the cosine similarity directly -- no need to re-divide by
  // norms here. Kept as a separate named function (rather than inlined)
  // so a real provider's non-pre-normalized vectors can reuse this exact
  // comparison by normalizing first.
  return dot;
}

class MockEmbeddingProvider {
  constructor({ name, model, modelVersion, dims }) {
    this.name = name;
    this.model = model;
    this.modelVersion = modelVersion;
    this.dims = dims || DEFAULT_DIMS;
  }

  async embed(text) {
    const start = Date.now();
    const behavior = getMockEmbeddingBehavior();
    const delayMs = behavior.delayMs != null ? behavior.delayMs : (5 + Math.floor(Math.random() * 20));
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));

    if (behavior.mode === 'error') {
      throw new Error(`[${this.name}] embedding provider error: service unavailable (internal diagnostic detail that must never reach a customer)`);
    }
    const vector = textToVector(text, this.dims);
    return { vector, model: this.model, modelVersion: this.modelVersion, dims: this.dims, latencyMs: Date.now() - start };
  }
}

function createDefaultEmbeddingProvider() {
  return new MockEmbeddingProvider({ name: 'mock-embedding-provider', model: 'mock-hashing-embedder', modelVersion: 'v1', dims: DEFAULT_DIMS });
}

module.exports = {
  MockEmbeddingProvider, createDefaultEmbeddingProvider, textToVector, cosineSimilarity,
  setMockEmbeddingBehavior, clearMockEmbeddingBehavior, EMBEDDING_TIMEOUT_MS, DEFAULT_DIMS,
};
