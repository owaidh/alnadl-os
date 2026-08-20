// migrations/019_outlet_merchant_link.js
//
// Scope 2 — ربط المنفذ بالشريك التجاري المالك/المشغّل.
//
// لماذا هذا العمود ضروري ولا بديل عنه:
// كان الرابط الوحيد الحيّ بين الشريك التجاري والمنفذ يمرّ عبر `products`
// (`merchant_id` + `outlet_id`) -- وهي علاقة **متعدد لمتعدد**: منفذ واحد قد
// يبيع أصناف ثلاث علامات، فلا يجيب استنتاجٌ منها عن سؤال «من يملك هذا
// المنفذ». استنتاج الهوية من المنتجات كان سيُنتج شعارًا يتغيّر بتغيّر
// محتوى القائمة، وهو أسوأ من غياب الهوية.
//
// و`outlets.legacy_merchant_id` ليس بديلًا: المخطط نفسه يصفه بأنه أثر
// ترحيل ("which merchants row this outlet was migrated from")، فمنفذ لم
// يُهاجَر من شيء يحمل NULL، واستعماله كعلاقة يربط بعض المنافذ ويترك
// بعضها بلا سبب مفهوم.
//
// القاعدة الحاكمة (قرار صاحب المنتج): **هوية المنفذ تأتي من
// outlets.merchant_id وحده**. تبقى المنتجات متعددة العلامات داخل المنفذ
// الواحد، ولا تُستنتج منها هوية بصرية أبدًا.
//
// nullable عمدًا: أغلب المنافذ يُشغّلها الشريك المضيف نفسه، وNULL هنا تعني
// "لا شريك تجاري مستقل" -- وهي الحالة الشائعة لا الاستثناء. قيمة افتراضية
// مفروضة كانت ستُلزمنا باختراع شريك تجاري وهمي لكل مقهى يديره الفندق.
'use strict';
const id = '019_outlet_merchant_link';

function up(db) {
  const cols = db.prepare('PRAGMA table_info(outlets)').all().map(c => c.name);
  if (!cols.includes('merchant_id')) {
    db.exec(`ALTER TABLE outlets ADD COLUMN merchant_id TEXT`);
  }
  // فهرس للاتجاه المقروء فعليًا: "أعطني منافذ هذا الشريك التجاري" -- تُستدعى
  // في شاشة الإدارة وعند حلّ الهوية.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_outlets_merchant ON outlets (merchant_id)`);

  // ترحيل محافظ: حيث يوجد أثر ترحيل موثوق **ويشير إلى شريك تجاري قائم
  // داخل نفس العقار**، نعتمده كقيمة أولية. الشرطان معًا مقصودان: أثر يشير
  // إلى صف محذوف أو إلى عقار آخر ليس علاقة ملكية بل بقية من ترحيل قديم،
  // واعتماده كان سيُنتج هوية خاطئة يصعب تفسيرها لاحقًا.
  db.exec(`
    UPDATE outlets SET merchant_id = legacy_merchant_id
    WHERE merchant_id IS NULL
      AND legacy_merchant_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM merchants m
        WHERE m.id = outlets.legacy_merchant_id
          AND m.property_id = outlets.property_id
      )
  `);
}

module.exports = { id, up };
