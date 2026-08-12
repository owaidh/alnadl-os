> **Version:** v2.0.3-p5-draft · **Status:** DRAFT — pending client review before any implementation begins (per §0, §23 of `P5_وتحديث_p4.docx`) · **Last Updated:** 2026-08-12 · **Baseline:** `v2.0.3-p4-baseline-locked`

# Alnadl Hospitality OS — Phase 5 (ALNADL Engage) Gap Analysis & Technical Design

**لا كود أُنتج بعد لهذا القسم.** هذا تحليل فجوة وتصميم فني فقط، مطابقًا لنفس المنهجية التي استُخدمت لـPhase 4 (`docs/PHASE4_GAP_ANALYSIS.md`) والتي أثبتت جدواها عمليًا — كل بند نُفِّذ لاحقًا منها كان مُختبَرًا فعليًا، لا مُدَّعى فقط.

## 1) الفجوة الجوهرية — بصراحة كاملة

**لا يوجد أي جزء من ALNADL Engage في النظام الحالي.** صفر جداول، صفر endpoints، صفر شاشات. هذا ليس امتدادًا لميزة قائمة (كما كانت Outlets امتدادًا لـMerchants في Phase 4) — بل **منظومة جديدة كليًا** تُستهلَك من بيانات Phase 1-4 (Context/Order/Branding) دون تكرارها.

**الفرق الجوهري عن كل ما بُني حتى الآن:** كل زيادة سابقة (Outlet Architecture، Unified Cart، Revenue Engine...) كانت منطقًا حتميًا (Deterministic) — نفس المدخلات تُنتج نفس المخرجات دائمًا، قابلة للاختبار بمقارنة مباشرة. **Engage غير حتمي بطبيعته** (توليد بالذكاء الاصطناعي، تنوع، سلامة محتوى) — هذا يغيّر منهجية الاختبار جذريًا: لا "النتيجة الصحيحة الوحيدة" بل "مجموعة نتائج مقبولة ضمن حواجز أمان صارمة".

## 2) مبدأ العزل الإلزامي (Core Isolation) — أهم قرار تصميمي واحد

كل بند في §25.1/§25.10 من الوثيقة يُختصر لمبدأ واحد: **فشل Engage لا يجوز أن يُسقط أي جزء من Core OS القائم**. هذا يفرض:
- Engage يُستدعى **بشكل غير متزامن (Async)** بعد `order.confirmed` — عبر Event/Outbox، وليس استدعاء مباشر synchronous داخل مسار الدفع الحرج
- أي جدول Engage جديد **لا يحمل Foreign Key من اتجاه Core→Engage** — الاتجاه دائمًا Engage→Core (Engage يقرأ `order_id`، لكن جداول `orders`/`payments`/إلخ لا تعرف بوجود Engage إطلاقًا)
- تعطيل Engage بالكامل (`engage_enabled=OFF`) يجب أن يكون **بلا أي أثر ملحوظ** على أي مسار طلب — هذا مُختبَر آليًا بسهولة (نفس Regression Suite الحالي 73/73 يعمل بمعزل تام عن أي كود Engage)

## 3) ما هو الأخطر تقنيًا — وأين يجب أن يبدأ التنفيذ الفعلي

بترتيب المخاطرة تنازليًا:
1. **Mechanic Lab ذاتي التطور** (§25.7) — نظام يبتكر آلياته الخاصة، بدورة حياة Canary→Promote تلقائية. هذا **أعلى مخاطرة في كامل الوثيقة** — نظام يُقرر بنفسه ما يُعرض لعملاء حقيقيين (بينهم عائلات وربما قاصرون في سياق Entertainment)
2. **توليد الذكاء الاصطناعي المباشر** (§25.4) — يتطلب مزوّد AI حقيقي (لا يوجد بيانات اعتماد في هذه البيئة، تمامًا كحال Q05/بوابة الدفع سابقًا)
3. **الحوكمة العمرية/الثقافية** (§25.5) — قرارات أمان محتوى حقيقية، ليست "منطق أعمال" عاديًا

**القرار المنهجي المقترح، بصراحة:** يبدأ التنفيذ بـ**العكس تمامًا** — الأجزاء الحتمية أولًا (بنية البيانات، بوابة `order.confirmed`، دورة حياة Session، حواجز Ceiling/Novelty كقواعد صريحة قابلة للاختبار)، باستخدام **محتوى مُعتمَد ثابت (Approved Fallback Only)** بدل توليد AI حي في المرحلة الأولى. هذا يُثبت الميكانيكا كاملة (Gate، Personality، Ceiling، Safety Gates، Audit Ledger) **دون** المخاطرة المزدوجة (AI + Safety) في نفس الخطوة — تمامًا كما فُصل Q05 (بوابة دفع حقيقية) عن بقية النظام في Phase 4.

## 4) خطة الزيادات المقترحة (Increments)

| # | الزيادة | المخاطرة | يتطلب موارد خارجية؟ |
|---|---|---|---|
| **P5-Inc-1** | بنية البيانات + `order.confirmed` Gate + `engage_pass`/`engage_session` (بلا أي محتوى بعد — فقط إثبات أن الـGate يعمل وأن Engage معزول تمامًا) | منخفضة | لا |
| **P5-Inc-2** | Context Personality Engine (RESET/SPARK/DISCOVER/PLAY/MIND) + Engagement Ceiling + محتوى ثابت مُعتمَد مسبقًا (لا AI) | منخفضة-متوسطة | لا |
| **P5-Inc-3** | Experience Ledger + Audit كامل + Admin Dashboard الأساسي (Overview, Live Activity, Ledger) | منخفضة | لا |
| **P5-Inc-4** | Semantic Novelty/Exposure Memory (منع التكرار) — بلا AI بعد، تشابه نصي بسيط كبداية | متوسطة | لا |
| **P5-Inc-5** | Social/Group Invite (Token، حد مشاركين، عزل Tenant) | متوسطة | لا |
| **P5-Inc-6** | Feature Flags + Roles جديدة (Safety Reviewer...) + دمج في Partner Dashboard بحدود Privacy (Cohort Threshold) | منخفضة | لا |
| **P5-Inc-7** | **توليد AI حي + Fallback Contract** | عالية | **نعم — بيانات اعتماد مزوّد AI حقيقي** |
| **P5-Inc-8** | **Mechanic Lab ذاتي التطور (Draft→Canary→Promote)** | **الأعلى** | نعم (يعتمد على Inc-7) |

**Inc-1 إلى Inc-6 قابلة للتنفيذ والاختبار الكامل في هذه البيئة الآن.** Inc-7 وInc-8 يتطلبان قرارًا تجاريًا (اختيار مزوّد AI) وبيانات اعتماد فعلية — تمامًا كحال Q05 — ويُوسَمان `Integration Pending` حتى تتوفر.

## 5) تصميم قاعدة البيانات — Increment 1 فقط (تفصيلي)

```sql
-- كل جدول يحمل FK باتجاه واحد فقط: Engage → Core (لا العكس أبدًا)
CREATE TABLE engage_pass (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, -- FK -> orders(id), القراءة فقط
  identity_ref TEXT, -- customer_id أو pseudonymous token للمجهول
  context_snapshot_json TEXT NOT NULL, -- لقطة ثابتة وقت الإصدار (partner/property/zone/outlet) -- لا استعلام حي لاحق
  status TEXT DEFAULT 'active', -- active | expired | revoked
  created_at INTEGER, expires_at INTEGER
);
CREATE TABLE engage_session (
  id TEXT PRIMARY KEY, pass_id TEXT NOT NULL, -- FK -> engage_pass(id)
  personality TEXT, -- RESET|SPARK|DISCOVER|PLAY|MIND
  ceiling_moments_used INTEGER DEFAULT 0, ceiling_moments_max INTEGER,
  status TEXT DEFAULT 'running', -- running | ended | killed
  started_at INTEGER, ended_at INTEGER
);
CREATE TABLE engage_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT,
  object_type TEXT, object_id TEXT, before_json TEXT, after_json TEXT, ts INTEGER
);
```
**ملاحظة تصميمية حرجة:** `context_snapshot_json` يُخزَّن كلقطة ثابتة وقت إنشاء الـPass — **وليس استعلامًا حيًا لجداول Core لاحقًا** — هذا يطابق مبدأ "Snapshot الثابت" الذي أثبت نجاحه في `revenue_ledger.model_snapshot_json` (Phase 4)، ويحقق شرط العزل (تغيير بيانات Outlet لاحقًا لا يُغيّر تجربة Pass صادر قبله).

## 6) نقاط الـAPI — Increment 1 فقط

- `POST /api/orders/:id/confirm-engage` — يُستدعى داخليًا عند `order.confirmed` (Hook إضافي على مسار الدفع القائم، **لا تعديل على منطقه**)، يُنشئ `engage_pass` بشكل Async (استدعاء بعد إرسال استجابة الدفع للعميل، ليس قبله)
- `GET /api/engage/pass/:id` — عام، يتحقق من الصلاحية والانتهاء
- `POST /api/engage/session/:id/end` — إنهاء صريح

## 7) معايير القبول — أول 5 بنود قابلة للاختبار فورًا (من §18/§25.11)

| Requirement ID | المعيار | قابل للاختبار في Inc-1؟ |
|---|---|---|
| ENG-GATE-001 | لا Engage قبل `order.confirmed` | ✅ نعم — اختبار مباشر: طلب غير مؤكَّد لا يُنشئ Pass |
| ENG-ISO-001 | فشل Engage لا يُسقط Core | ✅ نعم — إيقاف Engage بالكامل، تشغيل Regression الحالي (73/73)، يجب أن يبقى 73/73 دون أي تغيير |
| ENG-WORK-001 | Corporate = تجربة واحدة، لا تكرار | ✅ نعم (بعد Inc-2) |
| ENG-AUD-001 | سجل تدقيق كامل لكل Payload | ✅ نعم (بعد Inc-3) |
| ENG-NOV-001 | منع التكرار الدلالي | ⚠️ جزئي في Inc-4 (تشابه نصي بسيط، وليس Embeddings دلالية كاملة تتطلب AI) |

## 8) التقدير الزمني (لمطوّر واحد متفرغ)

| الزيادة | الأيام | ملاحظة |
|---|---|---|
| P5-Inc-1 (بنية بيانات + Gate + عزل) | 3 | الأهم — يُثبت مبدأ العزل قبل أي شيء آخر |
| P5-Inc-2 (Personality + Ceiling + محتوى ثابت) | 4 | |
| P5-Inc-3 (Ledger + Admin أساسي) | 3 | |
| P5-Inc-4 (Novelty بسيط) | 2 | |
| P5-Inc-5 (Social/Group) | 3 | |
| P5-Inc-6 (Flags/Roles/Partner Dashboard) | 2 | |
| **المجموع القابل للتنفيذ الآن (Inc 1-6)** | **≈17 يوم** | |
| P5-Inc-7 (AI حي) | 5-7 | يبدأ فقط بعد قرار مزوّد + بيانات اعتماد |
| P5-Inc-8 (Mechanic Lab) | 8-10 | الأعلى تعقيدًا، يعتمد على Inc-7 مكتملًا ومُختبَرًا بحمل حقيقي |
| **المجموع الكامل** | **≈32-37 يومًا** | مماثل تقريبًا لحجم Phase 4 الكامل |

## 9) التوصية

**البدء بـP5-Inc-1 الآن** — الأقل مخاطرة، الأكثر إثباتًا لصحة الاتجاه المعماري (العزل)، وقابل للاختبار الكامل بنفس منهجية Phase 4 (Regression مستمر، أدلة حقيقية، لا ادّعاء Done بلا دليل). Inc-7/Inc-8 يُصنَّفان *Pre-Go-Live / Integration Pending* من اليوم الأول، بنفس شفافية Q05.
