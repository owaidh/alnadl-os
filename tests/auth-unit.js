// tests/auth-unit.js — direct (in-process) tests for lib/auth.js behavior
// that needs raw database access, not just HTTP calls (e.g. inspecting
// password_hash format before/after login). Uses its own throwaway SQLite
// file, completely separate from the subprocess-based suites in the other
// test files.
'use strict';
const fs = require('fs');
const path = require('path');
const { assert, assertEqual, summary, resetCounts } = require('./helpers.js');

async function run() {
  resetCounts();
  console.log('=== Auth Unit Suite (in-process, direct DB access) ===');

  const dataPath = path.join(__dirname, '..', `test-auth-unit-${Date.now()}.sqlite`);
  process.env.SQLITE_PATH = dataPath;
  delete require.cache[require.resolve('../db.js')];
  delete require.cache[require.resolve('../lib/auth.js')];
  const { db, hash } = require('../db.js');
  const { login } = require('../lib/auth.js');

  try {
    // Simulate a pre-Q06 legacy row (raw SHA-256, no salt) — this is exactly
    // what any user created before the PBKDF2 upgrade would look like.
    db.prepare('INSERT INTO users (id,username,password_hash,role,active,created_at) VALUES (?,?,?,?,1,?)')
      .run('u_legacy_test', 'legacyuser', hash('legacypass'), 'Operator', Date.now());

    const before = db.prepare('SELECT password_hash FROM users WHERE username=?').get('legacyuser');
    assert(!before.password_hash.startsWith('pbkdf2:'), 'seeded row is genuinely legacy SHA-256 (test setup sanity check)');

    const result = login('legacyuser', 'legacypass');
    assert(!!result, 'login succeeds against a legacy SHA-256 hash (backward compatibility)');

    const after = db.prepare('SELECT password_hash FROM users WHERE username=?').get('legacyuser');
    assert(after.password_hash.startsWith('pbkdf2:'), 'the row is transparently upgraded to PBKDF2 immediately after a successful legacy login');

    const result2 = login('legacyuser', 'legacypass');
    assert(!!result2, 'a second login with the same password still succeeds after the silent upgrade (no forced password reset)');

    const wrongPw = login('legacyuser', 'wrongpassword');
    assert(wrongPw === null, 'a wrong password is still correctly rejected post-upgrade');

  } finally {
    try { fs.unlinkSync(dataPath); } catch {}
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
