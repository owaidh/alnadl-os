// lib/branding.js — Effective Branding Resolver (White Label).
//
// مصدر واحد لمنطق الوراثة. السبب نفسه الذي دعا لمُحلِّل حالة الشريك في R2:
// نثر قواعد الوراثة على الشاشات أو النقاط يعني أن أول موضع يُضاف لاحقًا
// وينسى مستوى واحدًا يُنتج هوية مختلفة في شاشة واحدة -- وهو خلل يراه
// الضيف ولا يظهر في أي اختبار وحدة.
//
// الترتيب: Outlet → Property → Partner → ALNADL default
// والوراثة **حقلًا بحقل** لا استبدال كتلة: عقار يُغيّر اللون فقط يرث شعار
// الشريك ونصوصه. استبدال الكتلة كان سيجبر كل مستوى على إعادة تعريف كل شيء.
'use strict';
const { db } = require('../db.js');

/* الهوية الافتراضية للمنصة. تُستخدم حين لا يوجد White Label أصلًا، وحين
   تكون الميزة غير مُفعّلة، وكقاع أخير للوراثة. */
const ALNADL_DEFAULT = {
  mode: 'alnadl',
  logo_url: null,
  logo_text: 'ALNADL',
  primary_color: '#5F3D79',
  secondary_color: null,
  welcome_text_ar: null,
  welcome_text_en: null,
  show_powered_by: 1,
  page_title_ar: 'ALNADL',
  page_title_en: 'ALNADL',
};

// mode و fees يخصّان مستوى الشريك وحده (نموذج تجاري يملكه SuperAdmin)،
// فلا يُورَّثان من تجاوز عقار أو منفذ ولا يُقبلان فيه.
const OVERRIDABLE_FIELDS = [
  'logo_url', 'logo_text', 'primary_color', 'secondary_color',
  'welcome_text_ar', 'welcome_text_en', 'show_powered_by',
  'page_title_ar', 'page_title_en',
];

/* ---------------------------------------------------------------------------
   التحقق من مسار الشعار — على الخادم حصرًا.
   لا توجد بنية تخزين في النظام (مُثبَت بالتدقيق)، فلا رفع في هذه المرحلة.
   والمسموح مسار داخلي فقط تحت public/. أي رابط خارجي مرفوض حتى من
   SuperAdmin: السماح به يفتح تحميلًا من مصدر لا نتحكم به داخل واجهة
   الضيف، وهو ناقل تتبّع ومحتوى مختلط في آن.
--------------------------------------------------------------------------- */
const ALLOWED_LOGO_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];

function validateLogoUrl(value) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  const v = String(value).trim();
  // يجب أن يكون مسارًا مطلقًا داخل الموقع
  if (!v.startsWith('/')) return { ok: false, reason: 'logo_url must be an internal path starting with /' };
  // '//host' هو رابط خارجي بروتوكول-نسبي، و ':' يفتح data:/javascript:
  if (v.startsWith('//') || v.includes(':')) return { ok: false, reason: 'external or scheme-bearing logo_url is not allowed' };
  if (v.includes('..')) return { ok: false, reason: 'logo_url must not contain ..' };
  if (v.includes('\\') || /[\r\n\t]/.test(v)) return { ok: false, reason: 'logo_url contains invalid characters' };
  const lower = v.toLowerCase().split('?')[0];
  if (!ALLOWED_LOGO_EXTENSIONS.some(ext => lower.endsWith(ext))) {
    return { ok: false, reason: `logo_url must end with one of ${ALLOWED_LOGO_EXTENSIONS.join(', ')}` };
  }
  return { ok: true, value: v };
}

function validateColor(value) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  const v = String(value).trim();
  // لون واحد يُشتق منه باقي الدرجات في CSS، فيجب أن يكون hex صالحًا --
  // قيمة حرة هنا تُحقن في style وتكسر التصميم أو أسوأ.
  if (!/^#[0-9a-fA-F]{6}$/.test(v)) return { ok: false, reason: 'color must be a #RRGGBB hex value' };
  return { ok: true, value: v };
}

/** يتحقق من حمولة تجاوز كاملة. يُرجع { ok, clean } أو { ok:false, reason }. */
function validateOverridePayload(body) {
  const clean = {};
  for (const f of OVERRIDABLE_FIELDS) {
    if (!(f in body)) continue;
    const raw = body[f];
    if (f === 'logo_url') {
      const r = validateLogoUrl(raw);
      if (!r.ok) return { ok: false, reason: r.reason };
      clean[f] = r.value;
    } else if (f === 'primary_color' || f === 'secondary_color') {
      const r = validateColor(raw);
      if (!r.ok) return { ok: false, reason: r.reason };
      clean[f] = r.value;
    } else if (f === 'show_powered_by') {
      clean[f] = raw === null || raw === undefined || raw === '' ? null : (raw === true || raw === 1 || raw === '1' ? 1 : 0);
    } else {
      const v = raw === null || raw === undefined ? null : String(raw).trim();
      clean[f] = v === '' ? null : v;
    }
  }
  return { ok: true, clean };
}

/* --------------------------------------------------------------------------- */

function partnerFeatures(partnerId) {
  const row = db.prepare(`
    SELECT p.features_json FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.partner_id = ? AND s.status = 'Active'`).get(partnerId);
  if (!row) return {};
  try { return JSON.parse(row.features_json || '{}'); } catch (e) { return {}; }
}

function getPartnerBranding(partnerId) {
  if (!partnerId) return null;
  return db.prepare('SELECT * FROM partner_branding WHERE partner_id = ?').get(partnerId) || null;
}

function getOverride(scopeType, scopeId) {
  if (!scopeId) return null;
  return db.prepare('SELECT * FROM branding_overrides WHERE scope_type = ? AND scope_id = ?')
    .get(scopeType, scopeId) || null;
}

/**
 * يحلّ الهوية الفعّالة.
 *
 * @param {{partnerId, propertyId?, outletId?}} ctx
 *   propertyId و outletId اختياريان: قبل اختيار المنفذ يُستدعى بلا outletId
 *   فتكون الوراثة Property → Partner → default، وبعده تُضاف طبقة المنفذ.
 *   هذا مقصود -- رمز QR يُحدّد منطقة لا منفذًا، والمنفذ يُعرف بعد اختيار
 *   الضيف، فتأخير الهوية حتى ذلك الحين كان سيُنتج وميضًا بصريًا.
 *
 * @returns {{...fields, sources: {field: 'outlet'|'property'|'partner'|'default'}}}
 */
function resolveBranding(ctx) {
  const { partnerId, propertyId, outletId } = ctx || {};
  const resolved = { ...ALNADL_DEFAULT };
  const sources = {};
  for (const k of Object.keys(ALNADL_DEFAULT)) sources[k] = 'default';

  // بوابة الميزة **داخل المُحلِّل**: بلا whiteLabel لا تُقرأ أي طبقة
  // إطلاقًا. وضعها هنا يعني أن أي مسار يستدعي المُحلِّل -- حاليًا أو
  // لاحقًا -- محكوم بها تلقائيًا، فلا يمكن تجاوزها بنقطة تنسى الفحص.
  const features = partnerFeatures(partnerId);
  if (features.whiteLabel !== true) {
    return { ...resolved, sources, whiteLabelActive: false, gatedBy: 'plan_entitlement' };
  }

  // طبقة الشريك: هي وحدها التي تحمل mode (النموذج التجاري)
  const partner = getPartnerBranding(partnerId);
  if (partner) {
    if (partner.mode) { resolved.mode = partner.mode; sources.mode = 'partner'; }
    for (const f of OVERRIDABLE_FIELDS) {
      if (partner[f] !== undefined && partner[f] !== null && partner[f] !== '') {
        resolved[f] = partner[f]; sources[f] = 'partner';
      }
    }
  }

  // العقار ثم المنفذ -- كل طبقة تُغطّي الحقول التي عرّفتها فقط.
  for (const [type, id] of [['property', propertyId], ['outlet', outletId]]) {
    if (!id) continue;
    const ov = getOverride(type, id);
    if (!ov) continue;
    for (const f of OVERRIDABLE_FIELDS) {
      if (ov[f] !== undefined && ov[f] !== null && ov[f] !== '') {
        resolved[f] = ov[f]; sources[f] = type;
      }
    }
  }

  // عنوان الصفحة: partner_branding لا يحمل عمود page_title (التجاوزات
  // وحدها تحمله)، فحين لا يُعرَّف صراحةً يرث logo_text -- وهو السلوك
  // المتوقع: من يضبط شعارًا يريد العنوان يتبعه، لا أن يبقى ALNADL.
  if (sources.page_title_ar === 'default' && sources.logo_text !== 'default') {
    resolved.page_title_ar = resolved.logo_text; sources.page_title_ar = sources.logo_text;
  }
  if (sources.page_title_en === 'default' && sources.logo_text !== 'default') {
    resolved.page_title_en = resolved.logo_text; sources.page_title_en = sources.logo_text;
  }

  // الهوية البيضاء تعمل فعليًا فقط حين يكون mode شيئًا غير alnadl.
  const whiteLabelActive = resolved.mode !== 'alnadl';
  if (!whiteLabelActive) {
    // mode ما زال alnadl: لا تُطبَّق هوية الشريك على الضيف حتى لو خُزّنت،
    // لأن التفعيل التجاري لم يحدث بعد.
    return { ...ALNADL_DEFAULT, sources: Object.fromEntries(Object.keys(ALNADL_DEFAULT).map(k => [k, 'default'])),
             whiteLabelActive: false, gatedBy: 'mode_alnadl' };
  }
  return { ...resolved, sources, whiteLabelActive: true, gatedBy: null };
}

/** هل يملك الشريك ميزة العلامة البيضاء أصلًا؟ */
function hasWhiteLabelEntitlement(partnerId) {
  return partnerFeatures(partnerId).whiteLabel === true;
}

module.exports = {
  resolveBranding, hasWhiteLabelEntitlement,
  validateOverridePayload, validateLogoUrl, validateColor,
  getOverride, ALNADL_DEFAULT, OVERRIDABLE_FIELDS, ALLOWED_LOGO_EXTENSIONS,
};
