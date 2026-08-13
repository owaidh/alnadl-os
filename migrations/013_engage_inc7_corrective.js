// migrations/013_engage_inc7_corrective.js — Phase 5 P5-Inc-7 corrective
// round: honest method naming + a genuine vector-embedding pipeline.
//
// Before this migration, checkNoveltySemantic() (curated concept/synonym
// normalization + Jaccard) wrote method='semantic_embedding' into
// novelty_evaluation -- a real, useful heuristic, but NOT an embedding.
// This migration (1) widens the method CHECK to add the honest name
// 'semantic_concept_similarity' for that existing technique, keeping
// 'semantic_embedding' reserved for genuine vector similarity only, and
// (2) adds real embedding storage: exposure_memory gets nullable
// embedding_vector_json/embedding_model/embedding_model_version columns
// (nullable because embedding generation can fail and must degrade
// safely -- an exposure with no embedding simply has nothing to compare
// against, not a broken row), and engage_provider_call gets a call_type
// column so embedding calls share the exact same audit table as
// generation calls rather than a parallel one.
'use strict';

function up(db) {
  db.exec(`
    -- Widen novelty_evaluation.method: same table-rebuild pattern already
    -- used for venue_policy_override.scope_type in Inc-6.
    CREATE TABLE novelty_evaluation_new (
      id TEXT PRIMARY KEY,
      moment_id TEXT NOT NULL REFERENCES moment(id) ON DELETE CASCADE ON UPDATE CASCADE,
      is_duplicate INTEGER NOT NULL,
      similarity_score REAL,
      threshold_used REAL NOT NULL,
      method TEXT NOT NULL CHECK(method IN ('text_similarity','semantic_concept_similarity','semantic_embedding')),
      created_at INTEGER NOT NULL
    );
    INSERT INTO novelty_evaluation_new SELECT * FROM novelty_evaluation;
    DROP TABLE novelty_evaluation;
    ALTER TABLE novelty_evaluation_new RENAME TO novelty_evaluation;

    ALTER TABLE exposure_memory ADD COLUMN embedding_vector_json TEXT;
    ALTER TABLE exposure_memory ADD COLUMN embedding_model TEXT;
    ALTER TABLE exposure_memory ADD COLUMN embedding_model_version TEXT;

    ALTER TABLE engage_provider_call ADD COLUMN call_type TEXT;
    UPDATE engage_provider_call SET call_type = 'generation' WHERE call_type IS NULL;
  `);
}

module.exports = { up };
