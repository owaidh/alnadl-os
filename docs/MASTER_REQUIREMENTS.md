> **Version:** v2.0.0 · **Status:** FINAL · **Last Updated:** 2026-08-12 · **Release Tag:** v2.0.0-final-quality-closure

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
| KDS/Routing (Multi-Outlet + Grouped/Separate Delivery) | §13 | ✅ منجز جزئيًا — Routing منجز، سياسة Grouped/Separate لم تُبنَ بعد |
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
- سياسة Grouped مقابل Separate Delivery للطلبات متعددة المنافذ (§13 جزء متبقٍ)
- Custom Domain Routing الفعلي (بنية تحتية، موثّق في `docs/DEPLOYMENT.md`)
- P02/P03/P05 تحليلات إضافية غير محددة صراحة

## سجل التغييرات
راجع `docs/CHANGELOG.md` لكل إصدار (tag) وما تضمّنه بالتفصيل.
