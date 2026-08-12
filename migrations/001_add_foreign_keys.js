// migrations/001_add_foreign_keys.js
//
// Q09: retrofits real FOREIGN KEY constraints (not just documentation) onto
// the tables where referential integrity matters most for financial and
// operational correctness: the order lifecycle and its money trail.
//
// SQLite cannot ALTER a live table to add a foreign key — the documented
// procedure (https://sqlite.org/lang_altertable.html #7) is: create a new
// table with the constraint, copy the data across, drop the old table,
// rename the new one into place. That is exactly what this migration does,
// for one table at a time, inside a single transaction (the migration
// runner wraps this whole file in BEGIN/COMMIT already).
//
// Scope of this pass: order_items, child_orders, payments, revenue_ledger —
// the tables directly in the money path (Q19 Financial Regression depends
// on these being provably consistent). Extending the same pattern to the
// remaining tables (zones/points/categories/products/...) is the next
// migration to write before a production launch; it is not done here to
// keep this migration reviewable and its blast radius small.
'use strict';

function up(db) {
  // --- order_items -> orders, products ---
  db.exec(`
    CREATE TABLE order_items_new (
      id TEXT PRIMARY KEY, order_id TEXT, product_id TEXT, merchant_id TEXT, outlet_id TEXT, child_order_id TEXT,
      name_ar TEXT, name_en TEXT, qty INTEGER, unit_price REAL, variant_json TEXT, addons_json TEXT, notes TEXT, line_total REAL,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (child_order_id) REFERENCES child_orders(id)
    );
    INSERT INTO order_items_new SELECT id, order_id, product_id, merchant_id, outlet_id, child_order_id, name_ar, name_en, qty, unit_price, variant_json, addons_json, notes, line_total FROM order_items;
    DROP TABLE order_items;
    ALTER TABLE order_items_new RENAME TO order_items;
  `);

  // --- child_orders -> orders, outlets ---
  db.exec(`
    CREATE TABLE child_orders_new (
      id TEXT PRIMARY KEY, parent_order_id TEXT, outlet_id TEXT, status TEXT DEFAULT 'Paid',
      subtotal REAL, station_id TEXT, cancel_reason TEXT, created_at INTEGER, updated_at INTEGER,
      FOREIGN KEY (parent_order_id) REFERENCES orders(id),
      FOREIGN KEY (outlet_id) REFERENCES outlets(id)
    );
    INSERT INTO child_orders_new SELECT id, parent_order_id, outlet_id, status, subtotal, station_id, cancel_reason, created_at, updated_at FROM child_orders;
    DROP TABLE child_orders;
    ALTER TABLE child_orders_new RENAME TO child_orders;
  `);

  // --- payments -> orders ---
  db.exec(`
    CREATE TABLE payments_new (
      id TEXT PRIMARY KEY, order_id TEXT, gateway_ref TEXT, amount REAL, status TEXT,
      method TEXT, fees REAL DEFAULT 0, created_at INTEGER,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );
    INSERT INTO payments_new SELECT id, order_id, gateway_ref, amount, status, method, fees, created_at FROM payments;
    DROP TABLE payments;
    ALTER TABLE payments_new RENAME TO payments;
  `);

  // --- revenue_ledger -> orders, outlets ---
  db.exec(`
    CREATE TABLE revenue_ledger_new (
      id TEXT PRIMARY KEY, order_id TEXT, outlet_id TEXT,
      gross_amount REAL, discount_amount REAL, eligible_base REAL,
      partner_amount REAL, alnadl_amount REAL, model_snapshot_json TEXT, created_at INTEGER,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (outlet_id) REFERENCES outlets(id)
    );
    INSERT INTO revenue_ledger_new SELECT id, order_id, outlet_id, gross_amount, discount_amount, eligible_base, partner_amount, alnadl_amount, model_snapshot_json, created_at FROM revenue_ledger;
    DROP TABLE revenue_ledger;
    ALTER TABLE revenue_ledger_new RENAME TO revenue_ledger;
  `);
}

module.exports = { up };
