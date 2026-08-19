// migrations/018_payment_policy.js
//
// P1-04 — سياسة التحصيل. مفهوم جديد كليًا: لم يكن في النظام أي أثر له.
//
// المشكلة التي يحلّها: النظام كان يفترض أن كل طلب يُحصَّل من الضيف. عملاء
// حقيقيون يريدون النادل لإدارة التشغيل فقط -- فندق يخدم نزلاءه، شركة تُطعم
// موظفيها -- والتحصيل يقع خارج رحلة الضيف تمامًا. إجبارهم على بوابة دفع أو
// محفظة كان سيعني منتجًا لا يناسبهم.
//
// جدول واحد عام بعمودي نطاق، لا ثلاثة جداول: نفس منطق branding_overrides،
// والسبب نفسه -- جداول متوازية تتباعد، وأول تباعد بينها خلل صامت في الوراثة.
//
// NULL في policy تعني "ورِث من الأعلى" -- وهو ما يجعل الوراثة حقلًا بحقل.
'use strict';

const id = '018_payment_policy';

const POLICIES = ['ONLINE', 'POS_ON_DELIVERY', 'CORPORATE_WALLET', 'NO_GUEST_PAYMENT', 'MIXED'];

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_policy_overrides (
      id TEXT PRIMARY KEY,
      -- 'partner' | 'property' | 'outlet'
      -- الشريك مشمول هنا (بخلاف العلامة) لأن السياسة ليست نموذجًا تجاريًا
      -- يملكه النادل، بل إعداد تشغيلي يخصّ العميل نفسه.
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      policy TEXT,
      -- MIXED فقط: قائمة الوسائل المصرّح بها. تُفرض على الخادم، فلا تستطيع
      -- الواجهة إرسال وسيلة خارجها مهما بدت متاحة في الشاشة.
      allowed_methods_json TEXT,
      updated_at INTEGER NOT NULL,
      updated_by TEXT
    );
  `);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_policy_scope
           ON payment_policy_overrides (scope_type, scope_id)`);

  // أثر السياسة على الطلب. عمودان لا واحد:
  //   payment_method -- بأي وسيلة (أو NO_GUEST_PAYMENT حين لا تحصيل)
  //   collection_status -- هل التحصيل مطلوب أصلًا
  // دمجهما كان سيجبرنا على تسجيل NOT_REQUIRED كأنها Paid، وهو تزوير محاسبي:
  // الطلب له قيمة حقيقية تدخل التقارير والتسويات، لكنها لم تُحصَّل من الضيف.
  const cols = db.prepare(`PRAGMA table_info(orders)`).all().map(c => c.name);
  if (!cols.includes('payment_method')) {
    db.exec(`ALTER TABLE orders ADD COLUMN payment_method TEXT`);
  }
  if (!cols.includes('collection_status')) {
    db.exec(`ALTER TABLE orders ADD COLUMN collection_status TEXT`);
  }

  // الطلبات القائمة: كلها سبقت هذا المفهوم وكانت تُحصَّل أونلاين فعلًا.
  // ترجمة أمينة لحالة قائمة، لا تخمين.
  db.prepare(`UPDATE orders SET collection_status = CASE
                WHEN status IN ('Delivered','Ready','Out for Delivery','Preparing','Accepted','Paid') THEN 'COLLECTED'
                WHEN status IN ('Refunded') THEN 'REFUNDED'
                ELSE 'PENDING' END
              WHERE collection_status IS NULL`).run();
  db.prepare(`UPDATE orders SET payment_method = 'ONLINE' WHERE payment_method IS NULL`).run();
}

module.exports = { id, up, POLICIES };
