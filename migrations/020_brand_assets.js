// migrations/020_brand_assets.js
//
// Scope 2 — سجل وسائط الهوية. **Metadata فقط**.
//
// لماذا لا تُخزَّن الصور في القاعدة (لا Base64 ولا BLOB):
// SQLite يقرأ الصف كاملًا، فصورة بحجم 800KB داخل صف تُحمَّل في الذاكرة مع
// كل استعلام يمسّ ذلك الصف -- بما فيها استعلامات لا تريد الصورة أصلًا.
// وتُضخّم كل نسخة احتياطية بحجم كل الصور مجتمعة، ثم تُنقل عبر HTTP في كل
// رد يحمل الهوية. الملفات تُخزَّن عبر lib/storage.js، والقاعدة تحمل
// المفتاح فقط.
//
// حدود العزل مبنية في الصف نفسه:
// `scope_type` + `scope_id` يحدّدان مالك الأصل، و`partner_id` مكرَّر عمدًا
// **رغم إمكانية اشتقاقه**: كل فحص صلاحية يحتاجه، واشتقاقه في كل مرة يعني
// انضمامين (outlet→property→partner) داخل مسار يُستدعى على كل طلب صورة --
// وأي نقطة تنسى الانضمام تفتح قراءة عابرة للمستأجرين. تخزينه يجعل الفحص
// مقارنةً واحدة لا يمكن نسيانها.
//
// `storage_key` مفتاح مبهم يولّده الخادم (UUID)، لا اسم الملف المرفوع:
// اسم المستخدم قد يحمل `..` أو محارف مسار أو امتدادًا كاذبًا. الاسم الأصلي
// يُحفظ للعرض فقط ولا يدخل أي مسار على القرص إطلاقًا.
'use strict';
const id = '020_brand_assets';

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS brand_assets (
      id TEXT PRIMARY KEY,
      -- 'partner' | 'property' | 'outlet' | 'merchant'
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      -- المستأجر المالك. مخزَّن لا مشتقّ -- انظر أعلاه.
      partner_id TEXT NOT NULL,
      -- 'logo' | 'banner' | 'favicon'
      asset_type TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      -- بصمة المحتوى: تكشف تلف الملف، وتسمح بكشف الرفع المكرّر لاحقًا.
      checksum TEXT,
      -- الاسم الأصلي للعرض في شاشة الإدارة فقط. لا يُستخدم في أي مسار.
      original_name TEXT,
      created_at INTEGER NOT NULL,
      created_by TEXT
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_brand_assets_scope
           ON brand_assets (scope_type, scope_id, asset_type)`);
  // كل فحص صلاحية يبدأ من هنا.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_brand_assets_partner
           ON brand_assets (partner_id)`);
  // المفتاح فريد: صفّان يشيران إلى ملف واحد يعني أن حذف أحدهما يكسر الآخر.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_assets_key
           ON brand_assets (storage_key)`);
}

module.exports = { id, up };
