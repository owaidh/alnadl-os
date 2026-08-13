// lib/engage-ledger.js — Phase 5 P5-Inc-3/6: Experience Ledger + Admin
// Overview + Partner Overview (SQL-level tenant scoping + Inc-6 cohort
// privacy threshold).
//
// Tenant filtering happens in the SQL WHERE clause itself, via
// json_extract() on context_snapshot_json with a parameterized value —
// never a post-query JavaScript .filter(). This matters even though the
// prior post-query filtering was not exploitable (the full row set was
// pulled into the Node process either way, just discarded there): as
// Engage data volume grows in later increments, a WHERE clause is what
// actually keeps the query itself bounded to one tenant, and it removes
// any possibility of a future refactor accidentally returning the
// unfiltered array before the .filter() step runs.
//
// Two distinct read models, deliberately kept separate rather than one
// endpoint with a role-based field filter bolted on — this makes it
// structurally impossible for a future change to accidentally leak
// mechanic/payload internals into the Partner-facing response, since that
// response is built by a completely different function that never even
// SELECTs those columns.
'use strict';
const { db } = require('../db.js');

const PARTNER_COHORT_THRESHOLD = 10; // §25.9: below this, suppress entirely

/** Full internal Ledger — exact payload, mechanic, selection reason, full
 * audit trail. SuperAdmin/internal-only (enforced at the route, not here —
 * this function itself has no concept of "who is asking"). Optionally
 * scoped to one partner via a real SQL WHERE clause (parameterized) for
 * SuperAdmin's own convenience when investigating a specific tenant; never
 * required. */
function getFullLedger({ partnerId, limit } = {}) {
  let sql = `
    SELECT mo.id AS moment_id, mo.session_id, mo.sequence_index, mo.status AS moment_status,
           mo.selection_reason, mo.created_at AS served_at,
           es.personality, es.pass_id,
           mv.mechanic_id, mv.version_number, m.name AS mechanic_name,
           pv.rendered_payload_json, pv.source AS payload_source,
           ep.order_id, ep.identity_ref, ep.context_snapshot_json,
           re.response_payload_json, re.ts AS responded_at
    FROM moment mo
    JOIN engage_session es ON es.id = mo.session_id
    JOIN engage_pass ep ON ep.id = es.pass_id
    JOIN mechanic_version mv ON mv.id = mo.mechanic_version_id
    JOIN mechanic m ON m.id = mv.mechanic_id
    LEFT JOIN payload_version pv ON pv.moment_id = mo.id
    LEFT JOIN response_event re ON re.moment_id = mo.id`;
  const params = [];
  if (partnerId) {
    sql += ` WHERE json_extract(ep.context_snapshot_json, '$.partnerId') = ?`;
    params.push(partnerId);
  }
  sql += ` ORDER BY mo.created_at DESC`;
  if (limit) { sql += ` LIMIT ?`; params.push(limit); }

  return db.prepare(sql).all(...params);
}

/** Admin-level aggregate Overview — counts only, no per-moment detail,
 * matching §10's Overview row (Eligible/Offered/Started/Completed; the
 * Freshness/Safety/AI-Health columns from the source spec are Inc-4/Inc-7
 * scope and are not fabricated here). */
function getAdminOverview() {
  const eligible = db.prepare('SELECT COUNT(*) c FROM engage_pass').get().c;
  const offered = db.prepare('SELECT COUNT(*) c FROM engage_session').get().c;
  const started = db.prepare('SELECT COUNT(DISTINCT session_id) c FROM moment').get().c;
  const completed = db.prepare(`SELECT COUNT(*) c FROM engage_session WHERE status = 'ended'`).get().c;
  const byPersonality = db.prepare('SELECT personality, COUNT(*) c FROM engage_session GROUP BY personality').all();
  const mechanicLifecycle = db.prepare('SELECT lifecycle_state, COUNT(*) c FROM mechanic_version GROUP BY lifecycle_state').all();
  return { eligible, offered, started, completed, byPersonality, mechanicLifecycle };
}

/** Partner-scoped aggregate Overview — counts and personality distribution
 * ONLY, for exactly one tenant, filtered in SQL itself via a parameterized
 * WHERE clause. Deliberately SELECTs NONE of: payload text, mechanic
 * name/id, selection_reason, provider/model info — there is no column in
 * this function's SQL that could leak those even by a future accidental
 * change, because they are never in the SELECT list here at all. Matches
 * §11's explicit Partner Dashboard restriction ("لا يظهر: prompts, model
 * routing, ..., Mechanic Lab internals") by construction, not by a filter
 * applied after the fact.
 *
 * Inc-6: minimum cohort threshold (§25.9) — below 10 sessions, the entire
 * response is suppressed rather than partially shown. Suppressing only
 * the per-personality breakdown while still showing a small raw "offered"
 * count would itself leak the small number; suppressing everything
 * (including "offered" itself) is the only response shape that reveals
 * nothing about a cohort too small to aggregate safely. */
function getPartnerOverview(partnerId) {
  const sessions = db.prepare(`
    SELECT es.personality, es.status
    FROM engage_session es
    JOIN engage_pass ep ON ep.id = es.pass_id
    WHERE json_extract(ep.context_snapshot_json, '$.partnerId') = ?
  `).all(partnerId);

  const offered = sessions.length;
  if (offered < PARTNER_COHORT_THRESHOLD) {
    return { suppressed: true, reason: 'Insufficient Data', minimumCohort: PARTNER_COHORT_THRESHOLD };
  }

  const completed = sessions.filter(s => s.status === 'ended').length;
  const byPersonality = {};
  for (const s of sessions) byPersonality[s.personality] = (byPersonality[s.personality] || 0) + 1;

  return { suppressed: false, offered, completed, byPersonality };
}

module.exports = { getFullLedger, getAdminOverview, getPartnerOverview, PARTNER_COHORT_THRESHOLD };
