> **Version:** v2.16.4 · **Status:** RELEASE CANDIDATE — **ليست Production Final** · **Date:** 2026-08-20 · **Tag:** `v2.16.4-rc4-atomic-recovery`

# Final Closure Report

> ## ⚠️ هذه النسخة **مرشَّحة لا نهائية**
>
> **الحاجز:** `package-lock.json` غير موجود، و`Dockerfile` ينفّذ `npm ci --omit=dev` الذي **يفشل صراحةً** بدونه — أي أن صورة الإنتاج لا تُبنى من هذه الحزمة كما هي.
>
> ولا يمكن توليده هنا: مستودع npm يعيد **403**. وجوهر ملف القفل بصمات تكامل لكل حزمة، وهي **غير معروفة بلا جلب الحزم فعليًا** — فملف ملفَّق إمّا يفشل عند أول `npm ci` أو، وهو الأسوأ، ينجح بشجرة اعتماديات لم يختبرها أحد.
>
> **الوسم النهائي يجب أن يُقطع بعد إيداع ملف القفل**، في بيئة متصلة، وفق §10.

هذا التقرير يُغلق التسليم. **لا يُستخدم لفظ PASS لأي بند لم يُنفَّذ فعليًا في هذه البيئة**؛ ما يحتاج Docker أو شبكة أو npm أو مسحًا بجهاز حقيقي يبقى `AWAITING_ENVIRONMENT_VERIFICATION` **ولا يُحتسب نجاحًا**.

---

## 1. الملخص التنفيذي

| المقياس | القيمة |
|---|---|
| **Final Commit** | يُقرأ من الوسم (§9) |
| **Final Tag** | `v2.16.4-rc4-atomic-recovery` |
| **Final Version** | `2.16.4` |
| **Total Test Suites** | **42** |
| **Total Assertions** | **1,664** |
| **Migrations Applied** | **23** (آخرها `023_bootstrap_recovery`) |
| **Git Status** | نظيف |
| **AWAITING items** | **6** |

---

## 2. حالة النطاقات

| النطاق | الحالة | الدليل |
|---|---|---|
| **P0 SuperAdmin Access** | **PASS** | `tests/superadmin-access.js` — 73 تأكيدًا · قاعدة جديدة · إعادة تشغيل · قاعدة فيها مستخدم سابق · **استرجاع لمرة واحدة وذرّي** · سيناريو النشر القائم · قفل |
| **P0 Production Persistence** | **PASS** | `tests/production-persistence.js` — 32 تأكيدًا · البقاء مُثبَت **بإماتة العملية** لا بفحص إعداد |
| **Operational Closure (الدفعتان أ و ب)** | **PASS** | `tests/operational-closure-b.js` — 80 تأكيدًا · P1-01 · P1-03 · P1-04 · P1-05 · P1-06 · P1-07 · P1-08 · P2 |
| **Payment Policy** | **PASS** | الوراثة منفذ ← عقار ← شريك · إنفاذ خادميّ · حالة `Confirmed` · لا استرجاع لما لم يُحصَّل |
| **Wallet Linkage** | **PASS** | خصم عابر للمستأجرين مُغلَق · فحص ملكية مزدوج · تفرّد داخل الشريك |
| **Commercial Partner Lifecycle** | **PASS** | Active/Inactive/Closed · الإغلاق محجوب مع عمل قائم · الحقوق المالية محفوظة |
| **Scope 2 — White Label** | **PASS** | `tests/brand-media.js` — 70 تأكيدًا · الوراثة حقلًا بحقل · بوابة المضيف تحكم الكل |
| **Brand Media** | **PASS** | رفع/معاينة/استبدال/حذف · تخزين مجرَّد · أمن الرفع · بقاء عبر إعادة التشغيل وإعادة الإنشاء |
| **Commercial Partner Identity** | **PASS** | `Outlet → Commercial Partner → Property → Main Partner → Default` |
| **Banner Boundary** | **PASS** | `Outlet → Commercial Partner → لا بانر` — لا وراثة عبر حدود العلامات |
| **Brand vs Location Context** | **PASS** | فصل في Brand Shell · التباين **مقيس** 15.5:1 و16.7:1 |
| **Light / Dark / System** | **PASS** | مقروئية مُثبَتة بالقياس في الوضعين |
| **Unified Cart** | **PASS** | مدعومة كاملةً · رحلة حقيقية عبر الشاشات · أقسام لكل منفذ · Shell عام ثابت |
| **Direct Outlet Products (`merchant_id = NULL`)** | **PASS** | `tests/direct-outlet-products.js` — 32 تأكيدًا · سلّة مختلطة بنسبتَي عمولة مختلفتين بلا تسرّب |
| **Acting Context / Audit** | **PASS** | `tests/context-switch-audit.js` — 45 تأكيدًا · بيانات وصفية لا صلاحية |
| **Migrations 019–023** | **PASS** | قاعدة جديدة **و** ترقية قاعدة قائمة — كلاهما مُتحقَّق (§3) |

---

## 3. التحقق من المهاجرات

### قاعدة جديدة فارغة

```
Applied 22 migration(s) · last: 022_audit_acting_context
audit_log: acting_partner_id, target_partner_id ✅
```

### ترقية قاعدة قائمة من إصدار سابق

بُنيت قاعدة فعليًا على الوسم السابق `v2.15.0-operational-closure` (18 مهاجرة)، وكُتبت فيها بيانات، ثم شُغّلت النسخة النهائية عليها:

| | قبل | بعد |
|---|---|---|
| Migrations | 18 | **22** (طُبِّقت 4 فقط: 019 · 020 · 021 · 022) |
| partners | 3 | **3** |
| orders | 5 | **5** |
| products | 9 | **9** |
| audit_log | 1 | **1** |

- صف التدقيق القديم **سليم**، والعمودان الجديدان فيه `null` — لا محاولة لتلفيق سياق لم يقع.
- `PRAGMA integrity_check` = **ok**
- `outlets.merchant_id` و`brand_assets` موجودان بعد الترقية.

**لا فقد ولا تلف.**

---

## 4. الإصلاحات المطلوبة — تحقق من HEAD

| البند | الحالة |
|---|---|
| P0 Production Persistence | ✅ IN HEAD |
| Payment Policy | ✅ IN HEAD |
| Wallet linkage | ✅ IN HEAD |
| Commercial Partner lifecycle | ✅ IN HEAD |
| White Label / Brand Media | ✅ IN HEAD |
| Commercial Partner Identity | ✅ IN HEAD |
| Banner Boundary | ✅ IN HEAD |
| Brand vs Location Context | ✅ IN HEAD |
| Light / Dark / System Mode | ✅ IN HEAD |
| Unified Cart | ✅ IN HEAD |
| Direct Outlet Products (`merchant_id = NULL`) | ✅ IN HEAD |
| SuperAdmin Acting Context | ✅ IN HEAD |
| Audit `acting_partner_id` / `target_partner_id` | ✅ IN HEAD |
| إصلاح الخروج (لا بقاء لـ`S.PARTNER_ID`) | ✅ IN HEAD |

---

## 5. بنود AWAITING_ENVIRONMENT_VERIFICATION

**لا يُحتسب أي منها نجاحًا.** كلٌّ بخطوات تنفيذه الحرفية.

| # | البند | السبب | خطوة الإغلاق |
|---|---|---|---|
| 1 | `package-lock.json` | مستودع npm يعيد **403** من هذه البيئة | `bash scripts/generate-lockfile.sh` على جهاز متصل |
| 2 | توليد صورة QR (SVG/PNG) | `qrcode@1.5.3` غير قابلة للتثبيت هنا · **المُتحقِّق `scripts/verify-qr.js` مكتوب وجاهز** | `npm ci && npm run verify:qr` |
| 3 | إعادة مسح رمز مُنزَّل/مطبوع | يحتاج صورة مُولَّدة | بعد (2) |
| 4 | مسح بكاميرا iPhone/Android | يحتاج جهازًا فعليًا | بعد (2)، بجهازين |
| 5 | `docker build` + `docker run` | لا مُشغِّل حاويات | `bash scripts/docker-verify.sh` |
| 6 | فحوص بقاء الوسائط داخل Docker | لا مُشغِّل حاويات | ضمن (5) |

**لم يُلفَّق ملف قفل:** جوهره بصمات تكامل لا تُعرف بلا جلب الحزم، وملف ملفَّق إمّا يفشل عند أول `npm ci` أو — وهو الأسوأ — ينجح بشجرة اعتماديات لم يختبرها أحد.

**ما هو مُثبَت رغم ذلك:** منطق رمز QR ودورة حياته مُختبَران بالكامل (`tests/qr-flow.js`) — **الصورة وحدها** غير متحقَّقة. و`tests/production-deployment.js` يبني شجرة الملفات من تعليمات `COPY` في الـDockerfile نفسه ويُشغّلها فعليًا (27 تأكيدًا): الإقلاع، الوصول إلى `Ready`، تطبيق كل المهاجرات، رفض الإقلاع بلا `migrations/`، ورفض تعدد النسخ في الإنتاج.

---

## 6. فجوات مسجَّلة — مفتوحة بقرار

| الفجوة | الحالة |
|---|---|
| **تبديل السياق غير مُدقَّق كجلسة خادمية** | مُغلق جزئيًا: حدثا `ADMIN_CONTEXT_ENTERED/EXITED` وعمودا التدقيق يوفّران الربط. جلسة سياق خادمية **لم تُبنَ عمدًا** — الهدف ربط تدقيقي لا مصادقة |
| **حارس العبور في الواجهة لا الخادم** | مقصود: SuperAdmin يملك الصلاحية بحق، فالمنع الخادميّ كان سيكون خطأً. المسار الخادميّ يبقى مُدقَّقًا صراحةً (`acting ≠ target`) |
| PostgreSQL للإنتاج | Not Implemented — `POSTGRESQL_MIGRATION_PLAN.md` |
| بوابة دفع حقيقية | Waiting for Provider — `lib/payment.js` |
| مخزن محدّد المعدل مشترك (Redis) | Not Implemented — **إلزامي قبل تعدد النسخ** |
| تخزين المبالغ كـ`REAL` | دَين تقني مُعتمَد |

---

## 7. متغيرات البيئة الإلزامية في الإنتاج

| المتغير | بدونه |
|---|---|
| `NODE_ENV=production` | لا تُفعّل الحواجز الإنتاجية |
| `SESSION_SECRET` (32+) | **يرفض الإقلاع** · يجب أن يبقى **ثابتًا** وإلا خرج كل المستخدمين مع كل نشر |
| `SQLITE_PATH` | **يرفض الإقلاع** — لا افتراض صامت على قرص مؤقت |
| `BRAND_MEDIA_PATH` | **يرفض الإقلاع** — صور على قرص مؤقت = شعار مكسور بعد أول إعادة تشغيل |
| `ADMIN_BOOTSTRAP_USERNAME` / `_PASSWORD` | مطلوبان لقاعدة فارغة — لا بيانات عرض في الإنتاج |

**الكود لا يعرف مسارًا بعينه ولا مزوّدًا بعينه.** مسار التركيب قرار بنية تحتية يملكه المشغّل.

---

## 8. إعادة إنتاج النتائج

```bash
node tests/run-all.js                    # 42 مجموعة · 1,664 تأكيدًا
node scripts/cross-system-audit.js       # تدقيق عابر للأنظمة
node scripts/build-docs-pdf.js           # يُعيد توليد docs/pdf/
```

**ملاحظة:** `docs/pdf/` ناتج مُولَّد وليس تحت إدارة الإصدارات (`.gitignore`). المصدر المُعتمَد هو ملفات markdown.

**اللقطات المرجعية:** `docs/scope2-screenshots/` (12) · `docs/batchb-screenshots/` (6) — روجعت **بصريًا** لا بالتأكيدات وحدها، وكشفت المراجعة البصرية عيوبًا لم يكشفها أي تأكيد.

---

## 9. بطاقة الإصدار

| | |
|---|---|
| **Final Commit** | يُقرأ من الوسم: `git rev-parse v2.16.4-rc4-atomic-recovery` |
| **Final Tag** | `v2.16.4-rc4-atomic-recovery` |
| **Final Version** | `2.16.4` |
| **Total Test Suites** | 42 |
| **Total Assertions** | 1,664 |
| **Migrations Applied** | 23 (`001` → `023_bootstrap_recovery`) |
| **Git Status** | نظيف — لا ملفات قاعدة ولا WAL ولا artifacts مؤقتة |
| **Overall** | **PASS** |
| **Fully Verified** | **NO** — 6 بنود `AWAITING_ENVIRONMENT_VERIFICATION` |

> **لماذا لا يُكتب المعرّف حرفيًا:** لا يستطيع التزامٌ أن يحوي معرّفه هو. الوسم هو المرجع المُعتمَد، ويُقرأ المعرّف منه مباشرة — وهو تحقق يستطيع المراجع تنفيذه بنفسه بدل الوثوق برقم مكتوب.

**الحزمة مُتحقَّق منها بعد الاستخراج**: تُفكّ إلى الوسم نفسه بشجرة نظيفة، وتُشغَّل الاختبارات منها مستقلةً لا من بيئة العمل.


---

## 10. الخطوات المتبقية لقطع الوسم النهائي

تُنفَّذ **في بيئة متصلة بالشبكة** ومزوَّدة بمُشغِّل حاويات. لا يستطيع أيٌّ منها أن يُنفَّذ في بيئة التطوير هذه، ولذلك **لا يُحتسب أيٌّ منها نجاحًا** حتى الآن.

```bash
# 1) ملف القفل — الحاجز الأول
bash scripts/generate-lockfile.sh
npm ci

# 2) التحقق الفعلي من QR (يفشل الآن بلا مكتبة، وينجح بعد npm ci)
npm run verify:qr

# 3) الانحدار الكامل من الشجرة نفسها
node tests/run-all.js

# 4) Docker حقيقي + بقاء الوسائط داخله
bash scripts/docker-verify.sh
npm run verify:image
npm run verify:image:negative

# 5) إيداع ملف القفل ثم قطع الوسم النهائي
git add package-lock.json
git commit -m "chore: add package-lock.json"
git tag -a v2.17.0-production-final -m "Production final"
```

**ثم يدويًا:** اطبع `qr-verify-output/qr-active.png` وامسحه بجهاز iPhone وجهاز Android. معيار القبول: يفتح المسح رحلة الضيف الصحيحة على الجهاز — لا مجرد ظهور صورة على الشاشة.

**عند اكتمال (1)–(5) والمسح اليدوي، تصبح البنود الستة `PASS` وتُقطع النسخة النهائية.**
