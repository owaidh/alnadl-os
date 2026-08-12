> **Version:** v1.9.0 · **Status:** FINAL · **Last Updated:** 2026-08-12 · **Release Tag:** v1.9.0-partner-dashboard

# Alnadl Hospitality OS — Change Log / Release Notes (§26.1)

كل إصدار أدناه له Git tag مطابق — `git log --oneline`/`git tag -l` في المستودع يُظهر السجل الكامل بالتفصيل الحرفي لكل تغيير وملف تأثّر.

## v1.9.0 — Partner Dashboard Extensions (2026-08-12)
- `GET /api/partner/overview`: حقلا `crossOutletBasketRate` و`outletPerformance` جديدان (إضافيان، لا يكسران أي مستهلك قائم)
- واجهة أمامية: جدول أداء لكل منفذ + مؤشر السلال متعددة المنافذ في لوحة الشريك

## v1.8.1 — Documentation Sync
- تحديث README/API_DOCUMENTATION/DATABASE_SCHEMA/HANDOVER لتعكس Phase 4 فعليًا (كانت متجمّدة عند v1.3.0)
- إصلاح خلل قص جدول Traceability Matrix في PDF (تحويل لتخطيط أفقي)

## v1.8.0 — QR Bulk Generation + Analytics (§5)
- `POST /api/admin/qr/bulk`: توليد حتى 50 رمز QR دفعة واحدة
- `GET /api/admin/qr/:pointId/analytics`: مسح/طلبات/تحويل/مبيعات لكل رمز، من سجل أحداث خام
- تتبع أحداث المسح والطلب الفعلي مضاف على `GET /api/qr/:token` و`/api/service-hub/:token`

## v1.7.0 — White Label Engine (§11, §12)
- جدول `partner_branding`: 3 أوضاع (alnadl/co_branded/full_white_label) + نموذج تجاري منفصل
- تطبيق مُحدَّد النطاق (CSS Custom Properties) على واجهة العميل فقط — هوية المنفذ مستقلة تمامًا
- تعديل الوضع/النطاق: SuperAdmin حصرًا

## v1.6.0 — Revenue Model Engine + Allocation Ledger (§9, §10)
- جدولا `revenue_models` (4 أنواع) و`revenue_ledger` (لقطات ثابتة لا تُعاد كتابتها)
- نموذج ضمني (Implicit) للمنافذ المُرحَّلة من Phase 3 بلا إعداد إضافي

## v1.5.0 — Unified Cart / Parent-Child Orders + Service Hub (§7, §8, §13)
- جدول `child_orders` + توزيع تلقائي لعناصر السلة حسب المنفذ
- `deriveParentStatus()`: حالة الطلب الأصل تُشتق تلقائيًا من أبنائه
- شاشة Service Hub الأمامية الكاملة للعميل + توجيه KDS متعدد المنافذ

## v1.4.0 — Outlet Architecture (§6)
- جدول `outlets` + Migration تلقائي Idempotent من `merchants` (Phase 3)
- باقة CONNECT جديدة + 5 مزايا جديدة (multiOutlet, unifiedCart, restaurantIntegration, whiteLabel, multiProperty)

## v1.3.1 — Phase 4 Planning
- Gap Analysis أولي + مراجعة ذاتية صححت فجوات (QR تفصيلي، رسوم White Label، مصفوفة أمنية)

## v1.3.0 — Phase 1-3 Baseline
- Backend + Frontend كاملان: رحلة العميل، KDS/Runner، SaaS (3 باقات)، Settlement Center، Loyalty، Corporate Wallet، Marketplace
- حزمة توثيق كاملة (10 ملفات + PDF مصمَّمة)

---

## سياسة الإصدار (Versioning Policy، §26.4)
- **الترقيم**: `MAJOR.MINOR.PATCH` تقريبيًا — MINOR لكل زيادة وظيفية (Increment)، PATCH للتوثيق/الإصلاحات
- **الحالة**: كل مستند يحمل `Status` في ترويسته: `DRAFT` (بانتظار مراجعة) أو `FINAL` (معتمد) أو `LIVING DOCUMENT` (يُحدَّث باستمرار مع تقدّم العمل، مثل `PHASE4_GAP_ANALYSIS.md`)
- **Single Source of Truth**: عند أي تعارض بين مستند ووصف والكود، **الكود مرجع أعلى** — كل مستند هنا وُلِّد أو رُوجِع مباشرة من الكود، وليس العكس
