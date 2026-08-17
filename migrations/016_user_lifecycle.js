// migrations/016_user_lifecycle.js
//
// Role & Control Completeness Corrective §3.1 — إلغاء "كلمة المرور = اسم
// المستخدم" كمسار إنشاء حساب.
//
// الوضع قبل هذه المهاجرة (مُثبَت من الكود): POST /api/admin/users كان
// ينفّذ hashPbkdf2(b.username) ويُعيد ملاحظة صريحة بأن كلمة المرور هي اسم
// المستخدم. عمليًا هذا يعني أن **كل حساب في النظام كلمة مروره معروفة
// لأي شخص يعرف اسم المستخدم** -- ثغرة إنتاج حقيقية، لا مجرد عيب تجربة.
//
// البديل: المستخدم يُنشأ بلا كلمة مرور إطلاقًا (password_hash = NULL)،
// ولا يستطيع الدخول حتى يُفعّل حسابه برمز تفعيل لمرة واحدة يُسلّمه
// المسؤول. لا مزوّد خارجي (§3.1 صراحةً) -- الرابط يُنسخ من الواجهة.
//
// خصائص أمنية مبنية هنا مرة واحدة، على نفس نمط verification_challenges:
//   * الرمز يُخزَّن مُجزَّأً فقط، ولا يُحفظ نصًا صريحًا أبدًا
//   * انتهاء صلاحية · استخدام واحد · إبطال الرموز السابقة عند التوليد
//   * حالة الحساب صريحة بدل استنتاجها من وجود كلمة مرور
'use strict';

const id = '016_user_lifecycle';

function up(db) {
  const cols = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);

  // 'pending_activation' -> أُنشئ ولم يُفعّل بعد (لا يستطيع الدخول)
  // 'active'             -> فعّل حسابه وعيّن كلمة مروره
  // 'suspended'          -> أُوقف إداريًا (يبقى السجل والتدقيق)
  if (!cols.includes('status')) {
    db.exec(`ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'`);
  }
  if (!cols.includes('activated_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN activated_at INTEGER`);
  }
  if (!cols.includes('password_set_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN password_set_at INTEGER`);
  }

  // الحسابات القائمة تبقى عاملة كما هي -- لا نُقفل أحدًا خارج النظام
  // بمهاجرة. active=1 تُترجم إلى status='active'، و active=0 إلى
  // 'suspended'. هذه ترجمة أمينة لحالة قائمة، لا تخمين.
  db.prepare(`UPDATE users SET status = CASE WHEN active = 1 THEN 'active' ELSE 'suspended' END
              WHERE status IS NULL OR status = ''`).run();

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_activation_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_by TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_activation_user ON user_activation_tokens (user_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_activation_hash ON user_activation_tokens (token_hash)`);
}

module.exports = { id, up };
