> **Version:** v2.0.8-p5-inc3 · **Status:** FINAL (Phase 1-4) + P5-Inc-1/2/3 tables · **Last Updated:** 2026-08-13 · **Release Tag:** v2.0.8-p5-inc3

# Alnadl Hospitality OS — Database Schema

المصدر الفعلي (Single Source of Truth) لهذا المخطط هو `db.js`. هذا المستند شرح مقروء له، وليس بديلاً عنه — عند أي تعارض، الكود هو المرجع.

المحرك: SQLite (عبر `node:sqlite` المدمج في Node، بدون أي مكتبة خارجية). الملف: `data.sqlite` يُنشأ تلقائيًا عند أول تشغيل.

---

## خريطة العلاقات (ERD، Q15)

**رسم فعلي محدَّث** (وليس نصيًا تقريبيًا) — يُولَّد من `docs/erd.dot` عبر Graphviz:
```
dot -Tpng docs/erd.dot -o docs/erd.png
```

![Alnadl Hospitality OS ERD](erd.png)

الرسم النصي أدناه يبقى كمرجع سريع (لا يغطي كل الجداول الـ34 — راجع الرسم أعلاه أو `db.js` نفسه للقائمة الكاملة):
```
partners (1) ──< properties (1) ──< zones (1) ──< points (1) ──< qr_tokens
   │                  │
   │                  ├──< outlets (1) ──< outlet_availability
   │                  │            └──< products (Phase 4، يحل محل merchants تدريجيًا)
   │                  └──< categories (1) ──< products (1) ──< variants
   │                                              │        └──< addons
   │
   ├──< subscriptions (1:1) >── plans
   ├──< settlements ──< settlement_events
   ├──< wallet_accounts ──< wallet_transactions
   ├──< partner_branding (1:1)
   └──< orders ──< order_items
                ├──< child_orders (Phase 4، عند تعدد المنافذ فقط) ──< order_items
                ├──< payments
                ├──< refunds (Phase 4، Q03)
                ├──< fulfillment (1:1)
                └──< feedback

outlets ──< revenue_models (نموذج واحد نشط) ──< revenue_ledger >── orders
loyalty_accounts ──< loyalty_transactions
qr_tokens ──< qr_analytics_events
users (كل مستخدم مرتبط بـ partner_scope اختياري لعزل الشركاء)
audit_log / notifications (سجلات مستقلة، مرتبطة بـ order_id أو entity id نصيًا وليس FK صارم)
promotions (مرتبط بـ property_id)
schema_migrations (Q08 — سجل تتبّع Migrations المُطبَّقة)
```

---

## الجداول

### `partners` — الشريك التجاري
| العمود | النوع | ملاحظات |
|---|---|---|
| id | TEXT PK | مثال: `pt_nova` |
| name_ar / name_en | TEXT | |
| legal_name | TEXT | الاسم القانوني للعقد |
| contract_ref | TEXT | مرجع العقد |
| status | TEXT | `Active` افتراضيًا |

### `properties` — المنشأة (فندق/مقر/مدينة ألعاب) التابعة لشريك
`partner_id` → `partners.id`. تحمل `timezone` و`address`.

### `zones` — منطقة داخل المنشأة (Lobby, Pool, Meeting Rooms...)
`property_id` → `properties.id`. `type` نصي حر (Lounge/Leisure/Business...).

### `points` — نقطة خدمة دقيقة (طاولة/غرفة/مقعد)
`zone_id` → `zones.id`. `active` يتحكم بإمكانية الطلب من هذه النقطة دون حذف تاريخها.

### `qr_tokens` — رمز QR فريد لكل نقطة
`point_id` → `points.id`. `token` هو الجزء الذي يُشفَّر داخل رمز QR الفعلي ويُستخدم في `GET /api/qr/:token`. **نقطة واحدة قد تملك أكثر من Token عبر الزمن** (عند إعادة الطباعة) — القديم يُعطَّل (`active=0`) بدل حذفه، حفاظًا على تتبع الطلبات التاريخية.

### `categories` / `products` / `variants` / `addons` — القائمة
- `categories.property_id` → `properties.id`
- `products.category_id` → `categories.id`، ويحمل `base_price` و`tax_code`
- `variants.product_id` → `products.id`، `price_delta` يُضاف إلى السعر الأساسي (مثال: حجم كبير +5)
- `addons.product_id` → `products.id`، `required` يحدد إن كانت الإضافة إلزامية

### `orders` — الطلب (الجدول المركزي)
| العمود | ملاحظات |
|---|---|
| id | صيغة `ORD-####` — **بدون أي رمز `#`** لأنه يكسر الروابط (فُهم هذا من اختبار فعلي أثناء البناء) |
| partner_id / property_id / zone_id / point_id | تُنسخ وقت الإنشاء لتسريع الاستعلامات وحفظ السياق حتى لو تغيّرت بنية المناطق لاحقًا |
| status | القيمة الحالية من آلة الحالة — راجع `lib/statemachine.js` |
| subtotal / vat / total | `vat` تُحسب دائمًا 15% على `(subtotal - discount_amount)` |
| promo_code / discount_amount | تُملأ فقط إن استُخدم كود خصم |
| payment_ref | مرجع ثابت يُستخدم لضمان Idempotency عند إعادة محاولة الدفع |
| cancel_reason | إلزامي عند `status = Cancelled` |

### `order_items` — بنود الطلب
`variant_json` و`addons_json` يخزنان **لقطة** (Snapshot) من الخيار وقت الطلب — وليس مرجعًا حيًا لجدول `variants`/`addons`، بحيث لا يتغير طلب قديم إذا عُدِّل سعر منتج لاحقًا.

### `payments` — سجل محاولات الدفع
`gateway_ref` هو ما ترجعه بوابة الدفع (حاليًا `MockGateway`، لاحقًا بوابة حقيقية). `status`: `Captured` أو `Failed`. طلب واحد قد يملك أكثر من صف هنا فقط إذا أُعيدت المحاولة بعد فشل (وليس بعد نجاح — الـ Idempotency تمنع ذلك).

### `fulfillment` — توقيتات دورة حياة الطلب التشغيلية
صف واحد لكل طلب (`order_id` PK)، يُحدَّث تدريجيًا: `accepted_at → preparing_at → ready_at → out_at → delivered_at`. هذا هو مصدر حساب "متوسط زمن التجهيز/التسليم" في لوحة M01.

### `settlements` + `settlement_events` — التسوية المالية (A06)
`settlements.status` يتبع سير الحالات: `Draft → Reviewed → Partner Review → Approved/Disputed → Paid`. **القيم المالية (`share_rate`, `partner_share`...) تُحفظ كنسخة ثابتة وقت الإنشاء** ولا تتغير أبدًا لاحقًا حتى لو عُدِّلت نسبة الشريك مستقبلاً — هذا يطبّق مبدأ "الشفافية وعدم المساس بالماضي" المذكور في وثيقة المفهوم (§23). `settlement_events` سجل تدقيق منفصل لكل انتقال حالة.

### `audit_log` — سجل تدقيق شامل
كل عملية حساسة (تغيير حالة طلب، تعديل مستخدم، تغيير باقة...) تُسجَّل هنا بالفاعل (`actor`) ودوره والقيمة قبل/بعد والسبب إن وُجد.

### `plans` / `subscriptions` — الباقات التجارية (SaaS، §12)
`plans` ثابتة (OPERATE/SMART/CONNECT/PLATFORM) وتحمل `features_json` (خريطة مزايا boolean). `subscriptions.partner_id` **فريد** (UNIQUE) — شريك واحد له اشتراك فعّال واحد فقط في كل لحظة؛ ترقية الباقة تستبدل الصف عبر `ON CONFLICT`.

### `promotions` — أكواد الخصم
`property_id` يربط الكود بمنشأة محددة (لا يعمل الكود عبر منشآت أخرى). `discount_type`: `percent` أو `flat`.

### `notifications` — سجل أحداث الإشعارات
بديل مؤقت لمزوّد SMS/Email/Push حقيقي (راجع README لتفاصيل نقطة التمديد).

### `feedback` — تقييم العميل بعد التسليم
`order_id` بلا FK صارم (تصميم مقصود، راجع "قيود التصميم" أدناه).

### `loyalty_accounts` / `loyalty_transactions` — الولاء والمكافآت (§15)
`loyalty_accounts.customer_key` هو رقم جوال العميل (فريد UNIQUE) — يُنشأ تلقائيًا عند أول استعلام رصيد أو أول طلب. `loyalty_transactions` سجل تدقيق كامل لكل حركة (`earn_on_delivery` أو `redeem_at_checkout`) مع ربطها بالطلب المسبب. معادلة الكسب/الاستبدال موثّقة في `lib/loyalty.js` (1 نقطة/ريال كسبًا، 20 نقطة=1 ريال استبدالًا).

### `merchants` — الشركاء التجاريون (Marketplace/Restaurant Integration، §9)
`property_id` → `properties.id`. `kind`: `alnadl` (مُشغَّل من النادل، يظهر دائمًا) أو `partner_restaurant` (يظهر فقط إن كانت باقة الشريك تشمل `marketplace`). `commission_rate` نسبة عمولة النادل على مبيعات هذا الشريك التجاري (منفصلة عن `share_rate` الخاص بتسوية الشريك الرئيسي).

### `wallet_accounts` / `wallet_transactions` — المحفظة المؤسسية (§8/§14)
`wallet_accounts.owner_ref` معرّف الجهة المستخدم في الربط عند الدفع (`GET /api/wallets/lookup`). `monthly_budget` و`spent_this_period` يحدّدان السقف الكلي؛ `policy_json` يحمل قواعد إضافية مرنة (حاليًا `perOrderCap` فقط، قابل للتوسعة لاحقًا لقيود توقيت/تصنيف دون تعديل المخطط). `wallet_transactions` سجل كل خصم فعلي، مرتبط بالطلب المسبب.

### `outlets` — المنافذ (Phase 4 §6)
`property_id` → `properties.id`. `type`: coffee/restaurant/bakery/service/other. `operator`: alnadl/partner/third_party. `commission_rate` قيمة موروثة من Merchants (Phase 3)، تُستخدم كنموذج إيراد ضمني حتى يُعرَّف نموذج صريح في `revenue_models`. `legacy_merchant_id` يحفظ تتبّع الترحيل من أي صف `merchants` نشأ هذا المنفذ.

### `outlet_availability` — ربط منفذ↔منطقة/نقطة **مع بُعد زمني** (§5)
منفذ **بلا أي صف هنا** متاح دائمًا وفي كل مكان — هذا ما يجعل كل منفذ مُرحَّل من Increment 1 يعمل دون أي إعداد إضافي. وجود صفوف يُقيِّد التوفر بمنطقة/نقطة/يوم/نطاق وقت محدد.

### `qr_analytics_events` — سجل خام لأحداث QR (§5)
صف واحد لكل مسح فعلي (`GET /api/qr/:token` أو `/api/service-hub/:token`) أو طلب فعلي — وليس عدادًا مُجمَّعًا مُخزَّنًا؛ كل مؤشرات التحليلات (نسبة التحويل، آخر مسح...) تُحسب من هذا السجل عند الطلب.

### `child_orders` + `order_items.child_order_id`/`outlet_id` (Phase 4 §8/§13)
طلب بمنفذ واحد **لا ينشئ أي صف هنا إطلاقًا** — يبقى مطابقًا 100% لسلوك ما قبل Phase 4. طلب يمتد لأكثر من منفذ (فقط إن كانت الباقة تشمل `unifiedCart`) ينشئ صفًا لكل منفذ، وتُحدَّث `order_items.child_order_id` لتربط كل سطر بالطلب الفرعي الصحيح. `orders.status` للطلب الأصلي **يُشتق تلقائيًا** من حالات الأبناء (`deriveParentStatus()` في `server.js`) ولا يُكتب مباشرة أبدًا عند وجود أبناء.

### `revenue_models` + `revenue_ledger` (Phase 4 §9/§10)
نموذج واحد نشط لكل منفذ (`active=1`)؛ تغيير النموذج يُعطِّل القديم (`active=0`) بدل حذفه — تاريخ كامل محفوظ. **`revenue_ledger` يُكتب مرة واحدة فقط عند نجاح الدفع، وكل سطر يحمل `model_snapshot_json`** (لقطة كاملة من النموذج المستخدم وقتها) — هذا يضمن أن تغيير نموذج منفذ لاحقًا لا يُعيد كتابة أي معاملة تاريخية أبدًا، بنفس فلسفة `settlements` في Phase 3.

### `partner_branding` (Phase 4 §11/§12)
صف واحد لكل شريك (`partner_id` PK). شريك بلا صف هنا (كل الشركاء افتراضيًا) يُعرَض بعلامة النادل الافتراضية. يحمل أيضًا نموذجًا تجاريًا مستقلاً تمامًا (`fee_model`, `setup_fee_amount`, `recurring_fee_amount`) عن نموذج إيراد أي منفذ تابع له.

### جداول Experience Ledger — Phase 5 P5-Inc-3 (`migrations/008_engage_inc3.js`)
- **`moment.selection_reason`** — عمود إضافي جديد؛ يُسجِّل صراحة *لماذا* اختير هذا المحتوى (حاليًا: Round-Robin ثابت، بصياغة صادقة تصف الواقع فعليًا وليس منطق ذكاء اصطناعي غير موجود بعد)
- **`experience_event`** — سجل دورة حياة الجلسة الكامل (`session_start`/`moment_served`/`moment_completed`/`moment_skipped`/`session_end`)، كل صف بختم زمني حقيقي
- **`response_event`** — استجابة العميل الفعلية لكل لحظة، مع `idempotency_key` (فهرس فريد جزئي `WHERE idempotency_key IS NOT NULL`) يمنع تسجيل نفس التفاعل مرتين عند إعادة إرسال الطلب

**العزل المعماري محفوظ بالكامل**: كل جدول أعلاه Engage بحت — لا عمود ولا قيد جديد على أي جدول Core.

### تصحيح أمني — Capability Tokens (`migrations/007_engage_session_auth.js`)
**`engage_pass.access_token`** و**`engage_session.access_token`** (عمودان إضافيان، `UNIQUE`، عشوائيان تشفيريًا 24 بايت) — الآن **السبيل الوحيد** لعنونة أي Pass/Session من واجهة العميل؛ لا يُقبَل `id` الداخلي كمُدخَل بعد الآن في أي نقطة نهاية Engage. يُغلق ثغرة IDOR حقيقية كانت موجودة في الإصدار الأول من Inc-2 (الاعتماد على `id` وحده، القابل للتخمين نظريًا). راجع `docs/PHASE5_GAP_ANALYSIS.md` قسم "الجولة التصحيحية الأمنية" للتفصيل الكامل.

### جداول ALNADL Engage — Phase 5 P5-Inc-2 (`migrations/006_engage_inc2.js`)
- **`properties.venue_context`** — عمود إضافي جديد (`corporate`/`coffee`/`hotel`/`entertainment`/`vip_lounge`)، الإشارة الأساسية لمحرك الشخصية عند غياب إشارة منطقة أقوى
- **`mechanic`/`mechanic_version`** — بنية تحتية مشتركة مع Mechanic Lab المستقبلية (Inc-8)؛ Inc-2 يزرع فقط 5 آليات ثابتة مُعتمَدة مسبقًا (`lifecycle_state='promoted'`, `created_by='alnadl_admin'`) — واحدة لكل شخصية، تمثيل حرفي لمتطلب "Approved Static/Fallback Content"
- **`moment`/`payload_version`** — كل لحظة مُقدَّمة فعليًا للعميل + المحتوى الحرفي المعروض (غير قابل للتعديل بعد إنشائه)
- **`venue_policy_override`** — جدول التخصيص الهرمي (`scope_type`: partner/property/zone، `policy_key`: مثال `ceiling_MIND`) — يُطبَّق عبر `lib/engage-personality.js` بصيغة `min()` مُتسلسلة تضمن أن لا مستوى أدق يتجاوز Global Safety أو قيدًا تعاقديًا أعلى

### جداول ALNADL Engage — Phase 5 P5-Inc-1 (`migrations/004_engage_inc1.js`)
**اتجاه الاعتماد مؤكَّد ومُختبَر**: `Engage → Core` حصريًا — `engage_pass.order_id` قيد `FOREIGN KEY ... REFERENCES orders(id)` **حقيقي** (`ON DELETE CASCADE ON UPDATE CASCADE`)، مُختبَر فعليًا برفض إدراج بمرجع غير صالح. لا جدول Core (`orders`, `payments`...) يحمل أي عمود أو قيد نحو Engage. تدفق البيانات (وليس الاعتماد) يسير بالاتجاه المعاكس: `Core → Engage` عبر `order.confirmed` → صف واحد في `engage_outbox` (كتابة محلية غير مشروطة، لا قرار Engage-specific داخل Core).

- **`engage_pass`** — بوابة الأهلية؛ لا صف بلا `order_id` صالح لطلب مدفوع فعليًا. `context_snapshot_json` لقطة ثابتة وقت الإصدار (نفس مبدأ `revenue_ledger.model_snapshot_json`)
- **`engage_session`** — بنية فقط في Inc-1 (`personality` NULLABLE)؛ التعبئة الفعلية مؤجَّلة لـInc-2
- **`engage_outbox`** — آلية الربط غير المتزامنة الوحيدة؛ `status`: `pending → processed` (Flag ON) أو `skipped` (Flag OFF، الحالة الافتراضية لكل الباقات اليوم) أو `dead_letter` (فشل نهائي بعد استنفاد `max_attempts`). **سياسة إعادة محاولة حقيقية** (جولة تصحيحية v2.0.5): `attempts`/`max_attempts` (افتراضي 5)/`next_attempt_at` (Backoff أُسِّي، سقف 30 ثانية)/`last_error` — فشل عابر يُبقي الصف `pending` قابلاً لإعادة المحاولة لاحقًا، وليس `failed` نهائية بلا رجعة كما كان الحال قبل هذا الإصلاح
- **`engage_audit_log`** — سجل تدقيق مستقل تمامًا عن `audit_log` الأساسي (لا تداخل)

`engage_enabled` أُضيف كمفتاح جديد في `plans.features_json` لكل الباقات الأربع (القيمة الافتراضية `false` للجميع — لا باقة خامسة أُنشئت، تطبيقًا لـ§6 من وثيقة Phase 5).

### `refunds` — الاسترجاعات الكاملة/الجزئية (Q03)
سجل غير قابل للتعديل — كل استرجاع صف جديد، لا يُعدَّل أي صف قائم أبدًا. `reason` تحمل بادئة `__idem__` عند استخدام مفتاح Idempotency بدل سبب نصي حر.

### `schema_migrations` (Q08)
سجل كل Migration طُبِّقت فعليًا، بترتيبها الزمني — يمنع إعادة تطبيق نفس الترحيل مرتين. راجع `lib/migrate.js` و`migrations/`.

### قيود المفاتيح الأجنبية (Foreign Keys، Q09)
`PRAGMA foreign_keys = ON` مُفعَّل على مستوى الاتصال. قيود FK فعلية (وليست توثيقًا فقط) مُطبَّقة حاليًا على: `order_items`, `child_orders`, `payments`, `revenue_ledger` — وهي مسار المال المباشر في النظام، عبر `migrations/001_add_foreign_keys.js`. **نطاق متبقٍ صراحة**: بقية الجداول (`zones`, `points`, `products`...) لم تُرحَّل بعد لنفس النمط — انظر `docs/GAP_REGISTER.md` بند Q09.

### `properties.delivery_grouping` (Q01)
`'grouped'` (افتراضي) أو `'separate'` — يتحكم بسياسة توصيل الطلبات متعددة المنافذ. راجع `docs/MULTI_OUTLET_SPEC.md`.

### `revenue_ledger.type` (Q03)
`'sale'` (المعاملة الأصلية) أو `'refund_adjustment'` (سطر عكسي عند استرجاع) — لا يُحذف أو يُعدَّل أي سطر `sale` عند الاسترجاع، بل يُضاف سطر `refund_adjustment` جديد بمبلغ سالب.

### `users` — حسابات النظام
`partner_scope` هو FK اختياري لـ `partners.id` — `NULL` تعني مستخدمًا على مستوى النادل (SuperAdmin/AlnadlFinance) وليس مقيّدًا بشريك واحد. `password_hash` بصيغة `pbkdf2:<iterations>:<salt>:<hash>` (Q06 — 100,000 تكرار، Salt فريد لكل مستخدم عبر `node:crypto`)؛ أي صف قديم بصيغة SHA-256 مجرد (بلا بادئة `pbkdf2:`) لا يزال يُتحقَّق منه للتوافق الخلفي، لكن لا يُنتَج بهذه الصيغة القديمة أبدًا لمستخدم جديد.

---

## قيود تصميم مقصودة (يجب معرفتها قبل التوسّع)

0. **معاملات (Transactions) صريحة على مسار الدفع** (جولة تصحيحية P5-Inc-1، v2.0.5): `POST /api/orders/:id/pay` يُغلِّف الآن كل كتاباته (Payments، حالة الطلب، تعاقب Child Orders، الولاء، توزيع الإيراد، سطر `engage_outbox`) داخل `BEGIN...COMMIT` واحدة — إما تثبت جميعًا معًا أو لا يثبت أي منها. **مُختبَر فعليًا بإثبات Rollback حقيقي**، وليس افتراضًا. هذا يحل خللاً حقيقيًا كان موجودًا سابقًا: كل Statement كانت تُثبَّت فوريًا بمعزل عن الأخرى (Auto-commit)، فانهيار فعلي بين خطوتين كان بإمكانه ترك طلب `Paid` بلا أي حدث Engage مقابل، بصمت تام.
0ب. **WAL Mode مُفعَّل** (`PRAGMA journal_mode=WAL` + `busy_timeout=5000`، جولة تصحيحية v2.0.5) — اكتُشف فعليًا أن تفعيل المعاملات الصريحة أعلاه يكشف قفل قاعدة بيانات حقيقيًا (SQLite الافتراضي/Rollback Journal يقفل الملف بالكامل أثناء أي معاملة كتابة) عند أي اتصال ثانٍ متزامن. WAL يسمح بقراءات متزامنة أثناء الكتابة، وهو الوضع المُوصى به عمليًا لأي سيناريو اتصالات متعددة.

1. **Foreign Key Constraints فعلية مفروضة الآن على 4 جداول فقط من أصل 34** (`order_items`, `child_orders`, `payments`, `revenue_ledger` — مسار المال المباشر، عبر `migrations/001_add_foreign_keys.js`، Q09). بقية الـ30 جدولاً لا تزال تعتمد على منطق التطبيق (`server.js`) فقط دون قيد قاعدة بيانات فعلي — **دَين تقني مُعتمَد رسميًا**، وليس إغفالًا. راجع `docs/GAP_REGISTER.md` بند Q09 للتفصيل والخطة.
2. **الأسعار مخزنة كـ REAL (Floating point) في كل الجداول المالية دون استثناء** — هذا خطر تقريب (Rounding Risk) حقيقي وغير مُعالَج بعد، ذُكر صراحة في مراجعة الجودة النهائية (بند 13). التوصية المُعتمَدة: الانتقال لتخزين أصغر وحدة عملة كعدد صحيح (halalas، أي الريال × 100 كـ INTEGER) أو `NUMERIC/DECIMAL` عند الانتقال لـPostgreSQL (Q07)، مع قاعدة تقريب موحّدة صريحة للضريبة والخصومات والعمولات والاسترجاعات والتسويات — **هذا العمل لم يبدأ بعد**.
3. **نظام Migrations موجود وفعّال** (`lib/migrate.js` + `migrations/`, Q08) — التعديل على المخطط الآن يمر عبر ملف مُرقَّم مُتتبَّع في `schema_migrations`، **وليس** حذف `data.sqlite` وإعادة الزرع كما كان الحال قبل Q08. عند الانتقال لـPostgreSQL (Q07)، نفس نمط الملفات المُرقَّمة يبقى صالحًا مع تعديل بنية SQL فقط.
