> **Version:** v1.9.0 · **Status:** FINAL · **Last Updated:** 2026-08-12 · **Release Tag:** v1.9.0-partner-dashboard

# Alnadl Hospitality OS — Deployment Guide

## 1) تشغيل محلي (Development)

```bash
node server.js
```
لا حاجة لـ `npm install`. متطلب واحد فقط: **Node.js v22 أو أحدث** (بسبب `node:sqlite`). للتحقق:
```bash
node -v   # يجب أن يبدأ بـ v22 أو أعلى
```
عند أول تشغيل، يُنشأ `data.sqlite` تلقائيًا ويُزرع ببيانات تجريبية (شريكان، منتجات، مستخدمون تجريبيون — راجع `README.md`).

لإعادة البدء من الصفر:
```bash
rm data.sqlite && node server.js
```

متغيرات البيئة المدعومة حاليًا:
| المتغير | الافتراضي | الوصف |
|---|---|---|
| `PORT` | `8787` | منفذ الاستماع |
| `SQLITE_PATH` | `./data.sqlite` | مسار ملف قاعدة البيانات |
| `PAYMENT_PROVIDER` | `mock` | راجع `lib/payment.js` — القيمة الوحيدة المتاحة حاليًا |

---

## 2) التشغيل عبر Docker

يتضمن المشروع `Dockerfile` جاهزًا:

```bash
docker build -t alnadl-hospitality-os .
docker run -d \
  --name alnadl-os \
  -p 8787:8787 \
  -v alnadl-data:/app/data \
  -e SQLITE_PATH=/app/data/data.sqlite \
  alnadl-hospitality-os
```

`-v alnadl-data:/app/data` يضمن بقاء قاعدة البيانات بعد إعادة تشغيل الحاوية أو نشر نسخة جديدة من الكود.

### Docker Compose (مثال لبيئة staging)
```yaml
services:
  alnadl-os:
    build: .
    ports: ["8787:8787"]
    volumes: ["alnadl-data:/app/data"]
    environment:
      - SQLITE_PATH=/app/data/data.sqlite
      - PAYMENT_PROVIDER=mock   # change when a real gateway is connected
    restart: unless-stopped
volumes:
  alnadl-data:
```

---

## 3) الانتقال لبيئة إنتاج فعلية — ما يجب تغييره

هذا المشروع **جاهز للعرض والتطوير المستمر، وليس للإنتاج مباشرة بصيغته الحالية**. الخطوات التالية إلزامية قبل استقبال عملاء حقيقيين:

### أ) قاعدة البيانات — القرار الهندسي النهائي (Q07)

**القرار المُعتمَد: PostgreSQL 15+ قبل أي إطلاق إنتاجي حقيقي متعدد الشركاء.** هذا قرار نهائي موثَّق، وليس ملاحظة مستقبلية مفتوحة.

**المبرر:**
- SQLite تقفل الملف بالكامل عند كل كتابة (Single-Writer) — مقياس `tests/concurrency.js` الحالي يُثبت صحة المنطق تحت تزامن خفيف (3-2 طلبات متزامنة)، لكنه **لا يُثبت أداءً تحت حمل إنتاجي حقيقي** (مئات الكتابات/الثانية عبر عدة شركاء) — وهذا خارج نطاق ما يمكن قياسه بمصداقية داخل هذه البيئة (راجع Q17 في `docs/GAP_REGISTER.md`)
- تعدد الشركاء (Multi-tenancy) الحقيقي يحتاج اتصالات متزامنة كثيرة من عمليات مختلفة (Web + Workers + لوحات تحليلات) — SQLite غير مصمَّمة لهذا النمط أصلاً

**خطة التنفيذ (لم تُنفَّذ في هذه البيئة — لا PostgreSQL مُثبَّتة هنا ولا اتصال شبكي لتثبيتها، لكن الخطة قابلة للتنفيذ المباشر خارج هذه البيئة):**
1. طبقة الوصول للبيانات معزولة بالكامل داخل `db.js` عبر استدعاءات `db.prepare(...).run()/.get()/.all()` — الاستبدال بـ`pg` (أو `postgres.js`) محصور في هذا الملف تحديدًا، وليس إعادة هيكلة شاملة عبر `server.js`
2. نظام Migrations **موجود بالفعل الآن** (`lib/migrate.js` + `migrations/`، Q08) — لا حاجة لأداة خارجية إضافية؛ نفس الأسلوب (SQL خام داخل ملفات مُرقَّمة) يعمل بلا تعديل جوهري مع أي محرك SQL قياسي؛ التعديل المطلوب فقط هو استبدال بنية `CREATE TABLE`/`ALTER TABLE` بصيغة PostgreSQL القياسية (فروق طفيفة: `AUTOINCREMENT`→`SERIAL`، أنواع البيانات)
3. الفهارس (Indexes) المطلوبة قبل الإنتاج، مُحدَّدة بدقة: `orders(status, created_at)`, `child_orders(parent_order_id, status)`, `qr_analytics_events(token, ts)`, `revenue_ledger(order_id)`, `revenue_ledger(outlet_id, created_at)`, `settlements(partner_id, period)` — هذه أعمدة الاستعلامات الأكثر تكرارًا فعليًا في `server.js`
4. فصل بيانات Demo/Seed (`seedIfEmpty()` في `db.js`) عن أي بيانات إنتاج — **لا يُستدعى `seedIfEmpty()` إطلاقًا في بيئة إنتاج**؛ يحتاج علم بيئة صريح (`NODE_ENV=production` يُعطِّل الاستدعاء)
5. نسخ احتياطي واستعادة: PostgreSQL توفر `pg_dump`/`pg_restore` القياسيين — يجب جدولتهما (يوميًا كحد أدنى) واختبار الاستعادة فعليًا قبل الاعتماد على الخطة

### ب) الأمان (راجع أيضًا README قسم "الأمان" و`docs/GAP_REGISTER.md` بند Q06)
- **مُنجَز فعليًا الآن**: تجزئة كلمات المرور PBKDF2 (100,000 تكرار)، Rate Limiting على `/api/auth/login` (5 محاولات/15 دقيقة)، تحذير Startup صريح عند غياب `SESSION_SECRET`
- **متبقٍ قبل الإنتاج**: تعيين `SESSION_SECRET` كسر ثابت فعلي من متغير بيئة (وإلا كل إعادة تشغيل تُبطل كل الجلسات)؛ تفعيل HTTPS عبر Reverse Proxy (Nginx/Caddy) أمام Node — لا تُعرِّض `node server.js` مباشرة على الإنترنت؛ Rate Limiting إضافي على `/api/orders` (غير موجود بعد، فقط على تسجيل الدخول حاليًا)

### ج) بوابة الدفع
راجع `README.md` قسم "الدفع" — نقطة التمديد الوحيدة هي `lib/payment.js`.

### د) المراقبة والنسخ الاحتياطي
- لا يوجد حاليًا أي تصدير Logs منظّم (`console.log` فقط) — أضف طبقة Logging منظّمة (مثل pino) قبل الإنتاج.
- أضف نسخًا احتياطية دورية لقاعدة البيانات (أو لـ PostgreSQL بعد الترقية).

### هـ) النطاق والشهادات
اربط نطاقًا فعليًا (مثال: `os.alnadl.com`) وشهادة SSL (Let's Encrypt عبر Caddy تلقائي، أو عبر مزوّد الاستضافة).

---

## Phase 4 — تفاصيل Migration الفعلية

كل تعديلات Phase 4 على قاعدة البيانات **تلقائية بالكامل** عند إقلاع `server.js` — لا سكربت منفصل يُشغَّل يدويًا:
1. `db.js` يُنفِّذ `CREATE TABLE IF NOT EXISTS` للجداول السبعة الجديدة (`outlets`, `outlet_availability`, `qr_analytics_events`, `child_orders`, `revenue_models`, `revenue_ledger`, `partner_branding`) — لا تأثير على أي جدول قائم
2. `ALTER TABLE ... ADD COLUMN` (محاطة بمعالجة أخطاء صامتة) لإضافة أعمدة على جداول موجودة (`qr_tokens.qr_type`, `products.outlet_id`, `order_items.outlet_id`/`child_order_id`) — آمنة على قاعدة بيانات فيها بيانات فعلية بالفعل
3. `migratePhase4Outlets()` تُنشئ منفذًا افتراضيًا لكل منشأة لا تملك منفذًا بعد — **Idempotent بالكامل**، تُشغَّل في كل إقلاع دون خطر التكرار (تتحقق أولاً من عدم وجود منفذ مسبقًا لكل منشأة)

**لا حاجة لإيقاف الخدمة** أثناء هذا Migration — يُنفَّذ خلال أجزاء من الثانية عند الإقلاع العادي. **لا Rollback سكربت منفصل مطلوب**: التراجع الفعلي هو استعادة نسخة `data.sqlite` الاحتياطية (أو قاعدة PostgreSQL) من قبل الترقية.

## 4) خيارات استضافة سريعة (بدون بنية تحتية معقّدة)

أي مزوّد يدعم حاويات Docker يعمل مباشرة بهذا الإعداد: **Railway، Render، Fly.io، أو خادم VPS عادي (DigitalOcean/Hetzner) مع Docker Compose أعلاه**. لا حاجة لخدمات متخصصة (مثل Vercel) لأن هذا التطبيق Backend حالة كاملة (Stateful) وليس Frontend ثابتًا.
