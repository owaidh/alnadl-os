// tests/golive-onboarding.js — Go-Live P0-2.
//
// THE CLAIM UNDER TEST: a SuperAdmin can take a genuinely EMPTY production
// database all the way to a real, paid guest order using ONLY the admin
// API -- no direct database access, no manual SQL, no seed script.
//
// This runs against a production-mode server with its own empty database,
// so it proves the real bootstrap path rather than leaning on dev seed data.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { assert, assertEqual, summary, resetCounts } = require('./helpers.js');

const PORT = 8899;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(__dirname, '..', 'test-onboarding.sqlite');

let proc = null;
async function startProductionServer() {
  for (const f of [DB_PATH, DB_PATH + '-shm', DB_PATH + '-wal']) { try { fs.unlinkSync(f); } catch (e) {} }
  proc = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      SQLITE_PATH: DB_PATH,
      SESSION_SECRET: 'onboarding-test-secret-of-sufficient-length-32plus',
      ADMIN_BOOTSTRAP_USERNAME: 'founder',
      ADMIN_BOOTSTRAP_PASSWORD: 'founder-strong-pass-1',
      RATE_LIMIT_DISABLED: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    try { const res = await fetch(`${BASE}/health`); if (res.ok) return; } catch (e) {}
  }
  throw new Error('production server did not start');
}
function stopProductionServer() { if (proc) { try { proc.kill('SIGKILL'); } catch (e) {} proc = null; } }

async function call(method, p, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

async function run() {
  resetCounts();
  console.log('=== Go-Live Suite: Production Onboarding from an Empty Database ===');

  try {
    await startProductionServer();

    // --- the database really is empty of commercial data ---
    const anonPlans = await call('GET', '/api/plans');
    assert(Array.isArray(anonPlans.data) && anonPlans.data.length === 0,
      'P0-2 a fresh production database starts with ZERO plans — this is the gap that previously made the first paying customer impossible without manual SQL');

    // --- 1. the bootstrapped SuperAdmin can log in ---
    const login = await call('POST', '/api/auth/login', { username: 'founder', password: 'founder-strong-pass-1' });
    assertEqual(login.status, 200, 'P0-2 the bootstrapped SuperAdmin can log in to a fresh production instance');
    const T = login.data.token;
    assertEqual(login.data.user.role, 'SuperAdmin', 'P0-2 the bootstrap account holds SuperAdmin');

    // --- 2. create a commercial plan with entitlements, via the API ---
    const created = await call('POST', '/api/admin/plans', {
      code: 'LAUNCH', name_ar: 'باقة الإطلاق', name_en: 'Launch Plan',
      monthlyFee: 3000, techFeeRate: 0.022,
      entitlements: { qrOrdering: true, digitalPayment: true, partnerDashboard: true,
                      loyalty_enabled: true, loyalty_redeem_enabled: false, engage_enabled: true },
    }, T);
    assertEqual(created.status, 201, 'P0-2 a SuperAdmin can CREATE a plan through the admin API — no database access required');
    assertEqual(created.data.entitlements.loyalty_enabled, true, 'P0-2 entitlements are stored as real booleans');
    assertEqual(created.data.entitlements.loyalty_redeem_enabled, false,
      'P0-2 a false entitlement stays false — redemption can be withheld while accrual is granted');

    // validation actually holds
    const dup = await call('POST', '/api/admin/plans', { code: 'LAUNCH', monthlyFee: 1, techFeeRate: 0.01 }, T);
    assertEqual(dup.status, 409, 'P0-2 duplicate plan codes are refused');
    const badRate = await call('POST', '/api/admin/plans', { code: 'BADRATE', monthlyFee: 100, techFeeRate: 5 }, T);
    assertEqual(badRate.status, 400, 'P0-2 an out-of-range tech fee rate is refused');
    const badCode = await call('POST', '/api/admin/plans', { code: 'a b!', monthlyFee: 0, techFeeRate: 0 }, T);
    assertEqual(badCode.status, 400, 'P0-2 a malformed plan code is refused');

    // entitlements MERGE on update rather than being wiped
    const patched = await call('PATCH', `/api/admin/plans/${created.data.id}`, {
      entitlements: { loyalty_redeem_enabled: true },
    }, T);
    assertEqual(patched.status, 200, 'P0-2 a plan can be updated');
    assertEqual(patched.data.entitlements.loyalty_redeem_enabled, true, 'P0-2 the changed entitlement is applied');
    assertEqual(patched.data.entitlements.qrOrdering, true,
      'P0-2 a partial update MERGES — untouched entitlements survive, so a live subscriber cannot silently lose capabilities');

    // --- 3. onboard partner + property + subscription in one call ---
    const onboard = await call('POST', '/api/admin/onboard', {
      partnerNameAr: 'فندق الإطلاق', partnerNameEn: 'Launch Hotel', planCode: 'LAUNCH',
      propertyNameAr: 'الفرع الرئيسي', propertyNameEn: 'Main Branch',
    }, T);
    assertEqual(onboard.status, 201, 'P0-2 partner + property + active subscription are created through the API');
    const partnerId = onboard.data.partnerId, propertyId = onboard.data.propertyId;
    assert(!!partnerId && !!propertyId, 'P0-2 the onboarding returns real ids');

    // --- 4. zone -> point -> QR ---
    const zone = await call('POST', '/api/admin/zones', { propertyId, name_ar: 'اللوبي', name_en: 'Lobby', type: 'Business' }, T);
    assertEqual(zone.status, 201, 'P0-2 a zone is created through the API');
    const point = await call('POST', '/api/admin/points', { zoneId: zone.data.id, label: 'Table 1', type: 'Table' }, T);
    assertEqual(point.status, 201, 'P0-2 a point is created through the API');
    assert(!!point.data.token, 'P0-2 the point comes with a real QR token — no manual token minting');

    // --- 5. catalog ---
    const cat = await call('POST', '/api/admin/categories', { propertyId, name_ar: 'قهوة', name_en: 'Coffee' }, T);
    assertEqual(cat.status, 201, 'P0-2 a catalog category is created through the API');
    const prod = await call('POST', '/api/admin/products', {
      categoryId: cat.data.id, name_ar: 'أمريكانو', name_en: 'Americano', basePrice: 18,
    }, T);
    assertEqual(prod.status, 201, 'P0-2 a product is created through the API');

    // --- 6. THE PROOF: a real guest journey on this brand-new tenant ---
    const qr = await call('GET', `/api/qr/${point.data.token}`);
    assertEqual(qr.status, 200, 'P0-2 a guest scanning the new QR resolves real context');
    assertEqual(qr.data.partner.name_en, 'Launch Hotel', 'P0-2 the QR resolves to the newly onboarded partner');

    const catalog = await call('GET', `/api/catalog?propertyId=${propertyId}`);
    assert(catalog.data.products.some(x => x.name_en === 'Americano'),
      'P0-2 the catalog the guest sees contains the product created moments ago through the API');

    const order = await call('POST', '/api/orders', {
      pointId: point.data.id, customerPhone: '0501234567',
      items: [{ productId: prod.data.id, qty: 2 }],
    });
    assertEqual(order.status, 201, 'P0-2 a REAL ORDER is placed on the brand-new tenant');
    const pay = await call('POST', `/api/orders/${order.data.id}/pay`, { method: 'card' });
    assertEqual(pay.data.status, 'Paid', 'P0-2 the order is paid — the full commercial path works end to end from an empty database');

    // --- 7. loyalty entitlement genuinely took effect from the created plan ---
    const opLogin = await call('POST', '/api/auth/login', { username: 'founder', password: 'founder-strong-pass-1' });
    await call('POST', `/api/orders/${order.data.id}/transition`, { to: 'Accepted' }, opLogin.data.token);
    await call('POST', `/api/orders/${order.data.id}/transition`, { to: 'Preparing' }, opLogin.data.token);
    await call('POST', `/api/orders/${order.data.id}/transition`, { to: 'Ready' }, opLogin.data.token);
    await call('POST', `/api/orders/${order.data.id}/transition`, { to: 'Out for Delivery' }, opLogin.data.token);
    const delivered = await call('POST', `/api/orders/${order.data.id}/transition`, { to: 'Delivered' }, opLogin.data.token);
    assertEqual(delivered.status, 200, 'P0-2 the order completes its lifecycle');
    assert(delivered.data.loyaltyEarned > 0,
      'P0-2 loyalty accrued because the plan CREATED THROUGH THE API granted loyalty_enabled — entitlements are live, not decorative');

    // --- 8. plan deletion is refused while subscribers exist ---
    const del = await call('DELETE', `/api/admin/plans/${created.data.id}`, null, T);
    assertEqual(del.status, 409,
      'P0-2 deleting a plan with live subscribers is refused rather than cascading a partner into a dangling subscription');

    // --- 9. production hygiene on this very instance ---
    const devTools = await fetch(`${BASE}/dev-tools.js`);
    assertEqual(devTools.status, 404, 'P0-2 the production bundle serves NO dev tooling');
    const demoPoints = await call('GET', '/api/demo/points');
    assertEqual(demoPoints.status, 404, 'P0-2 the demo endpoint does not exist in production');
    const demoLogin = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin' });
    assertEqual(demoLogin.status, 401, 'P0-2 no demo credentials exist in a production database');

    // --- 10. plans are not a public catalogue of the commercial model ---
    const plansAnon = await call('GET', '/api/admin/plans');
    assertEqual(plansAnon.status, 401, 'P0-2 plan administration requires authentication');

  } finally {
    stopProductionServer();
    for (const f of [DB_PATH, DB_PATH + '-shm', DB_PATH + '-wal']) { try { fs.unlinkSync(f); } catch (e) {} }
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
