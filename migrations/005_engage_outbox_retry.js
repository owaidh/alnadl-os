// migrations/005_engage_outbox_retry.js — P5-Inc-1 corrective round.
//
// Rebuilds engage_outbox with real retry bookkeeping. SQLite can't ALTER a
// CHECK constraint in place, so this follows the exact same
// create-copy-drop-rename procedure already proven in
// migrations/001_add_foreign_keys.js.
'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE engage_outbox_new (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE ON UPDATE CASCADE,
      event_type TEXT NOT NULL DEFAULT 'order.confirmed',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processed','skipped','dead_letter')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      next_attempt_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      processed_at INTEGER
    );
    INSERT INTO engage_outbox_new (id,order_id,event_type,status,attempts,created_at,processed_at)
      SELECT id,order_id,event_type,
        CASE WHEN status='failed' THEN 'dead_letter' ELSE status END,
        attempts,created_at,processed_at
      FROM engage_outbox;
    DROP TABLE engage_outbox;
    ALTER TABLE engage_outbox_new RENAME TO engage_outbox;
  `);
}

module.exports = { up };
