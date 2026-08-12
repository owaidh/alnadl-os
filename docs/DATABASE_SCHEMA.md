# Alnadl Hospitality OS — Database Schema

المصدر الفعلي (Single Source of Truth) لهذا المخطط هو `db.js`. هذا المستند شرح مقروء له، وليس بديلاً عنه — عند أي تعارض، الكود هو المرجع.

المحرك: SQLite (عبر `node:sqlite` المدمج في Node، بدون أي مكتبة خارجية). الملف: `data.sqlite` يُنشأ تلقائيًا عند أول تشغيل.

---

## خريطة العلاقات (ERD نصي)

```
partners (1) ──< properties (1) ──< zones (1) ──< points (1) ──< qr_tokens
   │                  │
   │                  └──< categories (1) ──< products (1) ──< variants
   │                                              │        └──< addons
   │
   ├──< subscriptions (1:1) >── plans
   ├──< settlements ──< settlement_events
   └──< orders ──< order_items
                ├──< payments
                ├──< fulfillment (1:1)
                └──< feedback

users (كل مستخدم مرتبط بـ partner_scope اختياري لعزل الشركاء)
audit_log / notifications (سجلات مستقلة، مرتبطة بـ order_id أو entity id نصيًا وليس FK صارم)
promotions (مرتبط بـ property_id)
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
`plans` ثابتة (OPERATE/SMART/PLATFORM) وتحمل `features_json` (خريطة مزايا boolean). `subscriptions.partner_id` **فريد** (UNIQUE) — شريك واحد له اشتراك فعّال واحد فقط في كل لحظة؛ ترقية الباقة تستبدل الصف عبر `ON CONFLICT`.

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

### `users` — حسابات النظام
`partner_scope` هو FK اختياري لـ `partners.id` — `NULL` تعني مستخدمًا على مستوى النادل (SuperAdmin/AlnadlFinance) وليس مقيّدًا بشريك واحد. `password_hash` هو SHA-256 بسيط **لأغراض العرض التوضيحي فقط** — راجع README لملاحظات الأمان قبل الإنتاج.

---

## قيود تصميم مقصودة (يجب معرفتها قبل التوسّع)

1. **لا Foreign Key Constraints فعلية مفروضة في SQLite هنا** (رغم `PRAGMA foreign_keys = ON`) — العلاقات مضمونة عبر منطق التطبيق (`server.js`) وليس عبر قيود قاعدة البيانات. أي تعديل مباشر على القاعدة خارج الـ API قد يكسر الاتساق.
2. **الأسعار مخزنة كـ REAL (Floating point)** — كافٍ لهذا الحجم التجريبي، لكن نظام إنتاج حقيقي بمبالغ مالية يُفضَّل أن يخزّنها كأصغر وحدة عملة (halalas كأعداد صحيحة) لتفادي أخطاء التقريب التراكمية.
3. **لا Migration system** — التعديل على المخطط حاليًا يعني حذف `data.sqlite` وإعادة الزرع. لبيئة إنتاج فعلية يجب إضافة نظام Migrations (مثل node-pg-migrate إن انتقلتم لـ PostgreSQL، وهو الأنسب فعليًا لحمل إنتاجي حقيقي متعدد الشركاء).
