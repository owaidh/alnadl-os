// migrations/022_audit_acting_context.js
//
// Governance — ربط الإجراء بالسياق الذي وقع فيه.
//
// المشكلة: سجل التدقيق كان يقول «SuperAdmin عدّل سياسة التحصيل»، ولا يقول
// **داخل أي سياق شريك كان يعمل حين فعل ذلك**. الفاعل معروف والهدف معروف،
// لكن نيّة العمل مفقودة -- ومع مشرف يدير عشرات المستأجرين، الفرق بين
// «عمل داخل سياق الشريك أ فعدّل الشريك أ» و«كان في مستوى المنصة فعدّل
// الشريك أ» فرق جوهري عند مراجعة حادثة.
//
// عمودان فقط، وكلاهما **بيانات وصفية بحتة**:
//   - acting_partner_id: السياق الذي أعلن المشرف أنه يعمل داخله
//   - target_partner_id: المستأجر الذي مسّه الإجراء فعلًا
//
// وجودهما منفصلين مقصود: تساويهما هو الحالة الطبيعية، واختلافهما إشارة
// تستحق أن تُرى -- إجراء عابر للمستأجرين وقع أثناء العمل داخل سياق واحد.
// دمجهما في عمود واحد كان سيُخفي بالضبط ما نريد كشفه.
//
// لا يمنح هذان العمودان صلاحية ولا يغيّران دورًا ولا يدخلان أي قرار RBAC.
'use strict';
const id = '022_audit_acting_context';

function up(db) {
  const cols = db.prepare('PRAGMA table_info(audit_log)').all().map(c => c.name);
  if (!cols.includes('acting_partner_id')) {
    db.exec(`ALTER TABLE audit_log ADD COLUMN acting_partner_id TEXT`);
  }
  if (!cols.includes('target_partner_id')) {
    db.exec(`ALTER TABLE audit_log ADD COLUMN target_partner_id TEXT`);
  }
  // الاستعلام المقصود: "أرني كل ما جرى داخل سياق هذا الشريك".
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_acting ON audit_log (acting_partner_id, ts)`);
}

module.exports = { id, up };
