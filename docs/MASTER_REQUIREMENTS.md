> **Version:** v2.8.0-golive-p0p1 · **Last Updated:** 2026-08-14

# Alnadl Hospitality OS — Master Requirements (§26.1)

مصدر واحد موحّد لكل متطلب مُعتمَد عبر Phase 1 إلى Phase 4. **هذا ملخص تنفيذي وفهرسة**، وليس بديلاً عن الوثائق المصدرية (`Alnadl_Hospitality_Operations_Technology_Concept.docx`, `05_..._Developer_Handoff_v1.docx`, `Alnadl_Hospitality_OS_Phase4_Upgrade_Change_Request_for_Developer_v2.docx`) — عند أي تعارض، الوثائق الأصلية من النادل هي المرجع، وهذا الملف يُحدَّث ليطابقها.

## Phase 1-3 (المنصة الأساسية + SaaS + Loyalty/Wallet/Marketplace)
| المجال | المتطلب المعتمد | حالة التنفيذ |
|---|---|---|
| رحلة العميل | QR → قائمة → سلة → دفع → تتبع → تقييم | ✅ منجز |
| التشغيل | KDS بآلة حالة صارمة، Runner | ✅ منجز |
| SaaS | 4 باقات (OPERATE/SMART/CONNECT/PLATFORM)، عزل بيانات كامل بين الشركاء | ✅ منجز |
| المالية | Settlement Center بسير حالات كامل (Draft→...→Paid) | ✅ منجز |
| الولاء | كسب/استبدال نقاط | ✅ منجز، مُقيّد بالباقة |
| المحفظة المؤسسية | Split Payment فعلي | ✅ منجز، مُقيّد بالباقة |
| Marketplace | شركاء تجاريون متعددون في قائمة واحدة | ✅ منجز، مُقيّد بالباقة |

تفاصيل كل بند: `docs/API_DOCUMENTATION.md` §1-14، `docs/DATABASE_SCHEMA.md`.

## Phase 4 (التوسعة البنيوية)
| المجال | المتطلب المعتمد (رقم القسم في Change Request v2) | حالة التنفيذ |
|---|---|---|
| Outlet Architecture | §6 | ✅ منجز |
| Service Hub | §7 | ✅ منجز |
| Unified Cart / Parent-Child Orders | §8 | ✅ منجز |
| Revenue Model Engine | §9 | ✅ منجز |
| Revenue Allocation Ledger | §10 | ✅ منجز |
| White Label | §11 | ✅ منجز |
| White Label Commercial Config | §12 | ✅ منجز |
| KDS/Routing (Multi-Outlet + Grouped/Separate Delivery) | §13 | ✅ منجز بالكامل — `properties.delivery_grouping` (`grouped`/`separate`)، مُختبَر آليًا (23 اختبارًا)، راجع `docs/MULTI_OUTLET_SPEC.md` |
| Partner Dashboard الموسّع | §14 | ✅ منجز |
| Alnadl Admin (Outlet/Revenue/Branding Manager) | §15 | ✅ منجز |
| Database/Migration | §16 | ✅ منجز (راجع `docs/DATABASE_SCHEMA.md` وقسم Migration في `docs/DEPLOYMENT.md`) |
| Backward Compatibility | §17 | ✅ منجز ومُختبر — راجع `docs/PHASE4_GAP_ANALYSIS.md` §Traceability Matrix |
| API/Backend | §18 | ✅ منجز |
| Security & Permissions | §19 | ✅ منجز — راجع `docs/ROLES_PERMISSIONS_MATRIX.md` |
| Acceptance Criteria (24 بندًا) | §20 | راجع `docs/TEST_PLAN.md` §Phase 4 Acceptance Criteria Crosswalk |
| Test Scenarios (12 سيناريو) | §21 | راجع `docs/TEST_PLAN.md` §Phase 4 Scenarios |
| Gap Analysis/Design/Estimate | §22 | ✅ `docs/PHASE4_GAP_ANALYSIS.md` |
| Definition of Done | §23 | راجع `docs/TEST_PLAN.md` |
| QR Types/Bulk/Analytics | §5 | ✅ منجز |
| CONNECT Package | §4 | ✅ منجز |

## نطاق مؤجَّل عمدًا (خارج Phase 4 الحالية)
- AI Forecasting / Predictive Operations
- (سياسة Grouped/Separate Delivery أُنجزت — أُزيلت من هذه القائمة، راجع الجدول أعلاه)
- Custom Domain Routing الفعلي (بنية تحتية، موثّق في `docs/DEPLOYMENT.md`)
- P02/P03/P05 تحليلات إضافية غير محددة صراحة

## سجل التغييرات
راجع `docs/CHANGELOG.md` لكل إصدار (tag) وما تضمّنه بالتفصيل.


---

## Go-Live Requirements — حالة التغطية

| البند | الحالة |
|---|---|
| §3.1 PostgreSQL | ⛔ **لم يُنفَّذ** — حاجز إطلاق قائم |
| §3.2 Production Onboarding | ✅ مُنفَّذ ومُختبَر من قاعدة فارغة |
| §3.3 Payment حقيقي | ⏸ Adapter جاهز — **بانتظار اختيار المزود ومفاتيحه** |
| §3.4 الولاء معزول لكل شريك | ✅ مُنفَّذ ومُختبَر |
| §3.5 هوية الضيف بلا SMS | ✅ الطلب بلا اسم أو جوال · الولاء اختياري |
| §3.6 بنية التحقق | ✅ مُنفَّذة — بلا ربط مزوّد (بقرارك) |
| §3.7 Entitlements | ✅ مُنفَّذة، بديلة لأسماء الباقات |
| §3.8 سياسة الاستبدال | ✅ `verified_only` افتراضيًا |
| §3.9 Rate Limiting | ✅ مركزي على كل النقاط العامة |
| §4.1 Health/Readiness | ✅ |
| §4.2 Logging/Monitoring | ✅ JSON + تنقيح + Correlation ID |
| §4.3 Backup/Restore | ⏸ يحتاج بيئة إنتاج فعلية للتدريب عليه |
| §4.4 Secrets/HTTPS | ✅ الحواجز قائمة ومُوسَّعة، ومفترضات الوكيل العكسي موثّقة |
| §4.5 Graceful Shutdown | ✅ مُنفَّذ ومُختبَر |
| §5 Engage عند الإطلاق | ✅ يعمل بالمحتوى الثابت، بلا AI خارجي |
| §6 P2 | 📋 لم يُبدأ عمدًا |

**شرط GO لم يتحقق بعد**: §3.1 قائم، و§3.3 ينتظر قرارك.
