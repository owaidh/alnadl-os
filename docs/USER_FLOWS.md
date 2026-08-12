> **Version:** v2.0.1 · **Status:** FINAL · **Last Updated:** 2026-08-12 · **Release Tag:** v2.0.1-corrective

# Alnadl Hospitality OS — User Flows (§26.1)

## تدفق 1: طلب عميل عبر منفذ واحد (السلوك الافتراضي، 100% من الشركاء قبل Phase 4)
```
مسح QR → GET /api/service-hub/:token (hub:false تلقائيًا)
  → Welcome → Menu → إضافة منتجات → Cart → Checkout
  → POST /api/orders (لا child_orders تُنشأ) → POST /pay
  → Payment Result → Tracking (orders.status يُدار مباشرة) → Feedback
```

## تدفق 2: طلب عميل عبر عدة منافذ (Unified Cart، Phase 4، يتطلب باقة CONNECT+)
```
مسح QR → GET /api/service-hub/:token (hub:true، منفذان أو أكثر)
  → Hub: اختيار "قهوة النادل" → Menu (قهوة) → إضافة لاتيه
  → زر "منافذ أخرى" → Hub مجددًا → اختيار "مطعم الشريك"
  → Menu (مطعم) → إضافة طبق → Cart (يعرض الصنفين مع فرز حسب المنفذ)
  → Checkout → POST /api/orders (فرز outlet_id تلقائي لكل سطر)
      → إن امتدت السلة لأكثر من منفذ: تُنشأ child_orders تلقائيًا
  → POST /pay (دفعة واحدة) → نجاح → cascade لكل child_orders
  → KDS: تذكرتان مستقلتان، كل واحدة بعلامة منفذها
  → Tracking: حالة واحدة مُشتقة (Ready فقط عند اكتمال الاثنتين)
```

## تدفق 3: تشغيل طلب في KDS
```
Operator يفتح KDS → GET /api/ops/queue (يشمل تذاكر مفردة + فرعية)
  → نقر تذكرة → قبول (Paid→Accepted) → بدء التجهيز (→Preparing) → جاهز (→Ready)
  → إن كانت تذكرة فرعية: deriveParentStatus() يُعيد حساب حالة الطلب الأصل تلقائيًا
  → Runner يرى الطلب في طابوره فقط عند اكتمال كل الأجزاء (Ready على مستوى Parent)
```

## تدفق 4: إعداد شريك جديد من الصفر (SuperAdmin)
```
Tenants & Plans → "شركاء جدد" → إدخال الاسم + اختيار باقة → POST /api/admin/onboard
  → يُنشئ Partner + Property + Subscription بضغطة واحدة
  → Outlets → إضافة منفذ (أو استخدام الافتراضي المُرحَّل إن وُجدت بيانات Merchants سابقة)
  → Revenue Models → تحديد نموذج إيراد لكل منفذ (أو ترك الافتراضي الضمني)
  → Zones/QR → إضافة مناطق + توليد رموز QR (فرديًا أو بالجملة)
  → Catalog → إضافة تصنيفات ومنتجات (تُربط تلقائيًا بأول منفذ إن لم يُحدَّد غير ذلك)
  → (اختياري، PLATFORM فقط) White Label → تخصيص الهوية البصرية
```

## تدفق 5: التسوية المالية الشهرية (AlnadlFinance)
```
Settlements → "إنشاء تسوية" (Draft) → مراجعة → "Reviewed"
  → عرض على الشريك → "Partner Review"
  → الشريك (PartnerViewer/PartnerAdmin) يعتمد أو يعترض → "Approved" أو "Disputed"
  → (إن اعتُرض) → "Reviewed" مجددًا لإعادة المراجعة
  → (إن اعتُمد) → "Paid"
```
ملاحظة: هذا سير على **مستوى الشريك الكامل** (`lib/settlement.js`). لتفاصيل الإيراد **لكل منفذ على حدة**، راجع `revenue_ledger` عبر `GET /api/admin/revenue-ledger` — منفصل تمامًا (`docs/REVENUE_MODEL_SPEC.md`).

## تدفق 6: تغيير نموذج إيراد منفذ (بدون أثر رجعي)
```
Revenue Models → اختيار المنفذ → تغيير النوع (مثال: عمولة → مشاركة إيراد)
  → إدخال النسبة الجديدة → حفظ → POST /api/admin/revenue-models
  → السجل القديم (revenue_ledger) يبقى بلقطته الأصلية دون أي تعديل
  → أي معاملة جديدة من الآن فصاعدًا تستخدم النموذج الجديد فقط
```
