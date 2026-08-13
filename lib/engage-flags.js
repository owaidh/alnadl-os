// lib/engage-flags.js — Phase 5 P5-Inc-6: full Feature Flag precedence for
// the engage_enabled master switch.
//
// Global Safety/Platform Guardrails -> Partner Contract -> Property
// Override -> Zone Override, exactly as named in §25.8 of the source spec.
// This is the SAME precedence-resolution shape already proven for
// Engagement Ceiling (lib/engage-personality.js, Inc-2) and Novelty
// (lib/engage-novelty.js, Inc-4) -- reused here, not reinvented: a lower
// level can only ever RESTRICT (turn OFF), never override a higher level
// that has already said OFF.
'use strict';
const { db, uid } = require('../db.js');

const GLOBAL_SCOPE_ID = 'system'; // sentinel scope_id for the one global row

function getBoolOverride(scopeType, scopeId, policyKey) {
  if (!scopeId) return null;
  const row = db.prepare(`SELECT policy_value_json FROM venue_policy_override WHERE scope_type = ? AND scope_id = ? AND policy_key = ?`)
    .get(scopeType, scopeId, policyKey);
  if (!row) return null;
  const parsed = JSON.parse(row.policy_value_json);
  return typeof parsed.enabled === 'boolean' ? parsed.enabled : null;
}

/** Resolves whether Engage is enabled for a given order's context, walking
 * the full precedence chain. Contract (the existing per-plan
 * `engage_enabled` feature flag from Inc-1) is the baseline; Property/Zone
 * overrides can only turn it OFF from there, never back ON if Contract or
 * Global Safety already said OFF -- structurally identical reasoning to
 * resolveCeiling()'s min()-based clamping, just boolean instead of numeric. */
function resolveEngageEnabled(contractEnabled, partnerId, propertyId, zoneId) {
  const globalOverride = getBoolOverride('global', GLOBAL_SCOPE_ID, 'engage_enabled');
  if (globalOverride === false) return false; // Global Safety kill switch -- absolute, wins over everything below

  if (!contractEnabled) return false; // Partner Contract says OFF -- nothing more specific can turn it back on

  const propertyOverride = getBoolOverride('property', propertyId, 'engage_enabled');
  const zoneOverride = getBoolOverride('zone', zoneId, 'engage_enabled');
  // Most specific explicit override wins as a further restriction on top of
  // an already-ON contract; if neither is set, the contract's ON stands.
  if (zoneOverride === false || propertyOverride === false) return false;
  return true;
}

/** SuperAdmin-only. Sets (or clears, with enabled=null) the single global
 * kill switch row. This is the one lever that can turn Engage off
 * platform-wide regardless of what any partner is contractually paying
 * for -- deliberately the most locked-down write in this file. */
function setGlobalKillSwitch(enabled, setBy) {
  const existing = db.prepare(`SELECT id FROM venue_policy_override WHERE scope_type='global' AND scope_id=? AND policy_key='engage_enabled'`).get(GLOBAL_SCOPE_ID);
  if (existing) {
    db.prepare(`UPDATE venue_policy_override SET policy_value_json=?, set_by=?, created_at=? WHERE id=?`)
      .run(JSON.stringify({ enabled }), setBy, Date.now(), existing.id);
  } else {
    db.prepare(`INSERT INTO venue_policy_override (id,scope_type,scope_id,policy_key,policy_value_json,set_by,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(uid('vpo'), 'global', GLOBAL_SCOPE_ID, 'engage_enabled', JSON.stringify({ enabled }), setBy, Date.now());
  }
}

/** Property/Zone level override -- SuperAdmin or tenant-scoped PartnerAdmin
 * (RBAC + tenant check happens at the route, same pattern as Ceiling/
 * Novelty overrides). */
function setEngageEnabledOverride(scopeType, scopeId, enabled, setBy) {
  if (!['property', 'zone'].includes(scopeType)) throw new Error('scopeType must be property or zone for engage_enabled overrides (use the kill switch for global, Contract is set via the plan)');
  db.prepare(`INSERT INTO venue_policy_override (id,scope_type,scope_id,policy_key,policy_value_json,set_by,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(uid('vpo'), scopeType, scopeId, 'engage_enabled', JSON.stringify({ enabled }), setBy, Date.now());
}

function getGlobalKillSwitchState() {
  const v = getBoolOverride('global', GLOBAL_SCOPE_ID, 'engage_enabled');
  return v === null ? true : v; // no override set -> platform default is ON (Contract still governs per-partner)
}

module.exports = { resolveEngageEnabled, setGlobalKillSwitch, setEngageEnabledOverride, getGlobalKillSwitchState };
