> **Version:** v2.0.2 · **Status:** FINAL · **Last Updated:** 2026-08-12 · **Release Tag:** v2.0.2-corrective-2

# Alnadl Hospitality OS — UX/UI Specification (§26.1)

## نظام التصميم
عربي RTL أولاً (إنجليزي LTR كخيار)، خطا Cairo (عناوين) وTajawal (نص) عبر Google Fonts. لوحة ألوان: Ink (أسود دافئ) للوحات الإدارية/التشغيلية، Cream (أبيض دافئ) لواجهة العميل، Brass (نحاسي ذهبي) كلون تمييز موحّد — راجع `public/styles.css` قسم `:root` للقيم الدقيقة (متغيرات CSS).

**مبدأ "الواجهة الأمامية مقابل الخلفية التشغيلية"**: شاشات العميل (`.fohshell`/`.phone`) بخلفية فاتحة تحاكي هاتفًا، بينما شاشات الموظفين/الإدارة (`.bohshell`) بخلفية داكنة كاملة الشاشة — تمييز بصري فوري بين "أمام البيت" و"خلف البيت" (استعارة من مصطلحات الضيافة نفسها).

## جرد الشاشات الكامل

### العميل (بدون تسجيل دخول)
| الشاشة | الوظيفة | جديد في Phase 4 |
|---|---|---|
| Hub (`scrHub`) | اختيار المنفذ عند تعدد المنافذ | ✅ جديد |
| Welcome | ترحيب + بدء الطلب | مُحدَّثة (علامة تجارية مخصصة) |
| Menu | القائمة، مُجمَّعة حسب المنفذ عند التعدد | مُحدَّثة (زر "منافذ أخرى") |
| Cart | السلة، كود خصم، نقاط ولاء | |
| Checkout | بيانات التسليم، محفظة مؤسسية، دفع | |
| Payment Result | نجاح/فشل الدفع | |
| Tracking | تتبع حالة الطلب (تُشتق تلقائيًا لو تعدد المنافذ) | مُحدَّثة داخليًا |
| Feedback | تقييم بعد التسليم | |

### التشغيل (Operator/Runner/SiteManager)
| الشاشة | الوظيفة | جديد في Phase 4 |
|---|---|---|
| KDS | طابور التجهيز، بعلامة منفذ على كل تذكرة عند التعدد | مُحدَّثة (تذاكر فرعية مستقلة) |
| Runner Queue | طابور التوصيل | |
| Live Dashboard | مؤشرات حية لمدير الموقع | |

### الإدارة (SuperAdmin/PartnerAdmin/AlnadlFinance/PartnerViewer)
| الشاشة | الدور المخوّل | جديد في Phase 4 |
|---|---|---|
| Tenants & Plans | SuperAdmin | |
| Portfolio | SuperAdmin | |
| **Outlets** | SuperAdmin, PartnerAdmin | ✅ جديد |
| **Revenue Models** | SuperAdmin, PartnerAdmin | ✅ جديد |
| **White Label** | SuperAdmin فقط | ✅ جديد |
| Zones/Points/QR (+ Bulk Generate + Analytics) | SuperAdmin, PartnerAdmin | ✅ موسَّعة |
| Catalog | SuperAdmin, PartnerAdmin | |
| Merchants | SuperAdmin, PartnerAdmin | |
| Corporate Wallets | SuperAdmin, PartnerAdmin | |
| Users | SuperAdmin, PartnerAdmin | |
| Settlements | SuperAdmin, AlnadlFinance, PartnerViewer, PartnerAdmin | |
| Audit Log | SuperAdmin, AlnadlFinance | |
| Partner Overview (+ Cross-Outlet Basket Rate + أداء كل منفذ) | PartnerViewer | ✅ موسَّعة |
| Billing/Plan | PartnerViewer, PartnerAdmin | |

القائمة الفعلية لكل دور معرَّفة في `public/app.js` — كائن `navByRole` (بحث عن `SuperAdmin:[[` للوصول المباشر للسطر).

## مبادئ تفاعلية
- **تخطٍ تلقائي بلا احتكاك**: Service Hub لا يظهر أبدًا إلا عند الحاجة الفعلية (§20.16) — هذا مبدأ تصميمي وليس فقط تقنيًا
- **الحالة الأصل مرئية دومًا، التفاصيل الفرعية عند الطلب**: العميل يرى حالة طلب واحدة مُشتقة، لا يُطلب منه فهم أن طلبه انقسم داخليًا
- **الألوان تُشتق من لون واحد**: تخصيص العلامة التجارية (White Label) يُدخل لونًا أساسيًا واحدًا فقط، وتُشتق الدرجات الأخرى تلقائيًا عبر `color-mix()` — لا يُطلب من الشريك اختيار 4 درجات يدويًا
