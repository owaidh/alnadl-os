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
  './engage-inc2.js',
  './engage-inc3.js',
  './engage-inc4.js',
  './engage-inc5.js',
  './engage-inc6.js',
  './engage-inc7.js',
  './engage-inc8.js',
  './partner-dashboard.js',
  './engage-security.js',
  './loyalty-partner-scope.js',
  './golive-ops.js',
  './golive-onboarding.js',
  './golive-p1.js',
  './golive-input-validation.js',
  './iam-lifecycle.js',
  './role-surfaces.js',
  './engage-governance.js',
  './partner-lifecycle.js',
  './loyalty-admin.js',
  './sitemanager-surfaces.js',
  './corrective-closure.js',
  './r3-gap-closure.js',
  './white-label.js',
  './brand-media.js',
  './direct-outlet-products.js',
  './context-switch-audit.js',
  './context-switch-audit.js',
  './operational-closure-b.js',
  './trusted-proxy.js',
  './production-deployment.js',
  './production-persistence.js',
  './browser-activation-journey.js',
  './browser-payment-policy.js',
  './browser-brand-identity.js',
  './qr-flow.js',
];

(async () => {
  const results = [];
  for (const suite of suites) {
    console.log(`\n${'='.repeat(60)}\nRunning ${suite}\n${'='.repeat(60)}`);
    const mod = require(suite);
    const ok = await mod.run();
    // مجموعة قد تُبلّغ عن بنود لم تُنفَّذ لغياب اعتماد بيئي. تمريرها كـPASS
    // كامل يُنتج تقريرًا آليًا يوحي بتحقق لم يحدث -- فتُسجَّل حالة ثالثة.
    const awaiting = (mod && Array.isArray(mod.awaiting)) ? mod.awaiting : [];
    results.push({ suite, ok, awaiting });
  }

  console.log(`\n${'='.repeat(60)}\nFINAL REPORT\n${'='.repeat(60)}`);
  let allPass = true;
  for (const r of results) {
    const label = !r.ok ? 'FAIL'
      : (r.awaiting && r.awaiting.length) ? 'AWAITING_ENVIRONMENT_VERIFICATION'
      : 'PASS';
    console.log(`  ${label}  ${r.suite}`);
    if (r.awaiting && r.awaiting.length) {
      for (const a of r.awaiting) console.log(`        awaiting: ${a.what}`);
    }
    if (!r.ok) allPass = false;
  }

  const awaitingSuites = results.filter(r => r.ok && r.awaiting && r.awaiting.length);
  const report = {
    timestamp: new Date().toISOString(),
    suites: results.map(r => ({
      suite: r.suite,
      status: !r.ok ? 'FAIL'
        : (r.awaiting && r.awaiting.length) ? 'AWAITING_ENVIRONMENT_VERIFICATION'
        : 'PASS',
      ...(r.awaiting && r.awaiting.length ? { awaiting: r.awaiting } : {}),
    })),
    // الانحدار الأخضر يبقى منفصلًا وصادقًا: كل ما شُغّل نجح. لكن
    // fullyVerified تُجيب سؤالًا مختلفًا -- هل تحقّق كل شيء فعلًا؟
    overall: allPass ? 'PASS' : 'FAIL',
    fullyVerified: allPass && awaitingSuites.length === 0,
    awaitingEnvironmentVerification: awaitingSuites.flatMap(r =>
      r.awaiting.map(a => ({ suite: r.suite, what: a.what, why: a.why }))),
  };
  const reportPath = path.join(__dirname, 'last-run-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nOverall: ${report.overall}`);
  if (!report.fullyVerified && report.overall === 'PASS') {
    console.log(`Fully verified: NO — ${report.awaitingEnvironmentVerification.length} item(s) awaiting environment verification`);
    for (const a of report.awaitingEnvironmentVerification) {
      console.log(`  - ${a.what}  [${a.suite}]  ${a.why}`);
    }
  } else if (report.fullyVerified) {
    console.log('Fully verified: YES');
  }
  console.log(`Report written to ${reportPath}`);

  process.exit(allPass ? 0 : 1);
})();
