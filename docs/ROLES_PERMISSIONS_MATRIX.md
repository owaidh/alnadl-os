> **Version:** v2.0.3 · **Status:** PHASE 1-4 TECHNICAL BASELINE LOCKED · **Last Updated:** 2026-08-12 · **Release Tag:** v2.0.3-p4-baseline-locked

# Alnadl Hospitality OS — Roles & Permissions Matrix (§19, §26.1)

**المصدر**: مُستخرَجة مباشرة من حراسات المسارات (`on(method, path, [roles], handler)`) في `server.js` — وليست موثَّقة يدويًا بمعزل عن الكود، لذا لا يمكن أن تنحرف عنه.

## الأدوار الثمانية
| الدور | النطاق | الوصف |
|---|---|---|
| `Customer` | عام، بلا تسجيل دخول | نقاط API العامة فقط (QR، القائمة، الطلب، الدفع) |
| `Operator` | مقيّد بمنشأة | KDS، انتقالات حالة الطلب المسموحة له فقط (Paid→Accepted→Preparing→Ready) |
| `Runner` | مقيّد بمنشأة | طابور التوصيل، انتقالات Ready→Out for Delivery→Delivered |
| `SiteManager` | مقيّد بمنشأة | KDS + لوحة حية، صلاحيات Operator بالإضافة لانتقالات إضافية (Preparing→Ready، Delivery Failed→...) |
| `PartnerViewer` | مقيّد بشريك (`partner_scope`) | قراءة فقط: نظرة عامة، تسويات (اعتماد/اعتراض فقط) |
| `PartnerAdmin` | مقيّد بشريك | إدارة ذاتية: منافذ، مناطق/QR، قائمة، محافظ، نماذج إيراد، مستخدمون (بأدوار محدودة) — **لا يستطيع** White Label أو الشركاء/الباقات |
| `AlnadlFinance` | كل الشركاء | اعتماد التسويات، سجل التدقيق، Ledger — **لا** إدارة منافذ/قائمة تشغيلية |
| `SuperAdmin` | كل شيء | كل الصلاحيات، بلا استثناء |

## مصفوفة الصلاحيات الكاملة (لكل Endpoint حسّاس)
| Endpoint | Operator | Runner | SiteManager | PartnerViewer | PartnerAdmin | AlnadlFinance | SuperAdmin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `GET /api/ops/queue` | ✅ | | ✅ | | | | ✅ |
| `GET /api/runner/queue` | | ✅ | | | | | ✅ |
| `GET /api/manager/live` | ✅ | | ✅ | | | | ✅ |
| `POST /api/orders/:id/transition`¹ | ✅ | ✅ | ✅ | | | ✅ | ✅ |
| `POST /api/child-orders/:id/transition`¹ | ✅ | ✅ | ✅ | | | ✅ | ✅ |
| `GET /api/partner/overview` | | | | ✅ | ✅ | ✅ | ✅ |
| `GET/POST /api/admin/settlements` | | | | قراءة | قراءة | ✅ | ✅ |
| `POST /api/admin/settlements/:id/transition`² | | | | اعتماد/اعتراض فقط | اعتماد/اعتراض فقط | كل الانتقالات | كل الانتقالات |
| `GET/POST /api/admin/outlets` | | | | | ✅ (نطاقه) | | ✅ |
| `GET/POST /api/admin/revenue-models` | | | | | ✅ (نطاقه) | | ✅ |
| `GET /api/admin/revenue-ledger` | | | | ✅ (نطاقه) | ✅ (نطاقه) | ✅ | ✅ |
| `GET/POST /api/admin/branding`³ | | | | | | | ✅ فقط |
| `GET/POST /api/admin/wallets` | | | | قراءة | ✅ (نطاقه) | | ✅ |
| `GET/POST /api/admin/zones`, `/points`, `/categories`, `/products` | | | | | ✅ (نطاقه) | | ✅ |
| `GET/POST /api/admin/users` | | | | | ✅ (أدوار محدودة⁴) | | ✅ |
| `POST /api/admin/qr/bulk`, `GET .../analytics` | | | | | ✅ (نطاقه) | | ✅ |
| `GET/POST /api/admin/partners`, `/onboard`, `/subscription` | | | | | | | ✅ فقط |
| `GET /api/admin/portfolio` | | | | | | | ✅ فقط |
| `GET /api/audit` | | | | | | ✅ | ✅ |
| `GET /api/admin/notifications` | | | ✅ | | | ✅ | ✅ |

¹ لكل حالة انتقالات مسموحة تحديدًا حسب `lib/statemachine.js` — ليس كل دور مسموح بكل انتقال، راجع `TRANSITIONS.by` لكل حالة.
² الشريك (PartnerViewer/PartnerAdmin) مقيّد بـ`Approved`/`Disputed` فقط ولا يمكنه تخطي أي خطوة سابقة.
³ **تعديل الوضع/النطاق المخصص إداري حصرًا** — قرار أمني صريح من §19، وليس قيدًا تقنيًا عرضيًا.
⁴ `PartnerAdmin` يستطيع إنشاء مستخدمين بأدوار `Operator`/`Runner`/`SiteManager`/`PartnerViewer` فقط — لا يستطيع إنشاء `SuperAdmin` أو `AlnadlFinance`.

## عزل النطاق (Scope Isolation)
كل نقطة "(نطاقه)" أعلاه تُطبِّق `assertTenantWrite()`/`assertPartnerScope()` — محاولة الوصول لبيانات شريك آخر تُرفض بـ**403 Forbidden**، مُختبرة فعليًا عبر محاولات اختراق متعمَّدة أثناء البناء (راجع سجل الاختبارات في محادثات التسليم).

## سجل التدقيق (Audit Trail) لكل تغيير حساس
كل عملية تعديل على: حالة طلب، نموذج إيراد، إعداد علامة تجارية، باقة شريك، أو حساب مستخدم — تُسجَّل عبر `audit()` بالفاعل ودوره والقيمة قبل/بعد. راجع `GET /api/audit`.
