// migrations/015_loyalty_partner_scope.js
//
// Go-Live P0 §3.4: loyalty must be partner-scoped. Until now
// loyalty_accounts was keyed on customer_key (the phone) ALONE, with no
// partner_id anywhere in lib/loyalty.js -- so a guest earning points at
// Partner A could spend them at Partner B, and Partner B silently
// absorbed the discount for a sale it never made. Every other subsystem
// in this product (partner data, and Engage identity in particular) is
// tenant-isolated; loyalty was the one that was not.
//
// §9 MIGRATION RULE — the important part of this file:
// "لا يتم تعيين partner_id للحسابات القديمة بطريقة تخمينية."
// Existing rows must NOT be guessed into a partner. This migration
// therefore classifies rather than assumes:
//
//   * An account whose real order history touches EXACTLY ONE partner is
//     attributable with certainty -> assigned to that partner.
//   * An account whose history spans MORE THAN ONE partner cannot be
//     split without inventing facts (whose points are whose?) -> it is
//     QUARANTINED: partner_id stays NULL and migration_status is set to
//     'needs_review' so a human decides before go-live.
//   * An account with NO order history at all is unattributable ->
//     also quarantined as 'orphan_no_orders'.
//
// A quarantined account is invisible to the new partner-scoped lookups
// (they all filter on partner_id), so no balance can be spent from an
// account nobody has claimed -- but the row and its balance are
// PRESERVED, never deleted, so the decision stays open and auditable.
'use strict';

const id = '015_loyalty_partner_scope';

function up(db) {
  // ---- Remove the legacy global UNIQUE(customer_key) ----
  // The original table declared `customer_key TEXT UNIQUE`, which makes
  // partner scoping structurally impossible: the same phone could never
  // exist at two partners. SQLite cannot drop a column constraint in
  // place, so the table is rebuilt -- the same technique migration 001
  // already uses to introduce real FOREIGN KEYs. All rows and balances
  // are copied across; nothing is dropped.
  const ddl = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='loyalty_accounts'`).get();
  if (ddl && /customer_key\s+TEXT\s+UNIQUE/i.test(ddl.sql)) {
    db.exec(`
      CREATE TABLE loyalty_accounts_new (
        id TEXT PRIMARY KEY, customer_key TEXT, points_balance INTEGER DEFAULT 0, created_at INTEGER,
        partner_id TEXT, migration_status TEXT DEFAULT 'active', verification_status TEXT DEFAULT 'unverified'
      );
      INSERT INTO loyalty_accounts_new (id, customer_key, points_balance, created_at)
        SELECT id, customer_key, points_balance, created_at FROM loyalty_accounts;
      DROP TABLE loyalty_accounts;
      ALTER TABLE loyalty_accounts_new RENAME TO loyalty_accounts;
    `);
  }

  const cols = db.prepare(`PRAGMA table_info(loyalty_accounts)`).all().map(c => c.name);

  if (!cols.includes('partner_id')) {
    db.exec(`ALTER TABLE loyalty_accounts ADD COLUMN partner_id TEXT`);
  }
  if (!cols.includes('migration_status')) {
    // 'active'        — normal, partner-scoped account
    // 'needs_review'  — pre-migration account spanning several partners
    // 'orphan_no_orders' — pre-migration account with no attributable history
    db.exec(`ALTER TABLE loyalty_accounts ADD COLUMN migration_status TEXT DEFAULT 'active'`);
  }
  if (!cols.includes('verification_status')) {
    // §3.6: verification state is deliberately independent of any
    // transport provider (SMS/WhatsApp/Email/IdP). Loyalty only ever
    // reads this column; it never learns which provider set it.
    db.exec(`ALTER TABLE loyalty_accounts ADD COLUMN verification_status TEXT DEFAULT 'unverified'`);
  }

  // ---- Classify pre-existing rows (never guess) ----
  const legacy = db.prepare(`SELECT id, customer_key FROM loyalty_accounts WHERE partner_id IS NULL`).all();
  for (const acct of legacy) {
    const partners = db.prepare(
      `SELECT DISTINCT partner_id FROM orders WHERE customer_phone = ? AND partner_id IS NOT NULL`
    ).all(acct.customer_key);

    if (partners.length === 1) {
      db.prepare(`UPDATE loyalty_accounts SET partner_id = ?, migration_status = 'active' WHERE id = ?`)
        .run(partners[0].partner_id, acct.id);
    } else if (partners.length > 1) {
      db.prepare(`UPDATE loyalty_accounts SET migration_status = 'needs_review' WHERE id = ?`).run(acct.id);
    } else {
      db.prepare(`UPDATE loyalty_accounts SET migration_status = 'orphan_no_orders' WHERE id = ?`).run(acct.id);
    }
  }

  // Logical key: one account per (partner, customer). Partial index so the
  // quarantined rows (partner_id NULL) do not collide with each other --
  // several unattributable accounts may legitimately share a phone.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_partner_customer
           ON loyalty_accounts (partner_id, customer_key) WHERE partner_id IS NOT NULL`);

  // ---- §3.6 verification challenges, provider-agnostic by design ----
  // Stores only a HASH of the code, never the code itself, and carries
  // expiry / attempt / resend state so any future provider inherits
  // replay and brute-force protection rather than reimplementing it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS verification_challenges (
      id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL,
      customer_key TEXT NOT NULL,
      channel TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_verif_lookup
           ON verification_challenges (partner_id, customer_key, status)`);
}

module.exports = { id, up };
