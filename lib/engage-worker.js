// lib/engage-worker.js — Phase 5 P5-Inc-1 Outbox Consumer.
//
// This is the ONLY code that reads engage_outbox and creates engage_pass
// rows. Core (server.js's payment handler) writes to engage_outbox
// unconditionally and knows nothing else about Engage — this file is where
// every Engage-specific decision (is the flag on? is the pass valid? should
// this failure be retried?) lives.
//
// processOutboxOnce() is a pure, synchronous, directly-testable function —
// the setInterval wrapper (startEngageWorker) is a thin scheduling shell
// around it so tests never need to wait on real timers.
'use strict';
const { db, uid } = require('../db.js');
const { getSubscription } = require('./plan.js');

const PASS_TTL_MS = 4 * 3600 * 1000; // 4 hours — a generous ceiling; Inc-2's Ceiling logic governs actual session limits

// Retry policy (corrective round): exponential backoff, capped, with a real
// dead-letter terminal state after max_attempts is exhausted. Backoff is
// intentionally short in absolute terms (seconds, not minutes) because this
// queue only ever holds order.confirmed events for a single-process
// deployment — there is no cross-service network hop to wait out.
function backoffMs(attempts) { return Math.min(1000 * Math.pow(2, attempts), 30000); } // 1s, 2s, 4s, 8s... capped at 30s

// Test-only failure injection hook — lets tests deterministically simulate a
// transient processing failure (e.g. "the 1st attempt for this order fails,
// the 2nd succeeds") without needing to fake real infrastructure outages.
// Production code path is untouched: the default injector never fires.
let failureInjector = () => null;
function setFailureInjector(fn) { failureInjector = fn || (() => null); }

function engageAuditLog(actor, action, objectType, objectId, before, after) {
  db.prepare(`INSERT INTO engage_audit_log (actor,action,object_type,object_id,before_json,after_json,ts) VALUES (?,?,?,?,?,?,?)`)
    .run(actor, action, objectType, objectId, before != null ? JSON.stringify(before) : null, after != null ? JSON.stringify(after) : null, Date.now());
}

/** Builds the context snapshot for a pass — frozen at issuance, per the
 * "no live re-query, no duplicate master data" principle (same as
 * revenue_ledger.model_snapshot_json). Includes the QR token active for the
 * point and every outlet touched by this order (correctly plural for a
 * Unified Cart order spanning multiple outlets) — referenced by id/name/type
 * only, never a full copy of the outlets row. */
function buildContextSnapshot(order) {
  const zone = db.prepare('SELECT * FROM zones WHERE id = ?').get(order.zone_id);
  const property = zone ? db.prepare('SELECT * FROM properties WHERE id = ?').get(zone.property_id) : null;
  const qrToken = db.prepare('SELECT token, qr_type FROM qr_tokens WHERE point_id = ? AND active = 1').get(order.point_id);
  const outletIds = db.prepare('SELECT DISTINCT outlet_id FROM order_items WHERE order_id = ? AND outlet_id IS NOT NULL').all(order.id).map(r => r.outlet_id);
  const outlets = outletIds.map(id => {
    const o = db.prepare('SELECT id, name_ar, name_en, type FROM outlets WHERE id = ?').get(id);
    return o ? { id: o.id, nameAr: o.name_ar, nameEn: o.name_en, type: o.type } : { id };
  });
  return {
    partnerId: order.partner_id, propertyId: property ? property.id : null,
    zoneId: order.zone_id, pointId: order.point_id, orderId: order.id,
    qrToken: qrToken ? qrToken.token : null, qrType: qrToken ? qrToken.qr_type : null,
    outlets, // [] for a legacy single-outlet order with no outlet_id recorded, [one] for a normal order, [many] for Unified Cart
    isMultiOutlet: outlets.length > 1,
    capturedAt: Date.now(),
  };
}

/** Processes every row currently eligible (status='pending' AND
 * (next_attempt_at IS NULL OR next_attempt_at <= now)) once. Returns a
 * summary for tests/observability. Idempotent: a row already
 * 'processed'/'skipped'/'dead_letter' is never touched twice. */
function processOutboxOnce() {
  const now = Date.now();
  const pending = db.prepare(`
    SELECT * FROM engage_outbox
    WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    ORDER BY created_at ASC`).all(now);
  const result = { processed: 0, skipped: 0, retried: 0, deadLettered: 0 };

  for (const row of pending) {
    try {
      const injectedError = failureInjector(row);
      if (injectedError) throw injectedError;

      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(row.order_id);
      if (!order) {
        // Structurally near-impossible (engage_outbox.order_id carries a real
        // FK to orders), and NOT a transient condition — retrying won't ever
        // fix a genuinely missing order, so this goes straight to
        // dead-letter rather than consuming retry attempts pointlessly.
        db.prepare(`UPDATE engage_outbox SET status='dead_letter', attempts=attempts+1, last_error=?, processed_at=? WHERE id=?`)
          .run('order not found', Date.now(), row.id);
        engageAuditLog('system:engage-worker', 'outbox_dead_letter', 'engage_outbox', row.id, null, { reason: 'order not found' });
        result.deadLettered++;
        continue;
      }

      const sub = getSubscription(order.partner_id);
      const engageOn = sub && sub.status === 'Active' && sub.features && sub.features.engage_enabled === true;
      if (!engageOn) {
        // The flag is OFF (or partner has no active plan with it) — this is
        // the normal, expected case for every partner today. Not a failure,
        // not subject to retry.
        db.prepare(`UPDATE engage_outbox SET status='skipped', attempts=attempts+1, processed_at=? WHERE id=?`).run(Date.now(), row.id);
        result.skipped++;
        continue;
      }

      const passId = uid('ep');
      const contextSnapshot = buildContextSnapshot(order);
      db.prepare(`INSERT INTO engage_pass (id,order_id,identity_ref,context_snapshot_json,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?)`)
        .run(passId, order.id, order.customer_phone || null, JSON.stringify(contextSnapshot), 'active', now, now + PASS_TTL_MS);
      engageAuditLog('system:engage-worker', 'pass_create', 'engage_pass', passId, null, { orderId: order.id });

      db.prepare(`UPDATE engage_outbox SET status='processed', attempts=attempts+1, processed_at=? WHERE id=?`).run(now, row.id);
      result.processed++;
    } catch (e) {
      const attempts = row.attempts + 1;
      if (attempts >= row.max_attempts) {
        db.prepare(`UPDATE engage_outbox SET status='dead_letter', attempts=?, last_error=?, processed_at=? WHERE id=?`)
          .run(attempts, e.message, Date.now(), row.id);
        engageAuditLog('system:engage-worker', 'outbox_dead_letter', 'engage_outbox', row.id, { attempts: row.attempts }, { attempts, error: e.message });
        result.deadLettered++;
      } else {
        // Stays 'pending' so the next poll cycle picks it up again, but not
        // before next_attempt_at — real exponential backoff, not a tight loop.
        db.prepare(`UPDATE engage_outbox SET attempts=?, next_attempt_at=?, last_error=? WHERE id=?`)
          .run(attempts, Date.now() + backoffMs(attempts), e.message, row.id);
        result.retried++;
      }
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

module.exports = { processOutboxOnce, startEngageWorker, stopEngageWorker, engageAuditLog, setFailureInjector, buildContextSnapshot };
