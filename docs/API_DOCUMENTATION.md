> **Version:** v2.0.11-p5-inc4-corrective · **Status:** FINAL (Phase 1-4) + P5-Inc-1/2/3/4 endpoints · **Last Updated:** 2026-08-13 · **Release Tag:** v2.0.11-p5-inc4-corrective

# Alnadl Hospitality OS — API Documentation

مرجع كامل لكل نقاط الـ API. الأساس (base URL) عند التشغيل المحلي: `http://localhost:8787`.

## المصادقة (Authentication)

معظم نقاط `/api/admin/*` و`/api/ops/*` و`/api/runner/*` و`/api/partner/*` و`/api/settlement*` تتطلب رأس تفويض:

```
Authorization: Bearer <token>
```

يُستخرج التوكن من `POST /api/auth/login`. صلاحيته 8 ساعات. لا يوجد Refresh Token في هذا الإصدار — عند الانتهاء يُطلب تسجيل دخول جديد.

### أدوار النظام (Roles)
`Customer` (بدون تسجيل دخول) · `Operator` · `Runner` · `SiteManager` · `PartnerViewer` · `PartnerAdmin` · `AlnadlFinance` · `SuperAdmin`

### نطاق الشريك (Partner Scope)
المستخدمون بدور `PartnerViewer` أو `PartnerAdmin` مقيّدون بـ `partner_scope` المخزّن في جلستهم — أي محاولة قراءة أو كتابة بيانات شريك آخر تُرفض بـ `403 Forbidden`.

### أشكال الأخطاء الموحّدة
```json
{ "error": "Human-readable message" }
```
| الحالة | المعنى |
|---|---|
| 400 | مدخلات غير صالحة |
| 401 | غير مُصادَق (توكن مفقود/منتهي) |
| 402 | **مزايا الباقة (SaaS plan) لا تشمل هذه القدرة** — راجع `lib/plan.js` |
| 403 | مُصادَق لكن غير مخوّل (دور أو نطاق شريك خاطئ) |
| 404 | غير موجود |
| 409 | تعارض حالة (مثال: انتقال غير مسموح في آلة الحالة) |

---

## 1) المصادقة

### `POST /api/auth/login`
عام (بدون تفويض).
```json
// Request
{ "username": "operator", "password": "operator" }
// Response 200
{ "token": "...", "user": { "username": "operator", "role": "Operator", "scope": "pt_nova" } }
```

---

## 2) العميل — QR والقائمة والطلب (عام، بدون تفويض)

### `GET /api/demo/points`
**لأغراض العرض التوضيحي فقط** — يسرد كل النقاط ورموزها لمحاكاة "مسح QR" بدون طباعة رموز فعلية. لا تُستخدم هذه النقطة في بيئة إنتاج حقيقية.

### `GET /api/qr/:token`
يحوّل رمز QR إلى سياق كامل (الشريك/المنشأة/المنطقة/النقطة). هذه هي النقطة التي يستدعيها تطبيق العميل عند فتح رابط QR الحقيقي.
```json
// Response 200
{ "partner": {...}, "property": {...}, "zone": {...}, "point": {...}, "token": "..." }
// 404 إن كان الرمز غير صالح، 409 إن كانت النقطة موقوفة
```

### `GET /api/catalog?propertyId=<id>`
يُرجع التصنيفات والمنتجات (مع Variants وAdd-ons) المتاحة لتلك المنشأة.

### `GET /api/promotions/validate?code=<code>&propertyId=<id>`
```json
// Response 200 (صالح)
{ "valid": true, "code": "WELCOME10", "discountType": "percent", "discountValue": 10 }
// Response 404 (غير صالح/منتهي)
{ "valid": false }
```

### `POST /api/orders`
ينشئ طلبًا جديدًا (Created → Payment Pending تلقائيًا). **مُقيّد بباقة الشريك** — يرجع `402` إن كانت الباقة `OPERATE` (لا تشمل qrOrdering).
```json
// Request
{
  "pointId": "PT-014",
  "customerName": "Khaled",
  "customerPhone": "+9665xxxxxxx",
  "promoCode": "WELCOME10",
  "items": [
    { "productId": "p_latte", "variantId": "vr_xxx", "addonIds": ["ad_xxx"], "qty": 2, "notes": "no sugar" }
  ]
}
// Response 201
{ "id": "ORD-1806", "paymentRef": "pay_xxx", "total": 45.54, "status": "Payment Pending" }
```

### `POST /api/orders/:id/pay`
**مُقيّد بباقة الشريك** (`digitalPayment`). يمر عبر `lib/payment.js` (راجع `README.md` لتفاصيل ربط بوابة حقيقية لاحقًا).
```json
// Request
{ "method": "card", "simulateFail": false }
// Response 200
{ "id": "ORD-1806", "status": "Paid" }
```
**Idempotent**: إعادة الاستدعاء لطلب مدفوع/فاشل مسبقًا تُرجع نفس النتيجة مع `"idempotent": true` دون إنشاء دفعة مكررة.

### `POST /api/payments/webhook`
نقطة استقبال Webhook من بوابة الدفع الحقيقية مستقبلاً (غير مستخدمة في المسار المتزامن الحالي، جاهزة لليوم الذي تُربط فيه بوابة فعلية).

### `GET /api/orders/:id`
عرض آمن للعميل (بدون بيانات حساسة داخلية).

### `POST /api/orders/:id/feedback`
يُقبل فقط إن كانت حالة الطلب `Delivered`.
```json
{ "stars": 5, "tags": ["Fast","Friendly"], "comment": "..." }
```

---

## 3) التشغيل (KDS) — يتطلب دور Operator / SiteManager / SuperAdmin

### `GET /api/ops/queue`
قائمة الطلبات الحيّة (`Paid`→`Out for Delivery`) مرتّبة بالأقدم أولاً.

### `POST /api/orders/:id/transition`
**المرجع الوحيد لتغيير حالة الطلب.** يتحقق من آلة الحالة (`lib/statemachine.js`) ومن صلاحية الدور في تلك الحالة تحديدًا.
```json
{ "to": "Accepted", "reason": "..." }  // reason إلزامي فقط عند to = "Cancelled"
```
`409` عند انتقال غير مسموح، `403` عند دور غير مخوّل لهذا الانتقال تحديدًا.

---

## 4) التوصيل — يتطلب دور Runner

### `GET /api/runner/queue`
### `POST /api/orders/:id/transition` (نفس نقطة القسم 3، بأدوار `Ready→Out for Delivery→Delivered/Delivery Failed`)

---

## 5) لوحة مدير الموقع (M01) — SiteManager / Operator / SuperAdmin

### `GET /api/manager/live?propertyId=<id>`
مؤشرات اليوم الحية: المبيعات، عدد الطلبات لكل حالة، متوسط زمن التجهيز/التسليم، أفضل منطقة.

---

## 6) لوحة الشريك — PartnerViewer / PartnerAdmin / SuperAdmin / AlnadlFinance

### `GET /api/partner/overview?partnerId=<id>`
**مُقيّد بباقة الشريك** (`partnerDashboard`) للأدوار الشريكة. مُقيّد بنطاق الشريك.

### `GET /api/settlement?partnerId=<id>&period=YYYY-MM`
حساب سريع للمعاينة فقط (لا يُخزَّن). للتسوية الرسمية القابلة للاعتماد راجع القسم 9.

---

## 7) الإدارة — الشركاء والباقات (SuperAdmin فقط لمعظمها)

### `GET/POST /api/admin/partners`
### `GET /api/admin/properties` (SuperAdmin أو PartnerAdmin ضمن نطاقه)
### `POST /api/admin/onboard`
ينشئ شريكًا + منشأة + اشتراكًا فعّالاً بضغطة واحدة.
```json
{ "partnerNameAr":"...", "partnerNameEn":"...", "propertyNameAr":"...", "propertyNameEn":"...", "planCode":"SMART" }
```
### `GET /api/plans`
عام — يسرد الباقات الأربع (OPERATE/SMART/CONNECT/PLATFORM) ومزاياها.
### `GET /api/admin/subscription?partnerId=<id>`
### `POST /api/admin/subscription`
تغيير باقة شريك فوريًا: `{ "partnerId":"...", "planCode":"PLATFORM" }`

---

## 8) الإدارة — المناطق/النقاط/QR والقائمة (SuperAdmin أو PartnerAdmin ضمن نطاقه)

`GET/POST /api/admin/zones` · `GET/POST /api/admin/points` · `PATCH /api/admin/points/:id` (تفعيل/إيقاف) · `GET/POST /api/admin/categories` · `GET/POST /api/admin/products` · `PATCH /api/admin/products/:id` · `GET /api/admin/products/:id/options` · `POST /api/admin/products/:id/variants` · `POST /api/admin/products/:id/addons`

كل نقطة كتابة هنا تتحقق أن العنصر المستهدف (Zone/Point/Category/Product) يتبع فعليًا لنطاق `PartnerAdmin` المرسل، وإلا `403`.

---

## 9) الإدارة — التسويات المالية الرسمية (Settlement Center، A06)

### `GET /api/admin/settlements`
### `POST /api/admin/settlements` (AlnadlFinance/SuperAdmin)
```json
{ "partnerId": "pt_nova", "period": "2026-08" }
```
### `POST /api/admin/settlements/:id/transition`
```json
{ "to": "Reviewed" }
```
سير الحالات الإلزامي: `Draft → Reviewed → Partner Review → Approved/Disputed → Paid`. الشريك (`PartnerViewer`/`PartnerAdmin`) يملك فقط صلاحية `Approved` أو `Disputed`، ولا يمكنه تخطي أي خطوة.

---

## 10) الإدارة — المستخدمون والصلاحيات (A05)

`GET/POST /api/admin/users` · `PATCH /api/admin/users/:id` (تفعيل/إيقاف)

`PartnerAdmin` يستطيع إنشاء مستخدمين لشريكه فقط، وبأدوار محدودة (`Operator`, `Runner`, `SiteManager`, `PartnerViewer`) — لا يمكنه إنشاء `SuperAdmin` أو `AlnadlFinance`.

---

## 11) الولاء والمكافآت (Loyalty & Rewards، §15) — عام

### `GET /api/loyalty/:phone`
يُرجع رصيد نقاط العميل (يُنشئ حسابًا برصيد صفر تلقائيًا إن لم يوجد).
```json
{ "pointsBalance": 340 }
```
### `GET /api/loyalty/:phone/history`
سجل آخر 50 حركة (كسب/استبدال) لهذا الحساب.

**آلية الكسب**: 1 نقطة لكل 1 ر.س من إجمالي الطلب، تُضاف تلقائيًا عند انتقال الطلب إلى `Delivered` (إن كان رقم جوال العميل مسجّلاً، وباقة الشريك تشمل `loyalty`).
**آلية الاستبدال**: تُرسل `redeemPoints` ضمن `POST /api/orders` — كل 20 نقطة = 1 ر.س خصم، بحد أقصى المجموع الفرعي للطلب. **مُقيّدة بباقة الشريك** (`loyalty` feature، PLATFORM فقط) — 402 إن حاول شريك على باقة أقل.

## 12) المحفظة المؤسسية (Corporate Wallet، §8/§14)

### `GET /api/wallets/lookup?ownerRef=<ref>`
عام — يبحث عن محفظة نشطة بمعرّف الجهة (`owner_ref`، مثال: `dept:engineering`). في نظام إنتاجي حقيقي هذا يُستبدل بجلسة موظف مُصادَق عليها (SSO)، وليس معاملًا في الرابط.
```json
{ "id":"wal_...", "ownerName":"Employee Wallet Pool", "remaining": 440, "policy": {"perOrderCap": 60} }
```
### `GET/POST /api/admin/wallets`
إنشاء محفظة جديدة (SuperAdmin أو PartnerAdmin ضمن نطاقه). **مُقيّدة بباقة الشريك** (`corporateWallet`، PLATFORM فقط).

**آلية Split Payment**: عند `POST /api/orders/:id/pay` بـ `method:"wallet"`، يحسب السيرفر تلقائيًا `min(إجمالي الطلب، الرصيد المتبقي، سقف الطلب الواحد إن وُجد)` كتغطية من المحفظة، ويُحصّل الباقي (إن وُجد) عبر البطاقة في نفس عملية الدفع — ويُسجَّل كصفين منفصلين في جدول `payments` (واحد `method:"wallet"` وآخر `method:"card"` أو `"split"`).

## 13) الشركاء التجاريون / Marketplace (Restaurant Integration، §9)

### `GET/POST /api/admin/merchants`
إدارة الشركاء التجاريين (مطاعم/خدمات الشريك) ضمن منشأة معيّنة. **مُقيّدة بباقة الشريك** (`marketplace`، PLATFORM فقط) — على الباقات الأقل، `GET /api/catalog` يُرجع فقط منتجات الشريك المُشغَّل من النادل نفسه (`kind:"alnadl"`) ويُخفي أي شريك تجاري آخر تلقائيًا دون الحاجة لأي منطق إضافي في الواجهة.

## 14) المحفظة والتدقيق (A01, A07)

### `GET /api/admin/portfolio` (SuperAdmin)
مقارنة GMV/الطلبات عبر كل الشركاء.
### `GET /api/audit?limit=100`
### `GET /api/admin/notifications?limit=100`
**⚠️ Q16 — Integration Pending، ليس خدمة إشعار عاملة**: يُرجع سجل أحداث فقط (`notifications` table) — لا SMS ولا Email ولا Push فعلي يصل لأي مستخدم حقيقي. راجع التعليق في `notify()` بـ`server.js` ونمط `lib/payment.js` (نقطة تمديد واحدة واضحة لمزوّد حقيقي لاحقًا).

---

## 15) المنافذ (Outlets) — Phase 4 §6

### `GET/POST /api/admin/outlets`
إدارة المنافذ (كوفي/مطعم/مخبز...) ضمن منشأة. **منفذ إضافي (بعد الأول) يتطلب باقة تشمل `multiOutlet`** (CONNECT أو PLATFORM) — 402 عدا ذلك؛ المنفذ الأول (المُرحَّل تلقائيًا من `merchants`) لا يخضع لهذا القيد أبدًا.
### `PATCH /api/admin/outlets/:id`
تفعيل/إيقاف أو تعديل حقول أساسية.

### `GET /api/service-hub/:token` — عام
النسخة الموسّعة من `GET /api/qr/:token` (نفس الشكل + حقلي `hub` و`outlets`/`outlet`):
- إن كان عدد المنافذ الفعّالة (بعد فلترة `outlet_availability` حسب المنطقة/النقطة/الوقت) ≤ 1، أو الباقة لا تشمل `multiOutlet`: `hub:false` مع `outlet` واحد — **تخطٍ كامل للشاشة**، مطابق تمامًا لمعيار القبول §20.16.
- إن كان العدد > 1 والباقة تشمل الميزة: `hub:true` مع مصفوفة `outlets`.

---

## 16) محرك نموذج الإيراد (Revenue Model Engine) — Phase 4 §9/§10

### `GET/POST /api/admin/revenue-models`
نموذج واحد نشط لكل Outlet، من 4 أنواع: `share` (نسبة من القاعدة المستحقة للشريك) · `commission` (نسبة يأخذها النادل) · `fixed` (رسم ثابت للنادل) · `hybrid` (عمولة + رسم ثابت معًا). منفذ بلا نموذج صريح يستخدم نموذج **عمولة ضمني** مبني تلقائيًا من `outlets.commission_rate` المُرحَّل من Phase 3 — لا حاجة لأي إعداد إضافي على المنافذ القائمة.

### `GET /api/admin/revenue-ledger?outletId=`
سجل كل معاملة موزَّعة. **كل سطر يحمل لقطة كاملة (`model_snapshot_json`) من النموذج وقت الكتابة** — تغيير النموذج لاحقًا لا يُعيد كتابة أي سطر قديم أبدًا. يُكتب مرة واحدة فقط عند نجاح الدفع (`POST /api/orders/:id/pay`)، ويُوزَّع تلقائيًا على كل منفذ ممثَّل في الطلب بما يتناسب مع حصته من المجموع الفرعي (بما في ذلك توزيع الخصومات بالتناسب).

---

## 17) السلة الموحّدة والطلبات الفرعية (Unified Cart / Child Orders) — Phase 4 §8/§13

طلب يمتد لأكثر من منفذ (فقط إن كانت الباقة تشمل `unifiedCart`) يُنشئ صفوف `child_orders` إضافية — **سلة بمنفذ واحد لا تُنشئ أي طلب فرعي إطلاقًا** وتبقى مطابقة 100% لسلوك ما قبل Phase 4.

### `POST /api/child-orders/:id/transition`
نظير `POST /api/orders/:id/transition` لكن على مستوى الطلب الفرعي — نفس آلة الحالة تمامًا. حالة الطلب الأصلي (Parent) **تُشتق تلقائيًا** من أبنائه (لا تُغيَّر مباشرة أبدًا): أقل حالة تقدّمًا بين الأبناء النشطين، وتصبح `Delivered` فقط عندما يكتمل الجميع، و`Cancelled` فقط إن أُلغي الجميع.

### `GET /api/ops/queue?stationId=`
يُرجع الطلبات أحادية المنفذ كما هي دائمًا، **بالإضافة** إلى تذكرة مستقلة لكل طلب فرعي نشط (بعلامة `isChild:true` واسم المنفذ) — قابلة للفلترة حسب المحطة.

---

## 18) العلامة التجارية (White Label) — Phase 4 §11/§12

### `GET/POST /api/admin/branding`
**تعديل الوضع أو النطاق المخصص إداري فقط (`SuperAdmin`)**، تطبيقًا لمبدأ §19 الأمني. **مُقيّد بباقة `whiteLabel`** (PLATFORM). يشمل نموذجًا تجاريًا منفصلاً تمامًا عن نموذج إيراد المنفذ (`fee_model`: `included`/`setup`/`monthly`/`annual`/`setup_recurring`).

يُطبَّق فقط على واجهة العميل (Platform Shell) عبر متغيرات CSS مُحدَّدة النطاق — **هوية أي Outlet (`branding_json`) مستقلة تمامًا ولا تتأثر أبدًا**. تخفيض باقة شريك لا يحذف إعداداته المحفوظة، بل يُرجع العرض تلقائيًا للعلامة الافتراضية حتى إعادة الترقية.

النطاق المخصص (`custom_domain`) بيانات تخزين فقط — التوجيه الفعلي (DNS/Reverse Proxy) بنية تحتية خارج نطاق الكود، موثّقة في `docs/DEPLOYMENT.md`.

---

## 19) رموز QR — التوليد الجماعي والتحليلات — Phase 4 §5

### `POST /api/admin/qr/bulk`
```json
{ "zoneId": "z_lobby", "type": "table", "count": 20, "labelPrefix": "Terrace Table" }
```
ينشئ حتى 50 نقطة+رمز QR بطلب واحد. الأنواع الخمسة: `table`, `office`, `room`, `zone`, `counter_pickup`.

### `GET /api/admin/qr/:pointId/analytics`
```json
{ "scans": 2, "orders": 1, "conversionRate": 50, "lastScan": 173..., "lastOrder": 173..., "totalSales": 25.3 }
```
محسوبة من سجل أحداث خام (`qr_analytics_events`) يُسجَّل عند كل مسح فعلي (`GET /api/qr/:token` أو `/api/service-hub/:token`) وكل طلب فعلي — وليس عدادًا مُخزَّنًا يمكن أن ينحرف عن الواقع.

---

## 20) الاسترجاعات (Refunds) — Q03

### `POST /api/orders/:id/refund`
الأدوار: `AlnadlFinance`, `SiteManager`, `SuperAdmin` فقط.
```json
{ "amount": 25.30, "reason": "Customer complaint", "idempotencyKey": "optional-client-generated-key" }
```
**قواعد الرفض الصارمة:**
- `400` إن غاب `reason` (إلزامي لسجل التدقيق) أو كان `amount` ≤ 0
- `409` إن كان المبلغ يتجاوز **الرصيد المتبقي القابل للاسترجاع فعليًا** (المدفوع − المُسترجَع سابقًا) — يمنع الاسترجاع المزدوج أو الزائد
- `409` إن كانت حالة الطلب ليست `Delivered`/`Partially Refunded`/`Cancelled`

**Idempotency:** إرسال نفس `idempotencyKey` مرتين يُرجع نفس النتيجة الأولى (`idempotent:true`) دون معالجة مزدوجة — مختلف عن استرجاعين جزئيين منفصلين شرعيين (بمفاتيح مختلفة أو بدونها).

**الأثر المالي:** عند النجاح، يُستدعى `recordRefundRevenue()` تلقائيًا فيُضاف سطر `refund_adjustment` سالب في `revenue_ledger` **يستثني ضريبة القيمة المضافة بشكل صحيح** (المبلغ يُحوَّل لمعادله قبل الضريبة قبل العكس) — لا يُعدَّل سطر البيع الأصلي أبدًا.

### `GET /api/orders/:id/refunds`
سجل كل استرجاعات هذا الطلب.

---

## 21) سياسة التسليم Grouped/Separate — Q01

### `PATCH /api/admin/properties/:id`
```json
{ "deliveryGrouping": "grouped" }  // أو "separate"
```
الافتراضي `grouped` لكل منشأة — يطابق حرفيًا السلوك القائم قبل هذه الميزة (Runner لا يرى الطلب إلا عند اكتمال كل منافذه). `separate` يجعل `GET /api/runner/queue` يُظهر تذكرة كل منفذ فور جاهزيته بمعزل عن البقية. راجع `docs/MULTI_OUTLET_SPEC.md`.

---

## ملاحظة حول آلة الحالة (State Machine)

جدول الانتقالات المسموحة والأدوار المخوّلة لكل انتقال موثّق بالكامل في `lib/statemachine.js` — هذا الملف هو "مصدر الحقيقة الوحيد" (Single Source of Truth) ولا يوجد أي منطق مكرر له في أي مكان آخر بالكود.

## 22) ALNADL Engage — Phase 5 P5-Inc-1

### `GET /api/engage/pass/:id` — عام
```json
{ "id": "ep_...", "status": "active", "expiresAt": 173..., "createdAt": 173... }
```
`404` إن لم يوجد. لا نقطة نهاية أخرى لـEngage في Inc-1 — إنشاء الـPass يحدث **حصريًا** عبر `lib/engage-worker.js` استجابةً لحدث `order.confirmed` حقيقي، وليس عبر أي API قابل للاستدعاء المباشر (لا من العميل ولا من الإدارة).

**آلية الربط `order.confirmed` (غير متزامنة بالكامل، ذرّية مع تأكيد الدفع):** عند نجاح الدفع، `server.js` يكتب صفًا واحدًا في `engage_outbox` **داخل نفس معاملة (Transaction) تحديث حالة الطلب** — إما يثبت الاثنان معًا أو لا يثبت أي منهما (جولة تصحيحية v2.0.5، Atomic Outbox Pattern). Worker مستقل (`startEngageWorker()`, استطلاع كل 5 ثوانٍ) يقرأ الصفوف المؤهَّلة، يتحقق من `engage_enabled` للشريك، وينشئ `engage_pass` فقط إن كانت الميزة مُفعَّلة. **إيقاف الـWorker بالكامل لا يُغيّر أي شيء في مسار الدفع/الطلب** — مُختبَر بشكل صريح (`ENG-ISO-001` في `tests/engage-inc1.js`).

**سياسة إعادة المحاولة (v2.0.5):** فشل عابر أثناء المعالجة (وليس `engage_enabled=false`، تلك ليست فشلاً) يُبقي الصف `pending` مع `next_attempt_at` بـBackoff أُسِّي (سقف 30 ثانية) حتى `max_attempts` (افتراضي 5)، ثم ينتقل لحالة `dead_letter` نهائية مع `last_error` وسجل تدقيق كامل.

## 23) ALNADL Engage — Phase 5 P5-Inc-2 (مُحدَّث — جولة تصحيحية أمنية)

**⚠️ تصحيح أمني (v2.0.7):** الإصدار الأول من هذا القسم كان يصف المصادقة بـ`passId`/`sessionId` — كان هذا خللاً أمنيًا حقيقيًا (IDOR)، أُصلح بالكامل. **كل التوثيق أدناه يصف السلوك الصحيح الحالي فقط.**

### `POST /api/engage/session/start`
```json
{ "accessToken": "yvqfLHvafktZe_qoZHX9dOfd2w5bacEu" }
```
عام (لا مصادقة موظفين — الـ`accessToken` نفسه **هو** التفويض الكامل، بنفس فلسفة رمز QR). **لا يُقبَل أي معرِّف داخلي (`passId`) كمُدخَل إطلاقًا.** يُرجع الجلسة القائمة لنفس الـPass إن وُجدت (بغض النظر عن حالتها — هذا مقصود، يمنع تجاوز RESET، راجع قسم "الجولة التصحيحية الأمنية" في `docs/PHASE5_GAP_ANALYSIS.md`)، وإلا يُنشئ جلسة جديدة بشخصية وسقف محسوبَين تلقائيًا، **ورمز وصول جديد خاص بالجلسة**:
```json
{ "id": "es_...", "sessionToken": "AbCd3F...", "personality": "SPARK", "ceilingMax": 3, "ceilingUsed": 0, "status": "running" }
```
`403` (وليس `404`) إن كان الرمز غير معروف — هذا مقصود: `404` كانت ستُتيح لمهاجم تمييز "رمز خاطئ الصياغة" عن "رمز صحيح الصياغة لكن غير موجود"، بينما `403` مُوحَّدة لا تكشف شيئًا. `409` إن كان الـPass غير نشط/منتهي الصلاحية.

### `POST /api/engage/session/:sessionToken/next-moment`
**المعامل في المسار هو `sessionToken` (رمز الوصول الخاص بالجلسة الذي أُعيد من `session/start`)، وليس `id` داخليًا.** يُقدِّم اللحظة التالية من المحتوى الثابت المُعتمَد (`source:"approved_fallback"`) لشخصية الجلسة، ويزيد عدّاد `ceiling_moments_used`. **`409` مع `ceilingReached:true`** إن بلغت الجلسة سقفها. الجلسة تنتهي تلقائيًا (`status:'ended'`) فور بلوغ السقف بهذا الاستدعاء نفسه. `403` لأي رمز لا يُطابق جلسة حقيقية — بما في ذلك تمرير رمز Pass بالخطأ في موضع رمز Session (الرمزان من فئتين مختلفتين تمامًا، لا تطابق بينهما أبدًا).
```json
{ "momentId": "mo_...", "payload": {...}, "ceilingUsed": 2, "ceilingMax": 3, "sessionEnded": false }
```

### `POST /api/engage/session/:sessionToken/end`
إنهاء صريح، Idempotent (استدعاؤه على جلسة منتهية بالفعل لا يُنتج خطأً).

### `GET /api/engage/pass/:accessToken`
مُحدَّث ليُعنوِن بالرمز أيضًا (كان بالمعرِّف الداخلي في الإصدار الأول) — نفس مبدأ الأمان المُوحَّد عبر كل نقاط Engage.

### `POST /api/admin/engage/policy-overrides` — إداري، RBAC مُطبَّق (مُوسَّع في Inc-4)
`SuperAdmin` أو `PartnerAdmin` فقط. `PartnerAdmin` يُمنَع صراحة من أي Override يخص شريكًا آخر على أي من المستويات الثلاثة (partner/property/zone). **شكلان مدعومان بنفس نقطة النهاية**:
```json
// Engagement Ceiling (Inc-2):
{ "scopeType": "zone", "scopeId": "z_pool", "personality": "PLAY", "max": 2 }
// Novelty (Inc-4، جديد) — نفس آلية الأولوية الهرمية بالضبط:
{ "scopeType": "partner", "scopeId": "pt_nova", "policyKey": "novelty_threshold", "value": 0.3 }
```
`policyKey` المسموحة: `novelty_window_days` (نافذة الذاكرة بالأيام، **عدد صحيح بين 1 و90 شاملة**)، `novelty_threshold` (عتبة تشابه Jaccard، **بين 0 و1 شاملة**). **`HTTP 400` صريح لأي قيمة خارج هذه الحدود** — لا تُقبَل ثم تُقلَّم بصمت لاحقًا.

### `GET /api/admin/engage/policy-overrides` — إداري، RBAC مُطبَّق
نفس الحماية؛ `PartnerAdmin` يرى فقط ما يخص شركته.

### `POST /api/engage/session/:sessionToken/moment/:momentId/respond` — Phase 5 P5-Inc-3
```json
{ "action": "completed", "idempotencyKey": "optional-client-generated-key" }
```
`action` يجب أن تكون `completed` أو `skipped` (`400` لأي قيمة أخرى). **فحص ملكية صريح**: اللحظة يجب أن تخص الجلسة المُخوَّلة بالضبط عبر `sessionToken` — محاولة الرد على لحظة تخص جلسة أخرى (حتى بتوكن جلسة صحيح آخر) تُرفَض بـ`403`. `idempotencyKey` اختياري يمنع تكرار التسجيل عند إعادة الإرسال — نفس نمط `POST /api/orders/:id/refund` تمامًا.

### `GET /api/admin/engage/ledger` — `SuperAdmin` فقط
السجل الكامل: كل لحظة، بالـPayload الحرفي، الشخصية، الآلية، `selection_reason`، والنتيجة الفعلية إن وُجدت. يدعم `?partnerId=` للتصفية (لراحة SuperAdmin عند التحقيق في شريك محدد، وليس إلزاميًا).

### `GET /api/admin/engage/overview` — `SuperAdmin` فقط
إحصاءات مُجمَّعة: `eligible`/`offered`/`started`/`completed`، توزيع الشخصيات، ودورة حياة الآليات.

### `GET /api/partner/engage/overview` — `PartnerAdmin`/`PartnerViewer`
**⚠️ عزل خصوصية صارم مُطبَّق بنيويًا وليس بفلترة لاحقة**: يُرجع إحصاءات مُجمَّعة لشريك واحد فقط (`offered`/`completed`/توزيع الشخصيات) — **لا Payload، لا اسم آلية، لا `selection_reason`، لا أي تفاصيل داخلية** — الدالة نفسها (`lib/engage-ledger.js`) لا تستعلم هذه الأعمدة إطلاقًا لهذا المسار، وليس فقط تُخفيها.

## ملاحظة حول Idempotency وWebhooks (Q03، §18)
- `POST /api/orders/:id/pay` idempotent فعليًا: استدعاء مُكرَّر بعد نجاح أول استدعاء يُرجع `{ idempotent: true }` دون تكرار التحصيل
- `POST /api/orders/:id/refund` idempotent عبر `idempotencyKey` اختياري (راجع القسم 20)
- `verifyWebhook()` في `lib/payment.js` نقطة تكامل جاهزة — أي Adapter حقيقي **يجب** أن يُنفِّذ التحقق الفعلي من توقيع HMAC هنا قبل أي إنتاج (راجع `docs/GAP_REGISTER.md` بند Q05)
