> **Baseline:** `v2.12.0-r4a-audit` · **Type:** R4-B Production Blocker Closure · **Date:** 2026-08-18 · **Verdict:** **CONDITIONAL GO — Single Instance** (بانتظار مراجعتك)

# R4-B — Production Blocker Closure

## الحكم

# 🟡 CONDITIONAL GO — Single Instance

**PB-1 · PB-2 · G-2 مُغلقة ومُثبتة.** PB-3 صار **قيد نشر مُنفَّذًا** لا تحذيرًا.

> **لا GO نهائي من طرفي** كما نصّ طلبك. الحزمة جاهزة لمراجعتك.

---

## قيد بيئي أُعلنه صراحةً

**لا Docker في بيئة البناء**، فلم أستطع تنفيذ `docker build` حرفيًا.

**البديل المستخدم**: `scripts/verify-container-image.js` **يقرأ تعليمات `COPY` من `Dockerfile` نفسه** ويبني منها شجرة معزولة ثم يُقلع منها. قائمة ملفات مكتوبة يدويًا كانت ستنحرف عن الملف عند أول تعديل ثم "تُثبت" شيئًا غير صحيح — وهو صنف الخطأ نفسه الذي أنتج probes خاطئة سابقًا.

**ما يلزم للتحقق النهائي**: بيئة فيها Docker لتنفيذ `docker build` ثم `docker run` — والأداة نفسها تصلح كخطوة تحقق داخل خط النشر.

---

## 1. PB-1 — مهاجرات الإنتاج · ✅ PASS

### الإصلاح
```dockerfile
COPY migrations ./migrations
```
**وحارس Fail-Fast** في `lib/migrate.js`: المجلد المفقود **أو الفارغ** يرمي `FATAL` ويمنع الإقلاع. العودة الصامتة `return []` هي ما حوّل صورة معطوبة إلى إقلاع "ناجح".

### الدليل — الإيجابي
```
COPY directives read from Dockerfile: server.js, db.js, lib, public, migrations
ready: true · aliveAfterGrace: true · exited: false
tables: 63 · migrationsApplied: 17/17 · lastMigration: 017_branding_overrides
CONTAINER CHECK: PASS
```

**`aliveAfterGrace` هو التأكيد الأهم**: العطل السابق كان يقع **بعد** الإقلاع حين يبدأ العامل عمله — فبلوغ Ready وحده لم يكن كافيًا لإثبات السلامة.

### الدليل — السلبي
```
materialised: server.js, db.js, lib, public        ← بلا migrations
ready: false · exitCode: 1 · refusedWithFatal: true · migrationsApplied: 0
CONTAINER CHECK: PASS
```

**بلا مهاجرات: رفض صريح برمز فشل** — لا خادم بمخطط ناقص.

---

## 2. PB-2 — الوكيل الموثوق · ✅ PASS

### الإصلاح
`X-Forwarded-For` **لا تُقبل إلا** إذا كان **عنوان المقبس** ضمن `TRUSTED_PROXY_IPS`. الافتراضي: **لا ثقة**.

**قراران يستحقان الذكر**:
- **الإثبات الوحيد المقبول هو عنوان المقبس** — لا ترويسة أخرى، لأن كل ترويسة يكتبها العميل
- **يُقرأ آخر عنصر في السلسلة لا أوله** — الأول يكتبه العميل ويمكن حشوه، والوكيل الموثوق يُلحق العنوان الحقيقي في النهاية

### الدليل — السيناريوهات الخمسة

| # | السيناريو | النتيجة |
|---|---|---|
| 1 | عميل مباشر + XFF مُزوَّر متغيّر | ✅ **لا يتجاوز** · والطلب بلا ترويسة يبقى محجوبًا |
| 2 | وكيل غير مُدرَج + XFF | ✅ **لا يتجاوز** |
| 3 | وكيل موثوق + XFF | ✅ **كل عميل يُحسب على حدة** · وعميل واحد يُحدّ كالمعتاد |
| 4 | سلسلة multi-hop مُزوَّرة | ✅ **الحشو لا يُنتج هويات جديدة** |
| 5 | بقية الحزم (الطلب · الولاء) | ✅ **فعّالة رغم الترويسة** |

**ونتيجة مهمة**: **محدّد محاولات الدخول محصّن ببنيته** — مفتاحه **اسم المستخدم** لا العنوان، فلا تمسّه أي ترويسة إطلاقًا.

**16/16 اختبارًا.**

---

## 3. G-2 — النسخ والاستعادة · ✅ PASS

### لماذا ليس `cp`
النسخ المباشر أثناء الكتابة يُنتج ملفًا ممزقًا، **ومع WAL يصبح أسوأ**: الملف الرئيس قد لا يحمل آخر المعاملات المُثبتة، فتبدو النسخة سليمة وهي ناقصة بصمت. **نسخة لا تُكتشف عيوبها إلا وقت الكارثة أسوأ من لا نسخة**، لأنها تمنح ثقة زائفة.

**البديل**: `VACUUM INTO` — عملية ذرّية تُنتج قاعدة متسقة **والخادم يكتب**، بلا إيقاف خدمة.

### الدليل — تمرين فعلي والخادم يعمل
```
source:   63 جدولًا · 17 مهاجرة
restored: 63 جدولًا · 17 مهاجرة
digestMatches: true · schemaMatches: true · migrationsMatch: true · countsMatch: true
RESTORE DRILL: PASS
```
العدّادات المتطابقة شملت: `partners` · `orders` · `payments` · `refunds` · `settlements` · `revenue_ledger` · `loyalty_accounts` · `users` · `audit_log`.

### الإجراء الموثَّق

| البند | القرار |
|---|---|
| **مكان الحفظ** | `BACKUP_DIR` (افتراضيًا `./backups`) — **يجب أن يكون على وحدة تخزين منفصلة** عن قاعدة البيانات |
| **الاحتفاظ** | `BACKUP_RETENTION_DAYS` (افتراضيًا 14) · التنظيف تلقائي بعد كل نسخة |
| **التحقق** | `PRAGMA integrity_check` + وجود `schema_migrations` + بصمة SHA-256 — **يجري فور الإنشاء** لا عند الاستعادة |
| **الاستعادة** | `node scripts/backup-restore.js restore --file <bk> --db <target>` |
| **عند فشل النسخ** | الملف يُحذف ولا يُترك جزئيًا يُظن نسخة صالحة |
| **عند فشل الاستعادة** | **نسخة غير مُتحقَّقة تُرفض** · والقاعدة القائمة **تُزاح لا تُحذف** (`.replaced-<ts>`) فيبقى مسار تراجع |

**التحقق فور الإنشاء قرار مقصود**: نسخة معطوبة تُكتشف **الآن** وهناك وقت لإعادة المحاولة، لا بعد أسبوعين وقت الحاجة إليها.

---

## 4. PB-3 — تعدد النسخ · ⏸ **INTENTIONALLY DEFERRED — MULTI-INSTANCE BLOCKER**

**لم يُنفَّذ Redis** بقرارك — الإطلاق الأول بنسخة واحدة.

**لكن التحذير وحده لم يبقَ**: `APP_INSTANCES > 1` في الإنتاج **يرفض الإقلاع** برمز `1` ورسالة تُسمّي الشرط المطلوب. التحذير يمرّ في السجل ويستمر النشر، فيصبح تعدد النسخ "يعمل" ظاهريًا بينما كل حد مضروب في عدد النسخ.

**تجاوز واعٍ متاح** لبيئات الاختبار عبر `ACCEPT_MULTI_INSTANCE_RISK=1` — **قرار يُكتب صراحة ويُسجَّل**، لا سلوك افتراضي صامت.

| الحالة | السلوك |
|---|---|
| `APP_INSTANCES=1` | ✅ يُقلع طبيعيًا |
| `APP_INSTANCES=4` في الإنتاج | ⛔ **`exit 1`** + `not production-supported` |
| `+ ACCEPT_MULTI_INSTANCE_RISK=1` | ⚠️ يُقلع مع `multi_instance_risk_accepted` مُسجَّلًا |

**التصنيف: `INTENTIONALLY DEFERRED — MULTI-INSTANCE BLOCKER` · ليس Closed.**

---

## 5. أدلة الإغلاق التسعة

| # | الشرط | النتيجة |
|---|---|---|
| 1 | Full Test Suite | ✅ **1159 / 1159** · 32 مجموعة · 0 FAIL |
| 2 | Cross-System Audit | ✅ `matrix clean: no 500, no unintended 404` |
| 3 | Browser E2E | ✅ رحلة الطلب · الأدوار السبعة · **0 أخطاء** |
| 4 | إقلاع إنتاج نظيف من الصورة | ✅ 63 جدولًا · 17/17 · حيّ بعد فترة سماح |
| 5 | اختبار سلبي للمهاجرات | ✅ `exit 1` + FATAL |
| 6 | اختبارات الوكيل الموثوق | ✅ **16/16** |
| 7 | تمرين النسخ والاستعادة | ✅ `RESTORE DRILL: PASS` |
| 8 | لا انحدار | ✅ Lifecycle · Subscription · IAM · Finance · Engage · Loyalty · White Label |
| 9 | تقرير الإغلاق | ✅ هذا المستند |

**نمو التغطية**: 1116 ← **1159** (+43) · **صفر تعديل على اختبار قائم**.

**close guard**: `409(PASS) · 409(PASS) · drained 0(PASS) · 200(PASS)`

---

## 6. ما بقي مؤجَّلًا

| البند | التصنيف | الأثر على الإطلاق الأحادي |
|---|---|---|
| **PB-3 مخزن مشترك** | **DEFERRED — MULTI-INSTANCE BLOCKER** | **لا أثر** — القيد مُنفَّذ |
| PostgreSQL | ENVIRONMENT REQUIRED | لا أثر — SQLite بـWAL كافية لحمل واحد |
| Redis | مرتبط بـPB-3 | لا أثر |
| S-1 ترويسات الأمان | GAP / MEDIUM | دفاع في العمق — **لا ثغرة مستغَلّة** |
| S-2 `products.image_url` | TECHNICAL DEBT | يتطلب مسؤولًا مُخترَقًا |
| G-1 فهرس `audit_log` | GAP / MEDIUM | يتباطأ مع النمو لا يفشل |
| G-3 تغطية التسجيل | GAP / LOW | الرقابة ممكنة |
| مزوّد دفع حقيقي | ENVIRONMENT REQUIRED | ينتظر قرارك |
| رفع الشعار · Custom Domain · الخطوط · شاشة التحميل | INTENTIONALLY DEFERRED | لا أثر |

---

## 7. متطلبات النشر الأحادي

```bash
NODE_ENV=production
SESSION_SECRET=<32+ محرفًا عشوائيًا>
ADMIN_BOOTSTRAP_USERNAME=<...>
ADMIN_BOOTSTRAP_PASSWORD=<12+ محرفًا>
APP_INSTANCES=1                          # أكثر من ذلك يرفض الإقلاع
TRUSTED_PROXY_IPS=<عنوان الوكيل العكسي>   # بدونه لا تُقبل XFF إطلاقًا
BACKUP_DIR=/var/backups/alnadl            # وحدة تخزين منفصلة
BACKUP_RETENTION_DAYS=14
```

**النسخ الاحتياطي المجدول**:
```
0 2 * * *  node /app/scripts/backup-restore.js backup
```

**تمرين استعادة دوري** (شهريًا كحد أدنى):
```
node scripts/backup-restore.js drill --db /path/to/live.sqlite
```

---

**لم أُعطِ GO نهائيًا.** الحزمة جاهزة لمراجعتك المباشرة قبل اعتماد الإطلاق.
