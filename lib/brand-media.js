// lib/brand-media.js — التحقق من وسائط الهوية ودورة حياتها.
//
// كل قرار هنا أمني قبل أن يكون وظيفيًا. الرفع هو المسار الوحيد في النظام
// الذي يقبل بايتات خامًا من مستخدم ويكتبها على القرص ثم يقدّمها لمتصفّح
// طرف ثالث -- أي أنه ناقل XSS وناقل استنزاف قرص وناقل تسريب بين مستأجرين
// في آن واحد إن أُهمل.
'use strict';
const crypto = require('crypto');
const { db } = require('../db.js');
const { getStorage, generateKey } = require('./storage.js');

const ASSET_TYPES = ['logo', 'banner', 'favicon'];
const SCOPE_TYPES = ['partner', 'property', 'outlet', 'merchant'];

/* الحدود. أرقام مقصودة لا اعتباطية:
   - الشعار والأيقونة صغيران بطبيعتهما؛ ملف بالميغابايتات لأيقونة علامة
     مؤشر خطأ لا حاجة مشروعة.
   - البانر أكبر لأنه صورة عرضية واسعة.
   الحد يُفحص **قبل** فكّ الصورة: صورة "قنبلة" بأبعاد هائلة وحجم ضئيل
   تستنزف الذاكرة عند المعالجة، فالبوابة الأولى هي البايتات. */
const LIMITS = {
  logo:    { maxBytes: 1024 * 1024,     maxWidth: 2000, maxHeight: 2000 },
  banner:  { maxBytes: 3 * 1024 * 1024, maxWidth: 4000, maxHeight: 2500 },
  favicon: { maxBytes: 256 * 1024,      maxWidth: 512,  maxHeight: 512 },
};

/* SVG **غير مسموح**. ليس تقصيرًا بل قرارًا: ملف SVG مستند XML قابل لحمل
   <script> و onload و xlink:href إلى جافاسكربت -- أي XSS مخزَّن يُقدَّم من
   نطاقنا نفسه. تعقيمه الموثوق يحتاج محلّل XML كامل وقائمة سماح مُتعهَّدة،
   وذلك نطاق مستقل. تأجيله أصدق من فتح الثغرة اليوم ووعد بإغلاقها.
   (قرار مطابق لما طلبه صاحب المنتج صراحة في §12.) */
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];

/* ---------------------------------------------------------------------------
   كشف النوع من **محتوى الملف** لا من امتداده ولا من ترويسة Content-Type.
   الامتداد نصّ يكتبه المستخدم، والترويسة يرسلها العميل: كلاهما ادّعاء لا
   دليل. البايتات الأولى وحدها حقيقة الملف.
--------------------------------------------------------------------------- */
function sniffMime(buf) {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47 &&
      buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return 'image/png';
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  // WEBP: 'RIFF' .... 'WEBP'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/* الأبعاد تُقرأ من ترويسة الصورة مباشرة، بلا مكتبة خارجية (المشروع بلا
   اعتماديات وقت تشغيل). فشل القراءة لا يمنع الرفع -- الأبعاد بيانات وصفية
   مفيدة لا حاجز أمني، والحاجز هو الحجم والنوع. */
function readDimensions(buf, mime) {
  try {
    if (mime === 'image/png') {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xFF) { i++; continue; }
        const marker = buf[i + 1];
        // SOF0..SOF15 عدا DHT/JPG/DAC — هذه وحدها تحمل الأبعاد
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return { width: null, height: null };
    }
    if (mime === 'image/webp') {
      const fmt = buf.toString('ascii', 12, 16);
      if (fmt === 'VP8X') return { width: (buf.readUIntLE(24, 3) & 0xFFFFFF) + 1, height: (buf.readUIntLE(27, 3) & 0xFFFFFF) + 1 };
      if (fmt === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3FFF, height: buf.readUInt16LE(28) & 0x3FFF };
      if (fmt === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3FFF) + 1, height: ((b >> 14) & 0x3FFF) + 1 };
      }
    }
  } catch (e) { /* بيانات وصفية لا حاجز */ }
  return { width: null, height: null };
}

function validate(buffer, assetType) {
  if (!ASSET_TYPES.includes(assetType)) return { ok: false, code: 'BAD_ASSET_TYPE', reason: `asset_type must be one of ${ASSET_TYPES.join(', ')}` };
  if (!buffer || !buffer.length) return { ok: false, code: 'EMPTY', reason: 'Empty upload' };

  const limits = LIMITS[assetType];
  if (buffer.length > limits.maxBytes) {
    return { ok: false, code: 'TOO_LARGE', reason: `File exceeds ${Math.round(limits.maxBytes / 1024)}KB for ${assetType}` };
  }
  const mime = sniffMime(buffer);
  if (!mime) {
    // الرسالة لا تكشف ما اكتُشف: "غير معروف" لا "هذا ملف SVG" -- كشفه
    // يحوّل النقطة إلى أداة استكشاف لما يقبله المحلّل.
    return { ok: false, code: 'BAD_MIME', reason: `Unsupported image format. Allowed: ${ALLOWED_MIME.join(', ')}` };
  }
  if (!ALLOWED_MIME.includes(mime)) {
    return { ok: false, code: 'BAD_MIME', reason: `Unsupported image format. Allowed: ${ALLOWED_MIME.join(', ')}` };
  }
  const dim = readDimensions(buffer, mime);
  if (dim.width && (dim.width > limits.maxWidth || dim.height > limits.maxHeight)) {
    return { ok: false, code: 'TOO_LARGE_DIMENSIONS', reason: `Image exceeds ${limits.maxWidth}x${limits.maxHeight} for ${assetType}` };
  }
  return { ok: true, mime, width: dim.width, height: dim.height };
}

/** يخزّن الأصل ويسجّله. `partnerId` يُمرَّر من نقطة النهاية بعد أن تحلّه
    من النطاق -- لا يُقبل من العميل أبدًا. */
function storeAsset({ scopeType, scopeId, partnerId, assetType, buffer, originalName, username }) {
  const v = validate(buffer, assetType);
  if (!v.ok) { const e = new Error(v.reason); e.status = 400; e.code = v.code; throw e; }
  if (!SCOPE_TYPES.includes(scopeType)) { const e = new Error('Invalid scope'); e.status = 400; throw e; }

  const key = generateKey();
  getStorage().put(key, buffer);
  const id = 'ast_' + crypto.randomBytes(6).toString('hex');
  db.prepare(`INSERT INTO brand_assets
      (id,scope_type,scope_id,partner_id,asset_type,storage_key,mime_type,size_bytes,width,height,checksum,original_name,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, scopeType, scopeId, partnerId, assetType, key, v.mime, buffer.length, v.width, v.height,
      crypto.createHash('sha256').update(buffer).digest('hex'),
      // الاسم الأصلي للعرض فقط -- ومع ذلك يُطبَّع إلى اسم قاعدي نظيف.
      // كشفه الاختبار: تجريد فواصل المسار وحدها كان يحوّل `../../evil.png`
      // إلى `....evil.png` -- غير ضارّ لأن الاسم لا يدخل أي مسار، لكنه
      // يُخزّن قيمة تحمل أثر محاولة اجتياز ثم تُعرض للمشغّل. التطبيع إلى
      // الاسم القاعدي أصدق، ويمنع أي استعمال مستقبلي مُهمِل لهذا الحقل.
      sanitizeDisplayName(originalName),
      Date.now(), username || null);
  return getAsset(id);
}

/* قراءة البايتات عبر التجريد. يُعرض هنا لا في server.js: نقطة التقديم
   يجب ألا تعرف مزوّد التخزين، وإلا لزم تعديلها عند إضافة محوّل S3. */
/** اسم عرض آمن: القاعدي فقط، بلا فواصل مسار ولا نقاط متتابعة. */
function sanitizeDisplayName(name) {
  const base = String(name || '').split(/[/\\]/).pop();
  const clean = base.replace(/[:*?"<>|\r\n\t]/g, '').replace(/\.{2,}/g, '.').replace(/^\.+/, '').trim();
  return clean.slice(0, 120) || null;
}

function getStorageBuffer(asset) {
  return getStorage().get(asset.storage_key);
}

function getAsset(assetId) {
  if (!assetId) return null;
  return db.prepare('SELECT * FROM brand_assets WHERE id = ?').get(assetId) || null;
}

/** الفحص الوحيد الذي يحرس القراءة والاستبدال والحذف. مقارنة واحدة، ولهذا
    خُزِّن partner_id على الصف: اشتقاقه في كل نقطة كان يعني نقطةً تنساه. */
function assertAssetInPartner(assetId, partnerId) {
  const a = getAsset(assetId);
  // نفس الرد للأصل غير الموجود وللأصل الذي يخصّ مستأجرًا آخر: رد مختلف
  // يحوّل معرّفات الأصول إلى أداة استكشاف عابرة للمستأجرين.
  if (!a || a.partner_id !== partnerId) {
    const e = new Error('Asset not found'); e.status = 404; e.code = 'ASSET_NOT_FOUND'; throw e;
  }
  return a;
}

function deleteAsset(assetId) {
  const a = getAsset(assetId);
  if (!a) return false;
  // الملف أولًا ثم الصف: العكس يترك ملفًا يتيمًا لا يعرف أحد أنه موجود.
  getStorage().remove(a.storage_key);
  db.prepare('DELETE FROM brand_assets WHERE id = ?').run(assetId);
  // وأي إشارة إليه في الهوية تُفرَّغ، وإلا بقي حقل يشير إلى أصل محذوف
  // فيظهر شعار مكسور في واجهة الضيف -- وهو أسوأ من غياب الشعار.
  for (const col of ['logo_asset_id', 'banner_asset_id', 'favicon_asset_id']) {
    db.prepare(`UPDATE branding_overrides SET ${col} = NULL WHERE ${col} = ?`).run(assetId);
  }
  return true;
}

function listAssets(partnerId) {
  return db.prepare('SELECT * FROM brand_assets WHERE partner_id = ? ORDER BY created_at DESC').all(partnerId);
}

module.exports = {
  ASSET_TYPES, SCOPE_TYPES, ALLOWED_MIME, LIMITS,
  validate, sniffMime, readDimensions,
  storeAsset, getAsset, getStorageBuffer, sanitizeDisplayName, assertAssetInPartner, deleteAsset, listAssets,
};
