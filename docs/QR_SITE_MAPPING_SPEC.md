> **Version:** v2.0.0 · **Status:** FINAL · **Last Updated:** 2026-08-12 · **Release Tag:** v2.0.0-final-quality-closure

# Alnadl Hospitality OS — QR & Site Mapping Specification (§5, §26.1)

## التسلسل الهرمي
```
Partner → Property → Zone → Point → QR Token
                              │
                              └──< Outlet Availability (منفذ↔نقطة، اختياري، مع بُعد زمني)
```

## أنواع رموز QR (`qr_tokens.qr_type`)
| النوع | الاستخدام النموذجي |
|---|---|
| `table` | طاولة مطعم/مقهى |
| `office` | مكتب موظف (سيناريو Corporate Wallet) |
| `room` | غرفة فندقية/قاعة اجتماعات |
| `zone` | منطقة عامة بلا مقعد محدد |
| `counter_pickup` | استلام من كاونتر بدل توصيل |

## دورة حياة رمز QR
1. **إنشاء**: فردي (`POST /api/admin/points`) أو بالجملة (`POST /api/admin/qr/bulk`, حتى 50 رمزًا دفعة واحدة)
2. **ربط ديناميكي**: الرمز يحمل فقط `point_id` — أي تغيير على القائمة أو المنافذ المتاحة عند تلك النقطة **لا يتطلب إعادة طباعة الرمز أبدًا**، لأن الاستعلام يُحسب لحظة المسح
3. **إيقاف/إعادة تخصيص**: `PATCH /api/admin/points/:id` — يُسجَّل في `audit_log` (لا حاجة لجدول منفصل)
4. **رمز جديد لنفس النقطة**: عند إعادة طباعة فعلية، الرمز القديم يُعطَّل (`active=0`) لا يُحذف — يحافظ على تتبع الطلبات التاريخية عبره

## ربط منفذ↔نقطة مع بُعد زمني (`outlet_availability`)
منفذ **بلا أي صف هنا متاح دائمًا وفي كل مكان** — هذا الافتراضي يجعل كل منفذ مُرحَّل من Phase 1-3 يعمل دون أي إعداد. لتقييد التوفر (مثال: منفذ إفطار متاح فقط 6ص-11ص):
```sql
INSERT INTO outlet_availability (outlet_id, zone_id, day_of_week, time_from, time_to)
VALUES ('out_xxx', 'z_lobby', NULL, '06:00', '11:00')  -- NULL day_of_week = كل يوم
```
لا توجد شاشة إدارية لإدخال هذه القواعد بعد (مبنية ومُختبرة منطقيًا في الـBackend فقط — راجع `docs/PHASE4_GAP_ANALYSIS.md` بند P4-HUB-02: **Partial**).

## التحليلات (`qr_analytics_events`)
سجل خام لكل مسح فعلي وكل طلب فعلي — وليس عدادًا مُخزَّنًا قد ينحرف عن الواقع:
```
GET /api/admin/qr/:pointId/analytics
→ { scans, orders, conversionRate, lastScan, lastOrder, totalSales }
```
`conversionRate = (orders / scans) × 100`، مبني بالكامل من الأحداث الخام لحظة الاستعلام.

## التوليد بالجملة
```
POST /api/admin/qr/bulk { zoneId, type, count (≤50), labelPrefix }
→ ينشئ N نقطة + N رمز QR بنفس النوع، بأسماء متسلسلة (labelPrefix + رقم)
```
الحد الأقصى 50 لكل طلب واحد — قرار تصميمي لمنع إساءة استخدام غير مقصودة، وليس قيدًا تقنيًا صارمًا (قابل للتعديل في `server.js`).
