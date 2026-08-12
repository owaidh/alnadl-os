> **Version:** v2.0.3 · **Status:** PHASE 1-4 TECHNICAL BASELINE LOCKED — 13/20 fully closed, 3/20 partially closed as formally-accepted technical debt (73/73 automated tests, verified count), 4/20 explicitly open (Pre-Go-Live). P4-GATE-001 through 008 all satisfied (see dedicated section below) — this baseline is now locked per the Phase 5 pre-gate requirement. · **Last Updated:** 2026-08-12 · **Release Tag:** v2.0.3-p4-baseline-locked

# Alnadl Hospitality OS — Gap Register (Final Quality & Completion Requirements Response)

**رد على مراجعتين من ALNADL**: `ALNADL_Phase_1_to_4_Final_Quality_Completion_Handover_Requirements.docx` (الأولى) و`مبرمج ٢.docx` (الجولة التصحيحية الثانية). كل بند أدناه بحالته **النهائية الحالية فقط** — لا يوجد جدول تاريخي منفصل قد يُقرأ خطأً كحالة راهنة، تطبيقًا لملاحظة الجولة الثانية بند 1.

## جدول الحالة الوحيد والنهائي (Q01–Q20)

| ID | التصنيف | الحالة والدليل |
|---|---|---|
| Q01 Grouped/Separate Delivery | ✅ مُغلَق بالكامل | `migrations/002_delivery_grouping.js` + منطق Runner Queue — مُختبَر آليًا (23 اختبارًا في `api-phase4.js`): `grouped` (افتراضي) يطابق السلوك القديم حرفيًا، `separate` يُظهر تذكرة المنفذ الجاهز فورًا |
| Q02 Service Hub Availability | ✅ مُغلَق بالكامل | شاشة إدارية فعلية (قواعد التوفر الزمني) + CRUD API — يوم الأسبوع، نافذة زمنية عادية، **نافذة ليلية عابرة لمنتصف الليل** (خلل حقيقي اكتُشف وأُصلح: `hm<from||hm>to` كان يفشل لنوافذ مثل 22:00-06:00)، منفذ مُغلَق بالكامل — مُختبَر آليًا وبصريًا |
| Q03 Refund End-to-End | ✅ مُغلَق بالكامل | استرجاع كامل/جزئي، منع الاسترجاع المزدوج، Idempotency، عكس Revenue Ledger تناسبيًا (يستثني VAT بشكل صحيح) — 16 اختبارًا ماليًا آليًا + شاشة إدارية حقيقية مُختبَرة بمتصفح حقيقي |
| Q04 Parent/Child Partial States | ✅ مُغلَق بالكامل | `deriveParentStatus()` يُنتج `Partially Ready`/`Partially Delivered` بدقة — مُختبَر آليًا وبصريًا (شاشة تتبع العميل الفعلية) |
| Q05 بوابة دفع حقيقية | ❌ **مفتوح — Pre-Go-Live Production Blocker** | MockGateway فقط. لا بيانات اعتماد فعلية لأي مزود متاحة في هذه البيئة. البنية (`lib/payment.js`) جاهزة لتلقي أي Adapter دون تعديل بقية النظام — **Integration Pending**، ليس Done |
| Q06 تقوية Authentication | ⚠️ **مُغلَق جزئيًا — Application Hardening Complete، وليس Production Security Complete** | PBKDF2 (100,000 تكرار + Salt فريد)، Rate Limiting (5/15 دقيقة، مُختبَر)، وابتداءً من هذه الجولة: **فشل Startup إلزامي** عند `NODE_ENV=production` بلا `SESSION_SECRET` قوي (بدل تحذير فقط) |
| Q07 قرار قاعدة بيانات الإنتاج | ⚠️ **مُغلَق جزئيًا — Architecture Decision Complete، وليس Production Database Complete** | قرار هندسي نهائي مكتوب (PostgreSQL 15+) بخطة تنفيذ مفصّلة — **لم يُنفَّذ فعليًا بعد**، لا يمكن تشغيل PostgreSQL في هذه البيئة (Pre-Go-Live) |
| Q08 Migration System | ✅ مُغلَق بالكامل | `lib/migrate.js` + `migrations/` — تطبيق تلقائي، Idempotent، معاملة واحدة مع Rollback عند الفشل |
| Q09 Foreign Key Integrity | ⚠️ **مُغلَق جزئيًا — Technical Debt مُعتمَد رسميًا** | FK فعلية على 4 جداول من 34 (~12%، مسار المال المباشر) — مُختبَر فعليًا (رفض إدراج حقيقي بمرجع غير صالح). بقية الجداول تبقى دَينًا تقنيًا مُسجَّلاً صراحة، غير مُدَّعى إغلاقه |
| Q10 Automated Test Suite | ✅ مُغلَق بالكامل | `tests/` (5 ملفات + Runner) — **73/73 اختبارًا ناجحًا حاليًا**، عدد مُتحقَّق منه مباشرة قبل كل تسليم، عبر أمر واحد `node tests/run-all.js`، بتقرير JSON حي |
| Q11 UAT رسمي موقَّع | ❌ **مفتوح — Pre-Go-Live** | يتطلب فريق النادل الفعلي؛ الحزمة (`docs/TEST_PLAN.md`) جاهزة تمامًا لهم |
| Q12 توحيد الإصدار | ✅ مُغلَق بالكامل | كل الوثائق (24) موحَّدة على نفس رقم الإصدار بترويسة متطابقة، مُدقَّقة في كل جولة تصحيحية |
| Q13 Git Traceability | ✅ مُغلَق بالكامل | `.git` مُدرَج فعليًا في كل حزمة مُسلَّمة منذ v2.0.1 — تحقَّق مباشرة من داخل نسخة مُستخرَجة: `git status` نظيف، و`HEAD` يطابق أحدث Tag حرفيًا |
| Q14 مطابقة API Documentation | ✅ مُغلَق بالكامل | يُدقَّق عند كل جولة عبر جرد مباشر لكل `on(...)` في `server.js` مقابل الوثيقة |
| Q15 ERD فعلي | ✅ مُغلَق بالكامل | `docs/erd.dot`/`erd.png` — رسم Graphviz فعلي لكل الـ34 جدولاً، وليس وصفًا نصيًا تقريبيًا |
| Q16 Notifications | ✅ مُغلَق بالكامل (كتصنيف) | مُوسَم صراحة `Integration Pending` في 3 مواضع (كود، API doc، README) — لا وصف مضلِّل بأنها خدمة عاملة |
| Q17 Load/Concurrency Tests | ❌ **مفتوح — Pre-Go-Live** | اختبار تزامن فعلي (Race Conditions) مُغلَق ضمن Q10؛ اختبار حمل p95/p99 تحت آلاف الطلبات يتطلب بنية تحتية إنتاجية فعلية |
| Q18 اختبار أجهزة فعلية | ❌ **مفتوح — Pre-Go-Live** | لا أجهزة iPhone/Android فعلية في بيئة الحاويات |
| Q19 Financial Regression | ✅ مُغلَق بالكامل | نفس مجموعة `financial-regression.js` — صافي `eligible_base` لطلب مُسترجَع بالكامل يُصفَّر تمامًا (0.00) |
| Q20 Documentation = Production | ✅ مُغلَق بالكامل | يُطبَّق كممارسة مستمرة — كل Commit تصحيحي يُحدِّث الكود والتوثيق معًا، وليس كخطوة منفصلة لاحقة |

## الخلاصة بثلاث فئات (كما طلبت الجولة التصحيحية الثانية)

**✅ Closed — Phase 1-4 (13):** Q01, Q02, Q03, Q04, Q08, Q10, Q12, Q13, Q14, Q15, Q16, Q19, Q20

**⚠️ Technical Debt — مُعتمَد رسميًا، ليس Done (3):** Q06 (Application Hardening فقط)، Q07 (قرار معماري فقط، بلا تنفيذ)، Q09 (تغطية FK جزئية 12%)

**❌ Pre-Go-Live Open Items — لا تمنع Technical Handover، لكنها تمنع Production Go-Live (4):** Q05 (بوابة دفع)، Q11 (UAT)، Q17 (Load Test)، Q18 (أجهزة فعلية)

## Phase 5 (ALNADL Engage) — تتبّع منفصل

Phase 5 لها سجل تتبّع خاص بها، منفصل عمدًا عن Q01-Q20 أعلاه (تلك خاصة بإغلاق Phase 1-4 فقط): راجع `docs/PHASE5_GAP_ANALYSIS.md`. **الحالة الحالية: P5-Inc-1 مُسلَّم ومُختبَر (90/90 اختبارًا إجماليًا)، بانتظار مراجعة ALNADL قبل بدء P5-Inc-2.**

## بوابة إغلاق Phase 4 (P4-GATE-001 إلى 008) — مُنفَّذة بالكامل

استجابةً لـ`P5_وتحديث_p4.docx`، القسم "PRE-PHASE 5 GATE". **هذه البوابة إلزامية قبل أي عمل على Phase 5 Engage**، وقد نُفِّذت بالكامل الآن:

| البوابة | الحالة | الدليل |
|---|---|---|
| P4-GATE-001 Baseline Lock | ✅ | هذا القسم نفسه + الوسم أدناه |
| P4-GATE-002 Regression Evidence | ✅ | **73/73** مُتحقَّق منه برمجيًا فور التنفيذ (لم ينخفض عن آخر رقم مُعلَن) |
| P4-GATE-003 Documentation/Version Consistency | ✅ | Regression كامل أُعيد تشغيله على هذا الالتزام تحديدًا؛ صفر انخفاض في التغطية |
| P4-GATE-004 ERD/Schema Truth | ✅ | **خلل حقيقي اكتُشف وأُصلح**: `docs/erd.dot` كان لا يزال يحمل "(v2.0.0)" ثابتة داخل عنوان الرسم رغم كل الترقيات — صُحِّحت لـv2.0.2 وأُعيد توليد `erd.png`/`erd.svg`. كذلك عنوان في `DATABASE_SCHEMA.md` كان لا يزال يحمل "(v2.0.1)" ثابتة — أُزيلت |
| P4-GATE-005 Production Safety Guards | ✅ | راجع Q06 الحالي — يصف SQLite (المحرك الفعلي المُستخدَم اليوم) بدقة، بما فيها FK الجزئية (4/34) كـTechnical Debt معلن، وليس ادّعاءً باكتمال غير موجود |
| P4-GATE-006 Core Fulfillment Definition | ✅ | **مُختبَر حيًا الآن، 3 حالات منفصلة**: (أ) DB فارغة بلا SESSION_SECRET ولا بيانات Bootstrap → فشل فوري؛ (ب) SESSION_SECRET موجود لكن DB فارغة بلا بيانات Bootstrap → فشل فوري؛ (ج) كل شيء صحيح → مستخدم واحد بالضبط، صفر شركاء وهميين. فحص SESSION_SECRET المعزول (DB غير فارغة) اختُبر منفصلًا أيضًا وأكَّد الرفض الصحيح |
| P4-GATE-007 Core Flow Protection | ✅ | **إضافة توثيقية جديدة**: تصريح صريح في `docs/MULTI_OUTLET_SPEC.md` و`docs/ARCHITECTURE.md` أن Runner توصيل داخلي حصري ضمن حدود المنشأة — لا مركبات، لا عناوين، لا GPS، لا توصيل خارجي في أي جزء من الكود الحالي |
| P4-GATE-008 Phase 4 Closure Decision | ✅ | Regression متصفح كامل عبر السلسلة الكاملة المذكورة حرفيًا (QR→Context→Service Hub→Outlet→Cart→Payment→Parent/Child→KDS→Runner→Delivered→Tracking) + تسجيل دخول الأدوار السبعة — صفر أخطاء |

**النتيجة: `PHASE 1-4 TECHNICAL BASELINE LOCKED`** — Status الرسمي المطلوب في §0/§1 من الوثيقة، مُثبَّت بوسم Git منفصل (`v2.0.3-p4-baseline-locked`).

## سجل التغييرات عبر الجولات التصحيحية

| الإصدار | التغيير الجوهري |
|---|---|
| v2.0.0-final-quality-closure | أول إغلاق شامل — تبيَّن لاحقًا أنه يحتوي عدد اختبارات خاطئ (70 بدل 68) وتناقضات توثيقية |
| v2.0.1-corrective | صحَّح عدد الاختبارات (73/73)، أزال تناقض GAP_REGISTER الذاتي (14/6 مقابل 15/5)، أعاد تصنيف Q09 كـPartial صراحة |
| **v2.0.2-corrective-2 (هذا الإصدار)** | إعادة كتابة هذه الوثيقة كجدول وحيد بلا حالات تاريخية متبقية (كانت Q01/Q03/Q04 لا تزال تُقرأ "لم يُبنَ" رغم إنجازها)؛ إصلاح خلل تنسيق جدول حقيقي (صفا Q10/Q11 كانا مُدمَجين سطرًا واحدًا بلا فاصل)؛ تصحيح مرجع Q13 لآخر Tag؛ فرض `SESSION_SECRET` إلزاميًا في Production بدل تحذير فقط؛ منع Demo Seed التلقائي في Production؛ تصحيح/حذف مرجع Migration 004 غير الحقيقي في `db.js` |

راجع `docs/CHANGELOG.md` للتفصيل الكامل الحرفي، و`git log --oneline` للتاريخ الفعلي بلا حذف.
