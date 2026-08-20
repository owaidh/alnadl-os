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
  // Scope 2 — معرّفات أصول الوسائط. كل واحد يُحلّ حقلًا بحقل كبقية الهوية:
  // عقار يغيّر البانر وحده يرث شعار الشريك، ومنفذ يغيّر الشعار وحده يرث
  // البانر ممّن فوقه.
  logo_asset_id: null,
  banner_asset_id: null,
  favicon_asset_id: null,
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
  'logo_asset_id', 'banner_asset_id', 'favicon_asset_id',
];

/* الحقول التي يحملها جدول partner_branding فعليًا. الجدول لم يُوسَّع في
   Scope 2 (انظر migrations/021): الحقول الجديدة تسكن الجدول العام وحده،
   فلا يزداد الازدواج القائم. القراءة منه تقتصر على ما يملكه. */
const PARTNER_TABLE_FIELDS = [
  'logo_text', 'primary_color', 'welcome_text_ar', 'welcome_text_en', 'show_powered_by',
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

/* يحوّل معرّفات الأصول إلى روابط جاهزة للاستهلاك. يُفعل هنا لا في كل شاشة:
   المستهلك (Brand Shell، حقن HTML، شاشة الإدارة) يجب أن يتلقّى قيمة يضعها
   في src مباشرة، لا معرّفًا يبني منه رابطًا بقاعدة يكرّرها كلٌّ بطريقته.
   ويُفضّل الأصل المرفوع على logo_url النصّي القديم حين يوجد الاثنان: الأصل
   مرّ بفحص نوع وحجم ومستأجر، والنص لم يمرّ إلا بفحص مسار. */
function withAssetUrls(resolved) {
  const url = (assetId) => assetId ? `/api/brand-assets/${assetId}` : null;
  return {
    ...resolved,
    logo_src: url(resolved.logo_asset_id) || resolved.logo_url || null,
    banner_src: url(resolved.banner_asset_id),
    favicon_src: url(resolved.favicon_asset_id),
  };
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
  /* الشريك التجاري يُشتقّ من `outlets.merchant_id` **حصرًا**، ولا يُقبل من
     المتصل. واستنتاجه من `products.merchant_id` ممنوع صراحةً: منفذ واحد قد
     يبيع أصناف عدة علامات، فالاستنتاج منها كان سيُنتج شعارًا يتغيّر بتغيّر
     محتوى القائمة -- وهو أسوأ من غياب الهوية. */
  let merchantId = null;
  if (outletId) {
    const row = db.prepare('SELECT merchant_id FROM outlets WHERE id = ?').get(outletId);
    merchantId = (row && row.merchant_id) || null;
  }
  const resolved = { ...ALNADL_DEFAULT };
  const sources = {};
  for (const k of Object.keys(ALNADL_DEFAULT)) sources[k] = 'default';

  // بوابة الميزة **داخل المُحلِّل**: بلا whiteLabel لا تُقرأ أي طبقة
  // إطلاقًا. وضعها هنا يعني أن أي مسار يستدعي المُحلِّل -- حاليًا أو
  // لاحقًا -- محكوم بها تلقائيًا، فلا يمكن تجاوزها بنقطة تنسى الفحص.
  const features = partnerFeatures(partnerId);
  if (features.whiteLabel !== true) {
    // نفس شكل الرد في كل المسارات: مستهلك يفحص وجود المفتاح بدل قيمته
    // كان سيتصرف تصرفين مختلفين لحالتين متطابقتين منطقيًا.
    return { ...withAssetUrls(resolved), sources, whiteLabelActive: false, gatedBy: 'plan_entitlement' };
  }

  // طبقة الشريك: هي وحدها التي تحمل mode (النموذج التجاري)
  const partner = getPartnerBranding(partnerId);
  if (partner) {
    if (partner.mode) { resolved.mode = partner.mode; sources.mode = 'partner'; }
    for (const f of PARTNER_TABLE_FIELDS) {
      if (partner[f] !== undefined && partner[f] !== null && partner[f] !== '') {
        resolved[f] = partner[f]; sources[f] = 'partner';
      }
    }
  }

  /* Scope 2 — الترتيب الكامل من الأدنى أولوية إلى الأعلى:
       partner (جدول + تجاوز) → property → merchant → outlet

     ملاحظتان تستحقان التوضيح:

     (1) تجاوز على مستوى الشريك يُقرأ **بعد** جدول partner_branding وفوقه.
         هذا ما يسمح للحقول الجديدة (الشعار المرفوع، البانر، الأيقونة،
         اللون الثانوي، عنوان الصفحة) بالسكن في الجدول العام وحده بلا
         توسيع partner_branding وبلا ترحيل بيانات.

     (2) الشريك التجاري يقع **فوق العقار ودون تجاوز المنفذ** -- بقرار
         صاحب المنتج. المعنى التشغيلي مقصود: هوية العقار لا تطمس هوية
         شريك تجاري مستقل يعمل بداخله، لأنه علامة قائمة بذاتها لا فرعٌ من
         الجهة المضيفة. ويبقى تجاوز المنفذ فوق الجميع، فحالة خاصة في منفذ
         بعينه تظل ممكنة.
         النموذج محايد قطاعيًا: الجهة المضيفة قد تكون شركة أو مجمّعًا أو
         موقع فعاليات أو جهة حكومية -- والقاعدة واحدة في كلٍّ منها. */
  const layers = [['partner', partnerId], ['property', propertyId]];
  if (merchantId) layers.push(['merchant', merchantId]);
  layers.push(['outlet', outletId]);

  for (const [type, id] of layers) {
    if (!id) continue;
    const ov = getOverride(type, id);
    if (!ov) continue;
    for (const f of OVERRIDABLE_FIELDS) {
      if (ov[f] !== undefined && ov[f] !== null && ov[f] !== '') {
        resolved[f] = ov[f];
        // المصدر يُسمّى بالمستوى الحقيقي -- شاشة الإدارة تعرضه للمشغّل،
        // و"موروثة" وحدها لا تخبره بشيء.
        sources[f] = type === 'merchant' ? 'merchant' : type;
      }
    }
  }

  /* ── حدّ الوسائط: البانر لا يُورَّث عبر حدود العلامات ──────────────
     المشكلة التي يعالجها: الوراثة حقلًا بحقل صحيحة تقنيًا، لكنها حين
     تُطبَّق على البانر تُنتج هوية بصرية مختلطة -- شعار علامة مستقلة فوق
     صورة غلاف تخصّ جهة أخرى. الضيف يرى علامتين في شاشة واحدة.

     القاعدة (قرار صاحب المنتج): متى صار الشريك التجاري مصدر الهوية
     الفعّالة للمنفذ، فالبانر يُحلّ من مساره وحده:

         Outlet Banner → Commercial Partner Banner → لا بانر

     وليس عبر العقار والشريك الرئيسي. غياب البانر أصدق من بانر علامة أخرى.

     "مصدر الهوية الفعّالة" = وجود طبقة هوية للشريك التجاري أصلًا (أي حقل
     مضبوط عليه). هذا التعريف مقصود: علامة عرّفت شعارها أو لونها أعلنت
     استقلالها البصري، ولا يُكمَّل ذلك بغلاف جهة أخرى. */
  const merchantHasBrand = merchantId && Object.values(sources).some(v => v === 'merchant');
  if (merchantHasBrand && !['outlet', 'merchant'].includes(sources.banner_asset_id)) {
    resolved.banner_asset_id = null;
    sources.banner_asset_id = 'none';
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

  /* بوابة الشريك المضيف تحكم **كل** الطبقات بما فيها الشريك التجاري.
     مقصود بقرار صاحب المنتج: العلاقة التجارية مع النادل تمرّ عبر الشريك
     الرئيسي، والشريك التجاري طبقة هوية داخل تجربته لا مسار تجاري ثانٍ.
     فإن كانت الهوية البيضاء غير مفعّلة للمضيف ⇒ ALNADL افتراضيًا دائمًا،
     **حتى لو كانت للشريك التجاري بيانات هوية مخزَّنة كاملة**. وموضع
     الفحص هنا -- بعد حلّ كل الطبقات -- هو ما يضمن ذلك بلا استثناء ممكن. */
  const whiteLabelActive = resolved.mode !== 'alnadl';
  if (!whiteLabelActive) {
    // mode ما زال alnadl: لا تُطبَّق هوية الشريك على الضيف حتى لو خُزّنت،
    // لأن التفعيل التجاري لم يحدث بعد.
    return { ...withAssetUrls(ALNADL_DEFAULT), sources: Object.fromEntries(Object.keys(ALNADL_DEFAULT).map(k => [k, 'default'])),
             whiteLabelActive: false, gatedBy: 'mode_alnadl' };
  }
  return { ...withAssetUrls(resolved), sources, whiteLabelActive: true, gatedBy: null };
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
