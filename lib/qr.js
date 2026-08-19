// lib/qr.js — Guest QR generation (P0-01).
//
// السياق: ما كان يُعرض في بطاقة النقطة **شبكة div زخرفية** مولّدة من رموز
// محارف الرمز -- لا ترميز QR إطلاقًا، فلا كاميرا تستطيع مسحه. نقطة دخول
// المنتج كلها كانت معطّلة عمليًا رغم أن الخادم يحلّ الرموز بشكل صحيح.
//
// قرارات مقصودة:
//
// 1) **التوليد على الخادم لا في المتصفح.** التوليد في المتصفح يعني شحن
//    المكتبة للعميل، وهو ما تمنعه قاعدة "لا CDN ولا تحميل خارجي". وعلى
//    الخادم مسار واحد يخدم العرض والتنزيل والطباعة معًا.
//
// 2) **مصدر واحد لرابط الضيف.** buildGuestUrl هنا هي الوحيدة التي تبنيه،
//    ويستخدمها QR وزر "فتح كضيف" معًا. مساران منفصلان يعنيان أن أحدهما
//    سينحرف يومًا، فيفتح الزر شيئًا ويقود الرمز المطبوع لشيء آخر -- وهو
//    خلل لا يُكتشف إلا بعد طباعة الرموز وتوزيعها.
//
// 3) **لا تُخزَّن صورة.** الرمز يُشتق حتميًا من الرابط، فتخزينه يُنشئ نسخة
//    ثانية قد تتقادم بصمت عن الرمز الحقيقي في qr_tokens.
'use strict';

/** يُحمَّل عند الطلب: الاعتماد الوحيد للتشغيل، ويُبلَّغ غيابه بوضوح. */
let QRCode = null;
let loadError = null;
function encoder() {
  if (QRCode) return QRCode;
  if (loadError) throw loadError;
  try {
    QRCode = require('qrcode');
    return QRCode;
  } catch (e) {
    loadError = new Error(
      'qrcode@1.5.3 is not installed. QR generation is unavailable until the ' +
      'dependency is installed in the build/deploy environment (npm install).'
    );
    loadError.status = 503;
    loadError.code = 'QR_DEPENDENCY_MISSING';
    throw loadError;
  }
}

function isAvailable() {
  try { encoder(); return true; } catch (e) { return false; }
}

/* ---------------------------------------------------------------------------
   بناء رابط الضيف -- المصدر الوحيد.

   الأمان: الأصل (origin) **لا يُقرأ من ترويسة Host** لأن العميل يتحكم بها،
   فالقراءة منها تسمح بحقن مضيف يجعل الرمز المطبوع يشير لموقع مهاجم. يُقرأ
   من PUBLIC_BASE_URL المضبوط عند النشر، وإلا يُبنى رابط نسبي لا يحمل مضيفًا
   أصلًا -- والنسبي آمن بطبيعته لأنه يُحلّ على الأصل الحالي.

   والرمز يُرمَّز بـencodeURIComponent فلا يستطيع كسر بنية الرابط.
--------------------------------------------------------------------------- */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{6,128}$/;

function publicBase() {
  const raw = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (!raw) return null;
  // https فقط في الإنتاج، ولا مسار ولا استعلام: قيمة الأصل لا أكثر.
  if (!/^https?:\/\/[^/\s?#]+\/?$/.test(raw)) return null;
  return raw.replace(/\/$/, '');
}

function buildGuestUrl(token, { absolute = false } = {}) {
  const t = String(token || '');
  if (!TOKEN_SHAPE.test(t)) {
    const e = new Error('Invalid token shape');
    e.status = 400;
    throw e;
  }
  const path = `/?t=${encodeURIComponent(t)}`;
  if (!absolute) return path;
  const base = publicBase();
  // بلا أصل مضبوط يبقى الرابط نسبيًا: أفضل من تخمين مضيف قد يكون خاطئًا
  // أو مُزوَّرًا، لأن الرمز المطبوع يعيش أشهرًا بعد لحظة توليده.
  return base ? base + path : path;
}

/** SVG -- المفضّل للعرض والطباعة: يتحجّم بلا فقد حدّة. */
async function toSvg(token, opts = {}) {
  const QR = encoder();
  return QR.toString(buildGuestUrl(token, { absolute: true }), {
    type: 'svg',
    errorCorrectionLevel: opts.ecc || 'M',
    margin: opts.margin == null ? 2 : opts.margin,
    width: Math.min(Math.max(parseInt(opts.width, 10) || 512, 128), 2048),
  });
}

/** PNG -- للتنزيل ولأي سياق لا يقبل SVG. */
async function toPngBuffer(token, opts = {}) {
  const QR = encoder();
  return QR.toBuffer(buildGuestUrl(token, { absolute: true }), {
    type: 'png',
    errorCorrectionLevel: opts.ecc || 'M',
    margin: opts.margin == null ? 2 : opts.margin,
    width: Math.min(Math.max(parseInt(opts.width, 10) || 512, 128), 2048),
  });
}

module.exports = { buildGuestUrl, toSvg, toPngBuffer, isAvailable, publicBase, TOKEN_SHAPE };
