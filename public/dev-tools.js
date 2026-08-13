/* ==========================================================================
   ALNADL Hospitality OS — Developer/Demo Tools (NEVER served in production)
   ==========================================================================
   UX-0 corrective round. This file physically contains every piece of
   demo/prototype-only functionality that public/app.js (the production
   bundle) previously had baked in: the one-tap demo-account login chooser,
   and the simulated-QR-scan point picker (with the /api/demo/points call
   that backs it).

   server.js gates GET /dev-tools.js the exact same way it already gates
   GET /api/demo/points -- a genuine 404 when NODE_ENV=production, not a
   response that happens to be empty. index.html references this file
   inside a <!--DEV-ONLY--> marker that the server strips from the HTML
   response entirely in production (see serveStatic() in server.js), so a
   production deployment's HTML does not even contain a <script> tag
   pointing at a URL that would 404.

   Load order matters and is enforced by index.html: app.js runs first
   (defining S, api, t, render, App and all its methods), THEN this file
   runs (so it can freely reference those globals), THEN a small inline
   script calls App.boot() -- by that point window.AlnadlDevTools is
   either fully populated (this file loaded) or simply undefined (server
   404'd it), and every render() from here on sees the correct, final
   answer with no race condition.

   Nothing in app.js ever calls INTO this file except through the
   window.AlnadlDevTools.renderDemoLogin / renderDemoQrPicker hooks that
   renderLogin()/renderQrPicker() check for. If this file is absent,
   those two functions fall through to their real production behavior
   (a real credential form, a genuine invalid-QR state) -- already proven
   correct in the prior UX-0 delivery and unchanged by this file's
   existence or absence.
   ========================================================================== */
(function(){

  const DEMO_USERS = [
    ['operator','Operator','KDS · accept/prepare/ready orders'],
    ['runner','Runner','Deliver Ready orders'],
    ['manager','SiteManager','Site oversight, can also work the KDS'],
    ['partner','PartnerViewer','Revenue & settlement for their own site only'],
    ['partneradmin','PartnerAdmin','Self-service: manage own zones/QR/catalog + billing'],
    ['finance','AlnadlFinance','Settlement approval + audit log'],
    ['admin','SuperAdmin','Full platform: tenants, plans, zones, catalog, audit'],
  ];

  // Demo one-tap login: password===username, exactly the pre-UX-0
  // behavior, now living somewhere the production server never delivers.
  App.quickLogin = async function(username){
    try{
      const r = await api('POST', '/api/auth/login', { username, password: username });
      S.session = r; S.mode = App.roleHome(r.user.role);
      S.screen = App.roleDefaultScreen(r.user.role);
      await App.loadForRole();
      render();
    }catch(e){ showErr(e.message); }
  };

  App._loadDemoPoints = async function(){
    try{ S._demoPoints = await api('GET','/api/demo/points'); render(); }catch(e){ S._demoPoints = []; render(); }
  };

  // Demo-only payment failure test path. The real, production
  // submitPayment() in app.js no longer accepts or sends a simulateFail
  // flag at all -- this is a fully separate function, reachable only
  // through a button this file itself injects into scrCheckout() via the
  // window.AlnadlDevTools.renderPaymentTestControl() extension point,
  // which is never present at all in production (this whole file is
  // server-gated exactly like /api/demo/points).
  App.submitPaymentSimulatedFail = async function(){
    S.ui.err=null;
    try{
      if(!S.currentOrder){
        const payload = {
          pointId: S.qrContext.point.id,
          customerName: S.checkoutName || null,
          customerPhone: S.checkoutPhone || null,
          promoCode: S.promo ? S.promo.code : null,
          redeemPoints: S.redeemPoints || 0,
          walletId: (S.payMethod==='wallet' && S.wallet) ? S.wallet.id : null,
          items: S.cart.map(c=>({ productId:c.productId, variantId:c.variantId, addonIds:c.addonIds, qty:c.qty, notes:c.notes })),
        };
        const created = await api('POST', '/api/orders', payload);
        S.currentOrder = { id: created.id, status: created.status };
      }
      const result = await api('POST', `/api/orders/${S.currentOrder.id}/pay`, { method:S.payMethod, simulateFail:true });
      S.currentOrder.status = result.status;
      App.goScreen('paymentResult');
    }catch(e){ showErr(e.message); }
  };

  window.AlnadlDevTools = {
    renderDemoLogin(){
      const chooseUser = S.lang==='ar' ? 'اختر مستخدمًا تجريبيًا' : 'Choose a demo user';
      const resetHint = S.lang==='ar' ? 'كلمة المرور = اسم المستخدم' : 'Password = username';
      return `<div class="loginwrap"><div class="loginbox">
        <h2>${t('login')}</h2><p>${chooseUser} · ${resetHint}</p>
        ${S.ui.err? `<div class="errbox">${S.ui.err}</div>`:''}
        ${DEMO_USERS.map(([u,r,desc])=>`<div class="userchip" onclick="App.quickLogin('${u}')"><div><b>${u}</b><br><span>${desc}</span></div><span>${r}</span></div>`).join('')}
        <button class="ghostbtn" style="margin-top:10px;width:100%" onclick="S.screen='welcome';render()">← ${t('role_customer')}</button>
      </div></div>`;
    },

    renderDemoQrPicker(){
      if(!S._demoPoints){ App._loadDemoPoints(); }
      const list = S._demoPoints;
      const noDemoPoints = S.lang==='ar' ? 'لا توجد نقاط تجريبية متاحة' : 'No demo points available';
      return `<div class="fohshell"><div class="phone"><div class="welcome">
        <div class="crest">ن</div>
        <h2 style="margin:0">${t('scanQr')}</h2>
        <div class="qrpicklist">
          ${list===undefined ? `
            <div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>
          ` : (list.length? list.map(p=>`<button class="qrpickitem" onclick="App.pickPoint('${p.token}')">${p.label}<span>${S.lang==='ar'?p.zone_ar:p.zone_en} · ${p.id}</span></button>`).join('')
            : `<div class="statepanel"><div class="glyph">—</div><p>${noDemoPoints}</p></div>`)}
        </div>
      </div></div></div>`;
    },

    renderPaymentTestControl(){
      const label = S.lang==='ar' ? 'محاكاة فشل الدفع (اختبار)' : 'Simulate payment failure (test)';
      return `<button style="border:none;background:none;color:var(--ink-400);font-size:11px" onclick="App.submitPaymentSimulatedFail()">${label}</button>`;
    },
  };

})();
