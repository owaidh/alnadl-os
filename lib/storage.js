// lib/storage.js — تجريد التخزين لوسائط الهوية.
//
// السبب المباشر: بعد إغلاق P0 (ثبات البيانات)، الكتابة في نظام ملفات
// الحاوية **شرط رفض** لا ملاحظة. صورة مرفوعة إلى مجلد التطبيق تختفي مع أول
// إعادة تشغيل، وتترك خلفها صفًّا في القاعدة يشير إلى ملف غير موجود -- أي
// شعارًا مكسورًا في واجهة الضيف، وهو أسوأ من غياب الشعار.
//
// التجريد ليس تجميلًا: منطق الهوية لا يعرف أين تُخزَّن الملفات ولا كيف.
// يعرف `put` و`get` و`remove` فقط. إضافة مزوّد متوافق مع S3 لاحقًا تكتب
// محوّلًا جديدًا هنا ولا تلمس سطرًا واحدًا في lib/branding.js أو في
// نقاط الرفع.
//
// وبنفس فلسفة SQLITE_PATH: **لا افتراض في الإنتاج**. مسار التخزين قرار
// بنية تحتية يملكه المشغّل ويختلف بين المزودين؛ افتراض مسار "معقول" يعني
// نشرًا على مزوّد آخر يعمل بصمت على قرص مؤقت -- وهو العطل نفسه الذي
// أغلقناه للتوّ، بثوب آخر. الكود لا يعرف /data ولا أي مزوّد بعينه.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---------------------------------------------------------------------------
   المحوّل المحلي — تخزين دائم على نظام ملفات مركَّب.
--------------------------------------------------------------------------- */
class LocalStorageAdapter {
  constructor(root) { this.root = root; this.name = 'local'; }

  /* المسار يُبنى من المفتاح المولَّد على الخادم وحده. المفتاح hex خالص
     (يتحقق منه المتصل)، فلا يحمل فاصل مسار ولا `..`. ومع ذلك يُتحقق من
     النتيجة النهائية أنها **داخل الجذر فعلًا** -- دفاع في العمق: أي خلل
     مستقبلي في توليد المفتاح يُوقف هنا بدل أن يكتب خارج المجلد. */
  _resolve(key) {
    if (!/^[a-f0-9]{2}\/[a-f0-9]{32}$/.test(key)) {
      const e = new Error('Invalid storage key'); e.code = 'BAD_KEY'; throw e;
    }
    const full = path.resolve(this.root, key);
    const rootResolved = path.resolve(this.root);
    if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
      const e = new Error('Storage key escapes the storage root'); e.code = 'PATH_TRAVERSAL'; throw e;
    }
    return full;
  }

  put(key, buffer) {
    const full = this._resolve(key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    // الكتابة إلى ملف مؤقت ثم إعادة التسمية: إعادة التسمية ذرّية على نفس
    // نظام الملفات، فانقطاع في منتصف الكتابة لا يترك ملفًا نصفيًا يُقدَّم
    // للضيف كصورة تالفة.
    const tmp = full + '.tmp-' + crypto.randomBytes(4).toString('hex');
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, full);
    return { key, bytes: buffer.length };
  }

  get(key) { return fs.readFileSync(this._resolve(key)); }
  exists(key) { try { return fs.existsSync(this._resolve(key)); } catch (e) { return false; } }

  remove(key) {
    // الحذف متسامح عمدًا: ملف مفقود أصلًا يجعل النتيجة المطلوبة (غير
    // موجود) محقّقة. رمي خطأ هنا كان سيمنع تنظيف صفٍّ يشير إلى ملف ضائع.
    try { fs.unlinkSync(this._resolve(key)); return true; } catch (e) { return false; }
  }
}

/* ---------------------------------------------------------------------------
   حلّ الإعداد.
--------------------------------------------------------------------------- */
let adapter = null;
let configured = null;

function resolveStorageRoot() {
  const provided = process.env.BRAND_MEDIA_PATH;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    return provided || path.join(__dirname, '..', '.local-media');
  }
  if (!provided || !String(provided).trim()) {
    console.error('\n❌ FATAL: NODE_ENV=production requires BRAND_MEDIA_PATH to be set to a');
    console.error('   directory on a PERSISTENT volume, e.g. /mnt/data/brand-media');
    console.error('   Brand images written inside the container image layer disappear on');
    console.error('   the next restart and leave database rows pointing at missing files —');
    console.error('   a broken logo in the guest journey. The mount path is yours to');
    console.error('   choose; this application does not assume one.\n');
    process.exit(1);
  }
  const root = path.resolve(String(provided).trim());
  if (!fs.existsSync(root)) {
    console.error(`\n❌ FATAL: BRAND_MEDIA_PATH does not exist: ${root}`);
    console.error('   The directory is NOT created automatically: a mistyped path would');
    console.error('   otherwise create one on ephemeral storage and look like success.\n');
    process.exit(1);
  }
  try { fs.accessSync(root, fs.constants.W_OK); }
  catch (e) {
    console.error(`\n❌ FATAL: BRAND_MEDIA_PATH is not writable: ${root}\n`);
    process.exit(1);
  }
  return root;
}

/** تهيئة كسولة: التخزين لا يُطلب إلا عند أول استعمال فعلي، فلا تُوقف
    بيئةٌ بلا وسائط إقلاعَ خادمٍ لا يرفع شيئًا. أما في الإنتاج فيُستدعى
    صراحةً عند الإقلاع (server.js) ليقع الفشل مبكرًا لا عند أول رفع. */
function getStorage() {
  if (!adapter) {
    const root = resolveStorageRoot();
    if (process.env.NODE_ENV !== 'production') fs.mkdirSync(root, { recursive: true });
    adapter = new LocalStorageAdapter(root);
    configured = root;
    console.log(`[storage] brand media (${adapter.name}): ${root}`);
  }
  return adapter;
}

/** مفتاح مبهم يولّده الخادم. لا يشتقّ من اسم الملف المرفوع بأي وجه:
    اسم المستخدم قد يحمل محارف مسار أو امتدادًا كاذبًا، وأي اشتقاق منه
    يجعل المهاجم يتحكم جزئيًا بمسار الكتابة. الشقّ الأول شجرة توزيع تمنع
    تراكم عشرات الآلاف من الملفات في مجلد واحد. */
function generateKey() {
  const raw = crypto.randomBytes(16).toString('hex');
  return `${raw.slice(0, 2)}/${raw}`;
}

module.exports = { getStorage, generateKey, resolveStorageRoot, LocalStorageAdapter };
