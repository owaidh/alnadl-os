// tests/white-label.js — White Label: الوراثة والعزل وبوابة الميزة.
// كل تأكيد يفحص الأثر الفعلي عبر HTTP أو المُحلِّل نفسه، لا شكل البيانات.
'use strict';
const { startServer, stopServer, api, assert, assertEqual, summary, resetCounts, getDataPath } = require('./helpers.js');

function openDb() {
  process.env.SQLITE_PATH = getDataPath();
  for (const m of ['../db.js', '../lib/loyalty.js', '../lib/partner-status.js', '../lib/branding.js']) {
    try { delete require.cache[require.resolve(m)]; } catch (e) {}
  }
  return require('../db.js');
}
async function makeUser(SA, username, role, scope) {
  const c = await api('POST', '/api/admin/users', { username, role, partner_scope: scope || null }, SA);
  await api('POST', `/api/activate/${c.data.activationToken}`, { password: `${username}-strong-pass-1` });
  return (await api('POST', '/api/auth/login', { username, password: `${username}-strong-pass-1` })).data.token;
}

async function run() {
  resetCounts();
  await startServer();
  console.log('=== White Label: inheritance · isolation · feature gate ===');

  try {
    const { db, uid } = openDb();
    const branding = require('../lib/branding.js');
    const SA = (await api('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).data.token;

    // ---- شريكان: أحدهما يملك الميزة والآخر لا ----
    const planWL = uid('plan'), planNo = uid('plan');
    db.prepare(`INSERT INTO plans (id,code,name_ar,name_en,monthly_fee,tech_fee_rate,features_json) VALUES (?,?,?,?,?,?,?)`)
      .run(planWL, 'WL_ON', 'مع', 'With', 0, 0.02, JSON.stringify({ qrOrdering: true, digitalPayment: true, whiteLabel: true }));
    db.prepare(`INSERT INTO plans (id,code,name_ar,name_en,monthly_fee,tech_fee_rate,features_json) VALUES (?,?,?,?,?,?,?)`)
      .run(planNo, 'WL_OFF', 'بدون', 'Without', 0, 0.02, JSON.stringify({ qrOrdering: true, digitalPayment: true, whiteLabel: false }));

    function mkPartner(label, planId) {
      const pid = uid('pt');
      db.prepare(`INSERT INTO partners (id,name_ar,name_en,legal_name,contract_ref,status) VALUES (?,?,?,?,?,'Active')`)
        .run(pid, label, label, label, 'C-' + label);
      db.prepare(`INSERT INTO subscriptions (id,partner_id,plan_id,status,started_at,renews_at) VALUES (?,?,?,'Active',?,?)`)
        .run(uid('sub'), pid, planId, Date.now(), Date.now() + 2592000000);
      const propId = uid('prop');
      db.prepare(`INSERT INTO properties (id,partner_id,name_ar,name_en,timezone,address,status) VALUES (?,?,?,?,?,?,'Active')`)
        .run(propId, pid, label + ' P', label + ' P', 'Asia/Riyadh', 'Riyadh');
      const outId = uid('out');
      db.prepare(`INSERT INTO outlets (id,property_id,name_ar,name_en,type,operator,delivery_mode,sla_prep_min,sla_delivery_min,commission_rate,status,created_at)
                  VALUES (?,?,?,?,'coffee','alnadl','runner',8,10,0,'Active',?)`)
        .run(outId, propId, label + ' O', label + ' O', Date.now());
      return { pid, propId, outId };
    }
    const A = mkPartner('WLA', planWL);
    const B = mkPartner('WLB', planWL);
    const C = mkPartner('WLC', planNo); // بلا ميزة

    const PA = await makeUser(SA, 'wl_padmin', 'PartnerAdmin', A.pid);
    const PAC = await makeUser(SA, 'wl_padmin_c', 'PartnerAdmin', C.pid);
    const OP = await makeUser(SA, 'wl_operator', 'Operator', A.pid);

    const eff = (ctx) => branding.resolveBranding(ctx);

    // ================= بوابة الميزة =================
    db.prepare(`INSERT INTO partner_branding (partner_id,mode,logo_text,primary_color,show_powered_by,updated_at)
                VALUES (?,?,?,?,?,?)`).run(C.pid, 'white_label', 'ShouldNotShow', '#112233', 0, Date.now());
    const gated = eff({ partnerId: C.pid, propertyId: C.propId });
    assertEqual(gated.whiteLabelActive, false,
      '**شريك بلا ميزة whiteLabel يعود إلى ALNADL default** حتى لو خُزّنت له علامة كاملة');
    assertEqual(gated.gatedBy, 'plan_entitlement', 'والسبب مُصرَّح: استحقاق الباقة');
    assertEqual(gated.logo_text, 'ALNADL', 'ولا يتسرّب أي حقل من علامته المخزَّنة');

    const gatedWrite = await api('PUT', `/api/admin/branding/property/${C.propId}`, { primary_color: '#445566' }, PAC);
    assertEqual(gatedWrite.status, 403,
      '**ولا يستطيع PartnerAdmin إنشاء تجاوز بلا استحقاق** — البوابة على الخادم لا في الواجهة');

    // ================= 1) الشريك فقط =================
    db.prepare(`INSERT INTO partner_branding (partner_id,mode,logo_text,primary_color,welcome_text_ar,welcome_text_en,show_powered_by,updated_at)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(A.pid, 'white_label', 'HotelA', '#AA0000', 'أهلًا', 'Welcome', 0, Date.now());
    const s1 = eff({ partnerId: A.pid });
    assertEqual(s1.whiteLabelActive, true, '(1) الهوية فعّالة بعلامة الشريك');
    assertEqual(s1.logo_text, 'HotelA', '(1) والشعار من الشريك');
    assertEqual(s1.sources.logo_text, 'partner', '(1) والمصدر مُعلَن: partner');
    assertEqual(s1.primary_color, '#AA0000', '(1) واللون من الشريك');

    // ================= 2) العقار يرث =================
    const s2 = eff({ partnerId: A.pid, propertyId: A.propId });
    assertEqual(s2.logo_text, 'HotelA', '(2) **العقار يرث الشعار تلقائيًا** بلا تجاوز');
    assertEqual(s2.primary_color, '#AA0000', '(2) ويرث اللون');
    assertEqual(s2.sources.primary_color, 'partner', '(2) والمصدر ما زال partner');

    // ================= 3) تجاوز العقار =================
    const putProp = await api('PUT', `/api/admin/branding/property/${A.propId}`,
      { primary_color: '#00AA00' }, PA);
    assertEqual(putProp.status, 200, '(3) PartnerAdmin ينشئ تجاوزًا لعقاره');
    const s3 = eff({ partnerId: A.pid, propertyId: A.propId });
    assertEqual(s3.primary_color, '#00AA00', '(3) واللون صار من العقار');
    assertEqual(s3.sources.primary_color, 'property', '(3) والمصدر property');
    assertEqual(s3.logo_text, 'HotelA',
      '(3) **والشعار ما زال موروثًا من الشريك** — الوراثة حقلًا بحقل لا استبدال كتلة');
    assertEqual(s3.sources.logo_text, 'partner', '(3) ومصدره ما زال partner');

    // ================= 4) المنفذ يرث العقار =================
    const s4 = eff({ partnerId: A.pid, propertyId: A.propId, outletId: A.outId });
    assertEqual(s4.primary_color, '#00AA00', '(4) **المنفذ يرث لون العقار** بلا تجاوز خاص');
    assertEqual(s4.sources.primary_color, 'property', '(4) والمصدر property');
    assertEqual(s4.logo_text, 'HotelA', '(4) ويرث شعار الشريك عبر العقار');

    // ================= 5) تجاوز المنفذ =================
    const putOut = await api('PUT', `/api/admin/branding/outlet/${A.outId}`,
      { logo_text: 'CafeInside', primary_color: '#0000AA' }, PA);
    assertEqual(putOut.status, 200, '(5) تجاوز المنفذ يُنشأ');
    const s5 = eff({ partnerId: A.pid, propertyId: A.propId, outletId: A.outId });
    assertEqual(s5.logo_text, 'CafeInside', '(5) والشعار من المنفذ');
    assertEqual(s5.sources.logo_text, 'outlet', '(5) والمصدر outlet');
    assertEqual(s5.primary_color, '#0000AA', '(5) واللون من المنفذ');
    assertEqual(s5.welcome_text_ar, 'أهلًا',
      '(5) **ونص الترحيب ما زال من الشريك** — ثلاث طبقات في نتيجة واحدة');
    assertEqual(s5.sources.welcome_text_ar, 'partner', '(5) بمصدره الصحيح');

    // قبل اختيار المنفذ لا يظهر تجاوزه (توقيت رحلة الضيف)
    const preOutlet = eff({ partnerId: A.pid, propertyId: A.propId });
    assertEqual(preOutlet.logo_text, 'HotelA',
      '**قبل اختيار المنفذ، الهوية = Property → Partner** — تجاوز المنفذ لا يسري بعد');

    // ================= 6) حذف التجاوز يُعيد الوراثة =================
    const delOut = await api('DELETE', `/api/admin/branding/outlet/${A.outId}`, null, PA);
    assertEqual(delOut.status, 200, '(6) حذف تجاوز المنفذ');
    const s6 = eff({ partnerId: A.pid, propertyId: A.propId, outletId: A.outId });
    assertEqual(s6.logo_text, 'HotelA', '(6) **والشعار عاد لوراثة الشريك**');
    assertEqual(s6.primary_color, '#00AA00', '(6) واللون عاد لوراثة العقار');
    assertEqual(s6.sources.primary_color, 'property', '(6) بمصدره الصحيح');

    const delProp = await api('DELETE', `/api/admin/branding/property/${A.propId}`, null, PA);
    assertEqual(delProp.status, 200, '(6) حذف تجاوز العقار');
    const s6b = eff({ partnerId: A.pid, propertyId: A.propId, outletId: A.outId });
    assertEqual(s6b.primary_color, '#AA0000', '(6) **وكل شيء عاد لعلامة الشريك**');
    assertEqual(s6b.sources.primary_color, 'partner', '(6) بمصدرها الأصلي');

    const delAgain = await api('DELETE', `/api/admin/branding/property/${A.propId}`, null, PA);
    assertEqual(delAgain.status, 404, '(6) وحذف تجاوز غير موجود يُرجع 404 لا خطأ خادم');

    // ================= عزل المستأجر =================
    const crossWrite = await api('PUT', `/api/admin/branding/property/${B.propId}`, { primary_color: '#123456' }, PA);
    assertEqual(crossWrite.status, 403, '**PartnerAdmin لا يكتب علامة عقار شريك آخر**');
    const crossOutlet = await api('PUT', `/api/admin/branding/outlet/${B.outId}`, { logo_text: 'X' }, PA);
    assertEqual(crossOutlet.status, 403, 'ولا منفذ شريك آخر');
    const crossDelete = await api('DELETE', `/api/admin/branding/property/${B.propId}`, null, PA);
    assertEqual(crossDelete.status, 403, 'ولا يحذف تجاوزات شريك آخر');
    const crossRead = await api('GET', `/api/admin/branding/effective?partnerId=${B.pid}`, null, PA);
    assertEqual(crossRead.status, 403, 'ولا يقرأ هوية شريك آخر');

    // ================= التحقق من الشعار =================
    for (const bad of ['https://evil.com/logo.png', '//evil.com/l.png', 'data:image/png;base64,AAA',
                       '/icons/../../etc/passwd.png', '/icons/x.exe', 'javascript:alert(1)']) {
      const r = await api('PUT', `/api/admin/branding/property/${A.propId}`, { logo_url: bad }, SA);
      assertEqual(r.status, 400, `**رابط شعار غير آمن مرفوض على الخادم**: ${bad.slice(0, 34)}`);
    }
    const goodLogo = await api('PUT', `/api/admin/branding/property/${A.propId}`, { logo_url: '/icons/icon-192.png' }, SA);
    assertEqual(goodLogo.status, 200, '**ومسار داخلي آمن مقبول**');
    const badColor = await api('PUT', `/api/admin/branding/property/${A.propId}`, { primary_color: 'red;background:url(x)' }, SA);
    assertEqual(badColor.status, 400, 'ولون غير hex مرفوض — لا حقن في style');

    // ================= الصلاحيات التجارية =================
    const paCommercial = await api('POST', '/api/admin/branding',
      { partnerId: A.pid, mode: 'white_label', fee_model: 'setup' }, PA);
    assertEqual(paCommercial.status, 403,
      '**PartnerAdmin لا يغيّر النموذج التجاري** — التفعيل والرسوم لـSuperAdmin وحده');
    const opWrite = await api('PUT', `/api/admin/branding/property/${A.propId}`, { primary_color: '#111111' }, OP);
    assertEqual(opWrite.status, 403, 'وOperator لا يمسّ العلامة إطلاقًا');

    // ================= رحلة الضيف تحمل الهوية المحلولة =================
    const zid = uid('z');
    db.prepare(`INSERT INTO zones (id,property_id,name_ar,name_en,type,status) VALUES (?,?,?,?,'Business','Active')`)
      .run(zid, A.propId, 'ص', 'Hall');
    const pt = await api('POST', '/api/admin/points', { zoneId: zid, label: 'WL1', type: 'Table' }, SA);
    const qr = await api('GET', `/api/qr/${pt.data.token}`);
    assertEqual(qr.status, 200, 'رحلة الضيف تعمل');
    assertEqual(qr.data.branding.whiteLabelActive, true, '**وسياق QR يحمل الهوية الفعّالة**');
    assertEqual(qr.data.branding.logo_text, 'HotelA', 'بشعار الشريك المحلول');
    assert(!!qr.data.branding.sources, 'ومعه مصدر كل قيمة للتفسير والتدقيق');

    // ================= التدقيق =================
    const audits = db.prepare(`SELECT COUNT(*) c FROM audit_log WHERE action LIKE 'branding_override%'`).get().c;
    assert(audits >= 4, `كل تغيير علامة مُسجَّل في التدقيق (${audits})`);

  } finally {
    stopServer();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
