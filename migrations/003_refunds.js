// migrations/003_refunds.js
//
// Q03: Full/Partial Refund infrastructure.
//
// Design: a refund is recorded as its OWN immutable event, never a mutation
// of the original sale. This mirrors the exact principle already used for
// revenue_models/revenue_ledger (Phase 4) and settlements (Phase 3) — no
// historical financial row is ever rewritten. `revenue_ledger` gets a
// `type` column ('sale' | 'refund_adjustment'); a refund inserts NEW
// negative-amount rows rather than editing the original sale row. Summing
// a period's ledger (SUM(eligible_base), SUM(partner_amount), ...)
// therefore correctly nets out refunds without ever losing the original
// transaction's true recorded value.
'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS refunds (
      id TEXT PRIMARY KEY, order_id TEXT, amount REAL, type TEXT, -- 'full' | 'partial'
      reason TEXT, gateway_ref TEXT, status TEXT, actor TEXT, actor_role TEXT, created_at INTEGER,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );
  `);
  try {
    db.exec(`ALTER TABLE revenue_ledger ADD COLUMN type TEXT DEFAULT 'sale'`);
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e;
  }
}

module.exports = { up };
