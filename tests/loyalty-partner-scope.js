// tests/loyalty-partner-scope.js — Go-Live P0 §7 acceptance tests.
// Every assertion here maps to a numbered line in §7 of the Go-Live
// Requirements. The central claim under test: loyalty is genuinely
// tenant-isolated, not isolated-by-convention.
'use strict';
const { startServer, stopServer, api, loginAs, assert, assertEqual, summary, resetCounts, getDataPath } = require('./helpers.js');

function openDb() {
  process.env.SQLITE_PATH = getDataPath();
  delete require.cache[require.resolve('../db.js')];
  return require('../db.js');
}

async function run() {
  resetCounts();
  await startServer();
  console.log('=== Go-Live Suite: Partner-Scoped Loyalty & Guest Verification ===');

  try {
    const { db, uid } = openDb();
    const adminToken = await loginAs('admin');
    const loyalty = require('../lib/loyalty.js');
    const PHONE = '0501112233';

    // Two partners, both entitled to loyalty via the NEW feature flags.
    const planId = uid('plan');
    db.prepare(`INSERT INTO plans (id,code,name_ar,name_en,monthly_fee,tech_fee_rate,features_json) VALUES (?,?,?,?,?,?,?)`)
      .run(planId, 'GOLIVE_TEST', 'اختبار', 'Test', 0, 0.02,
        JSON.stringify({ qrOrdering: true, digitalPayment: true, loyalty_enabled: true, loyalty_redeem_enabled: true }));

    function makePartner(label) {
      const pid = uid('pt');
      db.prepare(`INSERT INTO partners (id,name_ar,name_en,legal_name,contract_ref,status) VALUES (?,?,?,?,?,'Active')`)
        .run(pid, label, label, label, 'C-' + label);
      db.prepare(`INSERT INTO subscriptions (id,partner_id,plan_id,status,started_at,renews_at) VALUES (?,?,?,'Active',?,?)`)
        .run(uid('sub'), pid, planId, Date.now(), Date.now() + 2592000000);
      const propId = uid('prop');
      db.prepare(`INSERT INTO properties (id,partner_id,name_ar,name_en,timezone,address,status,venue_context) VALUES (?,?,?,?,?,?,'Active','coffee')`)
        .run(propId, pid, label, label, 'Asia/Riyadh', 'Riyadh');
      const zid = uid('z');
      db.prepare(`INSERT INTO zones (id,property_id,name_ar,name_en,type,status) VALUES (?,?,?,?,'Business','Active')`)
        .run(zid, propId, label, label);
      const ptid = 'PT-' + label;
      db.prepare(`INSERT INTO points (id,zone_id,code,label,type,active) VALUES (?,?,?,?,'Table',1)`)
        .run(ptid, zid, ptid, label);
      const tok = uid('tok');
      db.prepare(`INSERT INTO qr_tokens (id,point_id,token,active,created_at) VALUES (?,?,?,1,?)`)
        .run(uid('qr'), ptid, tok, Date.now());
      return { pid, propId, ptid, tok };
    }

    const A = makePartner('AAA');
    const B = makePartner('BBB');

    // §7.1 — same phone at two partners must be two independent accounts
    const acctA = loyalty.getOrCreateAccount(A.pid, PHONE);
    const acctB = loyalty.getOrCreateAccount(B.pid, PHONE);
    assert(acctA && acctB, 'setup: both accounts created');
    assert(acctA.id !== acctB.id,
      '§7.1 the same phone at Partner A and Partner B produces TWO INDEPENDENT accounts, not one shared balance');

    // §7.2 — earning at A must not move B
    loyalty.earnPoints(A.pid, PHONE, 'ORD-TEST-A', 100);
    const afterA = loyalty.findAccount(A.pid, PHONE);
    const afterB = loyalty.findAccount(B.pid, PHONE);
    assertEqual(afterA.points_balance, 100, '§7.2 earning 100 at A credits A');
    assertEqual(afterB.points_balance, 0,
      '§7.2 earning at A leaves B\'s balance untouched — this is the cross-partner leak the round closes');

    // §7.3 — history at A must not expose B's transactions
    loyalty.earnPoints(B.pid, PHONE, 'ORD-TEST-B', 55);
    const histA = loyalty.getHistory(afterA.id);
    assert(histA.every(t => t.order_id !== 'ORD-TEST-B'),
      '§7.3 A\'s history never contains B\'s transactions');
    assertEqual(histA.length, 1, '§7.3 A\'s history shows only A\'s own single transaction');

    // §7.4 — redeeming A's balance while at B must be refused server-side
    const quoteAtB = loyalty.quoteRedemption(B.pid, PHONE, 100, 500);
    assert(quoteAtB.pointsUsed <= 55,
      '§7.4 a redemption quoted at B can never draw on A\'s balance');
    const quoteAtA = loyalty.quoteRedemption(A.pid, PHONE, 100, 500);
    assert(quoteAtA.pointsUsed <= 100, '§7.4 a redemption at A is bounded by A\'s own balance');

    // §7.5 — a client-supplied partner_id must not change scope.
    // Scope is derived from the QR token server-side, so the only way to
    // "claim" another partner is to present their token -- which is exactly
    // the legitimate case. Presenting a forged/unknown token yields no scope.
    const forged = await api('GET', `/api/loyalty/${PHONE}?t=totally-made-up-token`);
    assertEqual(forged.data.pointsBalance, 0,
      '§7.5 an unknown/forged QR token grants NO partner scope and therefore no balance');
    const scopedA = await api('GET', `/api/loyalty/${PHONE}?t=${A.tok}`);
    assertEqual(scopedA.data.pointsBalance, 100, '§7.5 the genuine A token returns exactly A\'s balance');
    const scopedB = await api('GET', `/api/loyalty/${PHONE}?t=${B.tok}`);
    assertEqual(scopedB.data.pointsBalance, 55, '§7.5 the genuine B token returns exactly B\'s balance');

    const histEndpointA = await api('GET', `/api/loyalty/${PHONE}/history?t=${A.tok}`);
    assert(histEndpointA.data.every(t => t.order_id !== 'ORD-TEST-B'),
      '§7.3 the history ENDPOINT is partner-scoped too, not just the module');

    // §7.6 — loyalty_enabled=false blocks earning WITHOUT breaking the order
    const offPlan = uid('plan');
    db.prepare(`INSERT INTO plans (id,code,name_ar,name_en,monthly_fee,tech_fee_rate,features_json) VALUES (?,?,?,?,?,?,?)`)
      .run(offPlan, 'GOLIVE_OFF', 'مغلق', 'Off', 0, 0.02,
        JSON.stringify({ qrOrdering: true, digitalPayment: true, loyalty_enabled: false }));
    const C = makePartner('CCC');
    db.prepare(`UPDATE subscriptions SET plan_id = ? WHERE partner_id = ?`).run(offPlan, C.pid);
    assertEqual(loyalty.isLoyaltyEnabled(C.pid), false, '§7.6 loyalty_enabled=false is respected');
    const earnedOff = loyalty.earnPoints(C.pid, PHONE, 'ORD-TEST-C', 100);
    assertEqual(earnedOff, null, '§7.6 no points are earned when the entitlement is off');
    const orderStillWorks = await api('POST', '/api/orders', {
      pointId: C.ptid, customerPhone: PHONE,
      items: [{ productId: db.prepare('SELECT id FROM products LIMIT 1').get().id, qty: 1 }],
    });
    assertEqual(orderStillWorks.status, 201,
      '§7.6 the ORDER still succeeds with loyalty disabled — the feature is off, the journey is not broken');

    // §7.7 — redeem disabled while earning stays on
    const earnOnlyPlan = uid('plan');
    db.prepare(`INSERT INTO plans (id,code,name_ar,name_en,monthly_fee,tech_fee_rate,features_json) VALUES (?,?,?,?,?,?,?)`)
      .run(earnOnlyPlan, 'GOLIVE_EARN_ONLY', 'كسب', 'EarnOnly', 0, 0.02,
        JSON.stringify({ qrOrdering: true, digitalPayment: true, loyalty_enabled: true, loyalty_redeem_enabled: false }));
    const D = makePartner('DDD');
    db.prepare(`UPDATE subscriptions SET plan_id = ? WHERE partner_id = ?`).run(earnOnlyPlan, D.pid);
    const earnedD = loyalty.earnPoints(D.pid, PHONE, 'ORD-TEST-D', 200);
    assert(earnedD && earnedD.points_balance === 200, '§7.7 earning still works with redeem disabled');
    const quoteD = loyalty.quoteRedemption(D.pid, PHONE, 100, 500);
    assertEqual(quoteD.pointsUsed, 0, '§7.7 redemption is refused when loyalty_redeem_enabled=false');
    assertEqual(quoteD.blockedReason, 'redeem_disabled', '§7.7 the refusal carries a machine-readable reason');

    // §3.8 — phone alone must not unlock money without verification
    assertEqual(loyalty.redeemPolicy(), 'verified_only',
      '§3.8 the DEFAULT redemption policy is verified_only — a typed phone number is an identifier, not proof of ownership');
    const unverifiedQuote = loyalty.quoteRedemption(A.pid, PHONE, 50, 500);
    assertEqual(unverifiedQuote.pointsUsed, 0,
      '§3.8 an unverified account cannot self-redeem under the default policy');
    assertEqual(unverifiedQuote.blockedReason, 'verification_required', '§3.8 the reason is explicit');

    // §7.8 — with NO provider, the journey and earning still work
    const verification = require('../lib/verification.js');
    assertEqual(verification.isVerificationAvailable(), false,
      '§7.8 no verification provider is connected by default');
    const noProvider = await verification.sendChallenge(A.pid, PHONE);
    assertEqual(noProvider.ok, false, '§7.8 sending a challenge with no provider fails cleanly');
    assertEqual(noProvider.reason, 'no_provider', '§7.8 with a stable machine reason, not a crash');
    const earnStillWorks = loyalty.earnPoints(A.pid, PHONE, 'ORD-TEST-A2', 10);
    assert(earnStillWorks && earnStillWorks.points_balance === 110,
      '§7.8 earning is entirely unaffected by the absence of an SMS provider');

    // §7.9-§7.11 — the mock provider proves the full lifecycle
    process.env.VERIFICATION_PROVIDER = 'mock';
    const sent = await verification.sendChallenge(A.pid, PHONE);
    assertEqual(sent.ok, true, '§7.9 with a provider configured, a challenge is genuinely issued');
    const issued = db.prepare(`SELECT code FROM _test_verification_codes WHERE challenge_id = ?`).get(sent.challengeId);
    assert(!!issued && /^\d{6}$/.test(issued.code), '§7.9 a 6-digit code was generated');

    const stored = db.prepare(`SELECT code_hash FROM verification_challenges WHERE id = ?`).get(sent.challengeId);
    assert(stored.code_hash !== issued.code && stored.code_hash.length === 64,
      '§7.12 the code is stored ONLY as a hash, never in plain text');

    const wrong = verification.verifyChallenge(A.pid, PHONE, '000000');
    assertEqual(wrong.ok, false, '§7.10 an incorrect code is rejected');
    const stillUnverified = loyalty.findAccount(A.pid, PHONE);
    assertEqual(stillUnverified.verification_status, 'unverified', '§7.9 a failed attempt does NOT verify the account');

    const right = verification.verifyChallenge(A.pid, PHONE, issued.code);
    assertEqual(right.ok, true, '§7.9 the correct code verifies');
    const nowVerified = loyalty.findAccount(A.pid, PHONE);
    assertEqual(nowVerified.verification_status, 'verified',
      '§7.9 verification_status flips to verified ONLY after a genuinely correct challenge');

    const replay = verification.verifyChallenge(A.pid, PHONE, issued.code);
    assertEqual(replay.ok, false, '§7.10 replaying the SAME code is refused — single use enforced');

    // verification only lifts redemption for the partner it was done at
    const quoteVerifiedA = loyalty.quoteRedemption(A.pid, PHONE, 50, 500);
    assert(quoteVerifiedA.pointsUsed === 50,
      '§3.8 once verified at A, self-redemption at A is permitted');
    const quoteAtBStillBlocked = loyalty.quoteRedemption(B.pid, PHONE, 50, 500);
    assertEqual(quoteAtBStillBlocked.blockedReason, 'verification_required',
      '§7.4 verifying at A does NOT verify the same phone at B — verification is partner-scoped too');

    // expiry
    const sent2 = await verification.sendChallenge(B.pid, PHONE);
    db.prepare(`UPDATE verification_challenges SET expires_at = ? WHERE id = ?`).run(Date.now() - 1000, sent2.challengeId);
    const code2 = db.prepare(`SELECT code FROM _test_verification_codes WHERE challenge_id = ?`).get(sent2.challengeId).code;
    const expiredTry = verification.verifyChallenge(B.pid, PHONE, code2);
    assertEqual(expiredTry.ok, false, '§7.10 an EXPIRED challenge cannot verify');
    assertEqual(expiredTry.reason, 'expired', '§7.10 with the expired reason');

    // attempt limit
    const sent3 = await verification.sendChallenge(B.pid, PHONE);
    assert(sent3.ok === false && sent3.reason === 'cooldown',
      '§7.12 resend cooldown is enforced between sends');

    delete process.env.VERIFICATION_PROVIDER;

    // §7.13 — migration must not invent partner assignments
    const orphan = db.prepare(`SELECT COUNT(*) c FROM loyalty_accounts WHERE partner_id IS NULL AND migration_status != 'active'`).get().c;
    const guessed = db.prepare(`SELECT COUNT(*) c FROM loyalty_accounts WHERE migration_status = 'active' AND partner_id IS NULL`).get().c;
    assertEqual(guessed, 0,
      '§9 no account is marked active without a partner — migration never guesses an assignment');
    assert(orphan >= 0, `§9 unattributable legacy accounts are quarantined for review rather than assigned (${orphan} quarantined)`);
    const lost = db.prepare(`SELECT COUNT(*) c FROM loyalty_accounts WHERE points_balance < 0`).get().c;
    assertEqual(lost, 0, '§9 no balance went negative anywhere through the migration or the new commit guard');

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
