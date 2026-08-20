// migrations/021_branding_media_fields.js
//
// Scope 2 — ربط وسائط الهوية بنموذج الوراثة القائم.
//
// نتيجة التدقيق المطلوب قبل كتابة هذه المهاجرة:
//
// الازدواج بين `partner_branding` و`branding_overrides` **قائم اليوم
// أصلًا**: logo_text و primary_color و welcome_text_* و show_powered_by
// موجودة في الجدولين معًا. إضافة الحقول الجديدة إلى الجدولين كانت ستضاعفه.
//
// والتوحيد الكامل (نقل حقول الهوية من partner_branding إلى النموذج العام)
// يمسّ تسعة مواضع في خمسة ملفات، ومسار الكتابة الإداري، وبيانات إنتاج
// حيّة -- إعادة هيكلة لا يبررها هذا النطاق.
//
// المسار المعتمد: **لا يُضاف حقل واحد إلى `partner_branding`.** بدلًا من
// ذلك يُسمح بـ`scope_type = 'partner'` في الجدول العام -- وهو مدعوم أصلًا
// بلا أي تغيير مخطط لأن النطاق عمودان لا جدول لكل مستوى -- ويقرأ المُحلِّل
// مستوى الشريك طبقتين: partner_branding (توافق خلفي) ثم التجاوز فوقها.
//
// النتيجة: الحقول الجديدة تسكن مكانًا واحدًا، ولا ترحيل بيانات، ولا كسر
// توافق، ويصبح `partner_branding` تدريجيًا حاملًا للنموذج التجاري وحده
// (mode والرسوم) كما وُصف في المهاجرة 017.
//
// و`scope_type = 'merchant'` يدخل بالمنطق نفسه: **قيمة بيانات لا هجرة**.
'use strict';
const id = '021_branding_media_fields';

function up(db) {
  const cols = db.prepare('PRAGMA table_info(branding_overrides)').all().map(c => c.name);
  // معرّفات أصول لا مسارات نصّية: المسار النصّي يتيح كتابة أي قيمة، بينما
  // المعرّف يجبر كل صورة على المرور بسجل brand_assets -- ومعه فحص النوع
  // والحجم والمستأجر. NULL في كل منها تعني "ورِث" كبقية الحقول.
  for (const col of ['logo_asset_id', 'banner_asset_id', 'favicon_asset_id']) {
    if (!cols.includes(col)) db.exec(`ALTER TABLE branding_overrides ADD COLUMN ${col} TEXT`);
  }
  // mode على مستوى الشريك فقط، ويبقى في partner_branding. لا يُضاف هنا:
  // إضافته كانت ستسمح لعقار أو منفذ بتغيير النموذج التجاري الذي يملكه
  // SuperAdmin وحده.
}

module.exports = { id, up };
