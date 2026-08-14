> **Version:** v2.8.0-golive-p0p1 · **Last Updated:** 2026-08-14

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

## `engage_ai_generation` — نفس سلسلة الأولوية الكاملة، مفتاح مستقل عن `engage_enabled` (Phase 5 P5-Inc-7)

يتبع **بالضبط** نفس نمط `engage_enabled` — أربع طبقات، دالة عامة مشتركة (`resolveFlag()` في `lib/engage-flags.js`) — لكن **بمفتاح إيقاف طارئ مستقل تمامًا**. تعطيل الذكاء الاصطناعي عالميًا (مثال: حادثة مع مزوّد AI) **لا يُعطِّل** Engage الثابت نفسه — المحتوى الاحتياطي المُعتمَد يستمر في العمل طبيعيًا. مُختبَر مباشرة: تعطيل مفتاح AI العام لا يُغيّر نتيجة `resolveEngageEnabled()` إطلاقًا.

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

**القاعدة الصارمة (مُصحَّحة، الجولة التصحيحية v2.0.16)**: **Global Safety** و**Partner Contract** حظران مطلقان — لا يمكن لأي مستوى أدنى تجاوزهما مهما كان. **بعد تجاوز هذين الحظرين فقط**، `Property` و`Zone` أصبحا Override هرميًا حقيقيًا: **الأدق يفوز دائمًا** — قد يعني هذا أن `Zone` صريحة تُفعِّل ما قيَّده `Property` (مثال: `Property=OFF` لكن `Zone=ON` صراحةً → **يُفعَّل**)، بنفس صيغة `zone ?? property ?? افتراضي` المُطبَّقة في Ceiling/Novelty بالضبط. **جدول حقيقة كامل (9 حالات) مُختبَر مباشرة** في `tests/engage-inc6.js`، راجع `docs/PHASE5_GAP_ANALYSIS.md` قسم "الجولة التصحيحية" للتفصيل الكامل.


---

## Go-Live P0 §3.7 — مزايا الولاء (Entitlements)

**التحوّل الجوهري**: لم تعد الميزة مربوطة باسم باقة. كان الفحص فعليًا `plan.code === 'PLATFORM'` عبر عَلَم `loyalty` — **أسماء الباقات أدوات تجارية تتغيّر، والقدرات لا**.

| العَلَم | المعنى | الحالة |
|---|---|---|
| `loyalty_enabled` | كسب النقاط | **مُنفَّذ** |
| `loyalty_redeem_enabled` | السماح بالاستبدال — **رافعة منفصلة** | **مُنفَّذ** |
| `loyalty_custom_rules` | قواعد تخصيص | بنية جاهزة، غير مبنية |
| `loyalty_campaigns` | حملات ومضاعفات | مؤجَّل (P2) |
| `loyalty_analytics` | تحليلات ولاء | مؤجَّل (P2) |
| `loyalty_engage_integration` | ربط Engage بالمكافآت | مؤجَّل (P2) |

**التوافق الخلفي**: العَلَم القديم `loyalty` ما زال يعمل — الاشتراكات القائمة لا تفقد الميزة أثناء الانتقال. الأعلام الجديدة تُقدَّم عند وجودها.

**فصل الرافعتين مقصود**: شريك قد يريد الكسب فعّالًا والاستبدال مغلقًا حتى يتوفر مزوّد تحقق (§3.8).

**إضافة مزايا جديدة** لا تحتاج تغيير مخطط ولا نشرًا — `POST/PATCH /api/admin/plans` يقبل أي مفتاح Boolean.
