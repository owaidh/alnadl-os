> **Version:** v2.0.0 · **Status:** LIVING DOCUMENT — superseded by `docs/GAP_REGISTER.md` for Q01-Q20 closure tracking; kept for the original Phase 4 Increment 1-4 traceability matrix · **Last Updated:** 2026-08-12 · **Release Tag:** v2.0.0-final-quality-closure

# Alnadl Hospitality OS — Phase 4 Gap Analysis & Technical Design
### (المطلوب من المبرمج قبل بدء التنفيذ — §22 من وثيقة Phase 4 Change Request v2)

**الحالة:** مسودة أولى للمراجعة قبل بدء أي تعديل على الكود، طبقًا لتعليمات §22 الصريحة في الوثيقة. لم يُلمس أي كود إنتاجي بعد.

---

## 1. Gap Analysis — Existing vs Required

| Change Matrix Item (§3) | الحالة الفعلية اليوم | Gap |
|---|---|---|
| Partner Packages (OPERATE/SMART/**CONNECT**/PLATFORM) | 3 باقات فقط (OPERATE/SMART/PLATFORM)، بدون CONNECT، مزايا محدودة (`qrOrdering`, `digitalPayment`, `partnerDashboard`, `loyalty`, `marketplace`, `analytics`, `corporateWallet`) | **NEW**: إضافة باقة CONNECT + مزايا جديدة (`multiOutlet`, `unifiedCart`, `restaurantIntegration`, `whiteLabel`, `multiProperty`) + دعم Override تعاقدي لكل شريك بمعزل عن باقته |
| Outlet Entity | **غير موجود** — المنتجات مرتبطة بـ`merchant_id` (جدول `merchants`) الذي بُني في الجولة السابقة لتغطية "شريك تجاري واحد إضافي"، لكنه لا يحمل حقول Outlet المطلوبة (Operating Hours, Fulfillment Station, SLA, Branding, Revenue Model) | **NEW جوهري** — يحتاج جدول `outlets` كامل؛ `merchants` الحالي يُهاجَر إليه وليس بديلاً عنه (راجع §4 أدناه) |
| Service Hub | **غير موجود** — العميل يدخل مباشرة لقائمة مجمّعة بصريًا حسب `merchant_id` | **NEW** — شاشة عميل جديدة + منطق "outlet واحد = تخطّي الشاشة" |
| Multi-Outlet Routing (KDS) | KDS الحالي يعرض كل الطلبات لكل property بدون تمييز محطة | **EXTEND جوهري** — يحتاج `station_id` على مستوى Outlet + فلترة KDS حسب صلاحية المشغّل |
| Unified Cart + Parent/Child Orders | **غير موجود** — سلة واحدة تنشئ طلبًا واحدًا (`orders` مفرد) | **NEW جوهري** — أكبر تغيير بنيوي في هذه الوثيقة، يمس `orders`, `order_items`, حالة الطلب، الدفع، الإشعارات |
| Revenue Model Engine (Share/Commission/Fixed/Hybrid لكل Outlet) | يوجد محرك تسوية واحد فقط على مستوى **الشريك** (`lib/settlement.js`) بنسبة `share_rate` واحدة | **NEW جوهري** — يحتاج تعميم النموذج ليعمل لكل Outlet وليس لكل شريك فقط، مع 4 أنواع حساب مختلفة |
| Revenue Allocation Ledger | **غير موجود** — التسوية الحالية تُحسب مباشرة من `orders.total` وقت الطلب | **NEW** — يحتاج جدول Ledger منفصل يُسجَّل عند كل معاملة، لا يُحتسب لاحقًا (لضمان Snapshot ثابت، §10) |
| White Label Engine | **غير موجود إطلاقًا** — لا حقول Branding على مستوى partner/property | **NEW كامل** |
| QR Types + Bulk + Analytics | يوجد نوع QR واحد ضمني (`points`/`qr_tokens`)، بدون `type`, بدون توليد جماعي، بدون تتبع Scans/Conversion | **EXTEND** |
| Settlement بمستوى Outlet | التسوية الحالية على مستوى partner فقط | **EXTEND جوهري** |
| KEEP وحدات (Customer flow أساسي، QR resolve، KDS/Runner الأساسي، Partner Dashboard، Settlement Center workflow، Audit Log، A05 Users) | **موجودة ومُختبرة فعليًا** من الجولات السابقة | لا تغيير جوهري — تُوسَّع فقط لدعم Outlet Context بدل الافتراض بمنشأة واحدة |

### خلاصة الفجوة
هذه ليست "إضافة شاشات" — إنها **إعادة تعريف الوحدة الأساسية للنظام** من "Property تخدم قائمة واحدة" إلى "Property تحتوي عدة Outlets مستقلة، كل واحد بمحطة ودفع محاسبي وهوية بصرية خاصة به". كل مسار (طلب، دفع، KDS، تسوية) يمر عبر هذا التغيير.

---

## 2. Existing / Modify / New — لكل تغيير (§22 بند 2)

| # | العنصر | القرار |
|---|---|---|
| 1 | `merchants` table | **Modify → يُدمج ضمن `outlets`** (Migration، ليس حذفًا — راجع §4) |
| 2 | `products.merchant_id` | **Modify → يصبح `products.outlet_id`** |
| 3 | `orders` (طلب مفرد) | **Modify جوهري → يصبح `orders` (Parent) + `child_orders` (جديد)** |
| 4 | `lib/statemachine.js` | **Extend** — نفس آلة الحالة تُطبَّق على `child_orders`، و`orders` (Parent) تشتق حالتها من تجميع حالات الأبناء (§13) |
| 5 | `lib/settlement.js` | **Extend جوهري → محرك Revenue Model عام (`lib/revenue-engine.js` جديد)** يحل محله لحساب Outlet، والقديم يبقى للتوافق مستوى partner |
| 6 | `lib/plan.js` | **Modify** — إضافة CONNECT + مزايا جديدة |
| 7 | KDS queue endpoint | **Modify** — فلترة حسب `station_id` |
| 8 | Customer QR resolve → Menu | **Modify** — يمر عبر Service Hub الجديد كخطوة وسيطة شرطية |
| 9 | Admin catalog/zones screens | **Extend** — إضافة Outlet Manager, Revenue Model config, Branding config |
| 10 | Audit log | **Extend** — تسجيل صريح لتغييرات Revenue Model/Branding (موجود البناء العام، يحتاج فقط ربط أحداث جديدة) |

---

## 3. Technical Design — مختصر (§22 بند 3)

### 3.1 Outlet Architecture
```
properties (1) ──< outlets (1) ──< products
                       │
                       ├── operator: 'alnadl' | 'partner' | 'third_party'
                       ├── branding_json: { name, logo, theme, favicon }
                       ├── operating_hours_json
                       ├── station_id
                       ├── delivery_mode: 'runner' | 'pickup' | 'room' | 'office'
                       ├── sla_prep_min / sla_delivery_min
                       └── revenue_model_id → revenue_models
```
`merchants` (القائم) يُهاجَر بحقوله الحالية (`name_ar/en`, `kind`, `commission_rate`) كسطر أولي في `outlets`، مع تعبئة الحقول الجديدة بقيم افتراضية آمنة (Operating Hours = 24/7، SLA = القيم الافتراضية الحالية للمنشأة).

### 3.2 Service Hub
```
GET /api/service-hub/:token
  → إن كان عدد الـ Outlets النشطة لهذه النقطة/الوقت = 1: يُرجع نفس استجابة /api/qr/:token الحالية + outletId مباشرة (§20 بند 16، تخطّي الشاشة)
  → إن كان > 1: يُرجع قائمة Outlets (name/logo/theme/ETA/status) لعرض بطاقات الاختيار
```
هذا يحافظ على توافق العميل الحالي — النظام القائم اليوم لديه Outlet واحد فعليًا في أغلب السيناريوهات المزروعة، فلن يظهر Service Hub إلا عند تفعيل أكثر من Outlet فعليًا (مطابق تمامًا لمعيار القبول §20 بند 16).

### 3.3 Unified Cart + Parent/Child Orders
```
orders (Parent)                      child_orders (جديد)
  id, payment_ref, total,              id, parent_order_id, outlet_id,
  status (مُشتقة),                     status (آلة الحالة القائمة كما هي),
  customer_*, point_id                 subtotal, station_id
                                        │
                                        └──< order_items (كما هي، + outlet_id ثابت لكل سطر عبر child_order)
```
- **حالة الـ Parent** تُشتق (لا تُخزَّن مستقلة بمعزل عن الأبناء) وفق قاعدة بسيطة: أقل حالة تقدّمًا بين الأبناء (طلب لا يُعتبر "Ready" إلا حين يكون كل الأبناء Ready) — قابلة للتهيئة لاحقًا كسياسة موقع (Strict vs Independent) إن احتاج النادل ذلك، لكن الافتراضي المطلوب في المعيار §20 بند 17 هو الانعكاس المباشر.
- الدفع يبقى **عملية واحدة على مستوى Parent** (طلب دفع واحد، مبلغ واحد) — يتوافق مع "Checkout واحد" في §8، بينما التوزيع المالي يحدث داخليًا بعد النجاح عبر Revenue Allocation Engine.
- الإلغاء/الاسترجاع الجزئي (§8 "Partial Cancel/Refund") يعمل على مستوى `child_order` أو حتى `order_item` مفرد — يتطلب توسيع `lib/statemachine.js` بحالة `Partially Refunded` على مستوى الـParent.

### 3.4 Revenue Model Engine (`lib/revenue-engine.js` — جديد)
يستبدل `computeSettlement` الحالي لحسابات مستوى Outlet، مع الحفاظ عليه كما هو لأي شريك على باقة أقل من CONNECT (توافق خلفي):
```js
computeOutletRevenue(outletId, period) {
  // model = outlet.revenue_model (Share|Commission|Fixed|Hybrid)
  // base = calcBase(model.calculationBase, grossSales, discounts, refunds)
  // partnerAmount / alnadlAmount حسب النوع
  // → يُحفظ كسطر Ledger واحد لكل معاملة وقت وقوعها، وليس عند الطلب لاحقًا
}
```
**نقطة حرجة (§9، §10):** يجب حساب واعتماد التوزيع المالي **وقت نجاح الدفع**، وحفظ Snapshot كامل لإعدادات الـRevenue Model المستخدمة داخل سطر الـLedger نفسه — تمامًا كما طُبِّق مبدأ "لا تُعاد كتابة التسويات السابقة عند تغيير النسبة" في محرك التسوية الحالي (`lib/settlement.js`) خلال الجولة السابقة؛ نفس المبدأ يُعمَّم هنا فقط على مستوى كل معاملة بدل كل تسوية شهرية.

### 3.5 White Label Engine
```
partner_branding (جديد): partner_id, mode ('alnadl'|'co_branded'|'full_white_label'),
  logo_url, theme_json, favicon_url, welcome_text, show_powered_by, custom_domain
```
الواجهة الأمامية تقرأ `mode` من استجابة الـ QR/Service Hub وتُطبّق الهوية على مستوى **Platform Shell** فقط — أما هوية الـOutlet (`outlets.branding_json`) فتبقى مستقلة تمامًا ولا تُطغى عليها أبدًا (§11 "Platform Branding منفصل عن Outlet Branding"، ومعيار القبول §20 بند 22). Custom domain يتطلب طبقة توجيه (reverse proxy routing per Host header) خارج نطاق كود التطبيق نفسه — يُوثَّق كمتطلب بنية تحتية في `docs/DEPLOYMENT.md` وليس Feature في الكود.

---

## 4. Database Migration Plan (§16، §22 بند 4)

**السياسة:** كل Migration بخطوتين — `ADD` أولاً (أعمدة/جداول جديدة تقبل NULL أو بقيم افتراضية)، ثم `BACKFILL` (تعبئة بيانات القائم)، ثم فقط بعد التحقق يُفعَّل أي قيد `NOT NULL`. لا `DROP` لأي عمود أو جدول قائم في هذه المرحلة.

| الخطوة | الوصف | Rollback |
|---|---|---|
| 1 | نسخة احتياطية كاملة لـ `data.sqlite` (أو DB الإنتاج الفعلي إن تمت الترقية لـ PostgreSQL وفق `docs/DEPLOYMENT.md`) | استعادة الملف مباشرة |
| 2 | إنشاء `outlets`, `child_orders`, `revenue_models`, `revenue_ledger`, `partner_branding`, `qr_analytics` (جداول جديدة فقط، لا تعديل على القائم) | `DROP TABLE` للجداول الجديدة فقط — لا أثر على القائم |
| 3 | Backfill: لكل `property` قائمة → إنشاء `outlet` افتراضي واحد يحمل بيانات `merchants` الحالية إن وُجدت، وإلا بيانات افتراضية من الـproperty نفسها | حذف الصفوف المُنشأة تلقائيًا (معرَّفة بعلامة `migrated:true`) |
| 4 | `ALTER TABLE products ADD COLUMN outlet_id` (nullable) → تعبئته من `merchant_id` الحالي عبر جدول تحويل، **مع الإبقاء على `merchant_id` كما هو دون حذف** لضمان عدم كسر أي استعلام قائم فورًا | إبقاء `outlet_id` فارغًا لا يكسر شيئًا لأن الكود القديم لا يعرف عنه |
| 5 | `ALTER TABLE orders` — إضافة `is_parent` (افتراضي true لكل الطلبات القائمة، كل طلب قديم يُعامَل كـParent بابن واحد ضمني) — **لا حاجة لإنشاء صفوف `child_orders` فعلية للطلبات التاريخية**؛ منطق القراءة يتعامل مع "طلب بلا أبناء = طلب مفرد قديم" مباشرة، تفاديًا لإعادة كتابة آلاف السجلات التاريخية | — |
| 6 | تفعيل الكود الجديد خلف Feature Flag (`multiOutlet`) لكل شريك — **الشركاء القائمون يبقون بسلوكهم الحالي 100% حتى تفعيل الباقة يدويًا** | تعطيل الـFlag يُعيد السلوك القديم فورًا دون لمس البيانات |

هذا يحقق مباشرة §17 (Backward Compatibility) بندًا بندًا: Default Package/Outlet/Product linkage/QR صالح/لا إعادة احتساب تاريخي/Single-Outlet flow دون خطوات إضافية.

---

## 5. API Impact List (§22 بند 5)

**Endpoints جديدة بالكامل:**
`GET /api/service-hub/:token` · `GET/POST /api/admin/outlets` · `PATCH /api/admin/outlets/:id` · `GET/POST /api/admin/revenue-models` · `GET /api/admin/revenue-ledger` · `GET/POST /api/admin/branding` · `POST /api/admin/qr/bulk` · `GET /api/admin/qr/:id/analytics`

**Endpoints قائمة تحتاج تعديل غير كاسر (Additive فقط، لا Breaking Changes):**
`POST /api/orders` (يقبل حقلاً اختياريًا `outlets: [...]` بدل افتراض outlet واحد ضمني؛ الشكل القديم يبقى صالحًا ويُعامَل كسلة outlet واحد) · `GET /api/orders/:id` (يُرجع `childOrders: []` إضافية إن وُجدت) · `GET /api/ops/queue` (فلترة اختيارية بـ`stationId`) · `GET /api/catalog` (يُرجع `outlets` بدل `merchants` مع الإبقاء على `merchants` كـalias للتوافق مؤقتًا) · `GET /api/settlement*` (يقبل `outletId` اختياريًا)

---

## 6. UI Screens to Modify/Add (§22 بند 6)

**جديدة:** C-ServiceHub (عميل) · A-OutletManager · A-RevenueModelConfig · A-BrandingConfig · A-QRBulkGenerate+Analytics
**تُعدَّل:** C02 Menu (وسم كل منتج بـOutlet عند تعدد المنافذ) · O01 KDS (فلترة Station) · P01/Partner Dashboard (تفصيل حسب Outlet) · A06 Settlement Center (تفصيل حسب Outlet) · Checkout (دفعة واحدة، لا تغيير مرئي يُذكر)

---

## 7. Effort Estimate (§22 بند 7) — بالأيام، لفريق مطوّر واحد متفرغ

| الوحدة | الأيام | ملاحظة |
|---|---|---|
| Migration Plan + تنفيذه + اختبار Rollback | 2 | حرج — يُنفَّذ ويُختبَر أولاً قبل أي شيء آخر |
| Outlet Entity (DB + API + Admin screen) | 3 | يتضمن Backfill الفعلي |
| Service Hub (Backend + Frontend) | 2 | |
| Multi-Outlet KDS Routing | 2 | |
| Unified Cart + Parent/Child Orders (الأكبر) | 6–7 | يمس آلة الحالة، الدفع، الإشعارات، التتبع |
| Revenue Model Engine (4 أنواع + Snapshot) | 4 | |
| Revenue Allocation Ledger + Settlement بمستوى Outlet | 3 | |
| White Label Engine (بدون custom domain routing) | 3 | |
| QR Types + Bulk + Analytics | 2 | |
| CONNECT Package + Feature Flags الجديدة | 1 | سريع لأن `lib/plan.js` مبني مسبقًا بنفس النمط |
| Partner Dashboard/Admin extensions (عرض فقط) | 2 | |
| Test Scenarios (§21) كاملة + Regression لـ Phase 1-3 | 3 | |
| توثيق §26 الكامل (20 ملفًا + Traceability Matrix) | 3–4 | يُحدَّث تدريجيًا مع كل وحدة، وليس دفعة واحدة في النهاية |
| **الإجمالي التقديري** | **≈ 36–40 يوم عمل** | لمطوّر واحد متفرغ؛ يمكن تقليصه بالتوازي إن توفّر أكثر من مطوّر على الوحدات المستقلة (مثال: White Label وQR Analytics لا تعتمدان على Unified Cart) |

**ملاحظة منهجية مهمة:** هذا رقم هندسي واقعي لعمل حقيقي — وليس رقمًا يمكن ضغطه بادّعاء الإنجاز. في هذه البيئة (محادثة مع Claude) سأواصل البناء تدريجيًا عبر جلسات متتالية كما جرى في المراحل السابقة، مع اختبار فعلي (curl + متصفح حقيقي) لكل وحدة قبل الانتقال للتالية — بنفس المنهجية التي كشفت واحدًا حقيقيًا في الجولة السابقة (خطأ حالة الدفع في شاشة الدفع).

---

## 8. Dependencies & Risks (§22 بند 8)

| الخطر | الأثر | التخفيف |
|---|---|---|
| Unified Cart يمس آلة الحالة القائمة والمُختبرة بدقة | قد يكسر KDS/Runner الحاليين إن لم يُعزَل جيدًا | بناء `child_orders` كطبقة إضافية فوق نفس آلة الحالة القائمة، وليس استبدالها (راجع §3.3) |
| Revenue Engine الجديد يتعايش مع `lib/settlement.js` القديم | احتمال ازدواجية منطق أو تضارب أرقام بين الاثنين | القديم يبقى **حصريًا** لحساب مستوى partner (شركاء ما قبل CONNECT)، الجديد حصريًا لمستوى Outlet — لا تداخل، ويُوثَّق الفرق بوضوح في `docs/DATABASE_SCHEMA.md` المحدَّث |
| SQLite الحالي وقيود الكتابة المتزامنة | Revenue Ledger يزيد الكتابة كثيرًا (سطر لكل معاملة لكل Outlet) | يُعاد التذكير بتوصية `docs/DEPLOYMENT.md` القائمة: الانتقال لـPostgreSQL قبل أي حمل إنتاجي فعلي، أكثر إلحاحًا الآن |
| Custom Domain (White Label) | خارج نطاق كود التطبيق، يتطلب DNS/Reverse Proxy فعليين | يُوثَّق كمتطلب بنية تحتية منفصل، لا يُبنى كودًا وهميًا له |
| حجم التوثيق المطلوب في §26 (20 ملفًا) | عمل توثيقي ضخم موازٍ للبرمجة | يُحدَّث كل ملف تدريجيًا فور اكتمال الوحدة المرتبطة به، لا يُؤجَّل لنهاية المشروع (يطابق مبدأ الوثيقة نفسها في §26.4: لا تنفصل الوثائق عن النظام) |

---

## 8ب. تصحيحات وإضافات بعد مراجعة ثانية دقيقة — فجوات لم تُغطَّ في المسودة الأولى

### QR Distribution — تفصيل كامل (§5)
المسودة الأولى اختصرت هذا لسطر "EXTEND" عام. التفصيل الفعلي المطلوب:

| العنصر | الفجوة الفعلية | التصميم |
|---|---|---|
| 5 أنواع QR (Table/Office/Room/Zone/Counter-Pickup) | `qr_tokens` الحالي بلا حقل `type` إطلاقًا | `ALTER TABLE qr_tokens ADD COLUMN type` |
| Bulk Generate/Print حسب Zone | غير موجود — كل QR يُنشأ فرديًا مع Point واحد | `POST /api/admin/qr/bulk {zoneId, count, type}` جديد |
| Activate/Suspend/Reassign + Audit | `active` boolean فقط، بلا سجل تدقيق مخصص لهذا الإجراء | يُستخدم `audit_log` القائم فعليًا (لا حاجة لجدول جديد) — يكفي حدث `qr_reassign`/`qr_suspend` مُسجَّل عبر `audit()` الموجودة |
| Dynamic mapping (لا إعادة طباعة عند تغيير القائمة) | **موجود فعليًا بالفعل** — `qr_tokens.token` مرتبط بـ`point_id` فقط وليس بمحتوى القائمة، فالتصميم الحالي يحقق هذا المتطلب دون أي تعديل | ✅ لا فجوة هنا فعليًا |
| Scans/Last Order/Conversion/Sales لكل QR | **غير موجود إطلاقًا** — لا تسجيل لعمليات المسح نفسها، فقط الطلبات الناتجة | جدول جديد `qr_analytics_events (token, event_type: 'scan'|'order', ts)` + endpoint تجميع |
| **Zone/Point ↔ Outlet + وقت الخدمة** | **تصحيح جوهري عن المسودة الأولى**: كنت افترضت حقل `available_zones` مسطّح على `outlets`. هذا خطأ — العلاقة الفعلية many-to-many **مع بُعد زمني** (Outlet قد يتوفر في نفس المنطقة لكن بأوقات مختلفة) | جدول ربط مستقل: `outlet_availability (outlet_id, zone_id?, point_id?, day_of_week, time_from, time_to)` — يُستعلَم عند كل Service Hub request لتحديد المنافذ الفعّالة **الآن** وليس فقط "المرتبطة" |

### White Label Commercial Configuration — كانت غائبة كليًا (§12)
جدول `partner_branding` (المذكور في §3.5 من هذه الوثيقة) يحتاج حقولاً إضافية لم تُذكر سابقًا:
```
partner_branding: ... + fee_model ('included'|'setup'|'monthly'|'annual'|'setup_recurring'),
                        setup_fee_amount, recurring_fee_amount, recurring_cycle
```
هذه الرسوم **منفصلة تمامًا** عن Revenue Model الخاص بالـOutlet — تُحسب وتُسوَّى بشكل مستقل، ويجب أن تظهر كسطر منفصل في Settlement Statement (وليس مدمجة ضمن حساب الإيراد التشغيلي)، تحقيقًا لنص §12 "يمكن أن تعمل بالتوازي مع Commission أو Revenue Share".

### Security & Permissions — لم تُفرَد كبند مستقل في المسودة الأولى (§19)
| المتطلب | الحالة اليوم | الفجوة |
|---|---|---|
| صلاحية منفصلة لتعديل Revenue Models | غير موجودة — لا دور مخصص لهذا | إضافة تحقق صريح: تعديل `revenue_models` يتطلب دورًا لا يكفي فيه `PartnerAdmin` وحده (يقترح: `SuperAdmin` أو دور مالي جديد `FinanceAdmin` يمايز عن `AlnadlFinance` الحالي الذي يعتمد التسويات فقط) |
| صلاحية منفصلة لاعتماد Settlements | **موجودة فعليًا** — `AlnadlFinance`/`SuperAdmin` فقط يعتمدان عبر سير الحالات القائم | ✅ لا فجوة |
| White Label/Domain — Admin-only | غير موجود (الميزة نفسها غير موجودة) | يُبنى من الأساس ضمن نفس نمط الصلاحيات القائم (`requireRole(['SuperAdmin'])`) |
| Audit Before/After لكل Rate/Fee/Calculation Base change | **البنية موجودة وتعمل فعليًا** (`audit()` تسجّل `before`/`after` لكل تغيير حساس، كما طُبِّق فعليًا على تغيير الباقات والتسويات) | ✅ لا حاجة لبنية جديدة — فقط ربط أحداث Revenue Model الجديدة بنفس الدالة القائمة |
| عدم تخزين بيانات البطاقة | **مُطبَّق فعليًا** — `lib/payment.js` لا يخزّن أي بيانات بطاقة، فقط `gateway_ref` | ✅ لا فجوة |

### Partner Dashboard & Alnadl Admin — القوائم التفصيلية المفقودة (§14/§15)
المسودة الأولى قالت "Extend" بلا تعداد. القائمة الفعلية المطلوبة على لوحة الشريك: Package & Enabled Features · QR Distribution (Zones/Points/Active QR) · Scans/Conversion/Sales per QR · Outlet Performance (مقارنة) · Orders/AOV/Revenue per Outlet · **Cross-Outlet Basket Rate** (نسبة السلال التي تحتوي منتجات من أكثر من Outlet — مؤشر جديد كليًا يعتمد على وجود Unified Cart أولاً) · Revenue Model لكل Outlet · Partner Amount/Alnadl Amount · Settlement Statements per Outlet/period · SLA/Rating per Outlet. وعلى لوحة إدارة النادل إضافيًا: **Zone-to-Outlet Availability** و**Menu-to-Outlet mapping** كشاشتين إداريتين منفصلتين (وليس ضمنيًا داخل شاشة Outlet Manager كما افترضت المسودة الأولى) — لأن ربط القائمة بالمنفذ عملية متكررة يحتاجها فريق التشغيل يوميًا وتستحق شاشة مخصصة سريعة.

### KDS — سياسة Grouped مقابل Separate Delivery (فاتت من §13)
لم تُذكر في المسودة الأولى: عند نفس نقطة التسليم (Point) وطلب يحتوي أبناء من أكثر من Outlet، يحتاج الموقع إعدادًا (`property.delivery_grouping: 'grouped'|'separate'`) يحدد هل ينتظر Runner اكتمال كل الأبناء ليسلّمهم دفعة واحدة (Grouped) أم يسلّم كل Child Order فور جهوزيته بمعزل عن البقية (Separate). هذا يؤثر مباشرة على منطق `runner/queue` الذي بُني سابقًا لطلب مفرد فقط.

## 8ج. الالتزامات التوثيقية في §26 — لم تُعالَج في المسودة الأولى، هذا هيكلها الفعلي

### نظام Requirement ID (مطلوب لـ§26.3 Traceability Matrix)
يُقترح الترميز: `P4-<AREA>-<NUM>` مطابقًا لأمثلة الوثيقة نفسها (`P4-OUT-01`, `P4-REV-01`, `P4-WL-01`). المجالات: `OUT` (Outlet) · `HUB` (Service Hub) · `CART` (Unified Cart) · `REV` (Revenue Engine) · `WL` (White Label) · `QR` (QR/Site Mapping) · `PKG` (Packages/Flags) · `SEC` (Security).

### Traceability Matrix — Increments 1-4 + QR Bulk/Analytics (منفَّذة ومُختبَرة فعليًا)
أول سطور فعلية في هذا النظام، بأدلة اختبار حقيقية وليست افتراضية:

| Requirement ID | المتطلب | UI/Screen | API/Service | DB Entity | Test Evidence | الحالة |
|---|---|---|---|---|---|---|
| P4-OUT-01 | إنشاء Outlet مستقل لكل منفذ | A-OutletManager | `POST /api/admin/outlets` | `outlets` | اختُبر عبر متصفح حقيقي: إنشاء "مخبز الفجر" فعليًا وظهوره في القائمة فورًا (لقطة شاشة) | **Pass** |
| P4-OUT-02 | Migration: كل Property قائم يحصل Default Outlet | — (تلقائي عند الإقلاع) | `migratePhase4Outlets()` في `db.js` | `outlets`, `products.outlet_id` | اختُبر: DB جديدة → Hotel Nova حصل على منفذين من `merchants` الحالية بنفس النسب، Al-Rowad (بلا merchants) حصل منفذًا افتراضيًا | **Pass** |
| P4-OUT-03 | Migration idempotent (لا تكرار عند إعادة التشغيل) | — | نفس الدالة أعلاه | `outlets` | اختُبر: استدعاء الدالة مرتين → العدد ثابت (3 وليس 6) | **Pass** |
| P4-PKG-01 | باقة CONNECT جديدة بمزايا Multi-Outlet | A-TenantsPlans | `GET /api/plans` | `plans` | اختُبر: 4 باقات تُرجَع (OPERATE/SMART/**CONNECT**/PLATFORM) | **Pass** |
| P4-PKG-02 | حظر إنشاء Outlet إضافي بدون مزايا الباقة | A-OutletManager | `POST /api/admin/outlets` (feature gate) | `subscriptions.features_json` | اختُبر: تخفيض Hotel Nova لباقة SMART → محاولة إضافة منفذ ثالث تُرفض 402، والمنفذان المُرحَّلان يبقيان سليمين وقابلين للقراءة | **Pass** |
| P4-HUB-01 | Service Hub تظهر فقط عند تعدد المنافذ الفعلي | scrHub() — واجهة عميل كاملة | `GET /api/service-hub/:token` | `outlets`, `outlet_availability` | اختُبر عبر متصفح حقيقي: Hotel Nova (منفذان، PLATFORM) → بطاقات اختيار فعلية (لقطة شاشة)؛ Al-Rowad (منفذ واحد) → صفر بطاقات، تخطٍ تلقائي لشاشة "ابدأ الطلب" (لقطة شاشة) | **Pass** |
| P4-HUB-02 | Zone/Point↔Outlet مع بُعد زمني | — | `GET /api/service-hub/:token` | `outlet_availability` | مبني ومُختبَر منطقيًا (فلترة day_of_week/time_from/time_to)؛ **لا يوجد بعد سيناريو اختبار بوقت فعلي مضبوط** | **Partial** |
| P4-SEC-01 | Regression: النظام القائم لا يتأثر إطلاقًا | كل الشاشات القائمة | `GET /api/qr/:token` (بلا تغيير) | — | اختُبر عبر أكثر من 10 دورات Regression متتالية عبر كل زيادات Phase 4 — **صفر أخطاء في كل مرة** | **Pass** |
| P4-CART-01 | سلة موحّدة عبر أكثر من منفذ | scrHub + زر "منافذ أخرى" في القائمة | `POST /api/orders` (فرز outlet_id تلقائي) | `child_orders`, `order_items.outlet_id` | اختُبر عبر متصفح حقيقي كامل: اختيار منفذ، إضافة صنف، تبديل المنفذ، إضافة صنف آخر لنفس السلة، دفعة واحدة → تحقق عبر API أن الطلب انقسم فعليًا لتذكرتي KDS | **Pass** |
| P4-CART-02 | حالة الطلب الأصل تُشتق من الأبناء | شاشة KDS (Operator) | `POST /api/child-orders/:id/transition` + `deriveParentStatus()` | `orders.status`, `child_orders.status` | اختُبر: تقدّم منفذ واحد فقط → الحالة الأصل تبقى "Paid"؛ تقدّم الثاني أيضًا → تتحول لـ"Ready" تلقائيًا | **Pass** |
| P4-CART-03 | طلب أحادي المنفذ لا يتأثر إطلاقًا | KDS القديم | `POST /api/orders/:id/transition` (بلا تغيير) | `orders` (بلا `child_orders`) | اختُبر: طلب قديم انتقل عبر النقطة القديمة بنجاح رغم كل تعديلات Unified Cart | **Pass** |
| P4-REV-01 | 4 أنواع حساب إيراد | A-RevenueModels | `POST /api/admin/revenue-models` | `revenue_models` | اختُبرت الحسابات الأربعة رياضيًا (unit test) وصحّت جميعها | **Pass** |
| P4-REV-02 | نموذج ضمني للمنافذ المُرحَّلة | A-RevenueModels | `getActiveModel()` في `lib/revenue-engine.js` | `outlets.commission_rate` | اختُبر: منفذ بلا نموذج صريح استخدم عمولة 0%/12% المُرحَّلة تلقائيًا وبدقة | **Pass** |
| P4-REV-03 | Ledger بلقطة ثابتة، لا إعادة كتابة | A-RevenueModels | `recordOrderRevenue()` | `revenue_ledger.model_snapshot_json` | اختُبر: غُيِّر نموذج منفذ من عمولة لمشاركة 60%، والسطر القديم بالسجل بقي محتفظًا بلقطة النموذج القديم | **Pass** |
| P4-REV-04 | توزيع تناسبي عبر منافذ متعددة لنفس الطلب | — | نفس الدالة أعلاه | `revenue_ledger` | اختُبر: طلب بمنفذين → سطران منفصلان بحساب صحيح لكل منفذ | **Pass** |
| P4-WL-01 | عزل هوية المنصة عن هوية المنفذ | scrWelcome (متغيرات CSS مُحدَّدة النطاق) | `GET /api/qr/:token` (حقل `branding`) | `partner_branding` | اختُبر بمتصفح حقيقي: لون/شعار/نص مخصص ظهر في شاشة الترحيب، بينما شريط الإدارة العلوي بقي بألوان النادل الافتراضية دون أي تأثر (لقطة شاشة) | **Pass** |
| P4-WL-02 | تخفيض الباقة يُرجع العرض الافتراضي دون حذف الإعداد | — | نفس نقطة أعلاه | `partner_branding` | اختُبر: تخفيض الباقة لـSMART → `branding.mode` عاد لـ"alnadl" تلقائيًا في الاستجابة، دون حذف الصف المحفوظ | **Pass** |
| P4-QR-01 | توليد جماعي لرموز QR | A-QR Bulk Generate | `POST /api/admin/qr/bulk` | `points`, `qr_tokens` | اختُبر: توليد 5 رموز طاولات دفعة واحدة عبر متصفح حقيقي (لقطة شاشة) | **Pass** |
| P4-QR-02 | تحليلات لكل رمز QR (مسح/تحويل/مبيعات) | A-QR Analytics Modal | `GET /api/admin/qr/:pointId/analytics` | `qr_analytics_events` | اختُبر: مسح مرتين + طلب واحد مدفوع → تحويل 50% محسوب بدقة من السجل الخام | **Pass** |

### هيكل Final Delivery Package (§26.5) — تخطيط مبدئي لمطابقة `docs/` الحالي
| مجلد §26.5 المطلوب | الملف/المجلد المقابل في المشروع اليوم | الحالة |
|---|---|---|
| 01_Master_Requirements | لا يوجد — أقرب مكافئ هو هذه الوثيقة نفسها + الوثيقتان الأصليتان من النادل | **يحتاج إنشاء** ملف موحّد يدمج المتطلبات المعتمدة من Phase 1–4 |
| 02_Architecture_Database | `docs/DATABASE_SCHEMA.md` | يحتاج تحديث بعد Phase 4، لا إنشاء من الصفر |
| 03_API_Integration | `docs/API_DOCUMENTATION.md` | يحتاج تحديث بعد Phase 4 |
| 04_UX_UI_Flows | **غير موجود بصيغة مستقلة** — الشاشات موثّقة ضمن `README.md`/`HANDOVER.md` بشكل عام فقط | **يحتاج إنشاء** مستند User Flows مستقل |
| 05_QR_Outlets_Packages | غير موجود | **يحتاج إنشاء كامل** |
| 06_Revenue_Settlement | جزئيًا ضمن `docs/DATABASE_SCHEMA.md` (وصف `settlements`) | **يحتاج توسيع كبير** بعد Revenue Engine |
| 07_White_Label_Branding | غير موجود | **يحتاج إنشاء كامل** |
| 08_Roles_Operations | جزئيًا: `docs/TRAINING.md` + `docs/RUNBOOK.md` | يحتاج دمج/إعادة تنظيم تحت هذا المسمى + إضافة Roles/Permissions Matrix صريحة (لا توجد كمصفوفة اليوم، الصلاحيات موثّقة نثرًا فقط داخل `lib/auth.js`) |
| 09_Test_UAT | `docs/TEST_PLAN.md` | يحتاج تحديث + إضافة Traceability Matrix الفعلية |
| 10_Deployment_Migration | `docs/DEPLOYMENT.md` | يحتاج قسم Migration الخاص بـPhase 4 تحديدًا (نسخة موسّعة من §4 في هذه الوثيقة) |
| 11_Source_Code_Release | لا يوجد نظام Release Tag/Commit حتى الآن — المشروع يُسلَّم كملفات وليس كمستودع Git مُتتبَّع | **فجوة عملية حقيقية**: يجب اعتماد Git فعليًا (ولو محليًا) قبل الحديث عن Release Tag، وإلا فبند §26.2 "نفس Version/Commit المنشور" غير قابل للتحقق أصلاً |

### سياسة Versioning (§26.4) — غير مطبَّقة اليوم
كل ملف في `docs/` حاليًا بلا رقم إصدار أو تاريخ تحديث أو حالة (FINAL/APPROVED/SUPERSEDED) في الترويسة. **هذه فجوة سريعة الإصلاح** يجب تطبيقها من الآن على كل ملف موجود (وليس تأجيلها لنهاية Phase 4) حتى لا تتراكم عشرات الملفات بلا نظام تتبع لاحقًا.



1. **Staging Increment 1**: Migration + Outlet Entity + Service Hub (Single-Outlet regression مضمون 100%)
2. **Staging Increment 2**: Unified Cart + Parent/Child + KDS Routing
3. **Staging Increment 3**: Revenue Model Engine + Allocation Ledger + Settlement بمستوى Outlet
4. **Staging Increment 4**: White Label + QR Types/Bulk/Analytics + CONNECT Package
5. **UAT** على كل الزيادات مجتمعة وفق سيناريوهات §21 حرفيًا
6. **Production Migration** بعد اعتماد النادل، مع تفعيل تدريجي للـFeature Flags لكل شريك حسب باقته

---

## الخطوة التالية

بانتظار مراجعتكم لهذا التحليل قبل بدء أي تعديل فعلي على الكود — تحديدًا: هل الأولوية Increment 1 (Outlet + Service Hub) كما هو مقترح، أم توجد وحدة أكثر إلحاحًا تجاريًا تُقدَّم عليها؟
