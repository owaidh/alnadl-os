// tests/trusted-proxy.js — R4-B / PB-2.
// الادعاء: X-Forwarded-For لا تُقبل إلا من وكيل موثوق مُعلَن، ولا يمكن
// تجاوز أي حد بترويسة مُزوَّرة.
'use strict';
const { startServer, stopServer, assert, assertEqual, summary, resetCounts, BASE } = require('./helpers.js');

async function hit(path, headers = {}, body) {
  const res = await fetch(BASE() + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.status;
}

/** يستنفد الحد ثم يُرجع عدد الطلبات التي مرّت قبل أول 429. */
async function burst(path, headersFn, n, body) {
  let allowed = 0, blocked = 0;
  for (let i = 0; i < n; i++) {
    const s = await hit(path, headersFn(i), body);
    if (s === 429) blocked++; else allowed++;
  }
  return { allowed, blocked };
}

async function run() {
  resetCounts();
  // محدّد المعدل يجب أن يكون فعّالًا هنا -- هذه المجموعة تختبره تحديدًا.
  const prevDisabled = process.env.RATE_LIMIT_DISABLED;
  process.env.RATE_LIMIT_DISABLED = '0';
  await startServer();
  console.log('=== R4-B / PB-2: Trusted Proxy & Rate Limiting ===');

  const limiter = require('../lib/rate-limit.js');
  const VERIFY = '/api/loyalty/verify/start';
  const payload = { t: 'no-such-token', phone: '0500000000' };

  try {
    // ============ (1) عميل مباشر + XFF مُزوَّر ============
    delete process.env.TRUSTED_PROXY_IPS; // الافتراضي: لا ثقة
    limiter.resetAll();
    const forged = await burst(VERIFY, i => ({ 'X-Forwarded-For': `10.9.9.${i}` }), 12, payload);
    assert(forged.blocked > 0,
      '(1) **عميل مباشر بترويسة مُزوَّرة متغيّرة لا يتجاوز الحد** — هذا هو التجاوز الذي أثبته R4-A');
    assert(forged.allowed <= 6,
      `(1) والمسموح يبقى ضمن حدود الحزمة لا مفتوحًا (${forged.allowed})`);

    // ملاحظة عزل: resetAll() تعمل في عملية الاختبار، بينما المحدّد يعيش في
    // عملية الخادم -- فلا تُصفّره. لذا تُقاس المراحل بأثرها المتراكم على
    // نفس الحزمة بدل افتراض بداية نظيفة، وهو أقرب للواقع الإنتاجي أصلًا.
    const stillBlocked = await hit(VERIFY, {}, payload);
    assertEqual(stillBlocked, 429,
      '(1) والطلب بلا ترويسة يبقى محجوبًا بعد استنفاد الحد — الترويسة لم تمنح أي إعفاء');

    // ============ (2) وكيل غير موثوق + XFF ============
    process.env.TRUSTED_PROXY_IPS = '203.0.113.7'; // عنوان ليس عنواننا
    limiter.resetAll();
    const untrusted = await burst(VERIFY, i => ({ 'X-Forwarded-For': `10.8.8.${i}` }), 12, payload);
    assert(untrusted.blocked > 0,
      '(2) **وكيل غير مُدرَج لا تُقبل ترويسته** — الإدراج وحده لا يكفي، العنوان المباشر يجب أن يطابق');

    // ============ (3) وكيل موثوق ⇒ يُستخدم عنوان العميل الحقيقي ============
    // الاتصال في الاختبار قادم من localhost، فإدراجه يجعله وكيلًا موثوقًا.
    process.env.TRUSTED_PROXY_IPS = '127.0.0.1,::1';
    // حزمة مختلفة (engage_discovery: 30/دقيقة) لتفادي حزمة verification
    // المُستنفدة أعلاه -- الفصل بالحزمة لا بالتصفير.
    const ENG = (id) => `/api/orders/ORD-${id}/engage-pass?paymentRef=x`;
    let distinctAllowed = 0;
    for (let c = 0; c < 4; c++) {
      const st = await hit(ENG(1900 + c), { 'X-Forwarded-For': `198.51.100.${c}` });
      if (st !== 429) distinctAllowed++;
    }
    assertEqual(distinctAllowed, 4,
      '(3) **خلف وكيل موثوق، كل عميل يُحسب على حدة** — وإلا لتشارك كل زوار الفندق حزمة واحدة');

    // وعميل واحد خلف الوكيل الموثوق ما زال محدودًا
    const oneClient = await burst('/api/orders/ORD-1950/engage-pass?paymentRef=x',
      () => ({ 'X-Forwarded-For': '198.51.100.77' }), 45);
    assert(oneClient.blocked > 0,
      '(3) وعميل واحد خلف وكيل موثوق يُحدّ كالمعتاد — الثقة ليست إعفاءً');

    // ============ (4) سلسلة multi-hop مُزوَّرة ============
    // العميل يحشو سلسلة مزيفة، والوكيل الموثوق يُلحق عنوانه الحقيقي أخيرًا.
    // القراءة من آخر عنصر تعني أن الحشو لا يُنتج هويات جديدة.
    const spoofChain = await burst('/api/orders/ORD-1960/engage-pass?paymentRef=x',
      i => ({ 'X-Forwarded-For': `1.1.1.${i}, 2.2.2.${i}, 198.51.100.55` }), 45);
    assert(spoofChain.blocked > 0,
      '(4) **حشو سلسلة XFF لا يُنتج هويات جديدة** — يُقرأ آخر عنصر أضافه الوكيل الموثوق لا أوله');

    // ============ (5) بقية الحزم ما زالت فعّالة ============
    limiter.resetAll();
    const prod = 'p_latte';
    const orders = await burst('/api/orders', i => ({ 'X-Forwarded-For': `10.7.7.${i}` }), 20,
      { pointId: 'PT-021', items: [{ productId: prod, qty: 1 }] });
    assert(orders.blocked > 0, '(5) حزمة إنشاء الطلب ما زالت فعّالة رغم الترويسة المُزوَّرة');

    limiter.resetAll();
    const lookup = await burst('/api/loyalty/0500000000', i => ({ 'X-Forwarded-For': `10.6.6.${i}` }), 40);
    assert(lookup.blocked > 0, '(5) وحزمة بحث الولاء كذلك');

    // ============ محدّد الدخول: محصّن ببنيته ============
    limiter.resetAll();
    let loginBlocked = false;
    for (let i = 0; i < 10; i++) {
      const s = await hit('/api/auth/login', { 'X-Forwarded-For': `10.5.5.${i}` },
        { username: 'admin', password: 'definitely-wrong' });
      if (s === 429) { loginBlocked = true; break; }
    }
    assert(loginBlocked,
      '**محدّد محاولات الدخول محصّن ببنيته** — مفتاحه اسم المستخدم لا العنوان، فلا تمسّه أي ترويسة');

    // ============ سلوك الإعداد ============
    delete process.env.TRUSTED_PROXY_IPS;
    assertEqual(limiter.trustedProxies().length, 0, 'الافتراضي بلا وكلاء موثوقين إطلاقًا');
    const fakeReq = { headers: { 'x-forwarded-for': '9.9.9.9' }, socket: { remoteAddress: '10.0.0.5' } };
    assertEqual(limiter.isFromTrustedProxy(fakeReq), false, 'ولا ثقة بأي مصدر افتراضيًا');
    assertEqual(limiter.callerKey(fakeReq), '10.0.0.5',
      '**والمفتاح هو عنوان المقبس** — الوحيد غير القابل للتزوير على اتصال قائم');

    process.env.TRUSTED_PROXY_IPS = '10.0.0.5';
    assertEqual(limiter.isFromTrustedProxy(fakeReq), true, 'وإدراج العنوان المباشر يجعله موثوقًا');
    assertEqual(limiter.callerKey(fakeReq), '9.9.9.9', 'فيُقرأ العميل الحقيقي من الترويسة');

    // IPv6-mapped
    const mapped = { headers: {}, socket: { remoteAddress: '::ffff:10.0.0.5' } };
    assertEqual(limiter.isFromTrustedProxy(mapped), true,
      'و ::ffff: المُطابق يُعامَل كنفس المضيف — لا ثغرة تطبيع');

    delete process.env.TRUSTED_PROXY_IPS;
  } finally {
    stopServer();
    if (prevDisabled === undefined) delete process.env.RATE_LIMIT_DISABLED;
    else process.env.RATE_LIMIT_DISABLED = prevDisabled;
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
