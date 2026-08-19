#!/usr/bin/env node
// scripts/verify-qr.js
//
// Verifies that the qrcode runtime dependency is present and functional.
// Run after `npm ci` to confirm the QR subsystem is ready before deployment.
//
// Exit codes:
//   0 — all checks passed
//   1 — one or more checks failed (details printed to stderr)
'use strict';

const path = require('path');

let QRCode;
let installedVersion;

// ── 1. Module presence ────────────────────────────────────────────────────────
try {
  QRCode = require('qrcode');
  const pkgPath = require.resolve('qrcode/package.json');
  installedVersion = require(pkgPath).version;
} catch (err) {
  console.error('❌ FAIL  [qr-module-present]');
  console.error('   Cannot load qrcode:', err.message);
  console.error('   Fix: run `npm ci` (or `npm install`) from the project root.');
  process.exit(1);
}

// ── 2. Version pin ────────────────────────────────────────────────────────────
const REQUIRED_VERSION = '1.5.3';
if (installedVersion !== REQUIRED_VERSION) {
  console.error(`❌ FAIL  [qr-version-pin]`);
  console.error(`   Expected qrcode@${REQUIRED_VERSION}, found @${installedVersion}.`);
  console.error(`   Fix: ensure package-lock.json pins qrcode@${REQUIRED_VERSION} and re-run npm ci.`);
  process.exit(1);
}
console.log(`✅ PASS  [qr-module-present]   qrcode@${installedVersion} loaded`);

// ── helpers ───────────────────────────────────────────────────────────────────
const TEST_URL = 'https://alnadl-os-production.up.railway.app/g/test-token-verify';

async function run() {
  const results = [];

  // ── 3. SVG generation ───────────────────────────────────────────────────────
  try {
    const svg = await QRCode.toString(TEST_URL, { type: 'svg' });
    if (!svg || !svg.includes('<svg') || svg.length < 100) {
      throw new Error('SVG output looks invalid (too short or missing <svg> tag)');
    }
    console.log(`✅ PASS  [qr-svg-generation]   ${svg.length} bytes`);
    results.push(true);
  } catch (err) {
    console.error('❌ FAIL  [qr-svg-generation]');
    console.error('  ', err.message);
    results.push(false);
  }

  // ── 4. DataURL (PNG) generation ─────────────────────────────────────────────
  try {
    const dataUrl = await QRCode.toDataURL(TEST_URL, { type: 'image/png', width: 256 });
    if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) {
      throw new Error('DataURL output does not start with expected prefix');
    }
    const base64Part = dataUrl.split(',')[1];
    if (!base64Part || base64Part.length < 100) {
      throw new Error('DataURL base64 payload is suspiciously short');
    }
    console.log(`✅ PASS  [qr-dataurl-png]      ${base64Part.length} base64 chars`);
    results.push(true);
  } catch (err) {
    console.error('❌ FAIL  [qr-dataurl-png]');
    console.error('  ', err.message);
    results.push(false);
  }

  // ── 5. Terminal string generation (used internally for log output) ───────────
  try {
    const text = await QRCode.toString(TEST_URL, { type: 'terminal', small: true });
    if (!text || text.length < 50) {
      throw new Error('Terminal output is suspiciously short');
    }
    console.log(`✅ PASS  [qr-terminal-string]  ${text.length} chars`);
    results.push(true);
  } catch (err) {
    console.error('❌ FAIL  [qr-terminal-string]');
    console.error('  ', err.message);
    results.push(false);
  }

  // ── 6. Error-correction level L (smallest, fastest scan) ────────────────────
  try {
    const svg = await QRCode.toString(TEST_URL, { type: 'svg', errorCorrectionLevel: 'L' });
    if (!svg.includes('<svg')) throw new Error('SVG with ECL=L missing <svg> tag');
    console.log(`✅ PASS  [qr-ecl-L]            error-correction level L works`);
    results.push(true);
  } catch (err) {
    console.error('❌ FAIL  [qr-ecl-L]');
    console.error('  ', err.message);
    results.push(false);
  }

  // ── 7. Error-correction level H (highest, suits printed menus) ───────────────
  try {
    const svg = await QRCode.toString(TEST_URL, { type: 'svg', errorCorrectionLevel: 'H' });
    if (!svg.includes('<svg')) throw new Error('SVG with ECL=H missing <svg> tag');
    console.log(`✅ PASS  [qr-ecl-H]            error-correction level H works`);
    results.push(true);
  } catch (err) {
    console.error('❌ FAIL  [qr-ecl-H]');
    console.error('  ', err.message);
    results.push(false);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const passed = results.filter(Boolean).length;
  const total  = results.length;
  const allOk  = results.every(Boolean);

  console.log('');
  if (allOk) {
    console.log(`✅ verify:qr — ${passed}/${total} checks passed. QR subsystem is READY.`);
    console.log('   fullyVerified = true  (dependency present, version pinned, all output formats work)');
  } else {
    console.error(`❌ verify:qr — ${passed}/${total} checks passed. QR subsystem has FAILURES.`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error('❌ Unexpected error in verify-qr:', err);
  process.exit(1);
});
