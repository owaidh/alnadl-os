> **Version:** v2.0.15-p5-inc6 · **Status:** FINAL (Phase 1-4) + P5-Inc-6 engage_enabled precedence · **Last Updated:** 2026-08-13 · **Release Tag:** v2.0.15-p5-inc6

# Alnadl Hospitality OS — Packages & Feature Flags Matrix (§4, §26.1)

**المصدر الوحيد للحقيقة**: `db.js` (كائن `plans`). هذا الجدول نسخة مقروءة منه — عند أي تعديل مستقبلي على الباقات، يُحدَّث `db.js` أولاً ثم هذا الملف.

## الرسوم
| الباقة | الرسم الشهري | نسبة الرسم التقني |
|---|---|---|
| OPERATE | 0 ر.س | 0% |
| SMART | 2,500 ر.س | 2% |
| CONNECT | 4,000 ر.س | 2.2% |
| PLATFORM | 6,000 ر.س | 2.5% |

## مصفوفة المزايا (Feature Flags)
| الميزة | OPERATE | SMART | CONNECT | PLATFORM | نقطة التحقق في الكود |
|---|---|---|---|---|---|
| `qrOrdering` (الطلب عبر QR) | ❌ | ✅ | ✅ | ✅ | `POST /api/orders` |
| `digitalPayment` (الدفع الإلكتروني) | ❌ | ✅ | ✅ | ✅ | `POST /api/orders/:id/pay` |
| `partnerDashboard` (لوحة الشريك) | ❌ | ✅ | ✅ | ✅ | `GET /api/partner/overview` |
| `analytics` | ❌ | ✅ | ✅ | ✅ | — |
| `loyalty` (الولاء) | ❌ | ❌ | ❌ | ✅ | `POST /api/orders` (عند `redeemPoints`) |
| `corporateWallet` (المحفظة المؤسسية) | ❌ | ❌ | ❌ | ✅ | `POST /api/orders/:id/pay` (عند `method:"wallet"`) |
| `marketplace` (شركاء تجاريون متعددون) | ❌ | ❌ | ✅ | ✅ | `GET /api/catalog`, `POST /api/admin/merchants` |
| **`multiOutlet`** (منافذ متعددة) | ❌ | ❌ | ✅ | ✅ | `POST /api/admin/outlets` (المنفذ الأول مُستثنى دائمًا) |
| **`unifiedCart`** (السلة الموحّدة) | ❌ | ❌ | ✅ | ✅ | `POST /api/orders` (فرز child_orders) |
| **`restaurantIntegration`** | ❌ | ❌ | ✅ | ✅ | — (مرتبط مفهوميًا بـ`marketplace`) |
| **`whiteLabel`** (العلامة التجارية) | ❌ | ❌ | ❌ | ✅ | `POST /api/admin/branding` |
| **`multiProperty`** (منشآت متعددة) | ❌ | ❌ | ❌ | ✅ | غير مُفعَّلة على أي نقطة API بعد — محجوزة لتوسعة مستقبلية |

**البنود بالخط الغامق** أُضيفت في Phase 4.

## سلوك البوابة (Feature Gate) القياسي
كل نقطة API محمية تستدعي `requireFeature(partnerId, 'featureName')` من `lib/plan.js`:
- الشريك بلا الميزة → **402 Payment Required** (رمز مقصود، يعكس أن الحل هو ترقية الباقة، وليس خطأ في الطلب نفسه)
- ترقية الباقة → الميزة تُفعَّل **فورًا** دون أي تعديل كود إضافي
- تخفيض الباقة → **لا حذف للبيانات القائمة أبدًا** — العرض يتدهور بأمان (Graceful Degradation): مثال، منفذان قائمان يبقيان قابلين للقراءة حتى لو مُنع إنشاء ثالث، والعلامة التجارية المحفوظة تُعرَض كافتراضية دون حذف الإعداد نفسه.

## Override تعاقدي لكل شريك
النظام الحالي **لا يدعم Override فرديًا** خارج حدود الباقة (كل شريك يتبع مزايا باقته حرفيًا) لهذه الأعلام أعلاه تحديدًا. أي استثناء تعاقدي خاص (مثال: شريك على SMART لكن بميزة Loyalty بموجب اتفاق خاص) يتطلب إما ترقية الباقة فعليًا أو تعديل مباشر على `subscriptions.features_json` لذلك الشريك تحديدًا — غير مبني كواجهة إدارية بعد.

## `engage_enabled` — Feature Flag استثنائي بسلسلة أولوية كاملة (Phase 5)

على عكس كل الأعلام أعلاه (ثنائية القيمة، مستوى الباقة فقط)، `engage_enabled` له سلسلة أولوية هرمية كاملة (§25.8، مُطبَّقة عبر `lib/engage-flags.js`):

```
Global Safety (مفتاح إيقاف طارئ، SuperAdmin فقط، POST /api/admin/engage/kill-switch)
    ↓ يتجاوز كل ما يلي إن كان OFF
Partner Contract (plans.features_json.engage_enabled — نفس آلية باقي الأعلام أعلاه)
    ↓ لا يمكن لما يلي تجاوز رفضه
Property Override (venue_policy_override, scope_type='property')
    ↓ الأدق يفوز إن وُجد
Zone Override (venue_policy_override, scope_type='zone')
```

**القاعدة الصارمة**: أي مستوى أدنى يمكنه فقط أن **يُقيِّد** (يُحوِّل لـOFF) — لا يمكنه أبدًا **تفعيل** ما رفضه مستوى أعلى. مُختبَر مباشرة في `tests/engage-inc6.js` بكل توليفة تعارض ممكنة.
