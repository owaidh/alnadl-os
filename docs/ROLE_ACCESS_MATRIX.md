> **Version:** v2.9.1-role-engage-gov · **Status:** Round 1 + Round 2 (§1/§2/§6) · **Last Updated:** 2026-08-17

# ROLE ACCESS MATRIX

**الأساس**: `v2.8.4-field-fix` (لا `v2.8.2` — راجع الملاحظة أدناه).

> **ملاحظة على الأساس**: وثيقة المتطلبات ذكرت `v2.8.2-diagnostics`، لكن `v2.8.4` يحتوي إصلاحين لاحقين لها: السبب الجذري لخطأ `Server error` الميداني، **وشاشة إدارة الباقات** التي يطلبها §8. البناء على `v2.8.2` كان سيتراجع عنهما.

## Round 1 — المُنفَّذ في هذه الجولة

| Role | Required Capability | UI | API | Authorization | Tests | Status |
|---|---|---|---|---|---|---|
| **All** | إنشاء حساب بلا كلمة مرور معروفة | رمز تفعيل يُنسخ | `POST /api/admin/users` | منشئ مخوّل فقط | 48 | ✅ **Implemented & Verified** |
| **All** | تفعيل ذاتي وتعيين كلمة المرور | `/api/activate/:token` | `GET/POST /api/activate/:token` | الرمز هو الإثبات · مرة واحدة | 48 | ✅ |
| **All** | استعادة وصول بلا كشف كلمة مرور | زر إعادة إصدار | `POST /api/admin/users/:id/activation` | مخوّل ضمن نطاقه | 48 | ✅ |
| **SuperAdmin** | تغيير الدور/النطاق/الحالة | قائمة المستخدمين | `PATCH /api/admin/users/:id` | عدم تصعيد + حماية آخر SuperAdmin | 48 | ✅ |
| **PartnerAdmin** | إدارة مستخدمي شريكه فقط | قائمة المستخدمين | نفس النقطة | نطاق مفروض من الجلسة | 48 | ✅ |
| **All** | ملخص صلاحيات بلغة أعمال | قراءة فقط | `GET /api/admin/roles` | يُصفَّى حسب الفاعل | 48 | ✅ |
| **ProductAdmin** | مختبر الآليات + نظرة Engage | شاشتان | `mechanics` · `engage/overview` | لا Kill Switch (محصور بـSuperAdmin) | 28 | ✅ |
| **SafetyReviewer** | حوادث السلامة + السجل + المعالجة | شاشتان | `safety-incidents` · `ledger` · `resolve` | لا اقتراح آليات | 28 | ✅ |
| **PartnerAdmin** | Overview كشاشة أولى | ✅ | `partner/overview` | نطاق الشريك | 28 | ✅ |

## قواعد عدم التصعيد المفروضة (§3.2)

| القاعدة | الإثبات |
|---|---|
| PartnerAdmin لا يمنح دور منصة/مالية/Engage | `403` لكل من SuperAdmin · AlnadlFinance · ProductAdmin · SafetyReviewer · PartnerAdmin |
| النطاق من الجلسة لا من العميل | `partner_scope` مزوّر في الجسم **يُتجاهل تمامًا** |
| لا عبور مستأجر | PartnerAdmin من A يُرفض على مستخدم/بيانات B |
| حماية آخر SuperAdmin | تعطيله أو خفض دوره ⇒ `409` |
| لا قفز فوق التفعيل | حساب `pending_activation` لا يصبح `active` بضغطة إدارية ⇒ `409` |
| لا دخول بحساب غير مُفعّل | `401` عادي — لا يكشف أن الحساب موجود |

## Round 2 — المُنفَّذ (Engage Governance + Finance)

| Role | Required Capability | UI | API | Authorization | Tests | Status |
|---|---|---|---|---|---|---|
| **SuperAdmin** | مركز تحكّم Engage | `engagecontrol` | `engage/effective-state` · `kill-switch` · `policy-overrides` | SuperAdmin فقط للمفتاح | 37 | ✅ **Implemented & Verified** |
| **SuperAdmin** | الحالة الفعّالة بطبقاتها الأربع | ✅ | `GET /api/engage/effective-state` | نطاق أي شريك | 37 | ✅ |
| **SuperAdmin** | مختبر الآليات + سجل التجارب | مدخلان | نقاط قائمة | — | 37 | ✅ |
| **PartnerAdmin** | Engage نطاقه + تقييد فقط | `partnerengage` | `partner/engage/overview` · `policy-overrides` | نطاقه فقط · **لا توسيع** | 37 | ✅ |
| **PartnerViewer** | Engage نطاقه قراءة فقط | `partnerengage` | نفس النقاط | **صفر mutation** | 37 | ✅ |
| **AlnadlFinance** | دفتر الإيراد | `revledger` | `admin/revenue-ledger` | **بلا توسيع للتشغيل** | 37 | ✅ |

### ضمانات الحوكمة المُثبَتة (R2)

| القاعدة | الإثبات |
|---|---|
| مفتاح الإيقاف لـSuperAdmin حصرًا | `403` لـPartnerAdmin · PartnerViewer · AlnadlFinance |
| الشريك يُقيّد ولا يوسّع | تقييد نطاقه `201` · تقييد شريك آخر `403` |
| لا سجل تجارب كامل للشريك | `403` لكلا دوري الشريك · النظرة المُجمّعة `200` |
| **لا قراءة عابرة للمستأجر** | تمرير `partnerId` لشريك آخر ⇒ **`403` صريح** بدل استبدال صامت |
| سبب المنع مُفكَّك | `not_in_plan` · `subscription_inactive` · `global_kill_switch` · `scope_override` |
| المالية لا تُوسَّع للتشغيل | `AlnadlFinance` يُرفض على `/api/ops/queue` |
| لا تسريب أسرار | صفر `accessToken`/`prompt`/`selection_reason` في أي استجابة |

## Round 3 — لم يُنفَّذ بعد

| Requirement | التصنيف | ملاحظة |
|---|---|---|
| §4 Partner Control Center | **Backend partial** | البيانات موجودة، الصفحة الموحّدة لا |
| §6 Loyalty Administration | **Backend partial** | تلزم نقاط إدارية آمنة بعزل مستأجر |
| §4 Partner status management | **Truly missing** | لم تُعرَّف الحالات وأثرها بعد |

## خارج النطاق (§10)

PostgreSQL/F04 · مزوّد دفع حقيقي · SMS/OTP · AI Provider · باقات تجارية جديدة · Network Rewards · Campaigns/Tiers · Group Invite · Session Resume
