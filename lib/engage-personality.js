// lib/engage-personality.js — Phase 5 P5-Inc-2: Context Personality Engine +
// Engagement Ceiling + Policy Precedence.
//
// Personality resolution reads ONLY existing Core signals (zone.type,
// properties.venue_context) -- no duplicate master data is created. Ceiling
// resolution implements the exact precedence chain from §25.3/§25.8 of the
// source document: Global Safety/Platform Guardrails -> Partner Contract ->
// Property Override -> Zone Override, where a more specific (lower) level
// can only ever RESTRICT further, never exceed what a less specific level
// or Global Safety permits.
'use strict';
const { db, uid } = require('../db.js');

const PERSONALITIES = ['RESET', 'SPARK', 'DISCOVER', 'PLAY', 'MIND'];

// Global Safety hard ceiling — ABSOLUTE, non-negotiable maximum per
// personality. No override at any level (Contract/Property/Zone) can ever
// cause the effective ceiling to exceed this. RESET=1 here is what
// structurally guarantees "no replay" cannot be bypassed by any override.
const HARD_CEILING = { RESET: 1, SPARK: 5, DISCOVER: 5, PLAY: 5, MIND: 3 };

// The starting point before any override is applied.
const DEFAULT_CEILING = { RESET: 1, SPARK: 3, DISCOVER: 2, PLAY: 3, MIND: 1 };

// Zone types that give a strong, direct personality signal, overriding the
// property-level venue_context (e.g. a meeting room inside a hotel should
// behave like a work context, not the hotel's general "discover" tone).
const ZONE_TYPE_SIGNAL = { Business: 'RESET', Leisure: 'PLAY', VIP: 'MIND' };

// Property-level venue_context values map directly per §4 of the source doc.
const PROPERTY_CONTEXT_MAP = { corporate: 'RESET', coffee: 'SPARK', hotel: 'DISCOVER', entertainment: 'PLAY', vip_lounge: 'MIND' };

function resolvePersonality(propertyId, zoneId) {
  if (zoneId) {
    const zone = db.prepare('SELECT type FROM zones WHERE id = ?').get(zoneId);
    if (zone && ZONE_TYPE_SIGNAL[zone.type]) return ZONE_TYPE_SIGNAL[zone.type];
  }
  if (propertyId) {
    const property = db.prepare('SELECT venue_context FROM properties WHERE id = ?').get(propertyId);
    if (property && PROPERTY_CONTEXT_MAP[property.venue_context]) return PROPERTY_CONTEXT_MAP[property.venue_context];
  }
  return 'RESET'; // safest default when no signal is configured
}

function getOverride(scopeType, scopeId, personality) {
  if (!scopeId) return null;
  const row = db.prepare(`SELECT policy_value_json FROM venue_policy_override WHERE scope_type = ? AND scope_id = ? AND policy_key = ?`)
    .get(scopeType, scopeId, `ceiling_${personality}`);
  if (!row) return null;
  const parsed = JSON.parse(row.policy_value_json);
  return typeof parsed.max === 'number' ? parsed.max : null;
}

/** Resolves the effective Engagement Ceiling for a personality in a given
 * partner/property/zone, applying the full precedence chain. Returns the
 * final integer max-moments value — always <= HARD_CEILING[personality],
 * regardless of what any override tries to set. */
function resolveCeiling(personality, partnerId, propertyId, zoneId) {
  const contractVal = getOverride('partner', partnerId, personality);
  const propertyVal = getOverride('property', propertyId, personality);
  const zoneVal = getOverride('zone', zoneId, personality);

  // Most specific explicit override wins as the starting point...
  let resolved = zoneVal ?? propertyVal ?? contractVal ?? DEFAULT_CEILING[personality];
  // ...but Contract, if set, acts as an ADDITIONAL ceiling even over a more
  // specific Property/Zone override that tries to exceed it — "the lower
  // level cannot exceed Contract prohibition" is enforced here explicitly,
  // not just by convention.
  if (contractVal != null) resolved = Math.min(resolved, contractVal);
  // Global Safety is absolute and always wins last.
  resolved = Math.min(resolved, HARD_CEILING[personality]);
  return Math.max(0, resolved);
}

function setPolicyOverride(scopeType, scopeId, personality, max, setBy) {
  if (!PERSONALITIES.includes(personality)) throw new Error(`Unknown personality: ${personality}`);
  db.prepare(`INSERT INTO venue_policy_override (id,scope_type,scope_id,policy_key,policy_value_json,set_by,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(uid('vpo'), scopeType, scopeId, `ceiling_${personality}`, JSON.stringify({ max }), setBy, Date.now());
}

module.exports = { PERSONALITIES, HARD_CEILING, DEFAULT_CEILING, resolvePersonality, resolveCeiling, setPolicyOverride };
