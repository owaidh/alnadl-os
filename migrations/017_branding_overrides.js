// migrations/017_branding_overrides.js
//
// White Label — تجاوزات العلامة على مستوى العقار والمنفذ.
//
// لماذا جدول عام واحد بدل جدولين:
// جدولان (property_branding, outlet_branding) يعنيان تكرار كل حقل وكل
// فحص وكل استعلام مرتين -- وأول اختلاف بينهما يصبح خللًا صامتًا في
// الوراثة. نطاق واحد بعمودي (scope_type, scope_id) يجعل الـResolver
// يقرأ من مصدر واحد، ويجعل إضافة مستوى ثالث لاحقًا تغييرًا في البيانات
// لا في المخطط.
//
// التوافق الخلفي: partner_branding **تبقى كما هي ولا تُهاجَر بياناتها**.
// الـResolver يقرأ منها لمستوى الشريك مباشرة. أي شريك مُهيّأ اليوم يستمر
// عاملًا بلا أي تدخل، وهذه المهاجرة إضافة صافية لا تعديل.
//
// خارج النطاق عمدًا: custom_domain لا يُنقل ولا يُعرض (مؤجَّل بقرار)،
// و logo_url موجود في المخطط لكن مصادره محصورة server-side بمسارات
// داخلية آمنة حتى تتوفر بنية تخزين حقيقية.
'use strict';

const id = '017_branding_overrides';

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS branding_overrides (
      id TEXT PRIMARY KEY,
      -- 'property' أو 'outlet'. لا 'partner' هنا: مستوى الشريك يبقى في
      -- partner_branding لأنه يحمل النموذج التجاري (mode/fees) الذي
      -- يملكه SuperAdmin وحده.
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      -- كل حقل يقبل NULL عمدًا: NULL تعني "ورِث من الأعلى"، وهو ما يجعل
      -- الوراثة حقلًا بحقل بدل استبدال كتلة كاملة.
      logo_url TEXT,
      logo_text TEXT,
      primary_color TEXT,
      secondary_color TEXT,
      welcome_text_ar TEXT,
      welcome_text_en TEXT,
      show_powered_by INTEGER,
      page_title_ar TEXT,
      page_title_en TEXT,
      updated_at INTEGER NOT NULL,
      updated_by TEXT
    );
  `);
  // تجاوز واحد لكل كائن. حذف الصف = عودة الوراثة، وهو المسار المعتمد
  // لإزالة التجاوز بدل تخزين "فارغ" يصعب تمييزه عن "ورِث".
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_branding_scope
           ON branding_overrides (scope_type, scope_id)`);
}

module.exports = { id, up };
