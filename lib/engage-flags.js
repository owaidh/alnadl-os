// lib/engage-flags.js — Phase 5 P5-Inc-6/7: full Feature Flag precedence,
// generalized to any boolean Engage flag (engage_enabled, and now
// engage_ai_generation for Inc-7).
//
// Global Safety/Platform Guardrails -> Partner Contract -> Property
// Override -> Zone Override, exactly as named in §25.8 of the source spec.
// This is the SAME precedence-resolution shape already proven for
// Engagement Ceiling (lib/engage-personality.js, Inc-2) and Novelty
// (lib/engage-novelty.js, Inc-4).
//
// Global and Partner Contract are the only two NON-OVERRIDABLE
// prohibitions: if either says OFF, nothing below it can ever turn the
// flag back on. Once both have cleared, Property and Zone are TRUE
// hierarchical overrides -- the most specific EXPLICIT value wins, in
// either direction (a Zone override can turn ON what a less-specific
// Property said OFF, exactly as it can turn OFF what Property left ON),
// resolved via the same zone ?? property ?? default chain already proven
// for resolveCeiling().
'use strict';
const { db, uid } = require('../db.js');

const GLOBAL_SCOPE_ID = 'system'; // sentinel scope_id for the one global row per flag

function getBoolOverride(scopeType, scopeId, policyKey) {
  if (!scopeId) return null;
  const row = db.prepare(`SELECT policy_value_json FROM venue_policy_override WHERE scope_type = ? AND scope_id = ? AND policy_key = ?`)
    .get(scopeType, scopeId, policyKey);
  if (!row) return null;
  const parsed = JSON.parse(row.policy_value_json);
  return typeof parsed.enabled === 'boolean' ? parsed.enabled : null;
}

/** The generic resolver every specific flag (engage_enabled,
 * engage_ai_generation, ...) delegates to -- one implementation, so a fix
 * to the precedence logic (like the corrective round that replaced an
 * OR-based check with this exact ?? chain) automatically applies to every
 * flag built on top of it, not just the one that was tested at the time. */
function resolveFlag(flagKey, contractEnabled, partnerId, propertyId, zoneId) {
  const globalOverride = getBoolOverride('global', GLOBAL_SCOPE_ID, flagKey);
  if (globalOverride === false) return false; // Global Safety -- absolute, non-overridable prohibition

  if (!contractEnabled) return false; // Partner Contract -- absolute, non-overridable prohibition

  const propertyOverride = getBoolOverride('property', propertyId, flagKey);
  const zoneOverride = getBoolOverride('zone', zoneId, flagKey);
  return zoneOverride ?? propertyOverride ?? true;
}

function setGlobalKillSwitchFor(flagKey, enabled, setBy) {
  const existing = db.prepare(`SELECT id FROM venue_policy_override WHERE scope_type='global' AND scope_id=? AND policy_key=?`).get(GLOBAL_SCOPE_ID, flagKey);
  if (existing) {
    db.prepare(`UPDATE venue_policy_override SET policy_value_json=?, set_by=?, created_at=? WHERE id=?`)
      .run(JSON.stringify({ enabled }), setBy, Date.now(), existing.id);
  } else {
    db.prepare(`INSERT INTO venue_policy_override (id,scope_type,scope_id,policy_key,policy_value_json,set_by,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(uid('vpo'), 'global', GLOBAL_SCOPE_ID, flagKey, JSON.stringify({ enabled }), setBy, Date.now());
  }
}

function setOverrideFor(flagKey, scopeType, scopeId, enabled, setBy) {
  if (!['property', 'zone'].includes(scopeType)) throw new Error(`scopeType must be property or zone for ${flagKey} overrides (use the kill switch for global, Contract is set via the plan)`);
  db.prepare(`INSERT INTO venue_policy_override (id,scope_type,scope_id,policy_key,policy_value_json,set_by,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(uid('vpo'), scopeType, scopeId, flagKey, JSON.stringify({ enabled }), setBy, Date.now());
}

function getGlobalKillSwitchStateFor(flagKey) {
  const v = getBoolOverride('global', GLOBAL_SCOPE_ID, flagKey);
  return v === null ? true : v; // no override set -> platform default is ON (Contract still governs per-partner)
}

// ---- engage_enabled (Inc-6) — unchanged public API, now backed by resolveFlag() ----
function resolveEngageEnabled(contractEnabled, partnerId, propertyId, zoneId) {
  return resolveFlag('engage_enabled', contractEnabled, partnerId, propertyId, zoneId);
}
function setGlobalKillSwitch(enabled, setBy) { return setGlobalKillSwitchFor('engage_enabled', enabled, setBy); }
function setEngageEnabledOverride(scopeType, scopeId, enabled, setBy) { return setOverrideFor('engage_enabled', scopeType, scopeId, enabled, setBy); }
function getGlobalKillSwitchState() { return getGlobalKillSwitchStateFor('engage_enabled'); }

// ---- engage_ai_generation (Inc-7) — same shape, its own flag key/lever ----
/** §6 of the source spec: "engage_ai_generation ON عند Engage مع fallback" --
 * defaults to whatever the partner's plan contract says (see
 * migrations/012_engage_inc7.js), with the exact same 4-tier precedence
 * and its own independent Global kill switch -- ALNADL can disable AI
 * generation platform-wide (e.g. during a provider incident) without
 * touching engage_enabled itself, so static Engage content keeps serving
 * normally while only the AI path is paused. */
function resolveAIGenerationEnabled(contractEnabled, partnerId, propertyId, zoneId) {
  return resolveFlag('engage_ai_generation', contractEnabled, partnerId, propertyId, zoneId);
}
function setAIGenerationGlobalKillSwitch(enabled, setBy) { return setGlobalKillSwitchFor('engage_ai_generation', enabled, setBy); }
function setAIGenerationOverride(scopeType, scopeId, enabled, setBy) { return setOverrideFor('engage_ai_generation', scopeType, scopeId, enabled, setBy); }
function getAIGenerationGlobalKillSwitchState() { return getGlobalKillSwitchStateFor('engage_ai_generation'); }

module.exports = {
  resolveEngageEnabled, setGlobalKillSwitch, setEngageEnabledOverride, getGlobalKillSwitchState,
  resolveAIGenerationEnabled, setAIGenerationGlobalKillSwitch, setAIGenerationOverride, getAIGenerationGlobalKillSwitchState,
};
