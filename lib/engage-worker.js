// lib/engage-worker.js — Phase 5 P5-Inc-1 Outbox Consumer.
//
// This is the ONLY code that reads engage_outbox and creates engage_pass
// rows. Core (server.js's payment handler) writes to engage_outbox
// unconditionally and knows nothing else about Engage — this file is where
// every Engage-specific decision (is the flag on? is the pass valid?) lives.
//
// processOutboxOnce() is a pure, synchronous, directly-testable function —
// the setInterval wrapper (startEngageWorker) is a thin scheduling shell
// around it so tests never need to wait on real timers.
'use strict';
const { db, uid } = require('../db.js');
const { getSubscription } = require('./plan.js');

const PASS_TTL_MS = 4 * 3600 * 1000; // 4 hours — a generous ceiling; Inc-2's Ceiling logic governs actual session limits

function engageAuditLog(actor, action, objectType, objectId, before, after) {
  db.prepare(`INSERT INTO engage_audit_log (actor,action,object_type,object_id,before_json,after_json,ts) VALUES (?,?,?,?,?,?,?)`)
    .run(actor, action, objectType, objectId, before != null ? JSON.stringify(before) : null, after != null ? JSON.stringify(after) : null, Date.now());
}

/** Processes every 'pending' engage_outbox row once. Returns a summary for
 * tests/observability. Idempotent: a row already 'processed'/'skipped' is
 * never touched twice (status is the guard, checked in the same query that
 * selects pending rows). */
function processOutboxOnce() {
  const pending = db.prepare(`SELECT * FROM engage_outbox WHERE status = 'pending' ORDER BY created_at ASC`).all();
  const result = { processed: 0, skipped: 0, failed: 0 };

  for (const row of pending) {
    try {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(row.order_id);
      if (!order) {
        // Should be structurally impossible (engage_outbox.order_id carries a
        // real FK to orders), but handled defensively rather than throwing.
        db.prepare(`UPDATE engage_outbox SET status='failed', attempts=attempts+1, processed_at=? WHERE id=?`).run(Date.now(), row.id);
        result.failed++;
        continue;
      }

      const sub = getSubscription(order.partner_id);
      const engageOn = sub && sub.status === 'Active' && sub.features && sub.features.engage_enabled === true;
      if (!engageOn) {
        // The flag is OFF (or partner has no active plan with it) — this is
        // the normal, expected case for every partner today. Not a failure.
        db.prepare(`UPDATE engage_outbox SET status='skipped', attempts=attempts+1, processed_at=? WHERE id=?`).run(Date.now(), row.id);
        result.skipped++;
        continue;
      }

      const zone = db.prepare('SELECT * FROM zones WHERE id = ?').get(order.zone_id);
      const property = zone ? db.prepare('SELECT * FROM properties WHERE id = ?').get(zone.property_id) : null;
      const now = Date.now();
      const passId = uid('ep');
      const contextSnapshot = {
        partnerId: order.partner_id, propertyId: property ? property.id : null,
        zoneId: order.zone_id, pointId: order.point_id, orderId: order.id,
        capturedAt: now,
      };
      db.prepare(`INSERT INTO engage_pass (id,order_id,identity_ref,context_snapshot_json,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?)`)
        .run(passId, order.id, order.customer_phone || null, JSON.stringify(contextSnapshot), 'active', now, now + PASS_TTL_MS);
      engageAuditLog('system:engage-worker', 'pass_create', 'engage_pass', passId, null, { orderId: order.id });

      db.prepare(`UPDATE engage_outbox SET status='processed', attempts=attempts+1, processed_at=? WHERE id=?`).run(now, row.id);
      result.processed++;
    } catch (e) {
      db.prepare(`UPDATE engage_outbox SET status='failed', attempts=attempts+1, processed_at=? WHERE id=?`).run(Date.now(), row.id);
      engageAuditLog('system:engage-worker', 'outbox_process_error', 'engage_outbox', row.id, null, { error: e.message });
      result.failed++;
    }
  }
  return result;
}

let intervalHandle = null;
/** Starts the polling loop. A no-op if already running. This is the only
 * piece of this file that touches real timers — everything else is pure
 * and unit-testable without waiting. */
function startEngageWorker(intervalMs = 5000) {
  if (intervalHandle) return;
  intervalHandle = setInterval(processOutboxOnce, intervalMs);
  if (intervalHandle.unref) intervalHandle.unref(); // never keeps the process alive on its own
}
function stopEngageWorker() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
}

module.exports = { processOutboxOnce, startEngageWorker, stopEngageWorker, engageAuditLog };
