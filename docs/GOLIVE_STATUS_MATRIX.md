> **Version:** v2.8.1-golive-matrix · **Status:** مصفوفة حالة متطلبات الإطلاق · **Last Updated:** 2026-08-14 · **Baseline:** `v2.8.0-golive-p0p1`

# Production Go-Live Requirements — Status Matrix

**الحالات المستخدمة حصرًا** (لا تُستخدم كلمة "Done" لأي بند يعتمد على طرف خارجي أو تحقق لم يتم):

- **Implemented & Verified** — مُنفَّذ ومُختبَر آليًا في هذه البيئة
- **Implemented – Awaiting Production Environment Verification** — مُنفَّذ، والتحقق النهائي يحتاج بيئة إنتاج فعلية
- **Waiting for External Provider/Credentials** — البنية جاهزة، ينتظر قرارًا أو بيانات اعتماد
- **Deferred by Product Decision** — مؤجَّل بقرار
- **Not Implemented** — لم يُنفَّذ

---

## P0 — Production Launch Blockers

| Requirement | Status | Evidence / Test | External Dependency | Remaining Action |
|---|---|---|---|---|
| **§3.1 PostgreSQL 15+ للإنتاج** | **Not Implemented** | لا يوجد — لم يُنفَّذ ولم يُحاكَ | **خادم PG 15+ · مكتبة `pg` · شبكة** | تنفيذ كامل بثماني مراحل — راجع `POSTGRESQL_MIGRATION_PLAN.md` |
| §3.2 Production Onboarding من قاعدة فارغة | **Implemented & Verified** | `tests/golive-onboarding.js` — 31 اختبارًا من قاعدة إنتاج فارغة حتى طلب مدفوع | — | لا شيء |
| §3.2b إدارة الباقات والمزايا | **Implemented & Verified** | `POST/PATCH/DELETE /api/admin/plans` · ضمن الـ31 | — | لا شيء |
| **§3.3 Payment Gateway حقيقي** | **Waiting for External Provider/Credentials** | `lib/payment.js` — واجهة `getGateway()` قائمة · Mock **للتطوير فقط** | **اختيار المزوّد · وثائق توقيع Webhook · مفاتيح Sandbox · شبكة** | بناء المُحوِّل الفعلي بعد وصول القرار |
| §3.4 الولاء معزول لكل شريك | **Implemented & Verified** | `tests/loyalty-partner-scope.js` — 41 اختبارًا · مفتاح `(partner_id, customer_key)` | — | لا شيء |
| §3.5 هوية الضيف بلا SMS إلزامي | **Implemented & Verified** | الطلب يعمل بلا اسم أو جوال · الولاء اختياري · ضمن الـ41 | — | لا شيء |
| §3.6 Verification Provider Abstraction | **Implemented & Verified** | `lib/verification.js` · دورة حياة كاملة بمُشغِّل Mock · ضمن الـ41 | لا شيء **الآن** (بقرارك) | ربط مزوّد فعلي لاحقًا — بلا مهاجرة جديدة |
| §3.7 Loyalty Entitlements | **Implemented & Verified** | `loyalty_enabled` / `loyalty_redeem_enabled` كرافعتين منفصلتين · ضمن الـ41 | — | لا شيء |
| §3.8 سياسة الاستبدال قبل التحقق | **Implemented & Verified** | `verified_only` افتراضيًا · رفض موثَّق بسبب آلي · ضمن الـ41 | — | لا شيء |
| §3.9 Public Rate Limiting | **Implemented & Verified** | `tests/golive-ops.js` — 25 اختبارًا · 429 حقيقي بـ`Retry-After` | — | مخزن مشترك (Redis) **قبل** تعدد النسخ |

---

## P1 — Production Operations

| Requirement | Status | Evidence / Test | External Dependency | Remaining Action |
|---|---|---|---|---|
| §4.1 Health / Readiness | **Implemented & Verified** | `/health` · `/ready` · `tests/golive-p1.js` · فحص صفر تسريب | — | لا شيء |
| §4.2 Structured Logging | **Implemented & Verified** | `lib/logger.js` · تنقيح في طبقة السجل · ضمن الـ33 | — | لا شيء |
| §4.2b Correlation / Request IDs | **Implemented & Verified** | `X-Request-Id` مُولَّد أو موروث · مُتحقَّق عبر Socket خام | — | لا شيء |
| §4.2c Monitoring للأخطاء الحرجة | **Implemented – Awaiting Production Environment Verification** | 5xx تُسجَّل بمستوى `error`، والبطء بـ`warn` | منصة مراقبة (CloudWatch/Datadog/Loki) | توصيل الشحن وضبط التنبيهات |
| **§4.3 Backup & Restore** | **Not Implemented** | لا يوجد | **بيئة إنتاج + PostgreSQL** | تمرين استعادة فعلي بعد §3.1 · توثيق RPO/RTO |
| §4.4 Secrets Enforcement | **Implemented & Verified** | الخادم **يرفض الإقلاع** بلا `SESSION_SECRET` أو Bootstrap · ضمن الـ33 | — | حقن الأسرار من Secret Manager |
| §4.4b HTTPS / Reverse Proxy | **Implemented – Awaiting Production Environment Verification** | `X-Forwarded-For` مُستخدَم في محدّد المعدل · المفترضات موثّقة في `DEPLOYMENT.md` | وكيل عكسي أو Ingress مُدار | تركيب TLS في بيئة النشر |
| §4.5 Graceful Shutdown | **Implemented & Verified** | SIGTERM/SIGINT · خروج `0` خلال 202ms · `/ready` يُبلّغ `draining` · ضمن الـ33 | — | لا شيء |
| §4.5b Worker Safety عند إعادة التشغيل | **Implemented & Verified** | إيقاف العامل أولًا · الصفوف غير المُطالَب بها تبقى `pending` · ضمن الـ33 | — | لا شيء |

---

## §5 — Engage عند Go-Live

| Requirement | Status | Evidence / Test | External Dependency | Remaining Action |
|---|---|---|---|---|
| Engage بالمحتوى الثابت المعتمد | **Implemented & Verified** | ~400 اختبارًا عبر ثمانية Increments · الحوكمة وKill Switch وMechanic Lab | — | تفعيل `engage_enabled` على الباقة |
| ربط AI خارجي | **Deferred by Product Decision** | `MockAIProvider` فقط · `engage_ai_generation` مُطفأ | مزوّد AI ومفاتيحه | **بقرارك: لا ربط الآن** |
| Group Invite UI · Session Resume | **Deferred by Product Decision** | الخادم جاهز ومُختبَر (Inc-5) | — | موجة مخصصة عند الطلب |

---

## §7 — اختبارات القبول الإلزامية (الولاء والتحقق)

| # | البند | Status | Evidence |
|---|---|---|---|
| 1 | نفس الجوال عند شريكين = حسابان مستقلان | **Implemented & Verified** | `loyalty-partner-scope.js` §7.1 |
| 2 | Earn عند A لا يؤثر على B | **Implemented & Verified** | §7.2 |
| 3 | Redeem/Balance/History لا تعبر حدود المستأجر | **Implemented & Verified** | §7.3 · §7.4 |
| 4 | `partner_id` مزوّر يفشل | **Implemented & Verified** | §7.5 — النطاق من رمز QR على الخادم |
| 5 | Earn يعمل بلا SMS | **Implemented & Verified** | §7.8 |
| 6 | Redeem غير المُتحقَّق يتبع السياسة | **Implemented & Verified** | §3.8 — `verification_required` |
| 7 | مُشغِّل Mock يُثبت دورة الحياة | **Implemented & Verified** | §7.9 |
| 8 | OTP منتهٍ/معاد/خاطئ يفشل | **Implemented & Verified** | §7.10 |
| 9 | عطل المزوّد لا يكسر الطلب أو Engage | **Implemented & Verified** | §7.8 — فشل مغلق بلا كسر الرحلة |
| 10 | **PostgreSQL regression حقيقي** | **Not Implemented** | — |
| 11 | Production onboarding من قاعدة فارغة | **Implemented & Verified** | `golive-onboarding.js` |
| 12 | Rate limiting حقيقي | **Implemented & Verified** | `golive-ops.js` — 429 مُثبَت |
| 13 | **Backup → Restore → verification** | **Not Implemented** | يحتاج §3.1 |
| 14 | حزمة الإنتاج بلا أدوات تطوير أو اعتمادات | **Implemented & Verified** | `golive-onboarding.js` — 404 لـ`/dev-tools.js` و`/api/demo/points` · رفض اعتمادات العرض |

---

## §9 — قواعد ترحيل الولاء

| Requirement | Status | Evidence |
|---|---|---|
| لا تعيين `partner_id` تخمينًا | **Implemented & Verified** | `migrations/015` — النسب فقط عند شريك واحد يقينًا |
| تصنيف البيانات القديمة | **Implemented & Verified** | `needs_review` / `orphan_no_orders` — محجوزة لا محذوفة |
| لا فقدان أرصدة | **Implemented & Verified** | إعادة بناء الجدول تنسخ كل صف · اختبار عدم وجود رصيد سالب |

---

## الخلاصة التنفيذية

| الحالة | العدد |
|---|---|
| **Implemented & Verified** | **30** |
| Implemented – Awaiting Production Environment Verification | 2 |
| Waiting for External Provider/Credentials | 1 |
| Deferred by Product Decision | 2 |
| **Not Implemented** | **3** |

### شرط GO لم يتحقق

**ثلاثة بنود قائمة**، جميعها مرتبطة ببعضها:

1. **§3.1 PostgreSQL** — الحاجز الجذري
2. **§4.3 Backup/Restore** — يعتمد على §3.1
3. **§7.10 PostgreSQL regression** — يعتمد على §3.1

**وبند واحد ينتظر قرارك**: §3.3 Payment Gateway.

> إغلاق §3.1 يفتح البندين التابعين له تلقائيًا — أي أن **حاجزًا واحدًا حقيقيًا** يفصل النسخة الحالية عن Release Candidate.
