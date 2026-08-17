> **Version:** v2.9.5-r3-sitemanager · **Status:** Rounds 1-3 مكتملة · **Last Updated:** 2026-08-17

# ROLE ACCESS MATRIX

**الأساس**: `v2.8.4-field-fix` (لا `v2.8.2` — راجع الملاحظة أدناه).

> **ملاحظة على الأساس**: وثيقة المتطلبات ذكرت `v2.8.2-diagnostics`، لكن `v2.8.4` يحتوي إصلاحين لاحقين لها: السبب الجذري لخطأ `Server error` الميداني، **وشاشة إدارة الباقات** التي يطلبها §8. البناء على `v2.8.2` كان سيتراجع عنهما.

## Round 1 — المُنفَّذ في هذه الجولة

| Role | Required Capability | UI | API | Authorization | Tests | Status |
|---|---|---|---|---|---|---|
| **All** | إنشاء حساب بلا كلمة مرور معروفة | رمز تفعيل يُنسخ | `POST /api/admin/users` | منشئ مخوّل فقط | 48 | ✅ **Implemented & Verified** |
| **All** | تفعيل ذاتي وتعيين كلمة المرور | `/api/activate/:token` | `GET/POST /api/activate/:token` | الرمز هو الإثبات · مرة واحدة | 48 | ✅ |
| **All** | استعادة وصول بلا كشف كلمة مرور | زر إعادة إصدار | `POST /api/admin/users/:id/activation` | مخوّل ضمن نطاقه | 48 | ✅ |
| **SuperAdmin** | تغيير الدور/النطاق/الحالة | قائمة المستخدمين | `PATCH /api/admin/users/:id` | عدم تصعيد + حماية آخر SuperAdmin | 48 | ✅ |
| **PartnerAdmin** | إدارة مستخدمي شريكه فقط | قائمة المستخدمين | نفس النقطة | نطاق مفروض من الجلسة | 48 | ✅ |
| **All** | ملخص صلاحيات بلغة أعمال | قراءة فقط | `GET /api/admin/roles` | يُصفَّى حسب الفاعل | 48 | ✅ |
| **ProductAdmin** | مختبر الآليات + نظرة Engage | شاشتان | `mechanics` · `engage/overview` | لا Kill Switch (محصور بـSuperAdmin) | 28 | ✅ |
| **SafetyReviewer** | حوادث السلامة + السجل + المعالجة | شاشتان | `safety-incidents` · `ledger` · `resolve` | لا اقتراح آليات | 28 | ✅ |
| **PartnerAdmin** | Overview كشاشة أولى | ✅ | `partner/overview` | نطاق الشريك | 28 | ✅ |

## Round 2 — المُنفَّذ (`v2.9.1` · `v2.9.2`)

| Role | Required Capability | UI | API | Authorization | Tests | Status |
|---|---|---|---|---|---|---|
| **SuperAdmin** | مركز تحكم Engage | `engagecontrol` | `engage/kill-switch` · `policy-overrides` · `effective-state` | مفتاح الإيقاف له وحده | 37 | ✅ **Implemented & Verified** `v2.9.1` |
| **SuperAdmin** | الحالة الفعّالة بأسبابها | بطاقة الطبقات الأربع | `GET /api/engage/effective-state` | نطاق أي شريك | 37 | ✅ `v2.9.1` |
| **PartnerAdmin** | Engage نطاقه + تقييد باتجاه واحد | `partnerengage` | `partner/engage/overview` · `policy-overrides` | تقييد فقط · لا توسيع · لا عبور مستأجر | 37 | ✅ `v2.9.1` |
| **PartnerViewer** | Engage قراءة فقط | `partnerengage` | `partner/engage/overview` | صفر mutation | 37 | ✅ `v2.9.1` |
| **AlnadlFinance** | دفتر الإيراد | `revledger` | `GET /api/admin/revenue-ledger` | بلا توسيع للتشغيل | 37 | ✅ `v2.9.1` |
| **SuperAdmin** | **§4 Partner Control Center** | `partnerprofile` | نقاط قائمة فقط — **صفر API جديدة** | تصفية لكل شريك · لا تسريب متقاطع | 37 | ✅ **Implemented & Verified** `v2.9.2-r2-partner-center` |

**§4 Partner Control Center** — تسعة أقسام في صفحة موحّدة: Overview · Plan/Subscription · Properties · Users · Outlets · Loyalty · Engage · Branding · Finance summary · Audit. كل وحدة تُحمَّل وتفشل **مستقلة** (وحدة واحدة تفشل ⇒ تُعلن باسمها وبقية الصفحة تعمل)، ولا يُخترع أي حقل غير موجود في المخطط. **مُتحقَّق في متصفح حقيقي**: كل الأقسام حاضرة، صفر تسريب لشريك آخر، صفر أخطاء صفحة.

### R2 — البندان الأخيران (`v2.9.3`)

| Role | Required Capability | UI | API | Authorization | Tests | Status |
|---|---|---|---|---|---|---|
| **SuperAdmin** | **§4 دورة حياة الشريك** | ملف الشريك | `GET/POST /api/admin/partners/:id/status` | SuperAdmin وحده · سبب إلزامي · تدقيق قبل/بعد | 38 | ✅ **Implemented & Verified** |
| **PartnerAdmin/Viewer** | رؤية حالتهم وقدراتها | ملف الشريك | `GET .../status` | نطاقهم فقط · بلا مسار تغيير | 38 | ✅ |
| **SuperAdmin** | **§5 إدارة الولاء** | لوحة الولاء | `loyalty/summary` · `accounts` · `history` | يُحدّد الشريك صراحةً | 32 | ✅ |
| **PartnerAdmin** | ولاء شريكه | لوحة الولاء | نفس النقاط | النطاق من الجلسة · معامل مخالف **يُرفض** | 32 | ✅ |
| **PartnerViewer** | ولاء شريكه قراءة | لوحة الولاء | نفس النقاط | صفر mutation | 32 | ✅ |

### §4 — نموذج دورة حياة الشريك (معتمد)

**المبدأ**: الإيقاف إجراء تجاري ضد الشريك، **لا عقوبة على ضيف يقف بطلبه في يده، ولا إسقاط لحق مالي**. لذا تُفصل ثلاث قدرات: قبول التزامات جديدة (يتوقف) · إتمام التزامات قائمة (**يستمر**) · الحقوق المالية (**لا تُمسّ**).

| القدرة | Draft | Active | Suspended | Closed |
|---|---|---|---|---|
| دخول مستخدمي الشريك | ✅ | ✅ | ✅ | ❌ |
| رمز QR يُحلّ | ❌ | ✅ | ❌ | ❌ |
| طلب جديد | ❌ | ✅ | ❌ | ❌ |
| **الطلبات المفتوحة** | — | ✅ | ✅ **تُكمل** | ✅ **تُكمل** |
| KDS / Runner | ✅ | ✅ | ✅ | ✅ |
| Engage | ❌ | حسب الباقة | ❌ | ❌ |
| Loyalty Earn | ❌ | ✅ | ❌ | ❌ |
| Loyalty Redeem | ❌ | ✅ | ❌ | ❌ |
| التسويات والاسترجاعات | ✅ | ✅ | ✅ | ✅ |
| إدارة PartnerAdmin | ✅ | ✅ | 👁 قراءة | ❌ |

**شرط حاكم على الإغلاق (جولة تصحيحية)**: كان في النموذج تناقض حقيقي — `Closed` تُغلق `userLogin` بينما تُبقي `completeOpenOrders` و`kdsRunner`. عمليًا مستحيل: من يُفترض أن يُكمل الطلبات لا يستطيع الدخول، فتبقى الطلبات المدفوعة عالقة بلا مسار إتمام ولا استرجاع.

**الحل**: منع الوصول إلى `Closed` أساسًا ما دام هناك عمل تشغيلي قائم — لا فتح الدخول في `Closed` (فيفقد الإغلاق معناه).

| المحاولة | النتيجة |
|---|---|
| `Active` أو `Suspended` + طلب مفتوح ⟶ `Closed` | **`409 PARTNER_HAS_OPEN_ORDERS`** مع عدد الطلبات والمسار الصحيح |
| `Draft` ⟶ `Closed` | ✅ مسموح — لم يدخل التشغيل Live |
| بعد تصريف كل الطلبات | ✅ `200` |

**المسار التشغيلي الصحيح**: `Active → Suspended → إكمال الطلبات → Closed`. الإيقاف يمنع الجديد ويُبقي الدخول والتشغيل، فيصبح الإغلاق ممكنًا بأمان.

**الحالات النهائية**: `Delivered` · `Cancelled` · `Refunded` · `Delivery Failed`. وأي حالة غير مذكورة تُعدّ **مفتوحة عمدًا** — الافتراض الآمن أن الطلب يحتاج عملًا، فحالة تُضاف لاحقًا لا تنزلق كـ"منتهية" بصمت. والعدّ يشمل الطلبات **الفرعية** أيضًا، لأن طلبًا أصليًا قد يكون منتهيًا بينما فرعه قيد التجهيز.

**لا إلغاء تلقائي**: المحاولة الفاشلة **لا تكتب شيئًا** — لا حالة الشريك تتغيّر ولا حالة أي طلب.

**الملخص يعكس المتاح فعليًا**: `allowedTransitions` تُصفّى بالشروط، و`blockedTransitions` تُصرّح بالسبب والعدد — فلا يُعرض زر يفشل.

**الأثر Server-side عبر مُحلِّل مركزي** (`lib/partner-status.js`) — لا شروط منثورة. نقاط الإنفاذ: الدخول · حلّ QR · إنشاء الطلب · كسب الولاء · استبدال الولاء.

**Partner Status مستقل عن Subscription Status** — كلاهما يُفحص ولا يُشتق أحدهما من الآخر.

**الشريك يبدأ `Draft`**: لا يصبح Live بمجرد إنشائه؛ التفعيل قرار صريح مُدقَّق.

**Closed ليس Delete**: الطلبات والتسويات والاسترجاعات والولاء والتدقيق تبقى كاملة.

**رسالة الضيف محايدة**: «الطلب غير متاح حاليًا في هذا المكان» — بلا كشف أن السبب تجاري.

**السيناريوهان المطلوبان مُثبتان**: طلب مفتوح ← إيقاف ← **وصل Delivered** بينما QR يُرفض · و`Suspended → Active` ← الطلبات تعود **بلا فقد أي إعداد أو رصيد**.

### §5 — حدود إدارة الولاء

سطح إداري فقط: **لا Campaigns ولا Tiers ولا Network Rewards** (مُختبَر: النقاط الثلاث تُرجع 404). أرقام الجوال **مُخفاة جزئيًا** في كل قائمة إدارية. تمرير مُعرّف شريك آخر **يُرفض صراحةً** بدل تجاهله بصمت — كشفه الاختبار.

## Round 3 — SiteManager (`v2.9.5`)

**المبدأ**: كشف قدرة خلفية **مسموحة اليوم** — بلا توسيع صلاحية، وبلا بناء خلفي استباقي، وبلا تحويل SiteManager إلى PartnerAdmin.

| Role | Required Capability | UI | API | Authorization | Tests | Status |
|---|---|---|---|---|---|---|
| **SiteManager** | تنفيذ استرجاع | نافذة بتأكيد | `POST /api/orders/:id/refund` | مسموح له أصلًا · مفتاح idempotency | 38 | ✅ **Implemented & Verified** |
| **SiteManager** | سجل استرجاعات الطلب | ضمن النافذة | `GET /api/orders/:id/refunds` | مسموح له أصلًا | 38 | ✅ |
| **SiteManager** | تنبيهات الموقع | شاشة الاستثناءات | `GET /api/admin/notifications` | مسموح له أصلًا | 38 | ✅ |
| **SiteManager** | تجاوزات المهلة وتعذّر التسليم | شاشة الاستثناءات | `GET /api/ops/queue` | مسموح له أصلًا | 38 | ✅ |

**الاسترجاع عملية مالية**: تحذير صريح · سجل الاسترجاعات السابقة وإجماليها · سبب إلزامي · **منع إرسال مزدوج حقيقي** عبر مفتاح `idempotencyKey` يُولَّد عند فتح النافذة — إعادة الضغط تُعيد النتيجة الأصلية ولا تُنفّذ استرجاعًا ثانيًا (مُختبَر بمقارنة الإجمالي قبل/بعد).

**عيب تصميم كشفه التحقق البصري**: بنيت أولًا قسم "قابل للاسترجاع" على `/api/ops/queue` — لكنه **يستثني `Delivered` بحكم تعريفه**، فالقائمة لا يمكن أن تمتلئ أبدًا. زر معطّل بنيويًا. استُبدل ببحث برقم الطلب، وهو المسار الواقعي: الاسترجاع يبدأ من شكوى تحمل رقمًا.

### Zones / Points — قرار موثَّق
الخادم يسمح لـSiteManager بقراءتهما، **ولم تُضَف واجهة**: رحلته الحالية (اللوحة الحية ← KDS ← الاستثناءات) لا تحتاجهما، والطابور يعرض المنطقة والنقطة مع كل تذكرة أصلًا. إضافة شاشة لمجرد وجود نقطة تُضخّم الدور بلا حاجة تشغيلية مُثبَتة.

### Properties — **Deferred by Product Decision**
| السبب | التفصيل |
|---|---|
| لا Backend كتابة | `GET` فقط · **لا `POST` ولا `PATCH`** |
| لا مخطط | **`delivery_grouping` غير موجود في `properties`** رغم ذكره في المتطلب |
| لا عزل مُثبَت | لا اختبارات عزل مستأجر لمسار كتابة غير موجود |

بناؤها الآن يحوّل R3 من **ربط وتمكين تشغيلي** إلى **تطوير خلفي جديد بلا حاجة مُثبَتة**. **مُختبَر**: `POST` و`PATCH` يُرجعان `404` — التأجيل حقيقي لا ادّعاء.

## قواعد عدم التصعيد المفروضة (§3.2)

| القاعدة | الإثبات |
|---|---|
| PartnerAdmin لا يمنح دور منصة/مالية/Engage | `403` لكل من SuperAdmin · AlnadlFinance · ProductAdmin · SafetyReviewer · PartnerAdmin |
| النطاق من الجلسة لا من العميل | `partner_scope` مزوّر في الجسم **يُتجاهل تمامًا** |
| لا عبور مستأجر | PartnerAdmin من A يُرفض على مستخدم/بيانات B |
| حماية آخر SuperAdmin | تعطيله أو خفض دوره ⇒ `409` |
| لا قفز فوق التفعيل | حساب `pending_activation` لا يصبح `active` بضغطة إدارية ⇒ `409` |
| لا دخول بحساب غير مُفعّل | `401` عادي — لا يكشف أن الحساب موجود |

## Round 2 — المُنفَّذ (Engage Governance + Finance)

| Role | Required Capability | UI | API | Authorization | Tests | Status |
|---|---|---|---|---|---|---|
| **SuperAdmin** | مركز تحكّم Engage | `engagecontrol` | `engage/effective-state` · `kill-switch` · `policy-overrides` | SuperAdmin فقط للمفتاح | 37 | ✅ **Implemented & Verified** |
| **SuperAdmin** | الحالة الفعّالة بطبقاتها الأربع | ✅ | `GET /api/engage/effective-state` | نطاق أي شريك | 37 | ✅ |
| **SuperAdmin** | مختبر الآليات + سجل التجارب | مدخلان | نقاط قائمة | — | 37 | ✅ |
| **PartnerAdmin** | Engage نطاقه + تقييد فقط | `partnerengage` | `partner/engage/overview` · `policy-overrides` | نطاقه فقط · **لا توسيع** | 37 | ✅ |
| **PartnerViewer** | Engage نطاقه قراءة فقط | `partnerengage` | نفس النقاط | **صفر mutation** | 37 | ✅ |
| **AlnadlFinance** | دفتر الإيراد | `revledger` | `admin/revenue-ledger` | **بلا توسيع للتشغيل** | 37 | ✅ |

### ضمانات الحوكمة المُثبَتة (R2)

| القاعدة | الإثبات |
|---|---|
| مفتاح الإيقاف لـSuperAdmin حصرًا | `403` لـPartnerAdmin · PartnerViewer · AlnadlFinance |
| الشريك يُقيّد ولا يوسّع | تقييد نطاقه `201` · تقييد شريك آخر `403` |
| لا سجل تجارب كامل للشريك | `403` لكلا دوري الشريك · النظرة المُجمّعة `200` |
| **لا قراءة عابرة للمستأجر** | تمرير `partnerId` لشريك آخر ⇒ **`403` صريح** بدل استبدال صامت |
| سبب المنع مُفكَّك | `not_in_plan` · `subscription_inactive` · `global_kill_switch` · `scope_override` |
| المالية لا تُوسَّع للتشغيل | `AlnadlFinance` يُرفض على `/api/ops/queue` |
| لا تسريب أسرار | صفر `accessToken`/`prompt`/`selection_reason` في أي استجابة |

## Round 3 — لم يُنفَّذ بعد

| Requirement | التصنيف | ملاحظة |
|---|---|---|

## خارج النطاق (§10)

PostgreSQL/F04 · مزوّد دفع حقيقي · SMS/OTP · AI Provider · باقات تجارية جديدة · Network Rewards · Campaigns/Tiers · Group Invite · Session Resume
