// tests/engage-security.js — UX-5 corrective round.
//
// Two concerns, both proven against the REAL rendered DOM / real HTTP,
// not against the source:
//   1. Engage payload content must never become executable markup
//   2. An Engage capability token must not be obtainable from a
//      guessable order id alone
'use strict';
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const { startServer, stopServer, api, loginAs, assert, assertEqual, summary, resetCounts, getDataPath, BASE } = require('./helpers.js');

function openDb() {
  process.env.SQLITE_PATH = getDataPath();
  delete require.cache[require.resolve('../db.js')];
  return require('../db.js');
}

// A payload deliberately containing several distinct injection shapes --
// a script tag, an image with an inline handler, a raw event attribute,
// and quote-breaking characters. Alongside them, genuine Arabic and
// English text with real punctuation, so the same test proves escaping
// does not damage legitimate content.
const MALICIOUS_TITLE = `<script>window.__XSS_TITLE__=1;</script><b id="injected-title">x</b>`;
const MALICIOUS_BODY  = `<img src=x onerror="window.__XSS_BODY__=1"><svg onload="window.__XSS_SVG__=1"></svg>` +
                        `<div id="injected-body">y</div>` +
                        ` "quoted" 'single' & ampersand <not a tag> ` +
                        ` — مرحبًا بك في "النادل"، طلبك جاهز! 100% ` +
                        ` Café & Co. <3`;

async function run() {
  resetCounts();
  await startServer();
  console.log('=== UX-5 Security Suite: Engage escaping + pass authorization ===');
  let browser;

  try {
    const { db, uid } = openDb();
    const adminToken = await loginAs('admin');

    // Turn Engage on so the Worker genuinely mints a pass
    const plan = db.prepare(`SELECT * FROM plans WHERE code='PLATFORM'`).get();
    const feats = JSON.parse(plan.features_json); feats.engage_enabled = true;
    db.prepare('UPDATE plans SET features_json=? WHERE id=?').run(JSON.stringify(feats), plan.id);
    await api('POST', '/api/admin/subscription', { partnerId: 'pt_nova', planCode: 'PLATFORM' }, adminToken);

    // A real order, really paid
    const created = await api('POST', '/api/orders', { pointId: 'PT-021', items: [{ productId: 'p_latte', qty: 1 }] });
    const orderId = created.data.id;
    const paymentRef = created.data.paymentRef;
    await api('POST', `/api/orders/${orderId}/pay`, { method: 'card' });
    assert(!!paymentRef, 'setup: order creation returns a paymentRef to the guest');

    // Let the Engage worker create the pass
    for (let i = 0; i < 20 && !db.prepare('SELECT 1 FROM engage_pass WHERE order_id=?').get(orderId); i++) {
      await new Promise(r => setTimeout(r, 500));
    }
    assert(!!db.prepare('SELECT 1 FROM engage_pass WHERE order_id=?').get(orderId), 'setup: the Worker created an Engage pass');

    // ================================================================
    // PART 2 first (pure HTTP): pass-discovery authorization
    // ================================================================
    const good = await api('GET', `/api/orders/${orderId}/engage-pass?paymentRef=${encodeURIComponent(paymentRef)}`);
    assertEqual(good.data.eligible, true, 'AUTHZ: the legitimate guest (correct order id + its own paymentRef) CAN discover the pass');
    assert(!!good.data.accessToken, 'AUTHZ: the legitimate guest receives the capability token');

    const noRef = await api('GET', `/api/orders/${orderId}/engage-pass`);
    assertEqual(noRef.data.eligible, false, 'AUTHZ: knowing ONLY the order id is NOT sufficient — this is the enumeration flaw the corrective round closes');
    assert(!noRef.data.accessToken, 'AUTHZ: no capability token is leaked when proof of ownership is absent');

    const wrongRef = await api('GET', `/api/orders/${orderId}/engage-pass?paymentRef=pay_deadbeef00`);
    assertEqual(wrongRef.data.eligible, false, 'AUTHZ: a wrong paymentRef is refused');
    assert(!wrongRef.data.accessToken, 'AUTHZ: no token leaked on a wrong paymentRef');

    // Sequential ids are the actual attack: walk neighbours of a real id
    const idNum = parseInt(orderId.replace('ORD-', ''), 10);
    let harvested = 0;
    for (const guess of [idNum - 1, idNum + 1, idNum + 2, idNum + 7]) {
      const r = await api('GET', `/api/orders/ORD-${guess}/engage-pass`);
      if (r.data && r.data.accessToken) harvested++;
      const r2 = await api('GET', `/api/orders/ORD-${guess}/engage-pass?paymentRef=${encodeURIComponent(paymentRef)}`);
      if (r2.data && r2.data.accessToken) harvested++;
    }
    assertEqual(harvested, 0, 'AUTHZ: enumerating sequential neighbouring order ids yields ZERO capability tokens, with or without another order\'s paymentRef');

    // A second real order must not be reachable with the first one's proof
    const other = await api('POST', '/api/orders', { pointId: 'PT-021', items: [{ productId: 'p_latte', qty: 1 }] });
    await api('POST', `/api/orders/${other.data.id}/pay`, { method: 'card' });
    const crossed = await api('GET', `/api/orders/${other.data.id}/engage-pass?paymentRef=${encodeURIComponent(paymentRef)}`);
    assertEqual(crossed.data.eligible, false, 'AUTHZ: order A\'s paymentRef cannot unlock order B\'s Engage pass');

    const bogus = await api('GET', `/api/orders/ORD-DOES-NOT-EXIST/engage-pass?paymentRef=${encodeURIComponent(paymentRef)}`);
    assertEqual(bogus.data.eligible, false, 'AUTHZ: a nonexistent order id yields the same safe response');
    assertEqual(JSON.stringify(bogus.data), JSON.stringify(noRef.data),
      'AUTHZ: nonexistent-order and missing-proof responses are byte-identical — the endpoint is not an order-existence oracle and leaks no internal reason');

    // Expired pass must degrade to the same safe response
    const expOrder = await api('POST', '/api/orders', { pointId: 'PT-021', items: [{ productId: 'p_latte', qty: 1 }] });
    await api('POST', `/api/orders/${expOrder.data.id}/pay`, { method: 'card' });
    for (let i = 0; i < 20 && !db.prepare('SELECT 1 FROM engage_pass WHERE order_id=?').get(expOrder.data.id); i++) {
      await new Promise(r => setTimeout(r, 500));
    }
    db.prepare('UPDATE engage_pass SET expires_at = ? WHERE order_id = ?').run(Date.now() - 1000, expOrder.data.id);
    const expired = await api('GET', `/api/orders/${expOrder.data.id}/engage-pass?paymentRef=${encodeURIComponent(expOrder.data.paymentRef)}`);
    assertEqual(expired.data.eligible, false, 'AUTHZ: an EXPIRED pass returns the safe response even with fully correct proof');
    assert(!expired.data.accessToken, 'AUTHZ: no token leaked for an expired pass');

    db.prepare('UPDATE engage_pass SET expires_at = ?, status = ? WHERE order_id = ?').run(Date.now() + 3600000, 'revoked', expOrder.data.id);
    const revoked = await api('GET', `/api/orders/${expOrder.data.id}/engage-pass?paymentRef=${encodeURIComponent(expOrder.data.paymentRef)}`);
    assertEqual(revoked.data.eligible, false, 'AUTHZ: a REVOKED pass returns the safe response even with fully correct proof — revocation genuinely takes effect');
    assert(!revoked.data.accessToken, 'AUTHZ: no token leaked for a revoked pass');

    // ================================================================
    // PART 1: Engage output escaping, proven in a real browser DOM
    // ================================================================
    // Force the served moment content to the malicious payload by
    // rewriting the promoted static mechanic this session will draw from.
    const sess = db.prepare('SELECT personality FROM engage_session WHERE pass_id = (SELECT id FROM engage_pass WHERE order_id = ?)').get(orderId);
    const personality = (sess && sess.personality) || 'PLAY';
    const mv = db.prepare(`SELECT mv.id, mv.schema_json FROM mechanic_version mv JOIN mechanic m ON m.id = mv.mechanic_id
                           WHERE m.category='static_fallback' AND mv.lifecycle_state='promoted'
                           AND json_extract(mv.schema_json,'$.personality') = ?`).get(personality);
    assert(!!mv, `setup: found the promoted static mechanic for ${personality}`);
    const schema = JSON.parse(mv.schema_json);
    schema.pool = [{ title_ar: MALICIOUS_TITLE, title_en: MALICIOUS_TITLE, body_ar: MALICIOUS_BODY, body_en: MALICIOUS_BODY }];
    db.prepare('UPDATE mechanic_version SET schema_json = ? WHERE id = ?').run(JSON.stringify(schema), mv.id);

    const qrToken = db.prepare('SELECT token FROM qr_tokens WHERE point_id=? AND active=1').get('PT-021').token;

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    await page.goto(`${BASE()}/?t=${qrToken}`);
    await page.waitForTimeout(600);
    await page.evaluate(([oid, pref]) => {
      S.currentOrder = { id: oid, status: 'Paid', paymentRef: pref };
      App.goScreen('tracking');
    }, [orderId, paymentRef]);
    await page.waitForTimeout(1200);

    assert(await page.locator('.engage-invite').count() > 0, 'setup: the Engage invitation appears for an eligible guest');
    await page.click('.engage-invite button');
    await page.waitForTimeout(1800);

    assert(await page.locator('.engage-body').count() > 0, 'setup: an Engage moment rendered with the injected payload');

    // --- the actual security assertions, against the live DOM ---
    const xssFired = await page.evaluate(() => ({
      title: !!window.__XSS_TITLE__, body: !!window.__XSS_BODY__, svg: !!window.__XSS_SVG__,
    }));
    assertEqual(xssFired.title, false, 'XSS: the injected <script> in title did NOT execute');
    assertEqual(xssFired.body, false, 'XSS: the injected <img onerror> in body did NOT execute');
    assertEqual(xssFired.svg, false, 'XSS: the injected <svg onload> in body did NOT execute');

    assertEqual(await page.locator('#injected-title').count(), 0, 'XSS: no DOM element was created from the title payload');
    assertEqual(await page.locator('#injected-body').count(), 0, 'XSS: no DOM element was created from the body payload');
    assertEqual(await page.locator('.engage-body img, .engage-body svg, .engage-body script, .engage-body b').count(), 0,
      'XSS: the payload produced NO child elements inside the rendered body — it is inert text, not markup');

    // Proven as TEXT: the browser reports the literal characters, and the
    // element has no element children (only a text node).
    const bodyText = await page.locator('.engage-body').innerText();
    const childElements = await page.locator('.engage-body').evaluate(el => el.children.length);
    assertEqual(childElements, 0, 'XSS: the body element has zero child ELEMENTS — the payload never became markup');
    assert(bodyText.includes('<img src=x onerror='), 'XSS: the raw markup is displayed literally as visible text, which is the correct safe outcome');

    // --- and that legitimate content survived encoding intact ---
    assert(bodyText.includes('مرحبًا بك في "النادل"، طلبك جاهز!'), 'ESCAPING FIDELITY: Arabic text with quotes, comma and exclamation renders correctly');
    assert(bodyText.includes('Café & Co.'), 'ESCAPING FIDELITY: an ampersand is displayed as "&", not double-encoded to "&amp;"');
    assert(bodyText.includes('100%') && bodyText.includes("'single'"), 'ESCAPING FIDELITY: percent signs and single quotes survive intact');

    // --- no capability token anywhere in the DOM after the fix ---
    const html = await page.content();
    for (const term of ['sessionToken', 'accessToken', 'access_token', 'paymentRef', 'payment_ref']) {
      assert(!html.includes(term), `TOKEN HYGIENE: "${term}" never appears in the rendered DOM`);
    }
    const realToken = good.data.accessToken;
    assert(!html.includes(realToken), 'TOKEN HYGIENE: the actual capability token value never appears in the DOM');
    assert(!html.includes(paymentRef), 'TOKEN HYGIENE: the actual paymentRef value never appears in the DOM');

    assertEqual(pageErrors.length, 0, `no page JavaScript errors during the escaped-payload flow (${JSON.stringify(pageErrors)})`);

    await page.close();
  } finally {
    if (browser) await browser.close();
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
