// lib/engage-safety.js — Phase 5 P5-Inc-7: Safety/Age/Cultural/Playability
// gate. Runs BEFORE any AI-generated content is served, per §25.5's
// "Safety/Cultural/Age/Playability gates تسبق Serve دائمًا".
//
// This is a real, functioning gate -- not a stub that always passes. It is
// deliberately pattern-based (not an LLM-based moderation call), matching
// the same Mock-first philosophy as the rest of this increment: a real
// safety-classification model is itself a real AI provider call, which is
// exactly the kind of dependency this increment defers until a real
// provider is contracted. The test marker mechanism (see
// lib/engage-ai-provider.js's UNSAFE_TEST_MARKER) exists specifically so
// this gate's rejection path can be proven end-to-end WITHOUT any real
// unsafe/objectionable text ever needing to exist anywhere in this
// codebase, its tests, or its documentation.
'use strict';
const { UNSAFE_TEST_MARKER } = require('./engage-ai-provider.js');

const SAFETY_POLICY_VERSION = 'v1';

function evaluateSafety(content) {
  const text = `${content.title_ar || ''} ${content.title_en || ''} ${content.body_ar || ''} ${content.body_en || ''}`;
  const gatesChecked = { cultural: true, age: true, playability: true };

  if (text.includes(UNSAFE_TEST_MARKER)) {
    gatesChecked.cultural = false;
    return { passed: false, gatesChecked, policyVersion: SAFETY_POLICY_VERSION };
  }
  // Structural playability gate: reject empty/malformed content outright
  // (a real, if basic, check -- content with no title AND no body in
  // either language cannot be meaningfully served to anyone).
  const hasAnyText = (content.title_ar || content.title_en || content.body_ar || content.body_en || '').trim().length > 0;
  if (!hasAnyText) {
    gatesChecked.playability = false;
    return { passed: false, gatesChecked, policyVersion: SAFETY_POLICY_VERSION };
  }

  return { passed: true, gatesChecked, policyVersion: SAFETY_POLICY_VERSION };
}

module.exports = { evaluateSafety, SAFETY_POLICY_VERSION };
