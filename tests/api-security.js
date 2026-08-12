// tests/api-security.js — RBAC, tenant isolation, and FK integrity (Q09, Q10, part of Q06)
'use strict';
const { startServer, stopServer, api, loginAs, assert, assertEqual, summary, resetCounts } = require('./helpers.js');

async function run() {
  resetCounts();
  await startServer();
  console.log('=== Security & Isolation Suite ===');

  try {
    // --- Unauthenticated access to protected endpoints ---
    const noAuth = await api('GET', '/api/ops/queue');
    assertEqual(noAuth.status, 401, 'unauthenticated request to a protected endpoint returns 401');

    // --- Cross-tenant write attempt ---
    const paToken = await loginAs('partneradmin'); // scoped to pt_nova
    const crossTenant = await api('POST', '/api/admin/zones', { propertyId: 'prop_alrowad_hq', name_ar: 'x', name_en: 'x', type: 'Lounge' }, paToken);
    assertEqual(crossTenant.status, 403, 'PartnerAdmin cannot write to another partner\'s property');

    // --- Same-tenant write succeeds ---
    const sameTenant = await api('POST', '/api/admin/zones', { propertyId: 'prop_nova_main', name_ar: 'اختبار', name_en: 'Test Zone', type: 'Lounge' }, paToken);
    assertEqual(sameTenant.status, 201, 'PartnerAdmin can write to their own tenant');

    // --- Privilege escalation attempt: PartnerAdmin creating a SuperAdmin user ---
    const escalation = await api('POST', '/api/admin/users', { username: 'hacker', role: 'SuperAdmin' }, paToken);
    assertEqual(escalation.status, 403, 'PartnerAdmin cannot create a SuperAdmin user');

    // --- White Label: only SuperAdmin can write ---
    const adminToken = await loginAs('admin');
    const wlByPartnerAdmin = await api('POST', '/api/admin/branding', { partnerId: 'pt_nova', mode: 'full_white_label' }, paToken);
    assert([401, 403].includes(wlByPartnerAdmin.status), 'PartnerAdmin cannot modify White Label branding (Admin-only per §19)');
    const wlBySuperAdmin = await api('GET', '/api/admin/branding?partnerId=pt_nova', null, adminToken);
    assertEqual(wlBySuperAdmin.status, 200, 'SuperAdmin can read branding');

    // --- Invalid/expired token ---
    const badToken = await api('GET', '/api/ops/queue', null, 'not-a-real-token');
    assertEqual(badToken.status, 401, 'malformed token is rejected with 401');

    // --- Invalid QR token (failure handling) ---
    const badQr = await api('GET', '/api/qr/does-not-exist-token');
    assertEqual(badQr.status, 404, 'invalid QR token returns 404, not a crash');

    // --- Ordering against an inactive/unavailable point ---
    await api('PATCH', '/api/admin/points/PT-014', { active: false }, adminToken);
    const orderOnInactive = await api('POST', '/api/orders', { pointId: 'PT-014', items: [{ productId: 'p_latte', qty: 1 }] });
    assertEqual(orderOnInactive.status, 409, 'ordering against a deactivated point is rejected, not silently accepted');
    await api('PATCH', '/api/admin/points/PT-014', { active: true }, adminToken); // restore for other tests

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
