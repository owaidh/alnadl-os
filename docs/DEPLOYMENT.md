> **Version:** v1.3.0 · **Status:** FINAL · **Last Updated:** 2026-08-12 · **Release Tag:** v1.3.0

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

### أ) قاعدة البيانات
SQLite ممتازة للتطوير والعرض، لكنها **غير مناسبة لحمل إنتاجي متعدد الشركاء بكتابة متزامنة عالية** (SQLite تقفل الملف بالكامل عند الكتابة). يُوصى بالانتقال إلى **PostgreSQL** قبل الإطلاق الفعلي:
- طبقة الوصول للبيانات معزولة بالكامل داخل `db.js` عبر استدعاءات `db.prepare(...).run()/.get()/.all()` — إعادة الكتابة لتستخدم `pg` بدل `node:sqlite` عمل محصور في ملف واحد إلى حد كبير، وليس إعادة هيكلة شاملة.
- أضف نظام Migrations رسمي (مثل `node-pg-migrate`) بدل الاعتماد على `CREATE TABLE IF NOT EXISTS` الحالي.

### ب) الأمان (راجع أيضًا README قسم "الأمان")
- استبدل السر العشوائي لكل تشغيل في `lib/auth.js` (`SECRET = crypto.randomBytes(32)...`) بسر ثابت من متغير بيئة (`SESSION_SECRET`)، وإلا **كل إعادة تشغيل للسيرفر تُبطل كل جلسات المستخدمين الحاليين**.
- فعّل HTTPS عبر Reverse Proxy (Nginx/Caddy) أمام Node — لا تُعرِّض `node server.js` مباشرة على الإنترنت.
- فعّل Rate Limiting على `/api/auth/login` و`/api/orders` (لا يوجد حاليًا).
- استبدل `password_hash` (SHA-256 بسيط) بـ bcrypt/argon2 قبل أي بيانات مستخدم حقيقية.

### ج) بوابة الدفع
راجع `README.md` قسم "الدفع" — نقطة التمديد الوحيدة هي `lib/payment.js`.

### د) المراقبة والنسخ الاحتياطي
- لا يوجد حاليًا أي تصدير Logs منظّم (`console.log` فقط) — أضف طبقة Logging منظّمة (مثل pino) قبل الإنتاج.
- أضف نسخًا احتياطية دورية لقاعدة البيانات (أو لـ PostgreSQL بعد الترقية).

### هـ) النطاق والشهادات
اربط نطاقًا فعليًا (مثال: `os.alnadl.com`) وشهادة SSL (Let's Encrypt عبر Caddy تلقائي، أو عبر مزوّد الاستضافة).

---

## 4) خيارات استضافة سريعة (بدون بنية تحتية معقّدة)

أي مزوّد يدعم حاويات Docker يعمل مباشرة بهذا الإعداد: **Railway، Render، Fly.io، أو خادم VPS عادي (DigitalOcean/Hetzner) مع Docker Compose أعلاه**. لا حاجة لخدمات متخصصة (مثل Vercel) لأن هذا التطبيق Backend حالة كاملة (Stateful) وليس Frontend ثابتًا.
