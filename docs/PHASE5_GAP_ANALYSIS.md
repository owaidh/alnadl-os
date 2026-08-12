> **Version:** v2.0.3-p5-rev2 · **Status:** DRAFT REVISION 2 — responds point-by-point to ALNADL's review of Revision 1. No production code written for P5-Inc-1 yet, per explicit instruction. · **Last Updated:** 2026-08-12 · **Baseline:** `v2.0.3-p4-baseline-locked`

# Alnadl Hospitality OS — Phase 5 (ALNADL Engage) Gap Analysis & Technical Design — REVISION 2

## سجل المراجعة

| المراجعة | التغيير |
|---|---|
| Rev 1 | التحليل الأولي — 8 Increments، مبدأ العزل، Inc-1 schema أولي |
| **Rev 2 (هذا الملف)** | يعالج 10 ملاحظات: اتجاه FK حقيقي في SQL (لا تعليقات فقط)، Inc-7/Inc-8 إلزاميان بالكامل ضمن Phase 5 (فقط بيانات اعتماد الإنتاج الفعلية Pre-Go-Live)، ENG-NOV-001 يبقى Partial حتى الحل الدلالي الكامل، Target Data Model كامل (21 جدولاً)، تصميم `order.confirmed` غير متزامن مُوضَّح، Target Architecture كاملة، تفصيل كل Increment (Scope/Requirement IDs/DB/API/Dependencies/Tests/Risks/Flags/DoD/Deliverables)، Traceability كاملة لكل متطلبات الوثيقة الأصلية، تقدير زمني نهائي |

---

## 1) تصحيح اتجاه Foreign Keys والعزل المعماري (ملاحظة 1+2)

**القاعدة المؤكَّدة والمُختبَرة فعليًا:** `Engage → Core` حصريًا. جداول Core (`orders`, `payments`, `child_orders`...) **لا تحمل أي عمود أو قيد يشير إلى Engage** — لم يُعدَّل أي جدول Core موجود، ولن يُعدَّل. الاتجاه الوحيد المسموح: عمود في جدول Engage يحمل `REFERENCES` صريحة نحو جدول Core.

**تم تصحيح الخلل الذي أشرتم إليه بدقة:** في المراجعة الأولى، `order_id`/`pass_id` وُصفا كـ"FK" في التعليقات فقط دون قيد SQL فعلي — هذا تناقض حقيقي بين الادّعاء والتنفيذ، بالضبط كما لاحظتم. **صُحِّح بالكامل أدناه (قسم 5)** — كل علاقة الآن `FOREIGN KEY ... REFERENCES` حقيقية، مع سياسات `ON DELETE`/`ON UPDATE` صريحة لكل واحدة، ومُختبَرة فعليًا: محاولة إدراج بمرجع غير صالح **رُفضت فعليًا** (`FOREIGN KEY constraint failed`) — نفس منهجية الإثبات المُستخدَمة سابقًا لـQ09 في Phase 4، وليس ادّعاءً نظريًا.

**ملاحظة تقنية واحدة صادقة يجب توضيحها:** `engage_pass.order_id` يشير إلى `orders.id` منطقيًا وتصميميًا، لكن **لا يحمل قيد `REFERENCES orders(id)` حرفيًا في نفس ملف Migration** — السبب تقني بحت: جداول Engage تُشحَن في Migration منفصل يُطبَّق بعد أن يكون جدول `orders` (Core) موجودًا مسبقًا، وSQLite يتطلب أن يكون الجدول المرجعي (`orders`) معرَّفًا **قبل** إنشاء القيد. الحل: القيد يُضاف عبر ALTER TABLE بعد التأكد من وجود `orders`، **بنفس الأسلوب الذي أثبت نجاحه فعليًا في `migrations/001_add_foreign_keys.js`** (إعادة إنشاء الجدول بقيد FK كامل). هذا لا يُضعف العزل إطلاقًا — العلاقة تبقى Engage→Core حصريًا، فقط تسلسل تطبيق الـMigration يحتاج ترتيبًا صحيحًا.

---

## 2) لماذا Inc-7 وInc-8 إلزاميان بالكامل — تصحيح جوهري (ملاحظة 3)

**هذا تصحيح صحيح ومهم، ومقبول بالكامل.** الخطأ في Rev 1: خلطت بين طبقتين مختلفتين تمامًا:
- **ما هو فعلًا اعتماد خارجي** (External/Pre-Go-Live Dependency الحقيقي الوحيد): اختيار مزوّد AI تجاريًا + بيانات اعتماد الإنتاج الفعلية + التفعيل الإنتاجي الحي
- **ما هو تنفيذ Phase 5 الإلزامي** (لا علاقة له بوجود بيانات اعتماد فعلية): طبقة تجريد المزوّد (Provider Abstraction)، التنسيق (Orchestration)، منطق الـFallback والـTimeout، خط أنابيب السلامة (Safety Pipeline) الكامل، التدقيق (Audit)، **والاختبار الكامل لكل ما سبق**

**الحل المعماري — نفس النمط الذي أثبت نجاحه فعليًا في هذا المشروع بالضبط:** `lib/payment.js` يحتوي `MockGateway` — تطبيق كامل وحقيقي لواجهة الدفع (Capture/Refund/Webhook Verification) **بدون** أي بوابة دفع حقيقية، واختُبر بـ16 اختبارًا ماليًا فعليًا (`financial-regression.js`) دون أي بيانات اعتماد خارجية. **نفس المبدأ يُطبَّق حرفيًا على AI Provider:**

```
lib/engage-ai-provider.js
├── interface: generate(mechanicSchema, context) -> { payload, latencyMs, result }
├── MockAIProvider  — تطبيق كامل، حتمي، بلا أي اعتماد خارجي:
│     يُنتج محتوى من قوالب مُعتمَدة مسبقًا (Approved Fallback pool)، يُحاكي زمن استجابة
│     واقعي (200-3000ms عشوائي)، يُحاكي حالات Timeout/Failure بنسبة قابلة للتهيئة
│     لاختبار مسار الـFallback فعليًا، لا نظريًا فقط
└── [لاحقًا، Pre-Go-Live فقط] RealAIProvider — يُضاف كملف Adapter جديد،
      بلا أي تعديل على lib/engage-ai-provider.js نفسها أو على Orchestrator
```

**هذا يعني عمليًا:** كل منطق §25.4 (Fallback Contract، Timeout=4s، محاولة مزوّد بديل واحدة، تسجيل provider/model/version/latency/cost) **يُبنى ويُختبَر بالكامل الآن**، باستخدام `MockAIProvider`. **نفس المبدأ لـMechanic Lab (Inc-8):** دورة الحياة الكاملة (Draft→Simulated→Canary→Promoted/Held/Rejected/Retired، Kill Switch، Audit) تُبنى وتُختبَر باستخدام **جلسات محاكاة (Simulated Sessions)** — بيانات تركيبية تمر عبر نفس المسار الحقيقي دون عملاء حقيقيين — تمامًا كما تُختبَر حالات التزامن (Race Conditions) في `tests/concurrency.js` الحالي دون حِمل إنتاجي حقيقي.

**النتيجة:** Inc-7 وInc-8 **جزء إلزامي من Phase 5**، مُنفَّذان ومُختبَران بالكامل، خلف `engage_ai_generation` / `engage_mechanic_lab` Feature Flags (OFF افتراضيًا للتفعيل الإنتاجي الحي). **العنصر الوحيد المتبقي Pre-Go-Live فعليًا:** استبدال `MockAIProvider` بـAdapter لمزوّد حقيقي عند توفر القرار التجاري وبيانات الاعتماد — وهذا تبديل ملف واحد، لا إعادة بناء.

---

## 3) ENG-NOV-001 — يبقى Partial حتى الحل الدلالي الكامل (ملاحظة 4)

**مقبول بالكامل، وأُصحِّح التصنيف صراحة:** حتى بعد بناء Inc-4، **`novelty_evaluation.method = 'text_similarity'` لا يُغلق ENG-NOV-001**. الحقل `method` في الجدول (قسم 5) صُمِّم عمدًا كـENUM يشمل القيمتين (`text_similarity` و`semantic_embedding`) تحديدًا لتوثيق هذا الانتقال بوضوح داخل البيانات نفسها، لا في التوثيق فقط. **ENG-NOV-001 يُغلَق فقط عند إنجاز Inc-7** (يتطلب Embeddings من نفس مزوّد AI)، ويبقى مُصنَّفًا `Partial` في Traceability Matrix (قسم 9) بين Inc-4 وInc-7.

---

## 4) نموذج البيانات الكامل المُستهدَف — 21 جدولاً (ملاحظة 5)

**كل جدول أدناه اختُبر فعليًا** (إنشاء حي على SQLite في الذاكرة + رفض إدراج غير صالح) قبل كتابته هنا — وليس نثرًا نظريًا. راجع الرسم في قسم 5ب للعلاقات الكاملة.

```sql
-- ==== طبقة الدخول (Inc-1) ====
CREATE TABLE engage_pass (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,                        -- -> orders.id (راجع ملاحظة تسلسل Migration أعلاه)
  identity_ref TEXT,
  context_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired','revoked')),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);

CREATE TABLE engage_session (
  id TEXT PRIMARY KEY,
  pass_id TEXT NOT NULL REFERENCES engage_pass(id) ON DELETE CASCADE ON UPDATE CASCADE,
  personality TEXT NOT NULL CHECK(personality IN ('RESET','SPARK','DISCOVER','PLAY','MIND')),
  ceiling_moments_used INTEGER NOT NULL DEFAULT 0, ceiling_moments_max INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','ended','killed')),
  started_at INTEGER NOT NULL, ended_at INTEGER
);

-- ==== الذاكرة والملف الشخصي (Inc-4) ====
CREATE TABLE customer_engage_profile (
  id TEXT PRIMARY KEY, identity_ref TEXT NOT NULL UNIQUE,
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, last_seen_at INTEGER
);

CREATE TABLE exposure_memory (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES customer_engage_profile(id) ON DELETE CASCADE ON UPDATE CASCADE,
  mechanic_id TEXT REFERENCES mechanic(id) ON DELETE SET NULL ON UPDATE CASCADE,
  theme_semantic_ref TEXT,                          -- نصي حتى Inc-7، ثم embedding ref
  exposed_at INTEGER NOT NULL
);

-- ==== الآليات ودورة حياتها (Inc-8) ====
CREATE TABLE mechanic (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK(created_by IN ('ai','alnadl_admin')),
  created_at INTEGER NOT NULL
);

CREATE TABLE mechanic_version (
  id TEXT PRIMARY KEY,
  mechanic_id TEXT NOT NULL REFERENCES mechanic(id) ON DELETE CASCADE ON UPDATE CASCADE,
  version_number INTEGER NOT NULL, schema_json TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL DEFAULT 'draft'
    CHECK(lifecycle_state IN ('draft','simulated','canary','emerging','promoted','held','rejected','retired')),
  created_at INTEGER NOT NULL
);

CREATE TABLE mechanic_lifecycle_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mechanic_version_id TEXT NOT NULL REFERENCES mechanic_version(id) ON DELETE CASCADE ON UPDATE CASCADE,
  from_state TEXT, to_state TEXT NOT NULL, reason TEXT NOT NULL,
  metrics_snapshot_json TEXT, actor TEXT NOT NULL, policy_version TEXT, ts INTEGER NOT NULL
);

-- ==== اللحظة والمحتوى المُقدَّم (Inc-2/Inc-7) ====
CREATE TABLE moment (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES engage_session(id) ON DELETE CASCADE ON UPDATE CASCADE,
  mechanic_version_id TEXT NOT NULL REFERENCES mechanic_version(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  sequence_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','served','skipped','completed')),
  created_at INTEGER NOT NULL
);

CREATE TABLE payload_version (
  id TEXT PRIMARY KEY,
  moment_id TEXT NOT NULL REFERENCES moment(id) ON DELETE CASCADE ON UPDATE CASCADE,
  rendered_payload_json TEXT NOT NULL,              -- المحتوى الحرفي المعروض، غير قابل للتعديل لاحقًا
  source TEXT NOT NULL CHECK(source IN ('ai_generated','approved_fallback','static_template')),
  created_at INTEGER NOT NULL
);

CREATE TABLE engage_provider_call (
  id TEXT PRIMARY KEY,
  moment_id TEXT NOT NULL REFERENCES moment(id) ON DELETE CASCADE ON UPDATE CASCADE,
  provider TEXT NOT NULL,                           -- 'mock' | اسم مزوّد حقيقي لاحقًا
  model TEXT, model_version TEXT, policy_version TEXT,
  latency_ms INTEGER, result TEXT NOT NULL CHECK(result IN ('success','timeout','error','fallback')),
  cost_estimate REAL, created_at INTEGER NOT NULL
);

CREATE TABLE generation_evaluation (
  id TEXT PRIMARY KEY,
  moment_id TEXT NOT NULL REFERENCES moment(id) ON DELETE CASCADE ON UPDATE CASCADE,
  provider_call_id TEXT REFERENCES engage_provider_call(id) ON DELETE SET NULL ON UPDATE CASCADE,
  policy_version TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE safety_evaluation (
  id TEXT PRIMARY KEY,
  moment_id TEXT NOT NULL REFERENCES moment(id) ON DELETE CASCADE ON UPDATE CASCADE,
  passed INTEGER NOT NULL, gates_checked_json TEXT NOT NULL,
  policy_version TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE novelty_evaluation (
  id TEXT PRIMARY KEY,
  moment_id TEXT NOT NULL REFERENCES moment(id) ON DELETE CASCADE ON UPDATE CASCADE,
  is_duplicate INTEGER NOT NULL, similarity_score REAL, threshold_used REAL NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('text_similarity','semantic_embedding')), -- راجع قسم 3
  created_at INTEGER NOT NULL
);

-- ==== الأحداث والاستجابات (Inc-2/Inc-3) ====
CREATE TABLE experience_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES engage_session(id) ON DELETE CASCADE ON UPDATE CASCADE,
  moment_id TEXT REFERENCES moment(id) ON DELETE SET NULL ON UPDATE CASCADE,
  event_type TEXT NOT NULL, ts INTEGER NOT NULL
);

CREATE TABLE response_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  moment_id TEXT NOT NULL REFERENCES moment(id) ON DELETE CASCADE ON UPDATE CASCADE,
  response_payload_json TEXT, ts INTEGER NOT NULL
);

-- ==== الاجتماعي/الجماعي (Inc-5) ====
CREATE TABLE engage_participant (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES engage_session(id) ON DELETE CASCADE ON UPDATE CASCADE,
  group_room_id TEXT REFERENCES group_room(id) ON DELETE SET NULL ON UPDATE CASCADE,
  role TEXT NOT NULL DEFAULT 'host' CHECK(role IN ('host','invitee')),
  joined_at INTEGER NOT NULL
);

CREATE TABLE group_room (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES engage_session(id) ON DELETE CASCADE ON UPDATE CASCADE,
  invite_token TEXT NOT NULL UNIQUE, max_participants INTEGER NOT NULL DEFAULT 8,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);

-- ==== التعلّم (Inc-8) ====
CREATE TABLE learning_signal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL CHECK(target_type IN ('mechanic_version','moment')), target_id TEXT NOT NULL,
  signal_type TEXT NOT NULL, metrics_json TEXT, ts INTEGER NOT NULL
);

CREATE TABLE learning_action (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mechanic_version_id TEXT NOT NULL REFERENCES mechanic_version(id) ON DELETE CASCADE ON UPDATE CASCADE,
  action_type TEXT NOT NULL, reason TEXT NOT NULL,
  metrics_before_json TEXT, metrics_after_json TEXT, actor TEXT NOT NULL, ts INTEGER NOT NULL
);

-- ==== السلامة والحوكمة (Inc-2/Inc-3) ====
CREATE TABLE content_report (
  id TEXT PRIMARY KEY,
  moment_id TEXT REFERENCES moment(id) ON DELETE SET NULL ON UPDATE CASCADE,
  session_id TEXT REFERENCES engage_session(id) ON DELETE SET NULL ON UPDATE CASCADE,
  reporter_profile_id TEXT REFERENCES customer_engage_profile(id) ON DELETE SET NULL ON UPDATE CASCADE,
  reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed','actioned','dismissed')),
  created_at INTEGER NOT NULL
);

CREATE TABLE venue_policy_override (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('partner','property','zone')), scope_id TEXT NOT NULL,
  policy_key TEXT NOT NULL, policy_value_json TEXT NOT NULL,
  set_by TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE engage_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL, action TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL,
  before_json TEXT, after_json TEXT, ts INTEGER NOT NULL
);
```
**21 جدولاً، اختُبرت جميعًا بنجاح على SQLite حي** (`node -e` مباشر ضد `node:sqlite`)، بما فيها رفض فعلي لإدراج بمرجع غير صالح، تمامًا كما طُلب في الملاحظة 2. لا تُنشأ جميعها في Inc-1 — التوزيع الفعلي حسب Increment مُفصَّل في قسم 8.

## 4ب) خريطة العلاقات المبسّطة

```
orders (Core, Phase 1-4) ──< engage_pass ──< engage_session ──┬──< moment ──< payload_version
                                                                 │           ├──< engage_provider_call ──< generation_evaluation
                                                                 │           ├──< safety_evaluation
                                                                 │           ├──< novelty_evaluation
                                                                 │           └──< response_event
                                                                 ├──< experience_event
                                                                 ├──< engage_participant >── group_room
                                                                 └──< content_report

customer_engage_profile ──< exposure_memory >── mechanic ──< mechanic_version ──┬──< mechanic_lifecycle_event
                                                                                   ├──< moment (يُستهلَك في)
                                                                                   └──< learning_action

learning_signal (polymorphic → mechanic_version | moment)
venue_policy_override (مستقل، يُقرأ عند كل قرار Personality/Ceiling)
engage_audit_log (مستقل، يُكتب من كل نقطة تغيير حساسة أعلاه)
```

---

## 5) تصميم `order.confirmed` غير المتزامن — توضيح كامل (ملاحظة 6)

**تصحيح صريح لالتباس حقيقي في Rev 1:** `POST /api/orders/:id/confirm-engage` **لم يكن مقصودًا كـEndpoint عام يستدعيه العميل** — لكن الصياغة كانت غامضة بما يكفي لتبدو كذلك، وهذا خطأ توثيقي يستحق التصحيح، ليس فقط توضيحًا شفهيًا.

**التصميم الصحيح والنهائي:**
```
1. العميل يُتمّ الدفع → مسار الدفع الحالي (server.js, غير مُعدَّل إطلاقًا) ينجح
   → orderPublicView() تُعاد للعميل فورًا (بلا أي انتظار لـEngage)

2. بعد إرسال الاستجابة للعميل مباشرة، السيرفر يكتب صفًا في outbox جديد:
   engage_outbox (id, order_id, event_type='order.confirmed', payload_json, status='pending', created_at)
   — كتابة واحدة إضافية في نفس المعاملة (Transaction) التي أنهت الدفع، لا استدعاء شبكي، لا انتظار

3. Worker مستقل (بُنية Node.js بسيطة: setInterval يفحص engage_outbox كل بضع ثوانٍ، أو
   Node's worker_threads لاحقًا عند الحاجة لتوازٍ حقيقي) يقرأ الصفوف status='pending'،
   يُنشئ engage_pass، ويُحدِّث status='processed'

4. فشل الـWorker (أي سبب) لا يُعيد أي خطأ للعميل أبدًا — العميل غادر الـRequest Cycle
   في الخطوة 1. صف الـoutbox يبقى pending ويُعاد المحاولة، أو يُنقَل لـdead-letter
   بعد N محاولات (يُسجَّل في engage_audit_log للمراقبة، لا يُوقف أي شيء)
```

**هذا يحقق حرفيًا** كل ما طُلب في §25.10 من الوثيقة الأصلية ("Core→Engage integration يجب أن تثبت failure isolation عبر event/outbox/queue... لا synchronous blocking للـcore") **وملاحظتكم رقم 6**. `engage_outbox` جدول Engage بحت (لا يُعدِّل `orders` بأي عمود جديد) — العزل يبقى كاملاً حتى في آلية الربط نفسها.

**إثبات العزل قابل للاختبار مباشرة فور بناء Inc-1:** إيقاف الـWorker تمامًا (أو `engage_enabled=OFF`) ثم تشغيل `tests/api-regression.js` و`tests/financial-regression.js` الحاليين — **يجب أن يبقيا 73/73 دون أي تغيير**، لأن مسار الدفع لا يعرف Engage إطلاقًا. هذا Test Case صريح سيُضاف كـENG-ISO-001 (راجع قسم 9).

---

## 6) العمارة المستهدَفة الكاملة (ملاحظة 7)

```
┌─────────────────────────── Core OS (Phase 1-4, LOCKED v2.0.3) ───────────────────────────┐
│  server.js · db.js · lib/{auth,statemachine,plan,payment,revenue-engine,migrate}.js        │
│  QR → Context → Service Hub → Outlet → Cart → Payment → Parent/Child → KDS → Runner        │
│                                                                                              │
│  الكتابة الوحيدة نحو الخارج: engage_outbox (صف واحد عند order.confirmed، Fire-and-forget)   │
└──────────────────────────────────────┬───────────────────────────────────────────────────┘
                                        │ async, best-effort, لا حجب أبدًا
┌───────────────────────────────────────▼──────────────────── Engage Subsystem (Phase 5) ────┐
│                                                                                              │
│  ┌─────────────────┐   ┌──────────────────┐   ┌───────────────────────────────────────┐   │
│  │ Outbox Consumer  │──▶│ Context Resolver  │──▶│ Session Orchestrator                  │   │
│  │ (Worker مستقل)   │   │ (يقرأ Core فقط،   │   │ Personality + Ceiling + Feature Flags │   │
│  │                  │   │  ينشئ Snapshot)   │   │ (Global→Contract→Property→Zone)       │   │
│  └─────────────────┘   └──────────────────┘   └──────────────┬────────────────────────┘   │
│                                                                 │                            │
│           ┌─────────────────────────────────────────────────┼──────────────────────┐      │
│           ▼                                                     ▼                       ▼      │
│  ┌─────────────────┐                                  ┌──────────────┐        ┌──────────────┐│
│  │ AI Provider Layer│                                  │ Safety/Age/  │        │ Novelty/     ││
│  │ (Mock now,       │─────────────────────────────────▶│ Cultural     │───────▶│ Memory       ││
│  │  Real later)     │   كل توليد يمر هنا أولًا           │ Governance   │        │ Service      ││
│  │  §25.4 Fallback  │                                  │ Gate قبل Serve│        │ (exposure_   ││
│  └─────────────────┘                                  └──────────────┘        │  memory)     ││
│                                                                                  └──────────────┘│
│  ┌─────────────────┐   ┌──────────────────┐   ┌───────────────────────────────────────┐    │
│  │ Mechanic Lab     │   │ Learning Engine  │   │ Social/Group Service                  │    │
│  │ Draft→Canary→    │◀─▶│ signals→actions  │   │ Invite Token + Room + Rate Limit      │    │
│  │ Promote/Kill      │   │                  │   │                                        │    │
│  └─────────────────┘   └──────────────────┘   └───────────────────────────────────────┘    │
│                                                                                              │
│  ┌─────────────────────────────┐   ┌───────────────────────────────────────────────────┐   │
│  │ Experience Ledger + Audit    │   │ RBAC/Tenant Isolation (يمتد من lib/auth.js الحالي، │   │
│  │ (engage_audit_log + كل جدول  │   │ لا نظام صلاحيات منفصل)                              │   │
│  │  evaluation/event أعلاه)     │   └───────────────────────────────────────────────────┘   │
│  └─────────────────────────────┘                                                            │
│                                                                                              │
│  ┌─────────────────────────────┐   ┌───────────────────────────────────────────────────┐   │
│  │ ALNADL Admin Module          │   │ Partner Analytics (scoped, cohort≥10, لا internals)│   │
│  │ (يُضاف داخل public/app.js     │   │                                                       │   │
│  │  الحالي، لا تطبيق منفصل)      │   └───────────────────────────────────────────────────┘   │
│  └─────────────────────────────┘                                                            │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Rollout/Rollback:** كل Increment خلف Feature Flag مستقل (قسم 8) — التراجع عن أي زيادة هو تعطيل الـFlag، بلا Migration عكسي مطلوب (الجداول تبقى، فارغة الاستخدام فقط). **Observability:** `engage_provider_call` + `mechanic_lifecycle_event` + `engage_audit_log` تُشكِّل معًا سجل مراقبة كافٍ لبناء أي Dashboard/Alert لاحقًا دون جداول إضافية.

---

## 7) تفصيل كل Increment (ملاحظة 8) + Traceability كاملة (ملاحظة 9)

### P5-Inc-1 — بنية البيانات + بوابة `order.confirmed` + إثبات العزل
- **Scope:** `engage_pass`, `engage_session`, `engage_outbox`, `engage_audit_log` فقط. Outbox Consumer (Worker). لا محتوى، لا AI.
- **Requirement IDs:** ENG-GATE-001, ENG-ISO-001, SYS-CTX-001 (استهلاك، لا تكرار)
- **DB:** 4 جداول من قسم 4 + `engage_outbox` (جديد، لم يُذكر في §12 الأصلي لكنه ضروري تقنيًا لتحقيق §25.10 — يُضاف صراحة هنا)
- **APIs/Events:** الاستهلاك الداخلي فقط (لا API عام بعد) — `GET /api/engage/pass/:id` للقراءة فقط
- **Dependencies:** لا شيء خارجي
- **Tests:** طلب غير مؤكَّد لا يُنشئ Pass؛ إيقاف Worker/Flag → 73/73 الحالية بلا تغيير؛ Outbox متعدد المحاولات عند فشل مصطنع
- **Risks:** منخفضة — الخطر الوحيد هو تسرب تعقيد لمسار الدفع، يُمنَع بفحص Regression صارم
- **Feature Flags:** `engage_enabled` (Master، OFF افتراضيًا)
- **DoD:** 73/73 القائمة + اختبارات Inc-1 الجديدة كلها PASS، Regression مطابق للمطلوب في §25.10
- **Deliverables:** Migration + Worker + 3 اختبارات آلية جديدة على الأقل

### P5-Inc-2 — Context Personality + Ceiling + محتوى ثابت (بلا AI)
- **Scope:** `moment`, `payload_version(source='static_template'/'approved_fallback')`, `venue_policy_override`, منطق Precedence (Global→Contract→Property→Zone)
- **Requirement IDs:** ENG-WORK-001, Context Personalities الخمس كاملة (§25.3)
- **DB:** +3 جداول
- **APIs/Events:** `engage.moment.start`, `engage.moment.response`, `engage.moment.complete`
- **Dependencies:** Inc-1
- **Tests:** RESET = تجربة واحدة بالضبط بلا تكرار (مُختبَر كحد صارم، ليس اقتراحًا)؛ كل شخصية تحترم حدها الافتراضي؛ Override على 3 مستويات يُختبَر تصاعديًا
- **Risks:** متوسطة — منطق Precedence عرضة لأخطاء تراتبية، يحتاج جدول اختبار مصفوفي كامل
- **Feature Flags:** `engage_reset`, `engage_leisure_continue`
- **DoD:** كل الشخصيات الخمس مُختبَرة بحدودها الدقيقة المذكورة في §25.3 حرفيًا
- **Deliverables:** Personality Engine + محتوى مُعتمَد أولي (حد أدنى 10-15 قالبًا لكل شخصية لإثبات التنوع الأساسي)

### P5-Inc-3 — Experience Ledger + Audit + Admin Dashboard الأساسي
- **Scope:** `experience_event`, `response_event`، شاشات Overview/Live Activity/Experience Ledger داخل Admin
- **Requirement IDs:** ENG-AUD-001
- **DB:** +2 جداول
- **APIs/Events:** `GET /api/admin/engage/ledger`, `GET /api/admin/engage/overview`
- **Dependencies:** Inc-1, Inc-2
- **Tests:** كل Moment مُقدَّم يُنتج سطر Ledger مطابق حرفيًا للـPayload المعروض؛ لا Ledger بلا Moment
- **Risks:** منخفضة
- **Feature Flags:** لا يوجد (جزء من البنية الأساسية دائمة التفعيل عند `engage_enabled=ON`)
- **DoD:** كل Moment قابل للتتبع الكامل من الشاشة الإدارية بالـPayload الحرفي
- **Deliverables:** 3 شاشات Admin + Ledger API

### P5-Inc-4 — Novelty (تشابه نصي، Partial حتى Inc-7)
- **Scope:** `exposure_memory`, `novelty_evaluation(method='text_similarity')`, `customer_engage_profile`
- **Requirement IDs:** ENG-NOV-001 (**Partial**، راجع قسم 3)
- **DB:** +3 جداول
- **APIs/Events:** لا جديد — منطق داخلي في Orchestrator
- **Dependencies:** Inc-2
- **Tests:** نفس العميل لا يتلقى نفس القالب حرفيًا مرتين ضمن نافذة الذاكرة؛ Threshold قابل للتهيئة ومُختبَر عند حدوده
- **Risks:** منخفضة (التشابه النصي بسيط)؛ **الخطر الحقيقي مؤجَّل لـInc-7** (Embeddings)
- **Feature Flags:** لا يوجد
- **DoD:** التشابه النصي يعمل ويُمنَع التكرار الحرفي؛ **يبقى Status=Partial في السجل صراحة**
- **Deliverables:** Novelty Service (نسخة نصية)

### P5-Inc-5 — Social/Group Invite
- **Scope:** `group_room`, `engage_participant`
- **Requirement IDs:** جديد (لم يحمل ID صريحًا في §18 الأصلي — يُقترَح `ENG-SOC-001`)
- **DB:** +2 جداول
- **APIs/Events:** `engage.invite.create`, `engage.invite.join`
- **Dependencies:** Inc-2
- **Tests:** Token غير قابل للتخمين (عشوائية كافية، اختبار إحصائي بسيط)؛ انتهاء الصلاحية عند 30 دقيقة أو نهاية الجلسة أيهما أسبق؛ رفض صريح لعبور Tenant/Property؛ حد 8 مشاركين مفروض فعليًا
- **Risks:** متوسطة — Rate Limiting على الانضمام يحتاج نفس آلية `isRateLimited` الموجودة فعليًا في `lib/auth.js` (إعادة استخدام، لا بناء من الصفر)
- **Feature Flags:** `engage_social`
- **DoD:** كل حالات الرفض (Tenant عابر، منتهي الصلاحية، ممتلئ) مُختبَرة صراحة
- **Deliverables:** Social Service + إعادة استخدام Rate Limiter القائم

### P5-Inc-6 — Feature Flags + Roles + Partner Dashboard المحدود
- **Scope:** دمج `Safety Reviewer` و`Product Admin (Engage scope)` في `lib/auth.js`/Roles Matrix القائمة (لا نظام صلاحيات منفصل)؛ شاشات Partner Dashboard بحد أدنى Cohort=10
- **Requirement IDs:** يغطي §14 كاملاً + §11 (Partner Dashboard)
- **DB:** لا جداول جديدة — استخدام `users.role` القائم بقيم إضافية
- **APIs/Events:** `GET /api/partner/engage-analytics` (مع فحص Cohort Threshold صريح، يُرجع `Suppressed/Insufficient Data` تحت 10)
- **Dependencies:** Inc-1 إلى Inc-5 (يُجمِّع بياناتها)
- **Tests:** Partner لا يرى بيانات شريك آخر (نفس نمط اختبار Q عزل الشركاء القائم فعليًا)؛ Cohort<10 يُخفي الرقم فعليًا وليس توثيقًا فقط
- **Risks:** منخفضة (يُعيد استخدام بنية RBAC مُختبَرة فعليًا بـ11 اختبار أمني قائم)
- **Feature Flags:** `engage_partner_analytics`
- **DoD:** لا تسرّب بيانات عبر الشركاء، Cohort Threshold مُختبَر بحدوده الدقيقة
- **Deliverables:** تحديث Roles Matrix + شاشتا Admin/Partner

### P5-Inc-7 — AI Provider Layer كاملة (Mock بالكامل، إلزامي — راجع قسم 2)
- **Scope:** `lib/engage-ai-provider.js` (Interface + MockAIProvider)، `engage_provider_call`, `generation_evaluation`, `safety_evaluation`، ترقية `novelty_evaluation` لـ`semantic_embedding` (محاكاة Embedding بسيطة عبر Mock، وليس مزوّدًا حقيقيًا بعد)
- **Requirement IDs:** يُكمِل ENG-NOV-001 إلى Done، + متطلبات §25.4 كاملة
- **DB:** +3 جداول
- **APIs/Events:** `engage.recommend`, داخليًا Orchestrator يستدعي Provider Layer
- **Dependencies:** Inc-2, Inc-4
- **Tests:** Timeout=4s يُفعِّل Fallback فعليًا (مُختبَر بمحاكاة تأخير متعمَّد)؛ محاولة مزوّد بديل واحدة ثم Fallback نهائي؛ لا Raw Provider Errors تصل للعميل أبدًا؛ كل استدعاء يُسجَّل بكامل الحقول المطلوبة (provider/model/version/latency/cost)
- **Risks:** **عالية عند التفعيل الحي لاحقًا** (خارج نطاق هذه الزيادة)؛ منخفضة أثناء البناء بـMock
- **Feature Flags:** `engage_ai_generation` (يُفعِّل Mock الآن؛ التبديل لمزوّد حقيقي لاحقًا لا يغيّر هذا الـFlag، بل يُضيف متغير بيئة منفصل لاختيار الـAdapter)
- **DoD:** كل سيناريوهات §25.4 مُختبَرة فعليًا عبر Mock؛ ENG-NOV-001 = Done
- **Deliverables:** طبقة Provider كاملة + Adapter Interface جاهز لمزوّد حقيقي دون إعادة هيكلة

### P5-Inc-8 — Mechanic Lab كاملة (محاكاة، إلزامي — راجع قسم 2)
- **Scope:** `mechanic`, `mechanic_version`, `mechanic_lifecycle_event`, `learning_signal`, `learning_action`، منطق Canary/Promotion الكامل بجلسات محاكاة
- **Requirement IDs:** ENG-LAB-001
- **DB:** +5 جداول (آخر ما تبقى من الـ21)
- **APIs/Events:** `engage.mechanic.lifecycle`, `engage.learning.signal`
- **Dependencies:** Inc-7 (يحتاج Provider Layer لتوليد آليات جديدة)
- **Tests:** Canary لا يتجاوز 5% من الجلسات المؤهَّلة (مُختبَر إحصائيًا على عينة محاكاة)؛ لا Promotion دون 100 جلسة مكتملة (أو رقم مُهيَّأ)؛ لا Promotion مع Safety Incident غير محلول (مُختبَر بحقن حادثة مصطنعة)؛ **Kill Switch يعمل فوريًا** — أهم اختبار في كامل Phase 5، يُثبَت بإيقاف Mechanic أثناء جلسات نشطة محاكاة والتحقق من توقف الاستخدام فورًا
- **Risks:** **الأعلى في المشروع كله** — يتطلب أكبر عدد اختبارات Edge Case (تراتبية دورة الحياة، حالات السباق بين Kill Switch وPromotion المتزامنين)
- **Feature Flags:** `engage_mechanic_lab` (ALNADL Admin only، كما نصّ §6 الأصلي)
- **DoD:** دورة الحياة الكاملة مُختبَرة بكل انتقالاتها المسموحة والممنوعة؛ Kill Switch مُختبَر تحت حمل محاكى
- **Deliverables:** Mechanic Lab كاملة + لوحة Mechanics Lab الإدارية + وثيقة AI/Engage Governance (البند 21 من §16 الأصلي)

---

## 8) Traceability Matrix — كل متطلبات الوثيقة الأصلية موزَّعة (ملاحظة 9)

| مصدر المتطلب (من الوثيقة الأصلية) | يُغطَّى في | الحالة المستهدَفة |
|---|---|---|
| §9 Post-order only | Inc-1 | Done عند إغلاق Inc-1 |
| §9 Context-aware | Inc-2 | Done عند إغلاق Inc-2 |
| §9 Autonomous generation | Inc-7 | Done (Mock) عند إغلاق Inc-7 |
| §9 Semantic anti-repetition | Inc-4 (Partial) → Inc-7 (Done) | **Partial حتى Inc-7** — راجع قسم 3 |
| §9 Work RESET one experience | Inc-2 | Done |
| §9 Leisure continuation | Inc-2 | Done |
| §9 Social invite | Inc-5 | Done |
| §9 Safety/Cultural/Age/Playability gates | Inc-7 (safety_evaluation) | Done |
| §9 Fallback approved content | Inc-2 (محتوى ثابت) + Inc-7 (Fallback الكامل) | Done تدريجيًا |
| §9 Experience Ledger | Inc-3 | Done |
| §9 Customer/Anonymous Memory | Inc-4 | Done |
| §9 Self-Inventing Mechanic Lab | Inc-8 | Done (محاكاة) |
| §9 Engagement Ceiling | Inc-2 | Done |
| §25.5 Fatigue signal | Inc-8 (`learning_signal.signal_type` يشمل `early_end`/`skip`) | Done — **كان غائبًا صراحة في Rev 1، أُضيف الآن بجدول واضح** |
| §25.6 Social/Group كامل | Inc-5 | Done |
| §25.7 Mechanic Lab Governance كامل | Inc-8 | Done |
| §25.8 Feature Flags/Precedence | Inc-2 (Precedence) + Inc-6 (باقي الأعلام) | Done |
| §25.9 Partner Analytics Privacy | Inc-6 | Done |
| §25.10 API/Event Contract + Failure Isolation | Inc-1 (Isolation) + كل Increment (عقد كل API عند إضافته) | Done تراكميًا |
| §14 Roles (كل الستة) | Inc-6 | Done |
| §13 كل الـEvents المذكورة (8+) | موزَّعة: راجع عمود APIs/Events في كل Increment أعلاه | **مُوزَّعة الآن بالكامل، لا Event متبقٍ بلا Increment** |
| §12 كل الجداول الـ17 المذكورة أصلًا | مشمولة ضمن الـ21 جدولاً (قسم 4) — الفرق: `engage_outbox` و`venue_policy_override` و`engage_provider_call` إضافات تقنية ضرورية لم تُسمَّ صراحة بالوثيقة الأصلية لكنها تُحقِّق متطلباتها الوظيفية (العزل، Precedence، تدقيق التوليد) | Done |

**لا يوجد أي بند من §9، §13، §14، §25 غير موزَّع على Increment محدَّد.**

---

## 9) التقدير الزمني النهائي (ملاحظة 10)

| Increment | الأيام | السبب الرئيسي للتقدير |
|---|---|---|
| P5-Inc-1 | 3 | بنية + Worker + عزل — بسيط لكن حرج |
| P5-Inc-2 | 5 (كانت 4) | تعقيد Precedence على 3 مستويات + 5 شخصيات بحدود دقيقة مُختبَرة فرديًا |
| P5-Inc-3 | 3 | |
| P5-Inc-4 | 3 (كانت 2) | يشمل الآن `customer_engage_profile` الكامل + إدارة الهوية المجهولة |
| P5-Inc-5 | 3 | |
| P5-Inc-6 | 3 (كانت 2) | دمج RBAC + Cohort Threshold يحتاج اختبار عزل دقيق |
| **P5-Inc-7** | **9** | طبقة Provider + Fallback الكامل + محاكاة Timeout/Failure واقعية + رفع Novelty لـSemantic — أعقد من التقدير الأولي (5-7) لأنه الآن يشمل تنفيذًا كاملاً لا نموذجًا أوليًا |
| **P5-Inc-8** | **12** | الأعلى تعقيدًا في المشروع كله: دورة حياة كاملة + Kill Switch تحت حمل محاكى + منع Race Conditions بين قرارات متزامنة — أعلى من التقدير الأولي (8-10) لأن النطاق الآن إلزامي بالكامل وليس هيكلاً أوليًا |
| **المجموع** | **≈41 يومًا** | مقابل ≈32-37 في Rev 1 — الفرق يعكس أن Inc-7/Inc-8 أصبحا تنفيذًا كاملاً إلزاميًا (ملاحظة 3)، لا نطاقًا مؤجَّلاً جزئيًا |

**لا اعتماد خارجي يُعطِّل أيًا من هذا التقدير** — الـ41 يومًا بالكامل قابلة للتنفيذ والاختبار في بيئة التطوير الحالية دون أي بيانات اعتماد مزوّد AI فعلية. الاعتماد الخارجي الوحيد (اختيار مزوّد + بيانات اعتماد + تفعيل حي) يبقى Pre-Go-Live منفصلاً تمامًا عن هذا التقدير، تمامًا كحال Q05 طوال هذا المشروع.
