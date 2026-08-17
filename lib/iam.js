// lib/iam.js — Identity & Access Management (Role Corrective §3.1 / §3.2).
//
// لماذا وحدة مستقلة: قواعد عدم التصعيد (§3.2) يجب أن تكون في مكان واحد
// تستدعيه كل نقطة تُعدّل مستخدمًا. لو تكررت في كل معالج لاختلفت بمرور
// الوقت، وأول اختلاف هو ثغرة تصعيد صلاحية.
'use strict';
const crypto = require('crypto');
const { db, uid } = require('../db.js');

const ACTIVATION_TTL_MS = 72 * 60 * 60 * 1000; // 72 ساعة

/* ---------------------------------------------------------------------------
   §3.2 — من يستطيع إنشاء/تعديل أي دور
   القاعدة تُقرأ من هنا فقط، ويُفرضها الخادم دائمًا. الواجهة قد تُخفي أزرارًا،
   لكن الإخفاء ليس حماية -- الحماية هنا.
--------------------------------------------------------------------------- */
const PLATFORM_ROLES = ['SuperAdmin', 'AlnadlFinance', 'ProductAdmin', 'SafetyReviewer'];
const PARTNER_ROLES  = ['PartnerAdmin', 'PartnerViewer'];
const SITE_ROLES     = ['Operator', 'Runner', 'SiteManager'];
const ALL_ROLES      = [...PLATFORM_ROLES, ...PARTNER_ROLES, ...SITE_ROLES];

/** الأدوار التي يملك هذا الفاعل حق منحها. */
function assignableRoles(actorRole) {
  if (actorRole === 'SuperAdmin') return ALL_ROLES;
  // PartnerAdmin يبقى داخل نطاقه ولا يمنح أي دور منصة أو مالية أو Engage.
  if (actorRole === 'PartnerAdmin') return [...SITE_ROLES, 'PartnerViewer'];
  return [];
}

function canAssignRole(actorRole, targetRole) {
  return assignableRoles(actorRole).includes(targetRole);
}

/** يرمي 403 إن حاول الفاعل تجاوز نطاقه أو منح دورًا أعلى منه. */
function assertCanManageUser(session, target, intended) {
  const err = (msg) => { const e = new Error(msg); e.status = 403; throw e; };

  if (session.role === 'PartnerAdmin') {
    // لا يلمس إلا مستخدمي شريكه
    if (target && target.partner_scope !== session.scope) err('Forbidden: user belongs to another partner');
    // ولا يمنح دورًا خارج قائمته
    if (intended && intended.role && !canAssignRole('PartnerAdmin', intended.role)) {
      err('Forbidden: PartnerAdmin cannot assign platform or finance roles');
    }
    // ولا ينقل مستخدمًا إلى شريك آخر
    if (intended && intended.partner_scope !== undefined && intended.partner_scope !== session.scope) {
      err('Forbidden: cannot move a user outside your partner scope');
    }
    return;
  }

  if (session.role === 'SuperAdmin') {
    if (intended && intended.role && !canAssignRole('SuperAdmin', intended.role)) err('Unknown role');
    return;
  }

  err('Forbidden');
}

/* §3.2 — حماية آخر SuperAdmin.
   تعطيل أو خفض آخر حساب SuperAdmin فعّال يُقفل المنصة نهائيًا بلا أي مسار
   استرجاع من الواجهة. يُرفض صراحةً بدل تركه يحدث ثم اكتشافه بعد فوات الأوان. */
function assertNotLastSuperAdmin(targetUser, change) {
  if (!targetUser || targetUser.role !== 'SuperAdmin') return;
  const losesRole = change.role !== undefined && change.role !== 'SuperAdmin';
  const losesAccess = change.status === 'suspended' || change.active === 0 || change.active === false;
  if (!losesRole && !losesAccess) return;

  const remaining = db.prepare(
    `SELECT COUNT(*) c FROM users WHERE role = 'SuperAdmin' AND active = 1 AND id != ?`
  ).get(targetUser.id).c;
  if (remaining === 0) {
    const e = new Error('Refused: this is the last active SuperAdmin — the platform would become unmanageable');
    e.status = 409;
    throw e;
  }
}

/* ---------------------------------------------------------------------------
   رموز التفعيل — بديل "كلمة المرور = اسم المستخدم"
   الرمز يُخزَّن مُجزَّأً فقط. النص الصريح يُعاد **مرة واحدة** في استجابة
   الإنشاء لينسخه المسؤول، ولا يُخزَّن ولا يُسجَّل ولا يمكن استرجاعه بعدها.
--------------------------------------------------------------------------- */
function hashToken(token) {
  return crypto.createHash('sha256')
    .update(`${process.env.SESSION_SECRET || 'dev-activation-salt'}:${token}`)
    .digest('hex');
}

function issueActivationToken(userId, createdBy) {
  // إبطال أي رمز سابق: رمز واحد حيّ فقط لكل مستخدم في أي لحظة.
  db.prepare(`UPDATE user_activation_tokens SET status='superseded' WHERE user_id=? AND status='pending'`).run(userId);
  const token = crypto.randomBytes(24).toString('base64url');
  const now = Date.now();
  db.prepare(`INSERT INTO user_activation_tokens (id,user_id,token_hash,created_by,status,created_at,expires_at)
              VALUES (?,?,?,?,'pending',?,?)`)
    .run(uid('act'), userId, hashToken(token), createdBy || null, now, now + ACTIVATION_TTL_MS);
  return { token, expiresAt: now + ACTIVATION_TTL_MS };
}

/** يتحقق من رمز دون استهلاكه — لتُظهر شاشة التفعيل اسم المستخدم قبل الإرسال. */
function peekActivation(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT * FROM user_activation_tokens WHERE token_hash=? AND status='pending'`).get(hashToken(token));
  if (!row || Date.now() > row.expires_at) return null;
  const user = db.prepare('SELECT id, username, role FROM users WHERE id=?').get(row.user_id);
  return user ? { tokenRow: row, user } : null;
}

const PASSWORD_MIN = 10;

/** يستهلك الرمز ويعيّن كلمة المرور. استخدام واحد -- إعادة اللعب مرفوضة. */
function consumeActivation(token, newPassword, hashPassword) {
  const found = peekActivation(token);
  if (!found) return { ok: false, reason: 'invalid_or_expired' };
  if (!newPassword || String(newPassword).length < PASSWORD_MIN) {
    return { ok: false, reason: 'weak_password', minLength: PASSWORD_MIN };
  }
  const now = Date.now();
  db.prepare(`UPDATE user_activation_tokens SET status='consumed', consumed_at=? WHERE id=?`).run(now, found.tokenRow.id);
  db.prepare(`UPDATE users SET password_hash=?, status='active', active=1, activated_at=COALESCE(activated_at,?), password_set_at=? WHERE id=?`)
    .run(hashPassword(newPassword), now, now, found.user.id);
  return { ok: true, userId: found.user.id, username: found.user.username };
}

/** ملخص صلاحيات بلغة أعمال (§13) — لا أسماء نقاط برمجية. */
const ROLE_SUMMARY = {
  SuperAdmin:     { scope: 'platform', ar: ['إدارة كاملة للمنصة والشركاء والباقات', 'حوكمة Engage ومفتاح الإيقاف العام', 'سجل التدقيق'], en: ['Full platform, partner and plan administration', 'Engage governance and global kill switch', 'Audit log'] },
  AlnadlFinance:  { scope: 'platform', ar: ['التسويات والاسترجاعات', 'التدقيق المالي'], en: ['Settlements and refunds', 'Financial audit'] },
  ProductAdmin:   { scope: 'platform', ar: ['مختبر الآليات ودورة حياتها', 'نظرة Engage العامة'], en: ['Mechanic Lab and lifecycle', 'Engage overview'] },
  SafetyReviewer: { scope: 'platform', ar: ['حوادث السلامة ومعالجتها', 'سجل تجارب Engage'], en: ['Safety incidents and resolution', 'Engage experience ledger'] },
  PartnerAdmin:   { scope: 'partner',  ar: ['إدارة موارد الشريك: المنافذ والمناطق والقائمة', 'مستخدمو الشريك ضمن نطاقه', 'الاطلاع على الأداء والفوترة'], en: ['Partner resources: outlets, zones, catalog', 'Partner users within scope', 'Performance and billing visibility'] },
  PartnerViewer:  { scope: 'partner',  ar: ['اطلاع على الأداء والتسويات', 'بلا أي تعديل'], en: ['Performance and settlement visibility', 'No mutations'] },
  SiteManager:    { scope: 'site',     ar: ['اللوحة الحية للموقع', 'العمل على شاشة التشغيل'], en: ['Live site dashboard', 'Can work the KDS'] },
  Operator:       { scope: 'site',     ar: ['شاشة التشغيل: قبول وتجهيز الطلبات'], en: ['KDS: accept and prepare orders'] },
  Runner:         { scope: 'site',     ar: ['طابور التسليم واستلام الطلبات'], en: ['Delivery queue and order handoff'] },
};

module.exports = {
  PLATFORM_ROLES, PARTNER_ROLES, SITE_ROLES, ALL_ROLES,
  assignableRoles, canAssignRole, assertCanManageUser, assertNotLastSuperAdmin,
  issueActivationToken, peekActivation, consumeActivation,
  ROLE_SUMMARY, ACTIVATION_TTL_MS, PASSWORD_MIN,
};
