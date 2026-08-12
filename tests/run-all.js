// tests/run-all.js — runs every test file in this directory and prints a
// final report. This is the single command referenced by docs/TEST_PLAN.md
// and the Q10 requirement: `node tests/run-all.js`
'use strict';
const fs = require('fs');
const path = require('path');

const suites = [
  './api-regression.js',
  './api-phase4.js',
  './api-security.js',
  './concurrency.js',
  './financial-regression.js',
  './auth-unit.js',
  './engage-inc1.js',
];

(async () => {
  const results = [];
  for (const suite of suites) {
    console.log(`\n${'='.repeat(60)}\nRunning ${suite}\n${'='.repeat(60)}`);
    const mod = require(suite);
    const ok = await mod.run();
    results.push({ suite, ok });
  }

  console.log(`\n${'='.repeat(60)}\nFINAL REPORT\n${'='.repeat(60)}`);
  let allPass = true;
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.suite}`);
    if (!r.ok) allPass = false;
  }

  const report = {
    timestamp: new Date().toISOString(),
    suites: results.map(r => ({ suite: r.suite, status: r.ok ? 'PASS' : 'FAIL' })),
    overall: allPass ? 'PASS' : 'FAIL',
  };
  const reportPath = path.join(__dirname, 'last-run-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nOverall: ${report.overall}`);
  console.log(`Report written to ${reportPath}`);

  process.exit(allPass ? 0 : 1);
})();
