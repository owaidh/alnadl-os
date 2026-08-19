/* ==========================================================================
   ALNADL HOSPITALITY OS — Frontend (talks to the real backend over HTTP)
   No build step, no framework: plain fetch + template strings.
   ========================================================================== */

const API = '';
async function api(method, path, body, auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && S.session) headers['Authorization'] = 'Bearer ' + S.session.token;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

const T = {
  ar:{
    scanQr:'اختر نقطة (محاكاة مسح QR)', startOrder:'ابدأ الطلب', youAreAt:'أنت في', serviceOn:'الخدمة متاحة الآن',
    save:'حفظ',
    search:'بحث عن منتج...', cart:'السلة', items:'منتجات', addToCart:'إضافة للسلة',
    required:'إلزامي', notes:'ملاحظات خاصة', notesPh:'مثال: بدون سكر',
    yourCart:'سلتك', subtotal:'المجموع الفرعي', vat:'ضريبة القيمة المضافة',
    promo:'كود الخصم', apply:'تطبيق',
    total:'الإجمالي', continueCheckout:'متابعة للدفع', emptyCart:'سلتك فارغة — أضف منتجات من القائمة',
    checkoutTitle:'إتمام الطلب', deliverTo:'التسليم إلى', nameField:'الاسم', phoneField:'رقم الجوال',
    payMethod:'طريقة الدفع', card:'بطاقة / Apple Pay', wallet:'رصيد الشركة', payNow:'ادفع الآن',
    paySuccess:'تم الدفع بنجاح', payFail:'تعذر إتمام الدفع', yourOrder:'طلبك رقم', retry:'إعادة المحاولة',
    goTrack:'الانتقال إلى متابعة الطلب', trackTitle:'طلب', needHelp:'تحتاج مساعدة؟',
    st_created:'تم إنشاء الطلب', st_pending:'بانتظار تأكيد الدفع', st_paid:'تم الاستلام',
    st_accepted:'تم قبول الطلب', st_preparing:'قيد التجهيز', st_ready:'جاهز', st_out:'في الطريق إليك',
    st_delivered:'تم التسليم', st_failed:'فشل الدفع', st_cancelled:'ملغي',
    st_partially_ready:'جاهز جزئيًا', st_partially_delivered:'تم تسليم جزء',
    backToStart:'طلب جديد',
    howExperience:'كيف كانت تجربتك؟', speed:'سرعة الخدمة', quality:'جودة المنتج', delivery:'التسليم',
    optionalComment:'تعليق اختياري', submitFeedback:'إرسال التقييم', thanksFeedback:'شكرًا لتقييمك!',
    kds:'شاشة التشغيل — KDS', newCol:'جديد', prepCol:'قيد التجهيز', readyCol:'جاهز',
    accept:'قبول الطلب', start:'بدء التجهيز', markReady:'تعليم كجاهز', cancelOrder:'إلغاء الطلب',
    outForDelivery:'خرج للتوصيل', close:'إغلاق', noOrders:'لا توجد طلبات في هذه الحالة',
    payment:'الدفع', cancelReason:'سبب الإلغاء',
    runnerQ:'طلبات جاهزة للتسليم', claim:'استلام للتوصيل', deliverBtn:'تم التسليم', failBtn:'تعذر التسليم',
    adminZones:'المناطق والنقاط ورموز QR', adminCatalog:'القائمة والمنتجات', auditLog:'سجل التدقيق',
    zoneName:'اسم المنطقة (AR)', zoneNameEn:'اسم المنطقة (EN)', zoneType:'نوع المنطقة', addZone:'إضافة منطقة',
    pointCode:'اسم/رمز النقطة', pointType:'نوع النقطة', addPoint:'إضافة نقطة وتوليد QR',
    existingZones:'المناطق الحالية', existingPoints:'النقاط ورموز QR',
    catName:'اسم التصنيف (AR)', catNameEn:'اسم التصنيف (EN)', addCat:'إضافة تصنيف',
    prodName:'اسم المنتج (AR)', prodNameEn:'اسم المنتج (EN)', prodPrice:'السعر الأساسي', prodCat:'التصنيف',
    addProd:'إضافة منتج', currentCatalog:'القائمة الحالية', active:'مفعّل', inactive:'موقوف',
    partnerOverview:'نظرة عامة — الشريك', grossSales:'إجمالي المبيعات', orders:'الطلبات', aov:'متوسط قيمة الطلب',
    topZones:'أفضل المناطق', revShareTitle:'تسوية مشاركة الإيراد',
    discounts:'الخصومات', refunds:'المرتجعات', eligibleBase:'القاعدة المستحقة', partnerShare:'حصة الشريك',
    approveSettlement:'اعتماد التسوية', statusDraft:'مسودة',
    login:'دخول', logout:'خروج',
    resetHint:'كلمة المرور = اسم المستخدم', role_customer:'العميل واجهة الطلب',
    scope_note:'كل عملية هنا فعلية عبر واجهة برمجية حقيقية — لا توجد بيانات وهمية على الواجهة',
    toast_added:'أُضيف للسلة', toast_saved:'تم الحفظ', toast_zone:'تمت إضافة المنطقة', toast_point:'تم توليد QR للنقطة',
    toast_prod:'أُضيف المنتج للقائمة', toast_transition:'تم تحديث حالة الطلب',
  },
  en:{
    scanQr:'Choose a point (simulated QR scan)', startOrder:'Start Order', youAreAt:'You are at', serviceOn:'Service available now',
    save:'Save',
    search:'Search a product...', cart:'Cart', items:'items', addToCart:'Add to cart',
    required:'Required', notes:'Special notes', notesPh:'e.g. no sugar',
    yourCart:'Your cart', subtotal:'Subtotal', vat:'VAT',
    promo:'Promo code', apply:'Apply',
    total:'Total', continueCheckout:'Continue to checkout', emptyCart:'Your cart is empty — add items from the menu',
    checkoutTitle:'Checkout', deliverTo:'Deliver to', nameField:'Name', phoneField:'Mobile number',
    payMethod:'Payment method', card:'Card / Apple Pay', wallet:'Corporate wallet', payNow:'Pay now',
    paySuccess:'Payment successful', payFail:'Payment could not be completed', yourOrder:'Your order #', retry:'Retry',
    goTrack:'Go to order tracking', trackTitle:'Order', needHelp:'Need help?',
    st_created:'Order created', st_pending:'Awaiting payment confirmation', st_paid:'Order received',
    st_accepted:'Order accepted', st_preparing:'Preparing', st_ready:'Ready', st_out:'On the way to you',
    st_delivered:'Delivered', st_failed:'Payment failed', st_cancelled:'Cancelled',
    st_partially_ready:'Partially ready', st_partially_delivered:'Partially delivered',
    backToStart:'New order',
    howExperience:'How was your experience?', speed:'Service speed', quality:'Product quality', delivery:'Delivery',
    optionalComment:'Optional comment', submitFeedback:'Submit feedback', thanksFeedback:'Thanks for your feedback!',
    kds:'Kitchen Display — KDS', newCol:'New', prepCol:'Preparing', readyCol:'Ready',
    accept:'Accept order', start:'Start preparing', markReady:'Mark ready', cancelOrder:'Cancel order',
    outForDelivery:'Out for delivery', close:'Close', noOrders:'No orders in this state',
    payment:'Payment', cancelReason:'Cancellation reason',
    runnerQ:'Ready for delivery', claim:'Claim for delivery', deliverBtn:'Delivered', failBtn:'Delivery failed',
    adminZones:'Zones, Points & QR', adminCatalog:'Catalog & Products', auditLog:'Audit Log',
    zoneName:'Zone name (AR)', zoneNameEn:'Zone name (EN)', zoneType:'Zone type', addZone:'Add zone',
    pointCode:'Point label/code', pointType:'Point type', addPoint:'Add point & generate QR',
    existingZones:'Current zones', existingPoints:'Points & QR codes',
    catName:'Category name (AR)', catNameEn:'Category name (EN)', addCat:'Add category',
    prodName:'Product name (AR)', prodNameEn:'Product name (EN)', prodPrice:'Base price', prodCat:'Category',
    addProd:'Add product', currentCatalog:'Current catalog', active:'Active', inactive:'Inactive',
    partnerOverview:'Partner overview', grossSales:'Gross sales', orders:'Orders', aov:'AOV',
    topZones:'Top zones', revShareTitle:'Revenue-share settlement',
    discounts:'Discounts', refunds:'Refunds', eligibleBase:'Eligible base', partnerShare:'Partner share',
    approveSettlement:'Approve settlement', statusDraft:'Draft',
    login:'Log in', logout:'Log out',
    resetHint:'Password = username', role_customer:'Customer ordering UI',
    scope_note:'Every action here is real over the HTTP API — nothing on screen is mocked',
    toast_added:'Added to cart', toast_saved:'Saved', toast_zone:'Zone added', toast_point:'QR generated for point',
    toast_prod:'Product added to catalog', toast_transition:'Order status updated',
  }
};
function t(k){ return T[S.lang][k] ?? k; }
function money(n){ return Number(n||0).toFixed(2); }
// UX-0: shared KPI-dashboard skeleton — used by every admin/partner screen
// that leads with a kpirow (Overview, Portfolio, Live Manager) so the
// loading shape matches the shape that actually renders (spec §12).
function kpiDashboardSkeleton(n){ return `<div class="kpirow">${Array.from({length:n||4}).map(()=>'<div class="skeleton skeleton-kpi"></div>').join('')}</div>`; }
// UX-0 (spec §20 audit — cart/card/modal emoji thumbnails "look prototype-
// like"): a styled first-letter monogram, not a food emoji. Works for any
// product name in either language; see .media-placeholder in styles.css.
function productMonogram(name){ return (name||'؟').trim().charAt(0).toUpperCase() || '؟'; }
function unitCur(){ return S.lang==='ar' ? 'ر.س' : 'SAR'; }

const S = {
  lang:'ar', mode:'customer', screen:'welcome',
  session:null, // {token, user:{username,role,scope}}
  qrContext:null, catalog:null, activeCatId:null, activeProduct:null,
  // UX-1 (spec G05: "close/back behavior must preserve state... No
  // accidental loss of selections"): keyed by product id, holds the
  // last in-progress variant/addons/qty/notes for a product the customer
  // opened but did not add to cart. Cleared for a product once it IS
  // added (see addActiveToCart) so the next open starts fresh rather
  // than replaying a just-completed selection.
  productDrafts:{},
  cart:[], currentOrder:null, payMethod:'card', promo:null, redeemPoints:0, loyaltyBalance:null, wallet:null, activeOutletId:null,
  checkoutName:'', checkoutPhone:'',
  adminPlans:null, partnerProfile:null, properties:null, simResult:null, partnerStatusInfo:null, siteExceptions:null, orderRefunds:null, engageState:null, killSwitch:null, policyOverrides:null, partnerEngage:null, revenueLedger:null, mechanics:null, engageOverview:null, safetyIncidents:null, engageLedger:null,
  ops:{ queue:null, error:null }, runnerQ:null, runnerError:null, runnerLastRefresh:null, admin:{ zones:[], points:[], categories:[], products:[] },
  partner:{ overview:null, settlement:null }, audit:[], tenants:[], plans:[], subscription:null,
  portfolio:null, live:null, users:[], settlements:[], merchants:[], wallets:[], outlets:[], revenueLedger:[], revenueModels:{}, branding:null,
  refundLookupOrder:null, refundLookupRefunds:[], refundOrderIdInput:'',
  ui:{ openOrder:null, cancelFor:null, deliveryFailFor:null, refundFor:null, statusChange:null, activationHandoff:null, proposeMechanic:null, mechTransition:null, bulkPoints:null, err:null }, toast:null,
  // UX-5 (spec §11): Engage guest state. `pass` holds ONLY the capability
  // token the server handed us plus eligibility — never any policy,
  // personality reasoning, or AI internals. `moment.payload` is the
  // already-safety-checked content the server chose to serve; the client
  // never sees why it was chosen (spec: "Novelty/repetition logic is
  // invisible to the guest").
  engage:{ eligible:null, accessToken:null, session:null, moment:null, loading:false, ended:false, error:null, invite:null },
  PARTNER_ID:'pt_nova', PROPERTY_ID:'prop_nova_main',
};

function showToast(msg){ S.toast=msg; const d=document.createElement('div'); d.className='toast'; d.textContent=msg; document.body.appendChild(d); setTimeout(()=>d.remove(),1700); }
function showErr(msg){ S.ui.err = msg; render(); }

/* ============================== ACTIONS ============================== */
const App = {
  setLang(l){ S.lang=l; document.documentElement.lang=l; document.documentElement.dir = l==='ar'?'rtl':'ltr'; render(); },

  /* ---- customer boot ---- */
  async pickPoint(token){
    history.replaceState(null,'','/?t='+token);
    await App.loadQrContext(token);
  },
  async loadQrContext(token){
    try{
      const ctx = await api('GET', '/api/service-hub/'+token); // superset of /api/qr — same shape, plus optional hub/outlets
      S.qrContext = ctx; S.mode='customer';
      // Service Hub (§7): only ever shown when the property genuinely has more
      // than one available outlet AND the plan includes multiOutlet — every
      // single-outlet property (the default for everything before Phase 4)
      // skips straight to 'welcome' exactly as before.
      S.screen = ctx.hub ? 'hub' : 'welcome';
      if(!ctx.hub && ctx.outlet) S.activeOutletId = ctx.outlet.id;
      render();
    }catch(e){ showErr(e.message); }
  },
  chooseOutlet(outletId){
    S.activeOutletId = outletId;
    // First-ever pick (empty cart, fresh visit) shows the branded Welcome
    // screen once, matching how a single-outlet property always does.
    // Switching outlets mid-shopping (cart already has items) skips straight
    // back to the menu — the customer already saw Welcome and is actively
    // building a cart, so re-showing it would be a pointless extra tap.
    App.goScreen(S.cart.length > 0 ? 'menu' : 'welcome');
  },
  async goScreen(scr){ S.screen=scr; render(); window.scrollTo(0,0);
    if(scr==='menu' && !S.catalog){ await App.loadCatalog(); }
  },
  async loadCatalog(){
    const data = await api('GET', '/api/catalog?propertyId='+S.qrContext.property.id);
    S.catalog = data; S.activeCatId = data.categories[0]?.id; render();
  },
  setCat(id){ S.activeCatId=id; render(); },

  openProduct(pid){
    const def = S.catalog.products.find(p=>p.id===pid);
    const draft = S.productDrafts[pid];
    S.activeProduct = draft
      ? { def, variantIdx:draft.variantIdx, addons:{...draft.addons}, qty:draft.qty, notes:draft.notes }
      : { def, variantIdx: def.variants.length?0:-1, addons:{}, qty:1, notes:'' };
    render();
  },
  closeProduct(){
    // Save the in-progress selection as a draft before clearing
    // activeProduct — this is what makes reopening the SAME product
    // (without adding it to cart first) restore exactly what the
    // customer had chosen, instead of starting over.
    if(S.activeProduct){
      const ap = S.activeProduct;
      S.productDrafts[ap.def.id] = { variantIdx:ap.variantIdx, addons:{...ap.addons}, qty:ap.qty, notes:ap.notes };
    }
    S.activeProduct=null; render();
  },
  pickVariant(idx){ S.activeProduct.variantIdx=idx; render(); },
  toggleAddon(id){ S.activeProduct.addons[id]=!S.activeProduct.addons[id]; render(); },
  stepQty(d){ S.activeProduct.qty=Math.max(1,S.activeProduct.qty+d); render(); },
  setNotes(v){ S.activeProduct.notes=v; },
  addActiveToCart(){
    const ap=S.activeProduct, def=ap.def;
    const variant = ap.variantIdx>=0 ? def.variants[ap.variantIdx] : null;
    const addonList = def.addons.filter(a=>ap.addons[a.id]);
    const unit = def.base_price + (variant?variant.price_delta:0) + addonList.reduce((s,a)=>s+a.price,0);
    S.cart.push({ key:'ci'+Math.random().toString(36).slice(2), productId:def.id, ar:def.name_ar, en:def.name_en, imageUrl:def.image_url||null,
      variantId: variant?variant.id:null, variantLabel: variant?{ar:variant.name_ar,en:variant.name_en}:null,
      addonIds: addonList.map(a=>a.id), addonLabels: addonList.map(a=>({ar:a.name_ar,en:a.name_en})),
      notes:ap.notes, qty:ap.qty, unit, lineTotal:unit*ap.qty });
    delete S.productDrafts[def.id]; // resolved into the cart — next open should start fresh, not replay this
    S.activeProduct=null; showToast(t('toast_added')); render();
  },
  cartStep(key,d){ const r=S.cart.find(c=>c.key===key); if(!r)return; r.qty=Math.max(1,r.qty+d); r.lineTotal=r.unit*r.qty; render(); },
  cartRemove(key){ S.cart=S.cart.filter(c=>c.key!==key); render(); },
  cartTotal(){ return S.cart.reduce((s,c)=>s+c.lineTotal,0); },
  cartCount(){ return S.cart.reduce((s,c)=>s+c.qty,0); },
  computeTotals(){
    const subtotal = App.cartTotal();
    const promoDiscount = S.promo? (S.promo.discountType==='percent'? subtotal*(S.promo.discountValue/100) : Math.min(S.promo.discountValue, subtotal)) : 0;
    const afterPromo = subtotal - promoDiscount;
    const loyaltyDiscount = S.redeemPoints>0 ? Math.min(S.redeemPoints * 0.05, afterPromo) : 0;
    const eligible = Math.max(0, afterPromo - loyaltyDiscount);
    const vat = eligible * 0.15;
    const total = eligible + vat;
    return { subtotal, promoDiscount, loyaltyDiscount, eligible, vat, total };
  },
  setPayMethod(m){ S.payMethod=m; render(); },
  async applyPromo(){
    const code = document.getElementById('promoInput')?.value.trim();
    if(!code){ S.promo=null; S.ui.promoMsg=null; render(); return; }
    try{
      const r = await api('GET', `/api/promotions/validate?code=${encodeURIComponent(code)}&propertyId=${S.qrContext.property.id}`);
      if(r.valid){ S.promo = { code:r.code, discountType:r.discountType, discountValue:r.discountValue }; S.ui.promoMsg = S.lang==='ar'?'تم تطبيق الكود':'Code applied'; }
      else { S.promo=null; S.ui.promoMsg = S.lang==='ar'?'كود غير صالح':'Invalid code'; }
    }catch{ S.promo=null; S.ui.promoMsg = S.lang==='ar'?'كود غير صالح':'Invalid code'; }
    render();
  },
  async lookupLoyalty(){
    const phone = S.checkoutPhone;
    if(!phone || !S.qrContext.features?.loyalty){ return; }
    try{ const r = await api('GET', `/api/loyalty/${encodeURIComponent(phone)}`); S.loyaltyBalance = r.pointsBalance; render(); }catch{}
  },
  setRedeemPoints(v){
    const n = Math.max(0, Math.min(parseInt(v)||0, S.loyaltyBalance||0));
    S.redeemPoints = n; render();
  },
  async lookupWallet(){
    const ref = document.getElementById('employeeRef')?.value.trim();
    if(!ref) return;
    try{
      const r = await api('GET', `/api/wallets/lookup?ownerRef=${encodeURIComponent(ref)}`);
      S.wallet = { ...r, ownerRef: ref }; S.payMethod='wallet'; showToast(S.lang==='ar'?'تم العثور على المحفظة':'Wallet found'); render();
    }catch(e){ S.wallet=null; showErr(S.lang==='ar'?'لا توجد محفظة بهذا المعرّف':'No wallet found for this ID'); }
  },

  async goCheckout(){ if(S.cart.length===0) return; App.goScreen('checkout'); },

  // UX-1 corrective finding: this function used to accept a simulateFail
  // parameter, with the real payment button and a "Simulate payment
  // failure (test)" button both calling it — the second one sitting
  // directly in the production checkout screen. Same severity class as
  // the earlier protobar/demo-picker finding: a raw, client-reachable
  // flag on the real payment endpoint with no environment gating at all.
  // server.js now ignores that flag outright in production regardless of
  // what any client sends, and this function no longer accepts or sends
  // it at all — the only way to exercise the failure path is
  // dev-tools.js's own separate function (never delivered to production,
  // see the extension point in scrCheckout() below).
  async submitPayment(){
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
        S.currentOrder = { id: created.id, status: created.status, paymentRef: created.paymentRef };
      }
      const result = await api('POST', `/api/orders/${S.currentOrder.id}/pay`, { method:S.payMethod });
      S.currentOrder.status = result.status;
      App.goScreen('paymentResult');
    }catch(e){ showErr(e.message); }
  },
  retryPayment(){ App.goScreen('checkout'); },
  async goTrack(){ await App.refreshOrder(); App.goScreen('tracking'); },
  async refreshOrder(){
    if(!S.currentOrder) return;
    try{ const o = await api('GET', '/api/orders/'+S.currentOrder.id); S.currentOrder = { ...S.currentOrder, ...o }; render(); }catch{}
  },
  startNewOrder(){ S.cart=[]; S.currentOrder=null; S.promo=null; S.redeemPoints=0; S.loyaltyBalance=null; S.wallet=null; S.payMethod='card'; S.checkoutName=''; S.checkoutPhone=''; App.goScreen('welcome'); },
  setStar(n){ S.feedback = S.feedback||{stars:0,tags:[],comment:''}; S.feedback.stars=n; render(); },
  toggleTag(tag){ S.feedback = S.feedback||{stars:0,tags:[],comment:''}; const i=S.feedback.tags.indexOf(tag); if(i>-1) S.feedback.tags.splice(i,1); else S.feedback.tags.push(tag); render(); },
  async submitFeedback(){
    try{
      await api('POST', `/api/orders/${S.currentOrder.id}/feedback`, { stars:S.feedback.stars||5, tags:S.feedback.tags||[], comment:S.feedback.comment||'' });
      App.goScreen('feedbackThanks');
    }catch(e){ showErr(e.message); }
  },

  /* ---- Engage (UX-5, spec §11) --------------------------------------
     Every failure path here returns the guest to the normal hospitality
     flow rather than showing an error: per §11, "Kill-switch/off state
     falls back to normal hospitality flow without breaking Core", and
     "Safety... should result in safe alternative content or a clean end
     state -- not expose policy internals or alarming moderation language
     to the guest". An ineligible pass, a disabled feature flag, a
     provider outage and a safety rejection are therefore ALL
     indistinguishable to the guest by design -- they simply never see an
     invitation, or they see a calm ending. */
  async checkEngageEligibility(){
    if(!S.currentOrder || S.engage.eligible!==null) return;
    try{
      // paymentRef is the guest's own proof of ownership (see the
      // endpoint's authorization note in server.js) -- without it the
      // server correctly refuses to hand out an Engage capability.
      if(!S.currentOrder.paymentRef){ S.engage.eligible = false; render(); return; }
      const r = await api('GET', `/api/orders/${S.currentOrder.id}/engage-pass?paymentRef=${encodeURIComponent(S.currentOrder.paymentRef)}`);
      S.engage.eligible = !!r.eligible;
      S.engage.accessToken = r.accessToken || null;
    }catch(e){ S.engage.eligible = false; } // never surfaced to the guest
    render();
  },
  async startEngage(){
    if(!S.engage.accessToken) return;
    S.engage.loading = true; S.engage.error = null; App.goScreen('engage');
    try{
      const s = await api('POST','/api/engage/session/start',{ accessToken:S.engage.accessToken });
      S.engage.session = s;
      await App.nextMoment();
    }catch(e){ S.engage.loading=false; S.engage.error='start'; render(); }
  },
  async nextMoment(){
    if(!S.engage.session) return;
    S.engage.loading = true; render();
    try{
      const m = await api('POST',`/api/engage/session/${S.engage.session.sessionToken}/next-moment`,{});
      S.engage.moment = m;
      S.engage.session.ceilingUsed = m.ceilingUsed;
      S.engage.loading = false;
      if(m.sessionEnded) S.engage.ended = true;
      render();
    }catch(e){
      // A ceiling-reached 409 is a NORMAL, graceful ending -- not an error
      // state. Anything else also ends calmly rather than alarming the guest.
      S.engage.loading=false; S.engage.ended=true; S.engage.moment=null; render();
    }
  },
  async respondToMoment(action){
    const m = S.engage.moment; if(!m || !S.engage.session) return;
    try{
      await api('POST',`/api/engage/session/${S.engage.session.sessionToken}/moment/${m.momentId}/respond`,
        { action, idempotencyKey:`${m.momentId}:${action}` });
    }catch(e){ /* response capture is best-effort; never blocks the guest */ }
    if(S.engage.ended){ render(); return; }
    await App.nextMoment();
  },
  async endEngage(){
    if(S.engage.session){
      try{ await api('POST',`/api/engage/session/${S.engage.session.sessionToken}/end`,{}); }catch(e){}
    }
    S.engage.ended = true; render();
  },
  exitEngage(){
    // Back to the normal hospitality flow, exactly as if Engage had never
    // been offered -- the guest's order/tracking state is untouched.
    App.goScreen(S.currentOrder && S.currentOrder.status==='Delivered' ? 'feedback' : 'tracking');
  },

  /* ---- auth ---- */
  openLogin(){ S.screen='login'; render(); },
  // UX-0 corrective: the real credential-entry path, the ONLY login
  // mechanism physically present in the production-served app.js. The
  // one-tap password-equals-username shortcut now lives entirely in the
  // developer-tools file, which never reaches a production client.
  async login(){
    const username = document.getElementById('loginUsername')?.value?.trim();
    const password = document.getElementById('loginPassword')?.value;
    if(!username || !password){ showErr(S.lang==='ar'?'الرجاء إدخال اسم المستخدم وكلمة المرور':'Please enter both username and password'); return; }
    try{
      const r = await api('POST', '/api/auth/login', { username, password });
      S.session = r; S.mode = App.roleHome(r.user.role);
      S.screen = App.roleDefaultScreen(r.user.role);
      S.ui.err = null;
      await App.loadForRole();
      render();
    }catch(e){ showErr(e.message); }
  },
  logout(){ S.session=null; S.mode='customer'; S.screen='welcome'; render(); },
  roleHome(role){ return { Operator:'ops', SiteManager:'ops', Runner:'runner', SuperAdmin:'admin', AlnadlFinance:'finance', PartnerViewer:'partner', PartnerAdmin:'partneradmin' }[role] || 'customer'; },
  roleDefaultScreen(role){
    // §7: PartnerAdmin كان يبدأ على 'zones' — شاشة إعداد، لا نظرة عامة.
    // الآن يبدأ على Overview كما نصّ المطلب.
    // §3.3: ProductAdmin و SafetyReviewer لم يكن لهما شاشة بداية إطلاقًا،
    // فكانا يدخلان إلى واجهة فارغة رغم امتلاكهما صلاحيات خلفية حقيقية.
    return { Operator:'kds', SiteManager:'live', Runner:'runnerq', SuperAdmin:'tenants',
             AlnadlFinance:'settlements', PartnerViewer:'overview', PartnerAdmin:'overview',
             ProductAdmin:'mechanics', SafetyReviewer:'safety' }[role] || 'welcome';
  },
  async loadForRole(){
    const role = S.session.user.role;
    if(role==='Operator') return App.loadOpsQueue();
    if(role==='SiteManager') return Promise.all([App.loadOpsQueue(), App.loadLive(), App.loadSiteExceptions()]);
    if(role==='Runner') return App.loadRunnerQueue();
    if(role==='SuperAdmin') return Promise.all([App.loadAdminAll(), App.loadTenants(), App.loadPlans(), App.loadAdminPlans(), App.loadKillSwitch(), App.loadPolicyOverrides(), App.loadProperties()]);
    if(role==='ProductAdmin') return Promise.all([App.loadMechanics(), App.loadEngageOverview()]);
    if(role==='SafetyReviewer') return Promise.all([App.loadSafety(), App.loadLedger()]);
    if(role==='AlnadlFinance') return Promise.all([App.loadSettlements(), App.loadAudit()]);
    if(role==='PartnerViewer') return Promise.all([App.loadPartnerOverview(), App.loadSettlements(), App.loadSubscription(), App.loadEngageState(), App.loadPartnerEngage()]);
    // §7: PartnerAdmin يبدأ الآن على Overview، فوجب تحميل بياناتها معه —
    // بدونها تعلق الشاشة الأولى على هيكل تحميل أبدي. اكتشفه التحقق البصري.
    if(role==='PartnerAdmin'){ S.PARTNER_ID = S.session.user.scope; return Promise.all([App.loadPartnerOverview(), App.loadEngageState(), App.loadPartnerEngage(), App.loadOwnProperty(), App.loadAdminAll(), App.loadSubscription()]); }
  },
  async loadOwnProperty(){
    const props = await api('GET','/api/admin/properties',null,true);
    if(props[0]){ S.PROPERTY_ID = props[0].id; }
  },
  async setStaffScreen(scr){ S.screen=scr; render();
    if(scr==='audit') await App.loadAudit();
    if(scr==='zones') await App.loadAdminAll();
    if(scr==='catalog') await App.loadAdminAll();
    if(scr==='tenants') await Promise.all([App.loadTenants(), App.loadPlans()]);
    if(scr==='billing') await Promise.all([App.loadSubscription(), App.loadPlans()]);
    if(scr==='portfolio') await App.loadPortfolio();
    if(scr==='live') await App.loadLive();
    if(scr==='users') await App.loadUsers();
    if(scr==='settlements') await App.loadSettlements();
    if(scr==='outlets') await App.loadOutlets();
    if(scr==='revenue') await App.loadOutletsForRevenue();
    if(scr==='branding') await App.loadBranding();
    if(scr==='merchants') await App.loadMerchants();
    if(scr==='wallets') await App.loadWallets();
  },
  async loadPortfolio(){ S.portfolio = await api('GET','/api/admin/portfolio',null,true); render(); },
  async loadLive(){ try{ S.live = await api('GET',`/api/manager/live?propertyId=${S.PROPERTY_ID}`,null,true); }catch(e){} render(); },
  async loadUsers(){ S.users = await api('GET','/api/admin/users',null,true); render(); },
  /* P0-02 — دورة التفعيل: كانت النقطة تُرجع activationToken **والواجهة
     ترميه**، فيُنشأ حساب بلا كلمة مرور ولا وسيلة لتفعيله ⇒ Invalid
     credentials حتمية. الخادم سليم منذ R1؛ الناقص كان توصيل الواجهة.
     الرمز يُعاد مرة واحدة فقط ولا يمكن استرجاعه، فيُعرض فورًا للنسخ. */
  async createUser(){
    const el=document.getElementById('newUserName'), roleEl=document.getElementById('newUserRole');
    const username=el.value.trim(), role=roleEl.value;
    if(!username){ showErr(S.lang==='ar'?'اسم المستخدم مطلوب':'Username is required'); return; }
    try{
      const r = await api('POST','/api/admin/users',{username,role,partner_scope:S.PARTNER_ID},true);
      el.value='';
      S.ui.activationHandoff = {
        username: r.username || username, role,
        token: r.activationToken, expiresAt: r.expiresAt,
        url: `${location.origin}/activate.html?token=${encodeURIComponent(r.activationToken||'')}`,
      };
      await App.loadUsers();
      render();
    }catch(e){ showErr(e.message); }
  },
  dismissActivationHandoff(){ S.ui.activationHandoff=null; render(); },
  async reissueActivation(userId, username){
    try{
      const r = await api('POST',`/api/admin/users/${userId}/activation`,{},true);
      S.ui.activationHandoff = {
        username, reissued:true, token:r.activationToken, expiresAt:r.expiresAt,
        url: `${location.origin}/activate.html?token=${encodeURIComponent(r.activationToken||'')}`,
      };
      await App.loadUsers();
      render();
    }catch(e){ showErr(e.message); }
  },
  copyActivationLink(){
    const st=S.ui.activationHandoff; if(!st) return;
    const done=()=>showToast(S.lang==='ar'?'نُسخ الرابط':'Link copied');
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(st.url).then(done).catch(()=>{
        const i=document.getElementById('actLink'); if(i){ i.select(); document.execCommand('copy'); done(); }
      });
    } else {
      const i=document.getElementById('actLink'); if(i){ i.select(); document.execCommand('copy'); done(); }
    }
  },
  async toggleUser(id,active){ try{ await api('PATCH',`/api/admin/users/${id}`,{active:!active},true); await App.loadUsers(); }catch(e){ showErr(e.message); } },

  /* ---- merchants (Restaurant/Marketplace Integration) ---- */
  /* ---- outlets (Phase 4 Multi-Outlet Architecture, §6) ---- */
  async loadOutlets(){ S.outlets = await api('GET',`/api/admin/outlets?propertyId=${S.PROPERTY_ID}`,null,true); render(); },
  async addOutlet(){
    const name_ar=document.getElementById('outAr').value.trim(), name_en=document.getElementById('outEn').value.trim();
    const type=document.getElementById('outType').value, operator=document.getElementById('outOperator').value;
    if(!name_ar && !name_en) return;
    try{ await api('POST','/api/admin/outlets',{propertyId:S.PROPERTY_ID,name_ar:name_ar||name_en,name_en:name_en||name_ar,type,operator},true); showToast(t('toast_saved')); await App.loadOutlets(); }
    catch(e){ showErr(e.message); }
  },
  async toggleOutlet(id,active){
    try{ await api('PATCH',`/api/admin/outlets/${id}`,{status:active?'Inactive':'Active'},true); await App.loadOutlets(); }
    catch(e){ showErr(e.message); }
  },

  /* ---- outlet availability rules (Q02) ---- */
  async toggleAvailabilityPanel(outletId){
    S.ui.availabilityFor = S.ui.availabilityFor===outletId ? null : outletId;
    if(S.ui.availabilityFor){
      S.ui.availabilityRules = await api('GET',`/api/admin/outlets/${outletId}/availability`,null,true);
    }
    render();
  },
  async addAvailabilityRule(outletId){
    const dayOfWeek = document.getElementById('availDay').value;
    const timeFrom = document.getElementById('availFrom').value;
    const timeTo = document.getElementById('availTo').value;
    try{
      await api('POST',`/api/admin/outlets/${outletId}/availability`,{
        dayOfWeek: dayOfWeek===''?null:parseInt(dayOfWeek), timeFrom: timeFrom||null, timeTo: timeTo||null,
      },true);
      showToast(t('toast_saved'));
      S.ui.availabilityRules = await api('GET',`/api/admin/outlets/${outletId}/availability`,null,true);
      render();
    }catch(e){ showErr(e.message); }
  },
  async removeAvailabilityRule(outletId, ruleId){
    try{
      await api('DELETE',`/api/admin/outlets/${outletId}/availability/${ruleId}`,null,true);
      S.ui.availabilityRules = await api('GET',`/api/admin/outlets/${outletId}/availability`,null,true);
      render();
    }catch(e){ showErr(e.message); }
  },

  /* ---- revenue model engine (Phase 4 §9/§10) ---- */
  async loadOutletsForRevenue(){
    S.outlets = await api('GET',`/api/admin/outlets?propertyId=${S.PROPERTY_ID}`,null,true);
    S.revenueLedger = await api('GET','/api/admin/revenue-ledger',null,true);
    for(const o of S.outlets){
      try{ const models = await api('GET',`/api/admin/revenue-models?outletId=${o.id}`,null,true); S.revenueModels[o.id] = models[0]||null; }catch{ S.revenueModels[o.id]=null; }
    }
    render();
  },
  setRevModelType(outletId,type){ S.ui.revModelDraft = S.ui.revModelDraft||{}; S.ui.revModelDraft[outletId] = {...(S.ui.revModelDraft[outletId]||{}), type}; render(); },
  async saveRevenueModel(outletId){
    const draft = (S.ui.revModelDraft && S.ui.revModelDraft[outletId]) || {};
    const type = draft.type || document.getElementById('revType_'+outletId)?.value || 'commission';
    const payload = { outletId, type,
      shareRate: type==='share'? parseFloat(document.getElementById('revShare_'+outletId)?.value)/100 : null,
      commissionRate: (type==='commission'||type==='hybrid')? parseFloat(document.getElementById('revCommission_'+outletId)?.value)/100 : null,
      fixedAmount: (type==='fixed'||type==='hybrid')? parseFloat(document.getElementById('revFixed_'+outletId)?.value) : null,
    };
    try{ await api('POST','/api/admin/revenue-models',payload,true); showToast(t('toast_saved')); await App.loadOutletsForRevenue(); }
    catch(e){ showErr(e.message); }
  },

  /* ---- white label branding (Phase 4 §11/§12) ---- */
  async loadBranding(){ S.branding = await api('GET',`/api/admin/branding?partnerId=${S.PARTNER_ID}`,null,true); render(); },
  async saveBranding(){
    const mode = document.getElementById('brMode').value;
    const payload = {
      partnerId: S.PARTNER_ID, mode,
      logoText: document.getElementById('brLogo').value.trim() || null,
      primaryColor: document.getElementById('brColor').value.trim() || null,
      welcomeTextAr: document.getElementById('brWelcomeAr').value.trim() || null,
      welcomeTextEn: document.getElementById('brWelcomeEn').value.trim() || null,
      showPoweredBy: document.getElementById('brPoweredBy').checked,
      feeModel: document.getElementById('brFeeModel').value,
      setupFeeAmount: parseFloat(document.getElementById('brSetupFee').value) || 0,
      recurringFeeAmount: parseFloat(document.getElementById('brRecurringFee').value) || 0,
      recurringCycle: document.getElementById('brRecurringCycle').value,
    };
    try{ await api('POST','/api/admin/branding',payload,true); showToast(t('toast_saved')); await App.loadBranding(); }
    catch(e){ showErr(e.message); }
  },

  async loadMerchants(){ S.merchants = await api('GET','/api/admin/merchants',null,true); render(); },
  async addMerchant(){
    const name_ar=document.getElementById('merAr').value.trim(), name_en=document.getElementById('merEn').value.trim();
    const commissionRate=(parseFloat(document.getElementById('merCommission').value)||10)/100;
    if(!name_ar && !name_en) return;
    try{ await api('POST','/api/admin/merchants',{propertyId:S.PROPERTY_ID,name_ar:name_ar||name_en,name_en:name_en||name_ar,kind:'partner_restaurant',commissionRate},true); showToast(t('toast_saved')); await App.loadMerchants(); }
    catch(e){ showErr(e.message); }
  },

  /* ---- corporate wallets ---- */
  async loadWallets(){ S.wallets = await api('GET','/api/admin/wallets',null,true); render(); },
  async addWallet(){
    const ownerName=document.getElementById('walOwner').value.trim(), ownerRef=document.getElementById('walRef').value.trim();
    const monthlyBudget=parseFloat(document.getElementById('walBudget').value)||0;
    const perOrderCap=parseFloat(document.getElementById('walCap').value)||null;
    if(!ownerName || !ownerRef) return;
    try{ await api('POST','/api/admin/wallets',{partnerId:S.PARTNER_ID,ownerName,ownerRef,monthlyBudget,perOrderCap},true); showToast(t('toast_saved')); await App.loadWallets(); }
    catch(e){ showErr(e.message); }
  },

  async loadSettlements(){ S.settlements = await api('GET','/api/admin/settlements',null,true); render(); },

  /* ---- refunds (Q03) ---- */
  async lookupOrderForRefund(){
    const orderId = (S.refundOrderIdInput || document.getElementById('refundOrderId')?.value || '').trim();
    if(!orderId) return;
    S.refundOrderIdInput = orderId;
    try{
      const order = await api('GET', `/api/orders/${orderId}`);
      const refunds = await api('GET', `/api/orders/${orderId}/refunds`, null, true);
      S.refundLookupOrder = order; S.refundLookupRefunds = refunds; render();
    }catch(e){ showErr(S.lang==='ar'?'لم يتم العثور على الطلب':'Order not found'); }
  },
  async submitRefund(){
    const amount = document.getElementById('refundAmount').value;
    const reason = document.getElementById('refundReason').value.trim();
    if(!reason){ showErr(S.lang==='ar'?'سبب الاسترجاع إلزامي':'Refund reason is required'); return; }
    try{
      await api('POST', `/api/orders/${S.refundLookupOrder.id}/refund`, { amount, reason }, true);
      showToast(S.lang==='ar'?'تمت معالجة الاسترجاع':'Refund processed');
      await App.lookupOrderForRefund();
    }catch(e){ showErr(e.message); }
  },
  async createSettlement(){
    const period = new Date().toISOString().slice(0,7);
    try{ await api('POST','/api/admin/settlements',{partnerId:S.PARTNER_ID,period},true); showToast(t('toast_saved')); await App.loadSettlements(); }
    catch(e){ showErr(e.message); }
  },
  async settlementTransition(id,to){
    try{ await api('POST',`/api/admin/settlements/${id}/transition`,{to},true); await App.loadSettlements(); }
    catch(e){ showErr(e.message); }
  },

  /* ---- SaaS: tenants & plans (SuperAdmin) ---- */
  async loadTenants(){ S.tenants = await api('GET','/api/admin/partners',null,true); render(); },
  async loadPlans(){ S.plans = await api('GET','/api/plans'); render(); },
  // F04: إدارة الباقات كانت متاحة عبر الـAPI منذ v2.8.0 لكن بلا شاشة —
  // فكان المشغّل الحقيقي عاجزًا عن إنشاء أول باقة من الواجهة، وهو ما يُبطل
  // فعليًا شرط "أول عميل مدفوع بدون SQL يدوي".
  // §3.3 — محمّلات الأدوار الجديدة. كل استدعاء هنا يقابل نقطة يسمح بها
  // الخادم لهذا الدور تحديدًا؛ لم تُوسَّع أي صلاحية لتسهيل الواجهة.
  // R2 §1/§2 — الحالة الفعّالة: طبقة واحدة تشرح لماذا Engage مفعّل أو لا.
  // R2 §3 — Partner Control Center: يجمع ما هو موجود فعلًا في نداء واحد.
  // لا نقاط جديدة: كلها قائمة ومصرّحة لـSuperAdmin بالفعل. كل استدعاء
  // يفشل بصمت على حدة فلا تُسقط لوحة كاملة بسبب وحدة واحدة (§13).
  /* ===== R3 — SiteManager: كشف قدرات خلفية مسموحة له اليوم بلا أي توسيع.
     كل نداء أدناه يقابل نقطة يسمح بها الخادم لـSiteManager تحديدًا. ===== */
  async loadSiteExceptions(){
    S.siteExceptions = { loading:true }; render();
    const one = async (fn) => { try{ return await fn(); }catch(e){ return { __error:e.message }; } };
    // الطابور يحمل الطلبات النشطة؛ ومنه نستخرج ما يحتاج إجراءً.
    const [queue, notifications] = await Promise.all([
      one(()=>api('GET','/api/ops/queue',null,true)),
      one(()=>api('GET','/api/admin/notifications?limit=100',null,true)),
    ]);
    S.siteExceptions = { loading:false, queue, notifications };
    render();
  },
  async loadOrderRefunds(orderId){
    try{ S.orderRefunds = { orderId, rows: await api('GET',`/api/orders/${orderId}/refunds`,null,true) }; }
    catch(e){ S.orderRefunds = { orderId, rows: [], error: e.message }; }
    render();
  },
  openRefund(orderId){
    if(!orderId){ showErr(S.lang==='ar'?'أدخل رقم الطلب':'Enter an order number'); return; }
    // مفتاح تعطيل مزدوج الإرسال يُولَّد مرة واحدة عند فتح النافذة، فإعادة
    // الضغط تُرسل نفس المفتاح والخادم يُرجع النتيجة الأصلية بدل استرجاع ثانٍ.
    S.ui.refundFor = { orderId, idempotencyKey: 'rf-' + orderId + '-' + Date.now(), submitting:false, error:null };
    App.loadOrderRefunds(orderId);
    render();
  },
  dismissRefund(){ S.ui.refundFor = null; S.orderRefunds = null; render(); },
  async submitRefund(){
    const r = S.ui.refundFor; if(!r || r.submitting) return;
    const amountRaw = document.getElementById('rfAmount')?.value;
    const reason = document.getElementById('rfReason')?.value?.trim();
    if(!reason){ S.ui.refundFor.error = S.lang==='ar'?'السبب مطلوب':'A reason is required'; render(); return; }
    const amount = amountRaw ? parseFloat(amountRaw) : undefined;
    if(amountRaw && (!Number.isFinite(amount) || amount <= 0)){
      S.ui.refundFor.error = S.lang==='ar'?'المبلغ غير صالح':'Invalid amount'; render(); return;
    }
    S.ui.refundFor.submitting = true; S.ui.refundFor.error = null; render();
    try{
      const payload = { reason, idempotencyKey: r.idempotencyKey };
      if(amount !== undefined) payload.amount = amount;
      await api('POST', `/api/orders/${r.orderId}/refund`, payload, true);
      showToast(t('toast_saved'));
      S.ui.refundFor = null;
      await Promise.all([App.loadSiteExceptions(), App.loadOpsQueue()]);
    }catch(e){
      S.ui.refundFor.submitting = false;
      S.ui.refundFor.error = e.message;
      render();
    }
  },
  /* Corrective — تفعيل الشريك من الواجهة (Draft → Active وغيرها).
     النقطة والاختبارات بُنيت في R2 لكن بلا مسار في الواجهة، فكان التفعيل
     يتطلب استدعاء API يدويًا -- معيار FAIL صريح. لا نقطة جديدة ولا توسيع
     صلاحية: نفس POST /api/admin/partners/:id/status ونفس قواعد دورة الحياة. */
  async loadPartnerStatus(partnerId){
    try{ S.partnerStatusInfo = { partnerId, ...(await api('GET',`/api/admin/partners/${partnerId}/status`,null,true)) }; }
    catch(e){ S.partnerStatusInfo = { partnerId, error: e.message }; }
    render();
  },
  openStatusChange(partnerId, to){
    S.ui.statusChange = { partnerId, to, submitting:false, error:null };
    render();
  },
  dismissStatusChange(){ S.ui.statusChange = null; render(); },
  async submitStatusChange(){
    const c = S.ui.statusChange; if(!c || c.submitting) return;
    const reason = document.getElementById('scReason')?.value?.trim();
    if(!reason || reason.length < 4){
      S.ui.statusChange.error = S.lang==='ar'?'السبب مطلوب (4 أحرف على الأقل)':'A reason of at least 4 characters is required';
      render(); return;
    }
    S.ui.statusChange.submitting = true; S.ui.statusChange.error = null; render();
    try{
      await api('POST', `/api/admin/partners/${c.partnerId}/status`, { status: c.to, reason }, true);
      showToast(t('toast_saved'));
      S.ui.statusChange = null;
      // الحالة والقدرات تُعاد قراءتها من الخادم بعد النجاح، لا تُخمَّن محليًا
      await Promise.all([App.loadPartnerStatus(c.partnerId), App.loadPartnerProfile(c.partnerId), App.loadTenants()]);
    }catch(e){
      S.ui.statusChange.submitting = false;
      // الخادم قد يرفض بشروط دورة الحياة (مثل طلبات مفتوحة) -- تُعرض كما هي
      S.ui.statusChange.error = e.message;
      render();
    }
  },
  async loadPartnerProfile(partnerId){
    if(!partnerId) return;
    S.partnerProfile = { partnerId, loading:true }; render();
    const one = async (fn) => { try{ return await fn(); }catch(e){ return { __error: e.message }; } };
    const [overview, subscription, users, zones, outlets, settlements, engage] = await Promise.all([
      one(()=>api('GET',`/api/partner/overview?partnerId=${encodeURIComponent(partnerId)}`,null,true)),
      one(()=>api('GET',`/api/admin/subscription?partnerId=${encodeURIComponent(partnerId)}`,null,true)),
      one(()=>api('GET','/api/admin/users',null,true)),
      one(()=>api('GET','/api/admin/zones',null,true)),
      one(()=>api('GET','/api/admin/outlets',null,true)),
      one(()=>api('GET','/api/admin/settlements',null,true)),
      one(()=>api('GET',`/api/engage/effective-state?partnerId=${encodeURIComponent(partnerId)}`,null,true)),
    ]);
    S.partnerProfile = { partnerId, loading:false, overview, subscription, users, zones, outlets, settlements, engage };
    render();
  },
  openPartnerProfile(partnerId){ S.screen='partnerprofile'; App.loadPartnerProfile(partnerId); App.loadPartnerStatus(partnerId); App.loadProperties(); },
  async loadEngageState(partnerId){
    const q = partnerId ? `?partnerId=${encodeURIComponent(partnerId)}` : '';
    try{ S.engageState = await api('GET', '/api/engage/effective-state'+q, null, true); }
    catch(e){ S.engageState = { error: e.message }; }
    render();
  },
  async loadKillSwitch(){
    try{ S.killSwitch = await api('GET','/api/admin/engage/kill-switch',null,true); }catch(e){ S.killSwitch=null; }
    render();
  },
  async toggleKillSwitch(enabled){
    try{
      await api('POST','/api/admin/engage/kill-switch',{ enabled },true);
      showToast(t('toast_saved'));
      await Promise.all([App.loadKillSwitch(), App.loadEngageState(S.engageState && S.engageState.partnerId)]);
    }catch(e){ showErr(e.message); }
  },
  async loadPolicyOverrides(){
    try{ S.policyOverrides = await api('GET','/api/admin/engage/policy-overrides',null,true); }catch(e){ S.policyOverrides=[]; }
    render();
  },
  async setScopeOverride(scopeType, scopeId, enabled){
    try{
      await api('POST','/api/admin/engage/policy-overrides',
        { scopeType, scopeId, flagKey:'engage_enabled', enabled }, true);
      showToast(t('toast_saved'));
      await Promise.all([App.loadPolicyOverrides(), App.loadEngageState(S.engageState && S.engageState.partnerId)]);
    }catch(e){ showErr(e.message); }
  },
  async loadPartnerEngage(){
    try{ S.partnerEngage = await api('GET','/api/partner/engage/overview',null,true); }catch(e){ S.partnerEngage={}; }
    render();
  },
  async loadRevenueLedger(){
    try{ S.revenueLedger = await api('GET','/api/admin/revenue-ledger?limit=100',null,true); }catch(e){ S.revenueLedger=[]; }
    render();
  },
  /* ===== R3 G1 — إجراءات مختبر الآليات لـProductAdmin.
     كل استدعاء هنا يقابل نقطة يسمح بها الخادم لهذا الدور اليوم. لم تُوسَّع
     صلاحية واحدة -- الشاشة كانت عرضًا فقط (صفر onclick) فأصبحت رحلة. ===== */
  openProposeMechanic(){ S.ui.proposeMechanic = { submitting:false, error:null }; render(); },
  dismissPropose(){ S.ui.proposeMechanic = null; render(); },
  async submitPropose(){
    const st = S.ui.proposeMechanic; if(!st || st.submitting) return;
    const name = document.getElementById('mkName')?.value?.trim();
    const personality = document.getElementById('mkPersonality')?.value;
    const titleAr = document.getElementById('mkTitleAr')?.value?.trim();
    const bodyAr = document.getElementById('mkBodyAr')?.value?.trim();
    const bodyEn = document.getElementById('mkBodyEn')?.value?.trim();
    if(!name || !bodyAr || !bodyEn){
      S.ui.proposeMechanic.error = S.lang==='ar'?'الاسم ونصّا اللحظة مطلوبة':'Name and both moment texts are required';
      render(); return;
    }
    S.ui.proposeMechanic.submitting = true; S.ui.proposeMechanic.error = null; render();
    try{
      await api('POST','/api/admin/mechanics/propose',
        { name, personality, category:'static_fallback',
          pool:[{ title_ar:titleAr||'', title_en:titleAr||'', body_ar:bodyAr, body_en:bodyEn }] }, true);
      showToast(t('toast_saved'));
      S.ui.proposeMechanic = null;
      await App.loadMechanics();
    }catch(e){ S.ui.proposeMechanic.submitting=false; S.ui.proposeMechanic.error=e.message; render(); }
  },
  async simulateMechanic(id){
    try{
      const r = await api('POST',`/api/admin/mechanics/${id}/simulate`, { sampleCount: 100 }, true);
      S.simResult = { id, ...r }; showToast(t('toast_saved')); await App.loadMechanics();
    }catch(e){ showErr(e.message); }
  },
  openTransition(id, toState, currentState){
    S.ui.mechTransition = { id, toState, currentState, submitting:false, error:null }; render();
  },
  dismissTransition(){ S.ui.mechTransition = null; render(); },
  async submitTransition(){
    const st = S.ui.mechTransition; if(!st || st.submitting) return;
    const reason = document.getElementById('mtReason')?.value?.trim();
    if(!reason){ S.ui.mechTransition.error = S.lang==='ar'?'السبب مطلوب':'A reason is required'; render(); return; }
    const pct = document.getElementById('mtCanary')?.value;
    S.ui.mechTransition.submitting = true; S.ui.mechTransition.error = null; render();
    try{
      const payload = { toState: st.toState, reason };
      if(st.toState === 'canary' && pct) payload.canaryPercentage = parseFloat(pct);
      await api('POST',`/api/admin/mechanics/${st.id}/transition`, payload, true);
      showToast(t('toast_saved'));
      S.ui.mechTransition = null;
      await App.loadMechanics();
    }catch(e){ S.ui.mechTransition.submitting=false; S.ui.mechTransition.error=e.message; render(); }
  },

  /* ===== R3 G2 — توليد QR بالجملة (وعد الدليل: حتى 50) ===== */
  openBulkPoints(zoneId){ S.ui.bulkPoints = { zoneId, submitting:false, error:null, result:null }; render(); },
  dismissBulkPoints(){ S.ui.bulkPoints = null; render(); },
  async submitBulkPoints(){
    const st = S.ui.bulkPoints; if(!st || st.submitting) return;
    const count = parseInt(document.getElementById('bpCount')?.value, 10);
    const prefix = document.getElementById('bpPrefix')?.value?.trim();
    const startAt = parseInt(document.getElementById('bpStart')?.value, 10) || 1;
    if(!Number.isFinite(count) || count < 1 || count > 50){
      S.ui.bulkPoints.error = S.lang==='ar'?'العدد بين 1 و50':'Count must be between 1 and 50'; render(); return;
    }
    if(!prefix){ S.ui.bulkPoints.error = S.lang==='ar'?'البادئة مطلوبة':'A label prefix is required'; render(); return; }
    S.ui.bulkPoints.submitting = true; S.ui.bulkPoints.error = null; render();
    try{
      const r = await api('POST','/api/admin/points/bulk',
        { zoneId: st.zoneId, count, labelPrefix: prefix, startAt, type:'Table' }, true);
      S.ui.bulkPoints = { ...st, submitting:false, result:r };
      showToast(t('toast_saved'));
      await App.loadAdminAll();
    }catch(e){ S.ui.bulkPoints.submitting=false; S.ui.bulkPoints.error=e.message; render(); }
  },

  /* ===== R3 G3 — دورة حياة المنطقة ===== */
  async setZoneStatus(zoneId, status){
    try{
      await api('PATCH',`/api/admin/zones/${zoneId}`, { status }, true);
      showToast(t('toast_saved')); await App.loadAdminAll();
    }catch(e){ showErr(e.message); }
  },

  /* ===== R3 G4 — سياسة التسليم على العقار (نفس النقطة القائمة) ===== */
  async setDeliveryGrouping(propertyId, value){
    try{
      await api('PATCH',`/api/admin/properties/${propertyId}`, { deliveryGrouping: value }, true);
      showToast(t('toast_saved')); await App.loadOwnProperty();
      if(S.partnerProfile) await App.loadPartnerProfile(S.partnerProfile.partnerId);
    }catch(e){ showErr(e.message); }
  },
  async loadProperties(){
    try{ S.properties = await api('GET','/api/admin/properties',null,true); }catch(e){ S.properties=[]; }
    render();
  },
  async loadMechanics(){
    try{ S.mechanics = await api('GET','/api/admin/mechanics',null,true); }catch(e){ S.mechanics=[]; S.mechErr=e.message; }
    render();
  },
  async loadEngageOverview(){
    try{ S.engageOverview = await api('GET','/api/admin/engage/overview',null,true); }catch(e){ S.engageOverview={}; }
    render();
  },
  async loadSafety(){
    try{
      const mechs = await api('GET','/api/admin/mechanics',null,true);
      const all = [];
      for(const m of mechs){
        try{ const inc = await api('GET',`/api/admin/mechanics/${m.id}/safety-incidents`,null,true);
             (inc||[]).forEach(i=>all.push({...i, mechanicName:m.name})); }catch(e){}
      }
      S.safetyIncidents = all;
    }catch(e){ S.safetyIncidents=[]; }
    render();
  },
  async loadLedger(){
    try{ S.engageLedger = await api('GET','/api/admin/engage/ledger?limit=50',null,true); }catch(e){ S.engageLedger=[]; }
    render();
  },
  async resolveIncident(id){
    try{ await api('POST',`/api/admin/mechanics/safety-incidents/${id}/resolve`,{ note:'reviewed' },true);
         showToast(t('toast_saved')); await App.loadSafety(); }
    catch(e){ showErr(e.message); }
  },
  async loadAdminPlans(){
    try{ S.adminPlans = await api('GET','/api/admin/plans',null,true); }catch(e){ S.adminPlans = []; }
    render();
  },
  async createPlan(){
    const ent = {};
    document.querySelectorAll('[data-ent]').forEach(el => { ent[el.dataset.ent] = el.checked; });
    const b = {
      code: document.getElementById('plCode').value.trim().toUpperCase(),
      name_ar: document.getElementById('plNameAr').value.trim(),
      name_en: document.getElementById('plNameEn').value.trim(),
      monthlyFee: parseFloat(document.getElementById('plFee').value) || 0,
      techFeeRate: (parseFloat(document.getElementById('plRate').value) || 0) / 100,
      entitlements: ent,
    };
    if(!b.code){ showErr(S.lang==='ar'?'رمز الباقة مطلوب':'Plan code is required'); return; }
    try{
      await api('POST','/api/admin/plans', b, true);
      showToast(t('toast_saved'));
      await Promise.all([App.loadAdminPlans(), App.loadPlans()]);
    }catch(e){ showErr(e.message); }
  },
  async deletePlan(id){
    try{ await api('DELETE','/api/admin/plans/'+id, null, true); showToast(t('toast_saved'));
      await Promise.all([App.loadAdminPlans(), App.loadPlans()]);
    }catch(e){ showErr(e.message); }
  },
  async loadSubscription(){
    try{ S.subscription = await api('GET',`/api/admin/subscription?partnerId=${S.PARTNER_ID}`,null,true); }catch(e){ S.subscription=null; }
    render();
  },
  async onboardTenant(){
    const b = {
      partnerNameAr: document.getElementById('obNameAr').value.trim(),
      partnerNameEn: document.getElementById('obNameEn').value.trim(),
      propertyNameAr: document.getElementById('obPropAr').value.trim(),
      propertyNameEn: document.getElementById('obPropEn').value.trim(),
      planCode: document.getElementById('obPlan').value,
    };
    if(!b.partnerNameAr && !b.partnerNameEn) return;
    try{ const r = await api('POST','/api/admin/onboard', b, true); showToast(t('toast_saved')); S.selectedPartnerId=r.partnerId; await App.loadTenants(); }
    catch(e){ showErr(e.message); }
  },
  selectTenantForAdmin(partnerId){
    S.selectedPartnerId = partnerId;
    api('GET','/api/admin/properties',null,true).then(props=>{
      const prop = props.find(p=>p.partner_id===partnerId);
      if(prop){ S.PARTNER_ID=partnerId; S.PROPERTY_ID=prop.id; App.loadAdminAll(); }
    });
  },
  async changePlan(partnerId){
    const planCode = document.getElementById('planSelect_'+partnerId)?.value;
    if(!planCode) return;
    try{ await api('POST','/api/admin/subscription',{partnerId,planCode},true); showToast(t('toast_saved')); await App.loadTenants(); if(S.PARTNER_ID===partnerId) await App.loadSubscription(); }
    catch(e){ showErr(e.message); }
  },

  /* ---- ops / KDS ---- */
  async loadOpsQueue(){
    try{ S.ops.queue = await api('GET','/api/ops/queue',null,true); S.ops.error=null; }
    catch(e){ S.ops.error = e.message; }
    render();
  },
  openOrderDetail(id){ S.ui.openOrder=id; render(); },
  closeOrderDetail(){ S.ui.openOrder=null; render(); },
  // A ticket id starting with 'CHD-' is a child order (Unified Cart, Phase 4
  // §8) and routes to its own transition endpoint; everything else is the
  // legacy single-outlet order endpoint, unchanged since before Phase 4.
  transitionEndpoint(id){ return id.startsWith('CHD-') ? `/api/child-orders/${id}/transition` : `/api/orders/${id}/transition`; },
  async opsTransition(id,to){
    try{ await api('POST',App.transitionEndpoint(id),{to},true); showToast(t('toast_transition')); await App.loadOpsQueue(); S.ui.openOrder=null; render(); }
    catch(e){ showErr(e.message); }
  },
  opsCancel(id){ S.ui.cancelFor=id; render(); },
  async confirmCancel(id){
    const reason = document.getElementById('cancelReasonInput')?.value || '—';
    try{ await api('POST',App.transitionEndpoint(id),{to:'Cancelled',reason},true); S.ui.cancelFor=null; S.ui.openOrder=null; await App.loadOpsQueue(); }
    catch(e){ showErr(e.message); }
  },
  dismissCancel(){ S.ui.cancelFor=null; render(); },

  /* ---- runner ---- */
  async loadRunnerQueue(){
    // UX-2 (spec R06: "Never imply order disappeared or was delivered"):
    // a failed poll sets runnerError but deliberately does NOT touch
    // S.runnerQ — the last successfully-loaded list stays visible (with a
    // non-blocking connection-issue notice, see renderRunner) rather than
    // being wiped to a blank/empty state a Runner could misread as
    // "nothing to deliver."
    try{ S.runnerQ = await api('GET','/api/runner/queue',null,true); S.runnerError=null; S.runnerLastRefresh=Date.now(); }
    catch(e){ S.runnerError = e.message; }
    render();
  },
  async runnerTransition(id,to){
    try{ await api('POST',App.transitionEndpoint(id),{to},true); await App.loadRunnerQueue(); }
    catch(e){ showErr(e.message); }
  },
  // UX-2 (spec R03: "Delivery exception — reason required; audit-safe; do
  // not expose internal technical errors"): same two-step prompt pattern
  // already proven for order cancellation (opsCancel/confirmCancel) —
  // Runner taps "Delivery failed", is asked why, THEN the transition
  // (now server-enforced to require a reason, see server.js) is sent.
  runnerFailPrompt(id){ S.ui.deliveryFailFor=id; render(); },
  async confirmDeliveryFail(id){
    const reason = document.getElementById('deliveryFailReasonInput')?.value?.trim();
    if(!reason){ showErr(S.lang==='ar'?'يرجى إدخال السبب':'Please enter a reason'); return; }
    try{ await api('POST',App.transitionEndpoint(id),{to:'Delivery Failed',reason},true); S.ui.deliveryFailFor=null; await App.loadRunnerQueue(); }
    catch(e){ showErr(e.message); }
  },
  dismissDeliveryFail(){ S.ui.deliveryFailFor=null; render(); },

  /* ---- admin ---- */
  async loadAdminAll(){
    const [zones,points,categories,products] = await Promise.all([
      api('GET','/api/admin/zones',null,true), api('GET','/api/admin/points',null,true),
      api('GET','/api/admin/categories',null,true), api('GET','/api/admin/products',null,true)]);
    S.admin = { zones, points, categories, products }; render();
  },
  async addZone(){
    const name_ar=document.getElementById('zoneAr').value.trim(), name_en=document.getElementById('zoneEn').value.trim(), type=document.getElementById('zoneType').value;
    if(!name_ar && !name_en) return;
    try{ await api('POST','/api/admin/zones',{propertyId:S.PROPERTY_ID,name_ar:name_ar||name_en,name_en:name_en||name_ar,type},true); showToast(t('toast_zone')); await App.loadAdminAll(); }
    catch(e){ showErr(e.message); }
  },
  async addPoint(){
    const zoneId=document.getElementById('pointZone').value, label=document.getElementById('pointLabel').value.trim(), type=document.getElementById('pointType').value;
    if(!label) return;
    try{ await api('POST','/api/admin/points',{zoneId,label,type},true); showToast(t('toast_point')); await App.loadAdminAll(); }
    catch(e){ showErr(e.message); }
  },
  async togglePoint(id,active){
    try{ await api('PATCH',`/api/admin/points/${id}`,{active:!active},true); await App.loadAdminAll(); }
    catch(e){ showErr(e.message); }
  },
  async bulkGenerateQr(){
    const zoneId=document.getElementById('bulkZone').value, type=document.getElementById('bulkType').value;
    const count=document.getElementById('bulkCount').value, labelPrefix=document.getElementById('bulkPrefix').value.trim();
    try{ const r=await api('POST','/api/admin/qr/bulk',{zoneId,type,count,labelPrefix},true); showToast(`${S.lang==='ar'?'تم توليد':'Generated'} ${r.count}`); await App.loadAdminAll(); }
    catch(e){ showErr(e.message); }
  },
  async viewQrAnalytics(pointId){
    S.ui.qrAnalyticsFor = pointId; S.ui.qrAnalyticsData = null; render();
    try{ S.ui.qrAnalyticsData = await api('GET',`/api/admin/qr/${pointId}/analytics`,null,true); render(); }
    catch(e){ showErr(e.message); S.ui.qrAnalyticsFor=null; render(); }
  },
  closeQrAnalytics(){ S.ui.qrAnalyticsFor=null; render(); },
  async addCategory(){
    const name_ar=document.getElementById('catAr').value.trim(), name_en=document.getElementById('catEn').value.trim();
    if(!name_ar && !name_en) return;
    try{ await api('POST','/api/admin/categories',{propertyId:S.PROPERTY_ID,name_ar:name_ar||name_en,name_en:name_en||name_ar},true); showToast(t('toast_saved')); await App.loadAdminAll(); }
    catch(e){ showErr(e.message); }
  },
  async addProduct(){
    const name_ar=document.getElementById('prodAr').value.trim(), name_en=document.getElementById('prodEn').value.trim();
    const basePrice=parseFloat(document.getElementById('prodPrice').value)||0, categoryId=document.getElementById('prodCatSel').value;
    if(!name_ar && !name_en) return;
    try{ await api('POST','/api/admin/products',{categoryId,name_ar:name_ar||name_en,name_en:name_en||name_ar,basePrice},true); showToast(t('toast_prod')); await App.loadAdminAll(); }
    catch(e){ showErr(e.message); }
  },
  async toggleProdStatus(id,status){
    try{ await api('PATCH',`/api/admin/products/${id}`,{status: status==='Active'?'Inactive':'Active'},true); await App.loadAdminAll(); }
    catch(e){ showErr(e.message); }
  },

  /* ---- partner / finance ---- */
  async loadPartnerOverview(){ S.partner.overview = await api('GET',`/api/partner/overview?partnerId=${S.PARTNER_ID}`,null,true); render(); },
  async loadAudit(){ S.audit = await api('GET','/api/audit?limit=40',null,true); render(); },
};
window.App = App;

/* ============================== RENDER ============================== */
function statusBadge(status){
  const map = { 'Created':['pending','st_created'],'Payment Pending':['pending','st_pending'],'Paid':['paid','st_paid'],
    'Accepted':['paid','st_accepted'],'Preparing':['prep','st_preparing'],'Ready':['ready','st_ready'],
    'Out for Delivery':['out','st_out'],'Delivered':['delivered','st_delivered'],
    'Partially Ready':['ready','st_partially_ready'],'Partially Delivered':['out','st_partially_delivered'],
    'Failed':['cancel','st_failed'],'Cancelled':['cancel','st_cancelled'],'Delivery Failed':['cancel','st_cancelled'] };
  const [cls,label] = map[status] || ['pending', status];
  return `<span class="badge ${cls}">${t(label)||status}</span>`;
}
function elapsedStr(ts){ const d=Date.now()-ts; const m=Math.floor(d/60000), s=Math.floor((d%60000)/1000); return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0'); }

// UX-0 corrective round: this is the ONLY top-chrome renderer physically
// present in the production-served app.js: brand mark, language toggle,
// and session/login status — every one of these is genuinely needed by
// real customers and real staff in production. The old top-chrome
// renderer carried a "· live API" prototype label and was coupled to
// the demo login path; neither survives in this version. dev-tools.js
// does not touch this bar's contents at all in this corrective design
// (unlike the QR-picker/login overrides below) — there is nothing
// demo-specific left in it to override.
/* White Label — هوية الشريط العلوي.
   الأسطح الإدارية تُبقي ALNADL عمدًا: النظام يُدار بواسطة النادل وإخفاء
   ذلك يُربك المشغّل. أما الضيف فيرى الهوية الفعّالة المحلولة على الخادم.
   لا منطق وراثة هنا -- القيمة تصل جاهزة من resolveBranding. */
/* دعوة Engage: كانت «لحظة من النادل» ثابتة فتكسر الهوية البيضاء.
   تُستبدل بالهوية الفعّالة حين تكون مُفعّلة، وبصياغة محايدة خلاف ذلك.
   تصميم الشخصيات الخمس ومنطق Engage لم يُمسّا. */
function engageInviteLabel(){
  const b = S.qrContext && S.qrContext.branding;
  if (b && b.whiteLabelActive && b.logo_text) {
    return S.lang === 'ar' ? `لحظة من ${esc(b.logo_text)}` : `A moment from ${esc(b.logo_text)}`;
  }
  return S.lang === 'ar' ? 'لحظة من النادل' : 'A moment from Alnadl';
}

/* تسمية مُشغّل المنفذ.
   كانت «مُشغَّل من النادل» ثابتة وتظهر للضيف في شاشة اختيار المنفذ --
   تسمية تشغيلية داخلية تكسر الهوية البيضاء. تُستبدل بالهوية الفعّالة حين
   تكون مُفعّلة، وتبقى كما هي خلاف ذلك. اكتشفه التحقق البصري لا المراجعة. */
function outletOperatorLabel(operator){
  if (operator === 'partner') return S.lang === 'ar' ? 'شريك' : 'Partner';
  const b = S.qrContext && S.qrContext.branding;
  if (b && b.whiteLabelActive && b.logo_text) {
    return S.lang === 'ar' ? `مُشغَّل من ${esc(b.logo_text)}` : `Operated by ${esc(b.logo_text)}`;
  }
  return S.lang === 'ar' ? 'مُشغَّل من النادل' : 'Alnadl-operated';
}

function guestBrandMark(){
  const staff = !!(S.session && S.session.user);
  if (staff) return '<span class="mark">ن</span> ALNADL';
  const b = S.qrContext && S.qrContext.branding;
  if (!b || !b.whiteLabelActive) return '<span class="mark">ن</span> ALNADL';
  const label = esc(b.logo_text || '');
  const markChar = label ? esc(label.charAt(0).toUpperCase()) : 'ن';
  const mark = b.logo_url
    ? `<img src="${esc(b.logo_url)}" alt="${label}" class="mark" style="object-fit:contain;background:transparent" onerror="this.outerHTML='<span class=&quot;mark&quot;>${markChar}</span>'">`
    : `<span class="mark">${markChar}</span>`;
  return `${mark} ${label}`;
}

/* عنوان الصفحة والأيقونة — يتبعان الهوية الفعّالة.
   يُستدعى من render()، ويُعيد قيم المنصة حين لا تكون الهوية فعّالة، فلا
   يبقى أثر من جلسة سابقة. */
function applyGuestBrandChrome(){
  const staff = !!(S.session && S.session.user);
  const b = S.qrContext && S.qrContext.branding;
  const active = !staff && b && b.whiteLabelActive;
  const title = active
    ? (S.lang === 'ar' ? (b.page_title_ar || b.logo_text) : (b.page_title_en || b.logo_text))
    : 'Alnadl Hospitality OS';
  if (document.title !== title) document.title = title;

  const icon = document.querySelector('link[rel="icon"]');
  if (icon) {
    const href = active && b.logo_url ? b.logo_url : '/icons/icon-192.png';
    if (icon.getAttribute('href') !== href) icon.setAttribute('href', href);
  }
}

function renderTopBar(){
  const bar = document.getElementById('appbar');
  if(!bar) return;
  const loggedIn = !!S.session;
  bar.innerHTML = `
    <div class="brand">${guestBrandMark()}</div>
    <div class="spacer"></div>
    ${loggedIn ? `
      <div class="sessionpill">${S.session.user.username} <span class="rl">· ${S.session.user.role}</span></div>
      <button class="ghostbtn" onclick="App.logout()">${t('logout')}</button>
    ` : `
      <button class="ghostbtn" onclick="App.openLogin()">${t('login')} (staff)</button>
    `}
    <div class="langtoggle">
      <button class="${S.lang==='ar'?'active':''}" onclick="App.setLang('ar')">AR</button>
      <button class="${S.lang==='en'?'active':''}" onclick="App.setLang('en')">EN</button>
    </div>
  `;
}

function render(){
  applyGuestBrandChrome();
  renderTopBar();
  const app = document.getElementById('app');
  if(S.screen==='login'){ app.innerHTML = renderLogin(); return; }
  if(S.session){ app.innerHTML = renderStaffShell(); return; }
  app.innerHTML = renderCustomerShell();
}

function renderLogin(){
  // UX-0 corrective round: the demo one-tap account chooser is no longer
  // physically present in this file at all — it lives entirely in
  // dev-tools.js, which the server never delivers in production (see
  // GET /dev-tools.js gating in server.js). window.AlnadlDevTools is
  // undefined whenever that file was not served, which is the ONLY
  // signal checked here — not a value this file could compute or fake
  // on its own.
  if(window.AlnadlDevTools && window.AlnadlDevTools.renderDemoLogin){
    return window.AlnadlDevTools.renderDemoLogin();
  }
  return `<div class="loginwrap"><div class="loginbox">
    <h2>${t('login')}</h2>
    ${S.ui.err? `<div class="errbox">${S.ui.err}</div>`:''}
    <div class="loginform">
      <div class="formfield"><label>${S.lang==='ar'?'اسم المستخدم':'Username'}</label><input id="loginUsername" type="text" autocomplete="username"></div>
      <div class="formfield"><label>${S.lang==='ar'?'كلمة المرور':'Password'}</label><input id="loginPassword" type="password" autocomplete="current-password" onkeydown="if(event.key==='Enter')App.login()"></div>
      <button class="btn-primary" style="margin-top:4px" onclick="App.login()">${t('login')}</button>
    </div>
    <button class="ghostbtn" style="margin-top:10px;width:100%" onclick="S.screen='welcome';render()">← ${t('role_customer')}</button>
  </div></div>`;
}

/* ---------------- CUSTOMER ---------------- */
function renderCustomerShell(){
  if(!S.qrContext) return renderQrPicker();
  let inner='';
  switch(S.screen){
    case 'hub': inner=scrHub(); break;
    case 'welcome': inner=scrWelcome(); break;
    case 'menu': inner=scrMenu(); break;
    case 'cart': inner=scrCart(); break;
    case 'checkout': inner=scrCheckout(); break;
    case 'paymentResult': inner=scrPaymentResult(); break;
    case 'tracking': inner=scrTracking(); break;
    case 'feedback': inner=scrFeedback(); break;
    case 'feedbackThanks': inner=scrFeedbackThanks(); break;
    case 'engage': inner=scrEngage(); break;
    default: inner=scrWelcome();
  }
  // White Label (§11): the primary color override is scoped to the .phone
  // element ONLY via an inline CSS custom property — it never touches the
  // admin/staff top bar (renderTopBar), and an Outlet's own branding_json
  // (Increment 1) is completely independent of this and never overridden.
  const branding = S.qrContext.branding;
  const themeStyle = (branding && branding.whiteLabelActive && branding.primary_color)
    ? `style="--brass-300:color-mix(in srgb, ${branding.primary_color} 55%, white);--brass-500:${branding.primary_color};--brass-600:${branding.primary_color};--brass-700:color-mix(in srgb, ${branding.primary_color} 80%, black);"` : '';
  return `<div class="fohshell"><div class="phone" ${themeStyle}>${inner}${S.activeProduct?renderProductModal():''}</div></div>`;
}

function renderQrPicker(){
  // UX-0 corrective round: the simulated-QR-scan point picker and the
  // network call that backs it are no longer physically present in this
  // file at all — that code lives entirely in the developer-tools file.
  // A production deployment's app.js literally cannot make that network
  // call, because the code that would make it does not exist in the
  // file the server sends. This is the same window.AlnadlDevTools
  // presence check as renderLogin() above.
  if(window.AlnadlDevTools && window.AlnadlDevTools.renderDemoQrPicker){
    return window.AlnadlDevTools.renderDemoQrPicker();
  }
  return `<div class="fohshell"><div class="phone"><div class="statepanel qr-invalid" style="flex:1;display:flex;flex-direction:column;justify-content:center">
    <div class="glyph">⚠</div>
    <h4>${S.lang==='ar'?'رمز QR غير صالح أو مفقود':'Invalid or missing QR code'}</h4>
    <p>${S.lang==='ar'?'يرجى مسح رمز QR الموجود على الطاولة أو النقطة لبدء الطلب.':'Please scan the QR code at your table or point to start an order.'}</p>
  </div></div></div>`;
}

function scrHub(){
  // Service Hub (Phase 4 §7) — shown ONLY when the property genuinely has
  // more than one available outlet right now AND the plan includes
  // multiOutlet. This screen literally cannot appear for any property that
  // existed before Phase 4, since those all have exactly one outlet.
  //
  // UX-1: every outlet in this list is ALREADY server-filtered to ones
  // genuinely open right now (status='Active' + outlet_availability rules
  // passed, see GET /api/service-hub/:token) -- so the "Available now"
  // badge below is a real, backend-confirmed fact, not an invented
  // status. There is no live "busy/quiet" signal in the data model to
  // show honestly, so this delivery does not fabricate one. Type icons
  // are the same monogram treatment as product media (UX-0) instead of
  // food emoji, for visual consistency with the rest of the guest shell.
  const c = S.qrContext;
  const outlets = c.outlets || [];
  const typeLabel = { coffee:'C', restaurant:'R', bakery:'B', service:'S', other:'O' };
  return `
  <div class="welcome" style="padding:28px 22px">
    <div class="crest">ن</div>
    <div class="locpill">${t('youAreAt')}: ${S.lang==='ar'?c.partner.name_ar:c.partner.name_en} — ${S.lang==='ar'?c.zone.name_ar:c.zone.name_en}</div>
    <h2 style="margin:4px 0 0">${S.lang==='ar'?'اختر ما تريد الطلب منه':'Choose where to order from'}</h2>
    <div class="qrpicklist" style="max-width:320px">
      ${outlets.map(o=>`
        <button class="qrpickitem" style="display:flex;align-items:center;gap:12px;padding:14px" onclick="App.chooseOutlet('${o.id}')">
          <span class="media-placeholder sm" style="width:36px;height:36px;border-radius:var(--r-sm);background:linear-gradient(140deg,var(--purple-300),var(--purple-600));flex-shrink:0;font-size:14px">${typeLabel[o.type]||'O'}</span>
          <span style="flex:1">
            <span style="display:block;font-weight:800;font-size:14px">${S.lang==='ar'?o.name_ar:o.name_en}</span>
            <span style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--ink-400);font-weight:400;margin-top:2px">
              <span class="dot" style="width:6px;height:6px;border-radius:50%;background:var(--sage-500);display:inline-block"></span>${S.lang==='ar'?'متاح الآن':'Available now'}
              <span>· ${outletOperatorLabel(o.operator)}</span>
            </span>
          </span>
          <span style="color:var(--ink-300)">${S.lang==='ar'?'←':'→'}</span>
        </button>`).join('')}
    </div>
    <p style="font-size:11px;color:var(--ink-400);max-width:280px">${S.lang==='ar'?'يمكنك الطلب من أكثر من منفذ في نفس السلة':'You can order from more than one outlet in the same cart'}</p>
  </div>`;
}

function scrWelcome(){
  const c = S.qrContext;
  const nm = S.lang==='ar'?c.partner.name_ar:c.partner.name_en;
  const zn = S.lang==='ar'?c.zone.name_ar:c.zone.name_en;
  const branding = c.branding;
  // White Label: يُقرأ من نتيجة المُحلِّل بدل استنتاجه من mode محليًا --
  // المُحلِّل هو من يعرف بوابة الميزة والوراثة معًا.
  const isWhiteLabel = !!(branding && branding.whiteLabelActive);
  const crestLetter = isWhiteLabel && branding.logo_text ? branding.logo_text.charAt(0).toUpperCase() : 'ن';
  const welcomeTitle = isWhiteLabel && (S.lang==='ar'?branding.welcome_text_ar:branding.welcome_text_en) || nm;
  const showPoweredBy = !branding || branding.show_powered_by !== 0;
  return `
  <div class="welcome">
    <div class="crest">${crestLetter}</div>
    <div class="locpill">${t('youAreAt')}: ${nm} — ${zn} — ${c.point.label}</div>
    <div class="etarow"><span class="dot"></span>${t('serviceOn')}</div>
    <h2>${welcomeTitle}</h2>
    <button class="btn-primary" style="max-width:260px" onclick="App.goScreen('menu')">${t('startOrder')}</button>
    ${isWhiteLabel && showPoweredBy? `<div style="font-size:10px;color:var(--ink-400);margin-top:6px">${S.lang==='ar'?'مقدَّم من':'Powered by'} ALNADL</div>`:''}
  </div>`;
}

function scrMenu(){
  if(!S.catalog) return `<div class="scrbody">
    <div style="display:flex;gap:8px;margin-bottom:12px">${[1,2,3].map(()=>'<div class="skeleton skeleton-row" style="width:84px;height:32px;border-radius:999px"></div>').join('')}</div>
    <div class="prodgrid">${[1,2,3,4].map(()=>'<div class="skeleton skeleton-card"></div>').join('')}</div>
  </div>`;
  const cats = S.catalog.categories, prods = S.catalog.products.filter(p=>p.category_id===S.activeCatId);
  const c = S.qrContext;
  const merchants = S.catalog.merchants || [];
  const showMerchantGroups = merchants.length > 1;
  const merchantOf = (id) => merchants.find(m=>m.id===id);
  // group by merchant only when the marketplace feature exposes more than one (§9 Restaurant/Marketplace Integration)
  let prodBlocks = '';
  if(showMerchantGroups){
    const byMerchant = {};
    for(const p of prods){ (byMerchant[p.merchant_id] = byMerchant[p.merchant_id]||[]).push(p); }
    prodBlocks = Object.entries(byMerchant).map(([mid, list])=>{
      const m = merchantOf(mid);
      const label = m ? (S.lang==='ar'?m.name_ar:m.name_en) : '';
      return `${m && m.kind!=='alnadl'? `<div class="merchant-header"><span class="merchant-dot"></span>${label}<span class="merchant-tag">${S.lang==='ar'?'شريك':'Partner'}</span></div>` : (merchants.length>1? `<div class="merchant-header"><span class="merchant-dot brass"></span>${label}</div>`:'')}
        <div class="prodgrid">${list.map(prodCard).join('')}</div>`;
    }).join('');
  } else {
    prodBlocks = `<div class="prodgrid">${prods.map(prodCard).join('')}</div>`;
  }
  return `
  <div class="scrhead">
    <div class="top"><h3>${S.lang==='ar'?c.partner.name_ar:c.partner.name_en} — ${S.lang==='ar'?c.zone.name_ar:c.zone.name_en}</h3>
      ${S.qrContext.hub? `<button class="btn-small line" style="border:1px solid var(--ink-800);background:none" onclick="App.goScreen('hub')">${S.lang==='ar'?'منافذ أخرى':'Other outlets'}</button>` : (S.loyalty && S.loyalty.pointsBalance>0? `<div class="ptsbadge" onclick="App.goScreen('loyalty')">★ ${S.loyalty.pointsBalance}</div>` : '<div style="width:32px"></div>')}</div>
    <div class="cattabs">${cats.map(cat=>`<button class="${S.activeCatId===cat.id?'active':''}" onclick="App.setCat('${cat.id}')">${S.lang==='ar'?cat.name_ar:cat.name_en}</button>`).join('')}</div>
  </div>
  <div class="scrbody">
    ${prodBlocks}
  </div>
  ${S.cart.length? `<div class="cartbar"><div class="l">${App.cartCount()} ${t('items')}<b>${money(App.cartTotal())} ${unitCur()}</b></div>
    <button onclick="App.goScreen('cart')">${t('cart')} ←</button></div>`:''}
  `;
}
function prodCard(p){
  const name = S.lang==='ar'?p.name_ar:p.name_en;
  // UX-1: real media when set (admin-provided image_url), graceful
  // fallback to the UX-0 monogram placeholder otherwise — never a broken
  // image icon (onerror swaps back to the monogram markup directly).
  const media = p.image_url
    ? `<img src="${p.image_url}" alt="${name}" loading="lazy" onerror="this.outerHTML='<div class=&quot;media-placeholder sm&quot;>${esc(productMonogram(name))}</div>'">`
    : `<div class="media-placeholder sm">${productMonogram(name)}</div>`;
  return `
    <div class="prodcard ${p.available?'':'oos'}">
      <div class="thumb">${media}</div>
      <p class="nm">${name}</p>
      <div class="pricerow"><span class="price">${money(p.base_price)} ${unitCur()}</span>
      <button class="addbtn" onclick="App.openProduct('${p.id}')">+</button></div>
    </div>`;
}

function renderProductModal(){
  const ap=S.activeProduct, def=ap.def;
  const variant = ap.variantIdx>=0? def.variants[ap.variantIdx]:null;
  const addonTotal = def.addons.filter(a=>ap.addons[a.id]).reduce((s,a)=>s+a.price,0);
  const unit = def.base_price + (variant?variant.price_delta:0) + addonTotal;
  const modalName = S.lang==='ar'?def.name_ar:def.name_en;
  const heroMedia = def.image_url
    ? `<img src="${def.image_url}" alt="${modalName}" onerror="this.outerHTML='<div class=&quot;media-placeholder lg&quot;>${esc(productMonogram(modalName))}</div>'">`
    : `<div class="media-placeholder lg">${productMonogram(modalName)}</div>`;
  return `
  <div class="modalwrap"><div class="modalsheet">
    <div class="hero">${heroMedia}<button class="close" onclick="App.closeProduct()">✕</button></div>
    <div class="modalbody">
      <h3>${S.lang==='ar'?def.name_ar:def.name_en}</h3><p class="desc">${money(def.base_price)} ${unitCur()}</p>
      ${def.variants.length? `<div class="optgroup"><div class="lbl"><span>${S.lang==='ar'?'الحجم':'Size'}</span><span style="color:var(--red-500);font-size:10.5px">${t('required')}</span></div>
        ${def.variants.map((v,i)=>`<div class="optrow ${ap.variantIdx===i?'sel':''}" onclick="App.pickVariant(${i})">
          <div style="display:flex;align-items:center;gap:8px"><div class="radiodot ${ap.variantIdx===i?'on':''}"></div>${S.lang==='ar'?v.name_ar:v.name_en}</div>
          <span>${v.price_delta>0?'+'+money(v.price_delta):''}</span></div>`).join('')}</div>`:''}
      ${def.addons.length? `<div class="optgroup"><div class="lbl"><span>${S.lang==='ar'?'الإضافات':'Add-ons'}</span></div>
        ${def.addons.map(a=>`<div class="optrow ${ap.addons[a.id]?'sel':''}" onclick="App.toggleAddon('${a.id}')">
          <div style="display:flex;align-items:center;gap:8px"><div class="radiodot ${ap.addons[a.id]?'on':''}" style="border-radius:5px"></div>${S.lang==='ar'?a.name_ar:a.name_en}</div>
          <span>${a.price?'+'+money(a.price):''}</span></div>`).join('')}</div>`:''}
      <div class="optgroup"><div class="lbl"><span>${t('notes')}</span></div>
        <textarea class="noteinput" rows="2" placeholder="${t('notesPh')}" oninput="App.setNotes(this.value)">${ap.notes||''}</textarea></div>
      <div class="qtystepper"><button onclick="App.stepQty(-1)">–</button><span class="n">${ap.qty}</span><button onclick="App.stepQty(1)">+</button></div>
      <button class="btn-primary" onclick="App.addActiveToCart()">${t('addToCart')} — ${money(unit*ap.qty)} ${unitCur()}</button>
    </div>
  </div></div>`;
}

function scrCart(){
  const t1 = App.computeTotals();
  return `
  <div class="scrhead"><div class="top"><button class="back" onclick="App.goScreen('menu')">${S.lang==='ar'?'→':'←'}</button><h3>${t('yourCart')}</h3><div style="width:32px"></div></div></div>
  <div class="scrbody">
    ${S.cart.length===0? `<div class="empty-hint">${t('emptyCart')}</div>` : S.cart.map(c=>{
      const cName = S.lang==='ar'?c.ar:c.en;
      const cMedia = c.imageUrl
        ? `<img src="${c.imageUrl}" alt="${cName}" loading="lazy" onerror="this.outerHTML='<div class=&quot;media-placeholder sm&quot; style=&quot;font-size:16px&quot;>${esc(productMonogram(cName))}</div>'">`
        : `<div class="media-placeholder sm" style="font-size:16px">${productMonogram(cName)}</div>`;
      return `
      <div class="cartrow"><div class="th">${cMedia}</div><div class="mid">
        <p class="nm">${cName}</p>
        <p class="opt">${[c.variantLabel?(S.lang==='ar'?c.variantLabel.ar:c.variantLabel.en):null, ...c.addonLabels.map(a=>S.lang==='ar'?a.ar:a.en)].filter(Boolean).join(' · ')||'&nbsp;'}</p>
        <div class="stepper" style="display:flex;align-items:center;gap:8px"><button onclick="App.cartStep('${c.key}',-1)">–</button><span>${c.qty}</span><button onclick="App.cartStep('${c.key}',1)">+</button></div>
      </div><div style="text-align:end"><div class="price">${money(c.lineTotal)}</div><button class="rm" onclick="App.cartRemove('${c.key}')">${S.lang==='ar'?'حذف':'Remove'}</button></div></div>`;
    }).join('')}
    ${S.cart.length? `
      <div class="promorow" style="display:flex;gap:8px;margin:14px 0;">
        <input id="promoInput" placeholder="${t('promo')}" value="${S.promo?S.promo.code:''}" style="flex:1;border:1px solid var(--cream-200);border-radius:9px;padding:9px 12px;font-size:12.5px;background:var(--white);">
        <button onclick="App.applyPromo()" style="border:1px solid var(--ink-800);background:var(--white);border-radius:9px;padding:9px 14px;font-size:12px;font-weight:700;">${t('apply')}</button>
      </div>
      ${S.ui.promoMsg? `<div style="font-size:11.5px;color:${S.promo?'var(--sage-500)':'var(--red-500)'};margin:-8px 0 8px">${S.ui.promoMsg}</div>`:''}
      <div class="totalsbox">
      <div class="totalline"><span>${t('subtotal')}</span><span>${money(t1.subtotal)}</span></div>
      ${t1.promoDiscount>0? `<div class="totalline" style="color:var(--sage-500)"><span>${t('promo')} (${S.promo.code})</span><span>-${money(t1.promoDiscount)}</span></div>`:''}
      <div class="totalline"><span>${t('vat')} (15%)</span><span>${money(t1.vat)}</span></div>
      <div class="totalline grand"><span>${t('total')}</span><span>${money(t1.total)} ${unitCur()}</span></div></div>`:''}
  </div>
  ${S.cart.length? `<div style="position:absolute;bottom:0;inset-inline:0;padding:14px 18px;background:var(--cream-050);border-top:1px solid var(--cream-200);">
    <button class="btn-primary" onclick="App.goCheckout()">${t('continueCheckout')}</button></div>`:''}
  `;
}

function scrCheckout(){
  const t1 = App.computeTotals();
  const feat = S.qrContext.features || {};
  const walletCoverPreview = S.wallet ? Math.min(t1.total, S.wallet.remaining, S.wallet.policy?.perOrderCap ?? Infinity) : 0;
  return `
  <div class="scrhead"><div class="top"><button class="back" onclick="App.goScreen('cart')">${S.lang==='ar'?'→':'←'}</button><h3>${t('checkoutTitle')}</h3><div style="width:32px"></div></div></div>
  <div class="scrbody">
    ${S.ui.err? `<div class="errbox">${S.ui.err}</div>`:''}
    <div class="deliverybox"><div><div class="l">${t('deliverTo')}</div><div class="v">${S.lang==='ar'?S.qrContext.zone.name_ar:S.qrContext.zone.name_en} — ${S.qrContext.point.label}</div></div><div style="font-size:20px">📍</div></div>
    <div class="formfield" style="margin-top:16px"><label>${t('nameField')}</label><input id="custName" placeholder="Khaled AlHarbi" value="${S.checkoutName}" oninput="S.checkoutName=this.value"></div>
    <div class="formfield"><label>${t('phoneField')}</label><input id="custPhone" placeholder="+966 5x xxx xxxx" value="${S.checkoutPhone}" oninput="S.checkoutPhone=this.value" onblur="App.lookupLoyalty()"></div>

    ${feat.loyalty ? `
      <div class="loyaltybox">
        <div class="loyaltybox-head">★ ${S.lang==='ar'?'نقاط الولاء':'Loyalty points'}
          <span>${S.loyaltyBalance!=null? (S.lang==='ar'?`الرصيد: ${S.loyaltyBalance}`:`Balance: ${S.loyaltyBalance}`) : (S.lang==='ar'?'أدخل رقم الجوال لعرض رصيدك':'Enter your phone to see your balance')}</span>
        </div>
        ${S.loyaltyBalance>0? `
          <div class="formfield" style="margin:10px 0 0">
            <label>${S.lang==='ar'?`استبدال نقاط (كل 20 نقطة = 1 ر.س)`:`Redeem points (20 pts = 1 SAR)`}</label>
            <input type="number" min="0" max="${S.loyaltyBalance}" value="${S.redeemPoints||0}" oninput="App.setRedeemPoints(this.value)">
          </div>`:''}
      </div>` : ''}

    <div class="formfield"><label>${t('payMethod')}</label>
      <div class="paymethodrow ${S.payMethod==='card'?'sel':''}" onclick="App.setPayMethod('card')"><div style="display:flex;align-items:center;gap:8px"><div class="radiodot ${S.payMethod==='card'?'on':''}"></div>💳 ${t('card')}</div></div>
      ${feat.corporateWallet? `
      <div class="paymethodrow ${S.payMethod==='wallet'?'sel':''}" style="flex-direction:column;align-items:stretch;gap:8px" onclick="${S.wallet?"App.setPayMethod('wallet')":''}">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:8px"><div class="radiodot ${S.payMethod==='wallet'?'on':''}"></div>🏢 ${t('wallet')}</div>
          ${S.wallet? `<span style="font-size:11px;color:var(--sage-500);font-weight:700">${S.lang==='ar'?'متصل':'Linked'}</span>`:''}
        </div>
        ${!S.wallet? `<div style="display:flex;gap:6px" onclick="event.stopPropagation()">
            <input id="employeeRef" placeholder="${S.lang==='ar'?'معرّف الموظف (dept:engineering)':'Employee ID (dept:engineering)'}" style="flex:1;border:1px solid var(--cream-200);border-radius:8px;padding:8px 10px;font-size:12px;background:var(--white)">
            <button onclick="App.lookupWallet()" style="border:1px solid var(--ink-800);background:var(--white);border-radius:8px;padding:8px 12px;font-size:11.5px;font-weight:700">${S.lang==='ar'?'ربط':'Link'}</button>
          </div>` : `<div style="font-size:11px;color:var(--ink-400)">${S.lang==='ar'?'ستُغطّى':'Will cover'} ${money(walletCoverPreview)} ${unitCur()} ${S.lang==='ar'?'من إجمالي':'of'} ${money(t1.total)}</div>`}
      </div>`:''}
    </div>

    <div class="totalsbox">
      <div class="totalline"><span>${t('subtotal')}</span><span>${money(t1.subtotal)}</span></div>
      ${t1.promoDiscount>0? `<div class="totalline" style="color:var(--sage-500)"><span>${t('promo')}</span><span>-${money(t1.promoDiscount)}</span></div>`:''}
      ${t1.loyaltyDiscount>0? `<div class="totalline" style="color:var(--sage-500)"><span>★ ${S.lang==='ar'?'نقاط':'Points'}</span><span>-${money(t1.loyaltyDiscount)}</span></div>`:''}
      <div class="totalline"><span>${t('vat')}</span><span>${money(t1.vat)}</span></div>
      <div class="totalline grand"><span>${t('total')}</span><span>${money(t1.total)} ${unitCur()}</span></div></div>
  </div>
  <div style="position:absolute;bottom:0;inset-inline:0;padding:14px 18px;background:var(--cream-050);border-top:1px solid var(--cream-200);display:flex;flex-direction:column;gap:8px;">
    <button class="btn-primary" onclick="App.submitPayment()">${t('payNow')} · ${money(t1.total)} ${unitCur()}</button>
    ${window.AlnadlDevTools && window.AlnadlDevTools.renderPaymentTestControl ? window.AlnadlDevTools.renderPaymentTestControl() : ''}
  </div>`;
}

function scrPaymentResult(){
  const o = S.currentOrder; const ok = o && o.status!=='Failed';
  return `<div class="resultwrap"><div class="resulticon ${ok?'ok':'fail'}">${ok?'✓':'✕'}</div>
    <h2 style="margin:0">${ok?t('paySuccess'):t('payFail')}</h2>
    ${ok? `<div class="orderno">${t('yourOrder')}${o.id}</div>`:`<p style="color:var(--ink-400);font-size:12.5px;max-width:260px">${S.lang==='ar'?'لم يتم إنشاء طلب مكرر — يمكنك إعادة المحاولة بأمان.':'No duplicate order was created — you can safely retry.'}</p>`}
    ${ok? `<button class="btn-primary" style="max-width:260px" onclick="App.goTrack()">${t('goTrack')}</button>` : `<button class="btn-primary" style="max-width:260px" onclick="App.retryPayment()">${t('retry')}</button>`}
  </div>`;
}

function scrTracking(){
  const o=S.currentOrder; if(!o) return scrWelcome();
  const order=['Paid','Accepted','Preparing','Ready','Out for Delivery','Delivered'];
  const labels=['st_paid','st_accepted','st_preparing','st_ready','st_out','st_delivered'];
  // Partial states (Q04, multi-outlet orders) map onto the same 6-step
  // visual, but never claim more progress than genuinely happened —
  // "Partially Ready" sits at the Ready step, "Partially Delivered" at the
  // Out for Delivery step, both flagged so the UI can say "some of your order".
  const partialNote = o.status==='Partially Ready' ? (S.lang==='ar'?'بعض عناصر طلبك جاهزة، والباقي قيد التجهيز':'Part of your order is ready, the rest is still being prepared')
    : o.status==='Partially Delivered' ? (S.lang==='ar'?'تم تسليم جزء من طلبك، والباقي في الطريق':'Part of your order has been delivered, the rest is on the way') : null;
  const effectiveStatus = o.status==='Partially Ready' ? 'Ready' : o.status==='Partially Delivered' ? 'Out for Delivery' : o.status;
  const curIdx=order.indexOf(effectiveStatus);
  return `
  <div class="scrhead"><div class="top"><h3>${t('trackTitle')} ${o.id}</h3>${statusBadge(o.status)}</div></div>
  <div class="scrbody">
    ${partialNote? `<div class="notebox">${partialNote}</div>`:''}
    <div class="steplist">${order.map((st,i)=>{
      const done=curIdx>i, isCur=i===curIdx && o.status!=='Cancelled';
      const cls = o.status==='Cancelled'?'':(done?'done':isCur?'current':'');
      return `<div class="stepitem ${cls}"><div class="line"></div><div class="stepdot">${done?'✓':(i+1)}</div><div class="txt"><b>${t(labels[i])}</b></div></div>`;
    }).join('')}</div>
    ${o.status==='Cancelled'? `<div class="notebox" style="background:var(--red-100);color:var(--red-500)">${S.lang==='ar'?'تم إلغاء هذا الطلب':'This order was cancelled'}</div>`:''}
    <div class="deliverybox"><div><div class="l">${t('deliverTo')}</div><div class="v">${o.pointLabel||S.qrContext.point.label}</div></div><div style="font-size:20px">📍</div></div>
    ${o.status==='Delivered'? `<button class="btn-primary" style="margin-top:16px" onclick="App.goScreen('feedback')">${t('howExperience')}</button>`:''}
    ${engageInvite()}
  </div>`;
}

function scrFeedback(){
  const fb = S.feedback || (S.feedback = {stars:0,tags:[],comment:''});
  const tags = S.lang==='ar'? ['سريع','ودود','نظيف','طلب ناقص','تأخر'] : ['Fast','Friendly','Clean','Missing item','Delayed'];
  return `
  <div class="scrhead"><div class="top"><h3>${t('howExperience')}</h3><div style="width:32px"></div></div></div>
  <div class="scrbody" style="text-align:center">
    <div class="starrow" style="display:flex;gap:6px;justify-content:center;font-size:30px;margin:6px 0 18px">
      ${[1,2,3,4,5].map(n=>`<span style="cursor:pointer;color:${fb.stars>=n?'var(--brass-500)':'var(--ink-200)'}" onclick="App.setStar(${n})">★</span>`).join('')}
    </div>
    <div style="text-align:start">
      ${tags.map(tg=>`<span class="tagchip" style="display:inline-block;border:1px solid ${fb.tags.includes(tg)?'var(--ink-900)':'var(--cream-200)'};background:${fb.tags.includes(tg)?'var(--ink-900)':'var(--white)'};color:${fb.tags.includes(tg)?'var(--cream-050)':'var(--ink-900)'};padding:8px 14px;border-radius:999px;font-size:12px;font-weight:700;margin:0 5px 8px 0;cursor:pointer" onclick="App.toggleTag('${tg}')">${tg}</span>`).join('')}
    </div>
    <textarea id="fbComment" class="noteinput" rows="3" placeholder="${t('optionalComment')}" style="margin-top:14px" oninput="S.feedback.comment=this.value">${esc(fb.comment||'')}</textarea>
    <button class="btn-primary" style="margin-top:16px" onclick="App.submitFeedback()">${t('submitFeedback')}</button>
  </div>`;
}
function scrFeedbackThanks(){
  return `<div class="resultwrap"><div class="resulticon ok">✓</div><h2 style="margin:0">${t('thanksFeedback')}</h2>
    <button class="btn-primary" style="max-width:220px" onclick="App.startNewOrder()">${t('backToStart')}</button></div>`;
}

/* ---------------- ENGAGE (UX-5, spec §11) ----------------
   Five genuinely distinct experience modes sharing one design system —
   not one card with different copy. Each personality gets its own
   surface treatment, its own pacing cue, and its own closing tone,
   driven by the personality the SERVER chose (the client never decides
   or even knows why).

   G11 (deferred from UX-1): "Never block order/tracking. Calm opt-in
   invitation appropriate to context." The invitation below is an
   optional card BELOW the order's own content — it never gates,
   interrupts, or replaces anything in the hospitality flow, and it
   simply does not render when the guest has no eligible pass (which is
   also exactly what a disabled feature flag or a kill switch looks like
   from here). */
function engageInvite(){
  const e = S.engage;
  if(e.eligible===null){ App.checkEngageEligibility(); return ''; } // not yet known — render nothing rather than flicker
  if(!e.eligible) return '';                                        // no pass / disabled / expired — indistinguishable by design
  return `<div class="engage-invite">
    <div class="engage-mark">✦</div>
    <div class="t">
      <b>${engageInviteLabel()}</b>
      <span>${S.lang==='ar'?'شيء صغير بينما تنتظر — اختياري تمامًا':'Something small while you wait — entirely optional'}</span>
    </div>
    <button onclick="App.startEngage()">${S.lang==='ar'?'ابدأ':'Start'}</button>
  </div>`;
}

const ENGAGE_MODES = {
  RESET:    { cls:'reset',    showProgress:false, ar:{cta:'خذ لحظة',      close:'استمتع ببقية يومك'},        en:{cta:'Take a moment',  close:'Enjoy the rest of your day'} },
  SPARK:    { cls:'spark',    showProgress:true,  ar:{cta:'التالي',        close:'إلى اللقاء'},               en:{cta:'Next',           close:'See you next time'} },
  DISCOVER: { cls:'discover', showProgress:true,  ar:{cta:'اكتشف المزيد',  close:'نتطلع لزيارتك القادمة'},    en:{cta:'Discover more',  close:'Until your next visit'} },
  PLAY:     { cls:'play',     showProgress:true,  ar:{cta:'هيا',           close:'كانت جولة ممتعة'},          en:{cta:"Let's go",       close:'That was fun'} },
  MIND:     { cls:'mind',     showProgress:false, ar:{cta:'فكّر معنا',      close:'شكرًا لمشاركتك'},            en:{cta:'Think with us',  close:'Thanks for playing along'} },
};

function scrEngage(){
  const e = S.engage;
  const personality = e.session?.personality || 'RESET';
  const mode = ENGAGE_MODES[personality] || ENGAGE_MODES.RESET;
  const copy = S.lang==='ar' ? mode.ar : mode.en;

  // Bounded wait (spec §11: "Loading AI content needs bounded wait UX and
  // approved static fallback"). The server already guarantees a bounded
  // wait and always returns approved content -- the guest sees a calm
  // skeleton shaped like the moment, never a spinner with no end in sight.
  if(e.loading){
    return `<div class="engage ${mode.cls}">
      <div class="engage-card">
        <div class="skeleton skeleton-text w40" style="height:14px;margin-bottom:16px"></div>
        <div class="skeleton skeleton-text w80" style="height:22px;margin-bottom:10px"></div>
        <div class="skeleton skeleton-text w60" style="height:22px"></div>
      </div>
    </div>`;
  }

  // A calm, complete ending -- used for ceiling reached, session ended,
  // safety fallback exhaustion, and provider trouble alike. The guest is
  // never told which; all of them are simply "this is finished, here is
  // the way back" (spec §11 Safety UX).
  if(e.ended || !e.moment){
    return `<div class="engage ${mode.cls}">
      <div class="engage-card end">
        <div class="engage-mark">✦</div>
        <h2>${copy.close}</h2>
        <button class="btn-primary" style="max-width:240px;margin-top:18px" onclick="App.exitEngage()">${S.lang==='ar'?'العودة للطلب':'Back to my order'}</button>
      </div>
    </div>`;
  }

  const p = e.moment.payload || {};
  // Encoded at the point of output — see esc(). Engage payloads may be
  // AI-generated, so they are treated as untrusted markup regardless of
  // having passed the safety gate.
  const title = esc(S.lang==='ar' ? (p.title_ar||p.title_en||'') : (p.title_en||p.title_ar||''));
  const body  = esc(S.lang==='ar' ? (p.body_ar||p.body_en||'')  : (p.body_en||p.body_ar||''));
  const used = e.session?.ceilingUsed || 0;
  const max  = e.session?.ceilingMax || 0;

  // Progress is shown ONLY where the spec says it helps (SPARK/DISCOVER/
  // PLAY: "visible progress only if helpful"). RESET and MIND deliberately
  // show none -- a counter would contradict "one clear moment" and
  // "no pressure loops".
  const progress = (mode.showProgress && max>1)
    ? `<div class="engage-progress" aria-label="${used}/${max}">${Array.from({length:max}).map((_,i)=>`<span class="${i<used?'on':''}"></span>`).join('')}</div>`
    : '';

  return `<div class="engage ${mode.cls}">
    <div class="engage-card">
      ${progress}
      ${title? `<div class="engage-kicker">${title}</div>`:''}
      <p class="engage-body">${body}</p>
      <div class="engage-actions">
        <button class="btn-primary" onclick="App.respondToMoment('completed')">${copy.cta}</button>
        <button class="engage-skip" onclick="App.respondToMoment('skipped')">${S.lang==='ar'?'تخطّي':'Skip'}</button>
      </div>
      <button class="engage-exit" onclick="App.endEngage()">${S.lang==='ar'?'إنهاء':'End'}</button>
    </div>
  </div>`;
}

/* ---------------- STAFF SHELL ---------------- */
// UX-4 (spec §9 P1: "Do not place 13+ modules as equal horizontal
// buttons. The current pattern will become materially worse as Inc-5-8
// add Experience/AI/Learning/Lab surfaces."). SuperAdmin had exactly 13
// flat, equal-weight buttons -- the precise pattern flagged.
//
// Navigation is now defined as DOMAIN GROUPS matching the spec's own
// SA01-SA08 module groups, rendered in the sidebar component that UX-0
// built as a foundation but deliberately left unwired until this wave
// (the spec's §32 sequencing put the rollout here, once the platform's
// module list was known -- which it now is, Phase 5 included).
//
// Roles with few modules (Operator, Runner, SiteManager) keep the flat
// bar: a sidebar for 1-2 items would be pure overhead, and the spec's
// concern is explicitly about breadth. The grouping below is data, not
// layout -- renderStaffShell decides which presentation each role gets.
function navGroupsFor(role){
  const L = (ar,en) => S.lang==='ar'?ar:en;
  const groups = {
    SuperAdmin: [
      { id:'SA02', label:L('الشركاء','Partners'), items:[
        ['plans', L('الباقات','Plans')],
        ['tenants', L('الشركاء والباقات','Tenants & Plans')],
        ['portfolio', L('محفظة المواقع','Portfolio')],
        ['users', L('المستخدمون','Users')],
      ]},
      { id:'SA03', label:L('العمليات','Operations'), items:[
        ['outlets', L('المنافذ','Outlets')],
        ['zones', t('adminZones')],
        ['catalog', t('adminCatalog')],
        ['merchants', L('الشركاء التجاريون','Merchants')],
      ]},
      { id:'SA04', label:L('التجاري','Commercial'), items:[
        ['revenue', L('نماذج الإيراد','Revenue Models')],
        ['settlements', t('revShareTitle')],
        ['refunds', L('الاسترجاعات','Refunds')],
        ['wallets', L('محافظ الشركات','Corporate Wallets')],
      ]},
      { id:'SA05', label:L('التجربة','Experience'), items:[
        ['engagecontrol', L('تحكّم Engage','Engage Control')],
        ['mechanics', L('مختبر الآليات','Mechanic Lab')],
        ['ledger', L('سجل التجارب','Experience Ledger')],
      ]},
      { id:'SA06', label:L('المنصة','Platform'), items:[
        ['branding', L('العلامة التجارية','White Label')],
      ]},
      { id:'SA07', label:L('الحوكمة','Governance'), items:[
        ['audit', t('auditLog')],
      ]},
    ],
    // §3.3 — سطح ProductAdmin: مختبر الآليات ونظرة Engage فقط.
    // لا مفتاح إيقاف عام: الخادم يحصره بـSuperAdmin، والواجهة لا تتجاوز RBAC.
    ProductAdmin: [
      { id:'PA-ENG', label:L('التجربة','Experience'), items:[
        ['mechanics', L('مختبر الآليات','Mechanic Lab')],
        ['engageoverview', L('نظرة Engage','Engage Overview')],
      ]},
    ],
    // §3.3 — سطح SafetyReviewer: الحوادث والسجل فقط، والمعالجة حيث يسمح الخادم.
    SafetyReviewer: [
      { id:'SR-SAF', label:L('السلامة','Safety'), items:[
        ['safety', L('حوادث السلامة','Safety Incidents')],
        ['ledger', L('سجل التجارب','Experience Ledger')],
      ]},
    ],
    PartnerAdmin: [
      { id:'P-OVW', label:L('نظرة عامة','Overview'), items:[
        ['overview', L('أداء الشريك','Partner Performance')],
      ]},
      { id:'P-OPS', label:L('العمليات','Operations'), items:[
        ['outlets', L('المنافذ','Outlets')],
        ['zones', t('adminZones')],
        ['catalog', t('adminCatalog')],
        ['merchants', L('الشركاء التجاريون','Merchants')],
      ]},
      { id:'P-COM', label:L('التجاري','Commercial'), items:[
        ['revenue', L('نماذج الإيراد','Revenue Models')],
        ['wallets', L('محافظ الشركات','Corporate Wallets')],
        ['billing', L('الباقة','Plan')],
      ]},
      { id:'P-EXP', label:L('التجربة','Experience'), items:[
        ['partnerengage', L('Engage','Engage')],
      ]},
      { id:'P-ADM', label:L('الإدارة','Administration'), items:[
        ['users', L('المستخدمون','Users')],
      ]},
    ],
  };
  return groups[role] || null;
}

function renderStaffShell(){
  const role = S.session.user.role;
  const navByRole = {
    Operator:[['kds', t('kds')]], SiteManager:[['live', S.lang==='ar'?'اللوحة الحية':'Live Dashboard'],['kds', t('kds')],['exceptions', S.lang==='ar'?'الاستثناءات':'Exceptions']],
    Runner:[['runnerq', t('runnerQ')]],
    SuperAdmin:[['tenants', S.lang==='ar'?'الشركاء والباقات':'Tenants & Plans'],['portfolio', S.lang==='ar'?'محفظة المواقع':'Portfolio'],['outlets', S.lang==='ar'?'المنافذ (Outlets)':'Outlets'],['revenue', S.lang==='ar'?'نماذج الإيراد':'Revenue Models'],['branding', S.lang==='ar'?'العلامة التجارية (White Label)':'White Label'],['zones', t('adminZones')],['catalog', t('adminCatalog')],['merchants', S.lang==='ar'?'الشركاء التجاريون':'Merchants'],['wallets', S.lang==='ar'?'محافظ الشركات':'Corporate Wallets'],['users', S.lang==='ar'?'المستخدمون':'Users'],['settlements', t('revShareTitle')],['refunds', S.lang==='ar'?'الاسترجاعات':'Refunds'],['audit', t('auditLog')],['engagecontrol', S.lang==='ar'?'تحكّم Engage':'Engage Control'],['mechanics', S.lang==='ar'?'مختبر الآليات':'Mechanic Lab'],['ledger', S.lang==='ar'?'سجل التجارب':'Experience Ledger']],
    AlnadlFinance:[['revledger', S.lang==='ar'?'دفتر الإيراد':'Revenue Ledger'],['settlements', t('revShareTitle')],['refunds', S.lang==='ar'?'الاسترجاعات':'Refunds'],['audit', t('auditLog')]],
    PartnerViewer:[['partnerengage', S.lang==='ar'?'Engage':'Engage'],['overview', t('partnerOverview')],['settlements', t('revShareTitle')],['billing', S.lang==='ar'?'الباقة':'Plan']],
    ProductAdmin:[['mechanics', S.lang==='ar'?'مختبر الآليات':'Mechanic Lab'],['engageoverview', S.lang==='ar'?'نظرة Engage':'Engage Overview']],
    SafetyReviewer:[['safety', S.lang==='ar'?'حوادث السلامة':'Safety Incidents'],['ledger', S.lang==='ar'?'سجل التجارب':'Experience Ledger']],
    PartnerAdmin:[['partnerengage', S.lang==='ar'?'Engage':'Engage'],['overview', S.lang==='ar'?'أداء الشريك':'Partner Performance'],['outlets', S.lang==='ar'?'المنافذ (Outlets)':'Outlets'],['revenue', S.lang==='ar'?'نماذج الإيراد':'Revenue Models'],['zones', t('adminZones')],['catalog', t('adminCatalog')],['merchants', S.lang==='ar'?'الشركاء التجاريون':'Merchants'],['wallets', S.lang==='ar'?'محافظ الشركات':'Corporate Wallets'],['users', S.lang==='ar'?'المستخدمون':'Users'],['billing', S.lang==='ar'?'الباقة':'Plan']],
  };
  const nav = navByRole[role] || [];
  let inner = '';
  if(S.screen==='kds') inner = renderKds();
  else if(S.screen==='runnerq') inner = renderRunner();
  else if(S.screen==='exceptions') inner = renderSiteExceptions();
  else if(S.screen==='partnerprofile') inner = renderPartnerProfile();
  else if(S.screen==='engagecontrol') inner = renderEngageControl();
  else if(S.screen==='partnerengage') inner = renderPartnerEngage();
  else if(S.screen==='revledger') inner = renderRevenueLedger();
  else if(S.screen==='mechanics') inner = renderMechanicLab();
  else if(S.screen==='engageoverview') inner = renderEngageOverviewAdmin();
  else if(S.screen==='safety') inner = renderSafetyIncidents();
  else if(S.screen==='ledger') inner = renderEngageLedger();
  else if(S.screen==='plans') inner = renderPlansAdmin();
  else if(S.screen==='tenants') inner = renderTenants();
  else if(S.screen==='portfolio') inner = renderPortfolio();
  else if(S.screen==='live') inner = renderLiveManager();
  else if(S.screen==='zones') inner = renderAdminZones();
  else if(S.screen==='catalog') inner = renderAdminCatalog();
  else if(S.screen==='users') inner = renderUsers();
  else if(S.screen==='audit') inner = renderAudit();
  else if(S.screen==='overview') inner = renderPartnerOverview();
  else if(S.screen==='settlements') inner = renderSettlements();
  else if(S.screen==='billing') inner = renderBilling();
  else if(S.screen==='outlets') inner = renderOutlets();
  else if(S.screen==='revenue') inner = renderRevenueModels();
  else if(S.screen==='branding') inner = renderBranding();
  else if(S.screen==='refunds') inner = renderRefunds();
  else if(S.screen==='merchants') inner = renderMerchants();
  else if(S.screen==='wallets') inner = renderWallets();
  else inner = `<div class="empty-hint">—</div>`;

  const groups = navGroupsFor(role);
  const currentLabel = groups
    ? (groups.flatMap(g=>g.items).find(i=>i[0]===S.screen)?.[1] || '')
    : (nav.find(n=>n[0]===S.screen)?.[1] || '');

  // UX-4 (spec SA02: "Persistent scope breadcrumb"): the header now
  // states which domain group the current module belongs to, so a
  // SuperAdmin moving between 13 modules always knows where they are.
  const currentGroup = groups ? groups.find(g=>g.items.some(i=>i[0]===S.screen)) : null;
  const breadcrumb = currentGroup
    ? `<span class="crumb">${currentGroup.label}</span><span class="crumbsep">›</span>`
    : '';

  const shellInner = `
    <div class="boh-header">
      <div class="boh-title"><h1>${breadcrumb}${currentLabel}</h1><p>${t('scope_note')}</p></div>
      ${groups? '' : `<div class="boh-nav">${nav.map(([id,lbl])=>`<button class="${S.screen===id?'active':''}" onclick="App.setStaffScreen('${id}')">${lbl}</button>`).join('')}</div>`}
    </div>
    ${S.ui.err? `<div class="errbox">${S.ui.err}</div>`:''}
    ${inner}`;

  const body = groups
    ? `<div class="admin-layout">
        <nav class="sidebar" aria-label="${S.lang==='ar'?'التنقل':'Navigation'}">
          <div class="sidebar-scope">${S.lang==='ar'?'النطاق الحالي':'Current scope'}<b>${S.session.user.username} · ${role}</b></div>
          ${groups.map(g=>`
            <div class="sidebar-group">
              <div class="sidebar-group-label">${g.label}</div>
              ${g.items.map(([id,lbl])=>`<button class="sidebar-link ${S.screen===id?'active':''}" onclick="App.setStaffScreen('${id}')">${lbl}</button>`).join('')}
            </div>`).join('')}
        </nav>
        <div class="bohshell"><div class="bohwrap">${shellInner}</div></div>
      </div>`
    : `<div class="bohshell"><div class="bohwrap">${shellInner}</div></div>`;

  return `${body}
  ${S.ui.openOrder? renderOrderDetail(S.ui.openOrder):''}
  ${S.ui.deliveryFailFor? renderDeliveryFailModal(S.ui.deliveryFailFor):''}
  ${S.ui.refundFor? renderRefundModal():''}
  ${S.ui.statusChange? renderStatusChangeModal():''}
  ${S.ui.activationHandoff? renderActivationHandoff():''}
  ${S.ui.proposeMechanic? renderProposeModal():''}
  ${S.ui.mechTransition? renderMechTransitionModal():''}
  ${S.ui.bulkPoints? renderBulkPointsModal():''}`;
}

// UX-2 (spec R03 "Delivery exception — Destination + order + reason
// choices; Reason required; audit-safe; do not expose internal technical
// errors"): the destination and order are restated here so a Runner
// confirming a failure can see WHICH delivery they're marking failed,
// and the reason is required client-side as well as server-side.
function renderDeliveryFailModal(id){
  const o=(S.runnerQ||[]).find(x=>x.id===id); if(!o) return '';
  const zoneLabel = S.lang==='ar'?o.zone_name_ar:o.zone_name_en;
  const presets = S.lang==='ar'
    ? ['العميل غير موجود','النقطة مغلقة','تعذّر الوصول للنقطة','رفض العميل الاستلام']
    : ['Guest not present','Point closed','Could not reach the point','Guest declined'];
  return `<div class="ordmodal" onclick="if(event.target===this) App.dismissDeliveryFail()"><div class="ordsheet">
    <h3>${t('failBtn')}</h3>
    <div class="pt">${zoneLabel?zoneLabel+' · ':''}${o.point_label||'—'} · ${o.id}</div>
    <div class="formfield" style="margin-top:14px"><label>${S.lang==='ar'?'سبب تعذّر التسليم (مطلوب)':'Reason for failed delivery (required)'}</label>
      <input id="deliveryFailReasonInput" placeholder="${S.lang==='ar'?'اختر سببًا أو اكتبه':'Pick a reason or type one'}"></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      ${presets.map(r=>`<button class="btn-small" onclick="document.getElementById('deliveryFailReasonInput').value='${r}'">${r}</button>`).join('')}
    </div>
    <div class="actrow">
      <button class="btn-danger-line" onclick="App.confirmDeliveryFail('${o.id}')">${S.lang==='ar'?'تأكيد':'Confirm'}</button>
      <button class="ghostbtn" onclick="App.dismissDeliveryFail()">${t('close')}</button>
    </div>
  </div></div>`;
}

function renderKds(){
  // UX-2 (spec K05: "Differentiate genuinely empty vs loading/offline/
  // error. Operator trusts board state") -- S.ops.queue starts null
  // (not yet loaded) and loadOpsQueue() now sets S.ops.error on a
  // genuine fetch failure instead of silently swallowing it.
  if(S.ops.queue===null && !S.ops.error){
    return `<div class="kdscols">${[1,2,3].map(()=>`<div class="kdscol"><div class="skeleton skeleton-text w40" style="margin:2px 4px 12px"></div>${[1,2].map(()=>'<div class="skeleton skeleton-card" style="height:88px"></div>').join('')}</div>`).join('')}</div>`;
  }
  if(S.ops.error){
    return `<div class="statepanel offline" style="max-width:340px;margin:36px auto">
      <div class="glyph">⚠</div><h4>${S.lang==='ar'?'تعذّر تحميل الطابور':'Could not load the queue'}</h4>
      <p>${S.lang==='ar'?'تحقّق من الاتصال ثم أعد المحاولة.':'Check your connection, then try again.'}</p>
      <button class="btn-primary" style="max-width:150px;margin:14px auto 0" onclick="App.loadOpsQueue()">${S.lang==='ar'?'إعادة المحاولة':'Retry'}</button>
    </div>`;
  }

  const cols=[['New',['Paid']],['Preparing',['Accepted','Preparing']],['Ready',['Ready','Out for Delivery']]];
  const labelKey={New:'newCol',Preparing:'prepCol',Ready:'readyCol'};
  // UX-2 (spec K02: "Next valid transition is dominant" — now rendered
  // directly on the card, not only inside the detail modal).
  const nextAction={ Paid:{to:'Accepted',label:t('accept')}, Accepted:{to:'Preparing',label:t('start')}, Preparing:{to:'Ready',label:t('markReady')}, Ready:{to:'Out for Delivery',label:t('outForDelivery')} };

  return `<div class="kdscols">${cols.map(([name,statuses])=>{
    // Sort within the column by wait time — oldest (most urgent) first;
    // this is a real, stable sort (never reshuffles mid-view except when
    // an order genuinely leaves the column via a real status change),
    // matching K01's "Do not reorder unpredictably while user acts."
    const list=S.ops.queue.filter(o=>statuses.includes(o.status)).sort((a,b)=>a.created_at-b.created_at);
    // UX-2 (spec K01: "queue counts; SLA summary" at the column header —
    // previously only a count existed, no SLA signal at all).
    const breachedCount = list.filter(o => (Date.now()-o.created_at)/60000 >= (o.slaPrepMin||8)).length;
    return `<div class="kdscol"><h4>${t(labelKey[name])}<span class="cnt">${list.length}</span>${breachedCount>0?`<span class="cnt breach">${breachedCount} ${S.lang==='ar'?'متأخر':'late'}</span>`:''}</h4>
      ${list.length? list.map(o=>{
        // UX-2: real per-outlet SLA (o.slaPrepMin) drives the threshold —
        // not the old hardcoded 5/8-minute guess. Approaching = 70% of
        // the configured prep-time budget elapsed; breached = 100%+.
        const slaMin = o.slaPrepMin||8;
        const mins=(Date.now()-o.created_at)/60000;
        const warn = mins>=slaMin?'late':mins>=slaMin*0.7?'warn':'';
        const zoneLabel = S.lang==='ar'?o.zone_name_ar:o.zone_name_en;
        const action = nextAction[o.status];
        return `<div class="ticket ${warn}">
          <div class="trow"><span class="id">${o.id}</span><span class="timer ${warn}">${elapsedStr(o.created_at)}</span></div>
          <div class="pt">${zoneLabel?zoneLabel+' · ':''}${o.point_label||'—'}${o.isChild? ` <span class="merchant-tag" style="margin-inline-start:4px">${S.lang==='ar'?o.outletName:o.outletNameEn}</span>`:''}</div>
          <div class="items">${o.itemsSummary}</div>
          <div class="actrow">
            ${action? `<button class="action" onclick="App.opsTransition('${o.id}','${action.to}')">${action.label}</button>`:''}
            <button class="details" onclick="App.openOrderDetail('${o.id}')">${S.lang==='ar'?'التفاصيل':'Details'}</button>
          </div>
        </div>`;
      }).join('') : `<div class="kdsempty">${t('noOrders')}</div>`}
    </div>`;
  }).join('')}</div>`;
}
function renderOrderDetail(id){
  const o=(S.ops.queue||[]).find(x=>x.id===id) || (S.runnerQ||[]).find(x=>x.id===id); if(!o) return '';
  const nextByStatus = { Paid:['Accepted'], Accepted:['Preparing'], Preparing:['Ready'], Ready:['Out for Delivery','Delivered'] };
  const next = nextByStatus[o.status] || [];
  const showCancel = S.ui.cancelFor===id;
  return `<div class="ordmodal" onclick="if(event.target===this) App.closeOrderDetail()"><div class="ordsheet">
    <h3>${o.id}</h3><div class="pt">${o.point_label||'—'} · ${statusBadge(o.status)}</div>
    <div class="notebox">${o.itemsSummary}</div>
    ${showCancel? `<div class="formfield"><label>${t('cancelReason')}</label><input id="cancelReasonInput" placeholder="${S.lang==='ar'?'مثال: نفاد المنتج':'e.g. out of stock'}"></div>
      <div class="actrow"><button class="btn-secondary" onclick="App.confirmCancel('${o.id}')">${t('cancelOrder')}</button><button class="ghostbtn" onclick="App.dismissCancel()">${t('close')}</button></div>`
    : `<div class="actrow">
        ${o.status==='Paid'? `<button class="btn-primary" onclick="App.opsTransition('${o.id}','Accepted')">${t('accept')}</button>`:''}
        ${o.status==='Accepted'? `<button class="btn-primary" onclick="App.opsTransition('${o.id}','Preparing')">${t('start')}</button>`:''}
        ${o.status==='Preparing'? `<button class="btn-primary" onclick="App.opsTransition('${o.id}','Ready')">${t('markReady')}</button>`:''}
        ${o.status==='Ready'? `<button class="btn-primary" onclick="App.opsTransition('${o.id}','Out for Delivery')">${t('outForDelivery')}</button>`:''}
        ${['Paid','Accepted','Preparing'].includes(o.status)? `<button class="btn-danger-line" onclick="App.opsCancel('${o.id}')">${t('cancelOrder')}</button>`:''}
        <button class="ghostbtn" onclick="App.closeOrderDetail()">${t('close')}</button>
      </div>`}
  </div></div>`;
}

function renderRunner(){
  // UX-2 (spec R05/R06): loading vs genuinely-empty vs offline/error are
  // now three genuinely distinct states, matching the same discipline
  // already applied to the KDS board.
  if(S.runnerQ===null && !S.runnerError){
    return `<div class="panel">${[1,2].map(()=>'<div class="skeleton skeleton-card" style="height:120px;margin-bottom:12px"></div>').join('')}</div>`;
  }
  if(S.runnerQ===null && S.runnerError){
    return `<div class="statepanel offline on-dark" style="max-width:320px;margin:36px auto">
      <div class="glyph">⚠</div><h4>${S.lang==='ar'?'تعذّر تحميل الطلبات':'Could not load orders'}</h4>
      <p>${S.lang==='ar'?'تحقّق من الاتصال ثم أعد المحاولة.':'Check your connection, then try again.'}</p>
      <button class="btn-primary" style="max-width:150px;margin:14px auto 0" onclick="App.loadRunnerQueue()">${S.lang==='ar'?'إعادة المحاولة':'Retry'}</button>
    </div>`;
  }

  const staleNotice = S.runnerError ? `<div class="notebox" style="background:var(--amber-100);color:var(--amber-500);margin-bottom:12px">${S.lang==='ar'?'مشكلة اتصال — تُعرض آخر بيانات معروفة':'Connection issue — showing the last known data'}</div>` : '';
  const refreshedAgo = S.runnerLastRefresh ? Math.max(0, Math.floor((Date.now()-S.runnerLastRefresh)/1000)) : null;
  const refreshLine = refreshedAgo!=null ? `<p style="font-size:11px;color:var(--ink-300);text-align:center;margin-top:10px">${S.lang==='ar'?`آخر تحديث: قبل ${refreshedAgo} ثانية`:`Last updated ${refreshedAgo}s ago`}</p>` : '';

  if(S.runnerQ.length===0){
    return `${staleNotice}<div class="statepanel on-dark"><div class="glyph">—</div><h4>${t('noOrders')}</h4><p>${S.lang==='ar'?'سيظهر أي طلب جاهز هنا فور توفره.':'A newly ready order will appear here automatically.'}</p></div>${refreshLine}`;
  }

  // UX-2 (spec R01 hierarchy — "Destination > pickup outlet > order# >
  // wait" — the card previously showed order#+point as one equal-weight
  // line, no timer, no outlet at all). Wait time here is measured from
  // updated_at (when the order became Ready / this state last changed),
  // not created_at — what matters to a Runner is how long THIS has been
  // waiting for pickup/delivery, not the order's total age since placement.
  return staleNotice + S.runnerQ.map(o=>{
    const claimed = o.status==='Out for Delivery';
    const zoneLabel = S.lang==='ar'?o.zone_name_ar:o.zone_name_en;
    const outletLabel = o.multiOutletCount ? (S.lang==='ar'?`${o.multiOutletCount} منافذ`:`${o.multiOutletCount} outlets`) : (S.lang==='ar'?o.outletName:o.outletNameEn);
    const mins=(Date.now()-o.updated_at)/60000;
    const warn = mins>=12?'late':mins>=6?'warn':'';
    return `<div class="runnercard ${claimed?'claimed':''}">
      <div class="dest">${zoneLabel?`<span class="zone">${zoneLabel}</span>`:''}${o.point_label||'—'}</div>
      <div class="meta">
        ${outletLabel? `<span>${S.lang==='ar'?'من':'From'}: ${outletLabel}</span><span class="sep">·</span>`:''}
        <span>${o.id}</span>
      </div>
      <div class="meta">
        <span class="timer ${warn}">${elapsedStr(o.updated_at)}</span>
        ${o.itemCount? `<span class="sep">·</span><span>${o.itemCount} ${S.lang==='ar'?'عنصر':'items'}</span>`:''}
      </div>
      <div class="actrow">
        ${!claimed? `<button class="claim" onclick="App.runnerTransition('${o.id}','Out for Delivery')">${t('claim')}</button>`:''}
        ${claimed? `<button class="claim" onclick="App.runnerTransition('${o.id}','Delivered')">${t('deliverBtn')}</button>
          <button class="fail" onclick="App.runnerFailPrompt('${o.id}')">${t('failBtn')}</button>`:''}
      </div>
    </div>`;
  }).join('') + refreshLine;
}

function renderTenants(){
  const plans = S.plans || [];
  return `<div class="grid2">
    <div>
      <div class="panel"><h3>${S.lang==='ar'?'شركاء جدد':'Onboard a new tenant'}</h3>
        <p class="ph">${S.lang==='ar'?'ينشئ شريكًا + منشأة + اشتراكًا فعالاً بضغطة واحدة':'Creates a Partner + Property + active Subscription in one call'}</p>
        <div class="formgrid">
          <div class="darkfield"><label>${S.lang==='ar'?'اسم الشريك (AR)':'Partner name (AR)'}</label><input id="obNameAr" placeholder="مدينة الألعاب الذهبية"></div>
          <div class="darkfield"><label>${S.lang==='ar'?'اسم الشريك (EN)':'Partner name (EN)'}</label><input id="obNameEn" placeholder="Golden Playland"></div>
          <div class="darkfield"><label>${S.lang==='ar'?'اسم المنشأة (AR)':'Property name (AR)'}</label><input id="obPropAr" placeholder="الفرع الرئيسي"></div>
          <div class="darkfield"><label>${S.lang==='ar'?'اسم المنشأة (EN)':'Property name (EN)'}</label><input id="obPropEn" placeholder="Main Branch"></div>
          <div class="darkfield" style="grid-column:1/-1"><label>${S.lang==='ar'?'الباقة':'Plan'}</label>
            <select id="obPlan">${plans.map(p=>`<option value="${p.code}">${S.lang==='ar'?p.name_ar:p.name_en} — ${p.monthly_fee} SAR/mo</option>`).join('')}</select></div>
        </div>
        <button class="btn-small brass" onclick="App.onboardTenant()">+ ${S.lang==='ar'?'إنشاء الشريك':'Create tenant'}</button>
      </div>
    </div>
    <div class="panel"><h3>${S.lang==='ar'?'الشركاء الحاليون':'Current tenants'}</h3>
      ${(S.tenants||[]).map(pt=>{
        const sub = pt.subscription;
        return `<div class="pointrow" style="align-items:flex-start;flex-direction:column;gap:8px">
          <div style="display:flex;justify-content:space-between;width:100%;align-items:center"><b style="color:var(--cream-050)">${S.lang==='ar'?pt.name_ar:pt.name_en}</b>
          <span class="badge paid">${pt.subscription? pt.subscription.plan_code : '—'}</span>
          <button class="togglepill active" onclick="App.selectTenantForAdmin('${pt.id}')">${S.lang==='ar'?'تبديل السياق':'Switch context'}</button>
          <button class="togglepill" onclick="App.openPartnerProfile('${pt.id}')">${S.lang==='ar'?'ملف الشريك':'Partner profile'}</button></div>
          <div style="display:flex;gap:8px;align-items:center;width:100%">
            <select id="planSelect_${pt.id}" style="flex:1;background:var(--ink-800);color:var(--cream-050);border:1px solid var(--ink-700);border-radius:7px;padding:6px 8px;font-size:11.5px;">
              ${plans.map(p=>`<option value="${p.code}">${p.code} — ${p.monthly_fee} SAR/mo</option>`).join('')}
            </select>
            <button class="btn-small" onclick="App.changePlan('${pt.id}')">${S.lang==='ar'?'تغيير الباقة':'Change plan'}</button>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderBilling(){
  const sub = S.subscription; const plans = S.plans||[];
  if(!sub) return `<div class="panel"><div class="skeleton skeleton-text w40"></div><div class="skeleton skeleton-row" style="margin-top:14px"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div>`;
  const featureLabels = { qrOrdering: S.lang==='ar'?'الطلب عبر QR':'QR Ordering', digitalPayment: S.lang==='ar'?'الدفع الإلكتروني':'Digital Payment',
    partnerDashboard: S.lang==='ar'?'لوحة الشريك':'Partner Dashboard', loyalty:'Loyalty', marketplace:'Marketplace', analytics:'Analytics' };
  return `<div class="panel">
    <h3>${sub.plan_code} — ${S.lang==='ar'?sub.name_ar:sub.name_en}</h3>
    <p class="ph">${S.lang==='ar'?'الرسوم الشهرية':'Monthly fee'}: ${money(sub.monthly_fee)} SAR · ${S.lang==='ar'?'رسم تقني':'Tech fee'}: ${Math.round(sub.tech_fee_rate*100)}% · <span class="badge paid">${sub.status}</span></p>
    <div class="section-sm">${S.lang==='ar'?'المزايا المفعّلة':'Enabled capabilities'}</div>
    ${Object.entries(sub.features).map(([k,v])=>`<div class="prodlistrow"><div class="nm">${featureLabels[k]||k}</div><span class="togglepill ${v?'active':'inactive'}">${v?t('active'):t('inactive')}</span></div>`).join('')}
  </div>`;
}

function renderAdminZones(){
  const tenantNote = S.session.user.role==='SuperAdmin'
    ? `<div class="notebox" style="background:var(--ink-800);color:var(--brass-300)">${S.lang==='ar'?'تُدار الآن منشأة':'Currently managing property'}: <b>${S.PROPERTY_ID}</b> — ${S.lang==='ar'?'اختر شريكًا آخر من تبويب "الشركاء والباقات"':'pick another tenant from the "Tenants & Plans" tab'}</div>` : '';
  const zoneOpts = S.admin.zones.map(z=>`<option value="${z.id}">${S.lang==='ar'?z.name_ar:z.name_en}</option>`).join('');
  return `${tenantNote}<div class="grid2"><div>
    <div class="panel"><h3>${t('addZone')}</h3>
      <div class="formgrid">
        <div class="darkfield"><label>${t('zoneName')}</label><input id="zoneAr" placeholder="اللوبي"></div>
        <div class="darkfield"><label>${t('zoneNameEn')}</label><input id="zoneEn" placeholder="Lobby"></div>
        <div class="darkfield"><label>${t('zoneType')}</label><select id="zoneType"><option>Lounge</option><option>Leisure</option><option>Business</option><option>Guest Room</option></select></div>
      </div><button class="btn-small brass" onclick="App.addZone()">+ ${t('addZone')}</button>
      <div class="section-sm">${t('existingZones')}</div>
      ${S.admin.zones.map(z=>`<div class="pointrow"><div class="meta">
        <b>${S.lang==='ar'?z.name_ar:z.name_en} <span class="badge ${z.status==='Inactive'?'cancel':'ok'}">${z.status==='Inactive'?(S.lang==='ar'?'معطّلة':'Inactive'):(S.lang==='ar'?'فعّالة':'Active')}</span></b>
        <span>${z.type} · ${z.id}</span></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${z.status==='Inactive'
            ? `<button class="btn-small brass" onclick="App.setZoneStatus('${z.id}','Active')">${S.lang==='ar'?'إعادة تفعيل':'Reactivate'}</button>`
            : `<button class="btn-small" style="color:var(--red-500);border-color:var(--red-500)" onclick="App.setZoneStatus('${z.id}','Inactive')">${S.lang==='ar'?'تعطيل':'Deactivate'}</button>`}
          <button class="btn-small" onclick="App.openBulkPoints('${z.id}')">${S.lang==='ar'?'توليد QR بالجملة':'Bulk QR'}</button>
        </div></div>`).join('')}
      <p class="ph" style="margin-top:8px">${S.lang==='ar'?'تعطيل المنطقة يمنع الرحلات الجديدة عبرها فقط — الطلبات القائمة تُكمل، ولا يُحذف أي شيء.':'Deactivating a zone only blocks new journeys through it — open orders continue and nothing is deleted.'}</p>
    </div>
    <div class="panel"><h3>${t('addPoint')}</h3>
      <div class="formgrid">
        <div class="darkfield"><label>${S.lang==='ar'?'المنطقة':'Zone'}</label><select id="pointZone">${zoneOpts}</select></div>
        <div class="darkfield"><label>${t('pointType')}</label><select id="pointType"><option>Table</option><option>Room</option><option>Seat</option><option>Office</option><option>Area</option></select></div>
        <div class="darkfield" style="grid-column:1/-1"><label>${t('pointCode')}</label><input id="pointLabel" placeholder="Table 24"></div>
      </div><button class="btn-small brass" onclick="App.addPoint()">+ ${t('addPoint')}</button>
    </div>
    <div class="panel"><h3>${S.lang==='ar'?'توليد رموز QR بالجملة':'Bulk generate QR codes'}</h3>
      <p class="ph">${S.lang==='ar'?'لطباعة عدة نقاط دفعة واحدة (مثال: 20 طاولة تراس)':'Print several points at once (e.g. 20 terrace tables)'}</p>
      <div class="formgrid">
        <div class="darkfield"><label>${S.lang==='ar'?'المنطقة':'Zone'}</label><select id="bulkZone">${zoneOpts}</select></div>
        <div class="darkfield"><label>${S.lang==='ar'?'نوع الرمز':'QR type'}</label>
          <select id="bulkType"><option value="table">Table</option><option value="office">Office</option><option value="room">Room</option><option value="zone">Zone</option><option value="counter_pickup">Counter Pickup</option></select>
        </div>
        <div class="darkfield"><label>${S.lang==='ar'?'العدد (حتى 50)':'Count (up to 50)'}</label><input id="bulkCount" type="number" value="10" max="50" min="1"></div>
        <div class="darkfield"><label>${S.lang==='ar'?'بادئة الاسم':'Label prefix'}</label><input id="bulkPrefix" placeholder="Terrace Table"></div>
      </div>
      <button class="btn-small brass" onclick="App.bulkGenerateQr()">${S.lang==='ar'?'توليد':'Generate'}</button>
    </div></div>
    <div class="panel"><h3>${t('existingPoints')}</h3>
      ${S.admin.points.map(p=>{
        const z=S.admin.zones.find(zz=>zz.id===p.zone_id);
        return `<div class="pointrow"><div class="qrmini">${Array.from({length:36}).map((_,i)=>{
            const h=((p.token||'0').charCodeAt(i%(p.token||'0').length)+i*7)%5; return `<div class="${h===0?'off':''}"></div>`; }).join('')}</div>
          <div class="meta"><b>${p.label} — ${z?(S.lang==='ar'?z.name_ar:z.name_en):''}</b><span>${p.id} · token:${p.token}</span></div>
          <button class="btn-small line" style="margin-inline-end:6px" onclick="App.viewQrAnalytics('${p.id}')">${S.lang==='ar'?'تحليلات':'Analytics'}</button>
          <button class="togglepill ${p.active?'active':'inactive'}" onclick="App.togglePoint('${p.id}',${!!p.active})">${p.active?t('active'):t('inactive')}</button></div>`;
      }).join('')}
    </div></div>
    ${S.ui.qrAnalyticsFor? renderQrAnalyticsModal():''}`;
}

function renderQrAnalyticsModal(){
  const d = S.ui.qrAnalyticsData;
  const fmtTime = (ts) => ts ? new Date(ts).toLocaleString(S.lang==='ar'?'ar-SA':'en-US') : (S.lang==='ar'?'لا يوجد بعد':'None yet');
  return `<div class="ordmodal" onclick="if(event.target===this) App.closeQrAnalytics()"><div class="ordsheet">
    <h3 style="font-family:inherit">${S.lang==='ar'?'تحليلات رمز QR':'QR Analytics'}</h3>
    <div class="pt">${S.ui.qrAnalyticsFor}</div>
    ${!d? `<div class="kpirow" style="margin-bottom:0">${[1,2,3].map(()=>'<div class="skeleton skeleton-kpi"></div>').join('')}</div>` : `
      <div class="kpirow" style="margin-bottom:0">
        <div class="kpi"><div class="lbl">${S.lang==='ar'?'مسح':'Scans'}</div><div class="val">${d.scans}</div></div>
        <div class="kpi"><div class="lbl">${S.lang==='ar'?'طلبات':'Orders'}</div><div class="val">${d.orders}</div></div>
        <div class="kpi"><div class="lbl">${S.lang==='ar'?'التحويل':'Conversion'}</div><div class="val">${d.conversionRate}%</div></div>
        <div class="kpi"><div class="lbl">${S.lang==='ar'?'المبيعات':'Sales'}</div><div class="val">${money(d.totalSales)}</div></div>
      </div>
      <div class="notebox" style="margin-top:14px">${S.lang==='ar'?'آخر مسح':'Last scan'}: ${fmtTime(d.lastScan)}<br>${S.lang==='ar'?'آخر طلب':'Last order'}: ${fmtTime(d.lastOrder)}</div>
    `}
    <div class="actrow"><button class="ghostbtn" onclick="App.closeQrAnalytics()">${t('close')}</button></div>
  </div></div>`;
}

function renderAdminCatalog(){
  return `<div class="grid2"><div>
    <div class="panel"><h3>${t('addCat')}</h3>
      <div class="formgrid"><div class="darkfield"><label>${t('catName')}</label><input id="catAr" placeholder="مشروبات باردة"></div>
      <div class="darkfield"><label>${t('catNameEn')}</label><input id="catEn" placeholder="Cold Drinks"></div></div>
      <button class="btn-small brass" onclick="App.addCategory()">+ ${t('addCat')}</button></div>
    <div class="panel"><h3>${t('addProd')}</h3>
      <div class="formgrid">
        <div class="darkfield"><label>${t('prodName')}</label><input id="prodAr" placeholder="آيس لاتيه"></div>
        <div class="darkfield"><label>${t('prodNameEn')}</label><input id="prodEn" placeholder="Iced Latte"></div>
        <div class="darkfield"><label>${t('prodPrice')}</label><input id="prodPrice" type="number" placeholder="20"></div>
        <div class="darkfield"><label>${t('prodCat')}</label><select id="prodCatSel">${S.admin.categories.map(c=>`<option value="${c.id}">${S.lang==='ar'?c.name_ar:c.name_en}</option>`).join('')}</select></div>
      </div><button class="btn-small brass" onclick="App.addProduct()">+ ${t('addProd')}</button></div>
    </div>
    <div class="panel"><h3>${t('currentCatalog')}</h3>
      ${S.admin.categories.map(c=>`<div class="section-sm">${S.lang==='ar'?c.name_ar:c.name_en}</div>
        ${S.admin.products.filter(p=>p.category_id===c.id).map(p=>`
          <div class="prodlistrow"><div class="nm">${S.lang==='ar'?p.name_ar:p.name_en}</div>
          <button class="togglepill ${p.status==='Active'?'active':'inactive'}" onclick="App.toggleProdStatus('${p.id}','${p.status}')">${p.status==='Active'?t('active'):t('inactive')}</button></div>`).join('')}`).join('')}
    </div></div>`;
}

function renderAudit(){
  return `<div class="panel"><table class="datatable"><tr><th>Actor</th><th>Role</th><th>Action</th><th>Entity</th><th>When</th></tr>
    ${S.audit.map(a=>`<tr><td>${a.actor}</td><td>${a.role}</td><td>${a.action}</td><td style="font-family:var(--mono)">${a.entity}</td><td>${new Date(a.ts).toLocaleString(S.lang==='ar'?'ar-SA':'en-US')}</td></tr>`).join('')}
  </table></div>`;
}

// F04: شاشة إدارة الباقات (SuperAdmin) — تُغلق الفجوة التي جعلت إنشاء أول
// باقة مستحيلًا من الواجهة رغم وجود الـAPI.
// §3.3 — شاشات ProductAdmin و SafetyReviewer.
// مبدأ حاكم: لا يظهر أي إجراء لا تسمح به APIs الحالية لهذا الدور. الإخفاء
// ليس حماية (الخادم يفرض RBAC)، لكن إظهار زر يفشل حتمًا تجربة سيئة وتضليل.
/* ===================== R2 §1/§2 — Engage Governance ======================
   مبدأ حاكم: الواجهة تعكس RBAC ولا تتجاوزه. مفتاح الإيقاف العام يظهر
   لـSuperAdmin فقط لأن الخادم يحصره به؛ والشريك يرى **أثره** عليه بلغة
   أعمال دون زر يفشل. */

// بطاقة الحالة الفعّالة — مشتركة بين SuperAdmin والشريك، بمستوى تفصيل مختلف.
function engageEffectiveCard(st, isPartnerView){
  const L=(ar,en)=>S.lang==='ar'?ar:en;
  if(st===null) return '<div class="panel"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div>';
  if(st.error) return `<div class="panel"><div class="statepanel on-dark"><div class="glyph">⚠</div><h4>${L('تعذّر قراءة الحالة','Could not read state')}</h4></div></div>`;

  // سبب المنع بلغة أعمال — لا أسماء أعلام ولا نقاط برمجية (§13)
  const REASON = {
    not_in_plan:            L('غير متاح في الباقة الحالية','Not included in the current plan'),
    subscription_inactive:  L('الاشتراك غير فعّال','Subscription is not active'),
    global_kill_switch:     L('موقوف على مستوى المنصة من قِبل النادل','Paused platform-wide by ALNADL'),
    scope_override:         L('مُقيَّد على مستوى العقار أو المنطقة','Restricted at property or zone level'),
  };
  const on = st.effective === true;
  const lay = st.layers || {};
  const row = (label, ok, note) => `<div class="totalline" style="color:var(--ink-200)">
      <span>${label}</span>
      <span style="display:flex;align-items:center;gap:7px">
        ${note?`<span class="ph" style="font-size:11px">${note}</span>`:''}
        <span class="badge ${ok?'ok':'cancel'}">${ok?L('نعم','Yes'):L('لا','No')}</span>
      </span></div>`;

  return `
  <div class="panel">
    <h3>${L('حالة Engage الفعّالة','Effective Engage State')}</h3>
    <div class="attentionrow ${on?'':'high'}" style="background:${on?'var(--sage-100)':'var(--red-100)'};margin-bottom:14px">
      <span class="dot" style="background:${on?'var(--sage-500)':'var(--red-500)'}"></span>
      <span class="txt" style="color:${on?'#20452F':'#5E1F1B'}">
        <b>${on?L('مُفعّل','Active'):L('غير مُفعّل','Not active')}</b>
        ${!on && st.blockedBy ? ' — ' + (REASON[st.blockedBy]||st.blockedBy) : ''}
      </span>
    </div>
    ${row(L('مشمول في الباقة','Included in plan'), lay.plan && lay.plan.entitlement, lay.plan && lay.plan.code)}
    ${row(L('الاشتراك فعّال','Subscription active'), lay.subscription && lay.subscription.active, lay.subscription && lay.subscription.status)}
    ${row(L('مسموح على مستوى المنصة','Allowed platform-wide'), lay.globalKillSwitch && lay.globalKillSwitch.allowed,
          isPartnerView ? L('يتحكم به النادل','Controlled by ALNADL') : '')}
    ${(lay.scopeOverrides && lay.scopeOverrides.length)
      ? `<div style="margin-top:12px">
          <label style="display:block;font-size:12px;font-weight:700;color:var(--ink-300);margin-bottom:6px">${L('تقييدات النطاق','Scope restrictions')}</label>
          ${lay.scopeOverrides.map(o=>`<div class="attentionrow ${o.enabled?'medium':'high'}">
            <span class="dot"></span>
            <span class="txt">${o.scopeType==='property'?L('عقار','Property'):L('منطقة','Zone')}: ${esc(o.scopeId)}</span>
            <span class="sev">${o.enabled?L('مسموح','Allowed'):L('موقوف','Paused')}</span>
          </div>`).join('')}
        </div>`
      : `<p class="ph" style="margin-top:10px">${L('لا توجد تقييدات على مستوى العقار أو المنطقة','No property or zone restrictions')}</p>`}
  </div>`;
}

// §1 — مركز تحكم Engage لـSuperAdmin
/* R2 §3 — Partner Control Center.
   صفحة واحدة تجمع كل ما يخصّ شريكًا بعينه من نقاط قائمة أصلًا. لم تُبنَ
   أي واجهة برمجية جديدة؛ ولا يُخترع أي حقل غير موجود في المخطط -- ما لا
   تُرجعه البيانات يظهر كشرطة، لا كصفر مضلِّل. */
/* R3 §1/§2 — استثناءات الموقع لـSiteManager.
   المبدأ: كشف قدرة خلفية مسموحة له اليوم، بلا أي توسيع صلاحية ودون
   تحويله إلى PartnerAdmin. كل عنصر هنا **يحتاج إجراءً** -- الشاشة ليست
   عرض بيانات إضافيًا، فاللوحة الحية تغطي ذلك أصلًا. */
function renderSiteExceptions(){
  const L=(ar,en)=>S.lang==='ar'?ar:en;
  const ex = S.siteExceptions;
  if(!ex || ex.loading) return '<div class="panel"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div>';

  const err = o => o && o.__error;
  const queue = err(ex.queue) ? [] : (ex.queue || []);
  const notifs = err(ex.notifications) ? [] : (ex.notifications || []);

  // ما يحتاج إجراءً فعلًا: طلبات تجاوزت مهلة منفذها، وطلبات تعذّر تسليمها.
  const now = Date.now();
  const breached = queue.filter(o => {
    const budget = o.slaPrepMin || 8;
    return ['Paid','Accepted','Preparing'].includes(o.status) && (now - o.created_at)/60000 > budget;
  });
  const failedDelivery = queue.filter(o => o.status === 'Delivery Failed');
  // ملاحظة تصميم: لا يوجد قسم "قابل للاسترجاع" مبني على الطابور.
  // /api/ops/queue يستثني Delivered بحكم تعريفه، فقائمة كهذه لا يمكن أن
  // تمتلئ أبدًا -- زر معطّل بنيويًا. كشفه التحقق البصري، واستُبدل ببحث
  // برقم الطلب وهو المسار الواقعي: الاسترجاع يبدأ من شكوى تحمل رقمًا.

  const failedModules = [err(ex.queue) && L('الطابور','Queue'), err(ex.notifications) && L('التنبيهات','Notifications')].filter(Boolean);

  const card = (title, items, body) => `
    <div class="panel">
      <h3>${title} <span class="cnt">${items.length}</span></h3>
      ${items.length ? body : `<div class="statepanel on-dark" style="padding:16px 8px"><div class="glyph" style="color:var(--sage-500)">✓</div><p>${L('لا شيء يحتاج إجراءً','Nothing needs action')}</p></div>`}
    </div>`;

  return `
  ${failedModules.length ? `<div class="notebox" style="background:var(--amber-100);color:var(--amber-500)">
    <b>${L('تعذّر تحميل','Could not load')}:</b> ${failedModules.join(' · ')} — ${L('بقية الشاشة سليمة.','the rest of the screen is intact.')}
  </div>`:''}

  ${card(L('تجاوز المهلة الآن','Past SLA right now'), breached,
    `<table class="datatable"><tr><th>${L('الطلب','Order')}</th><th>${L('الموقع','Location')}</th><th>${L('منذ','Elapsed')}</th><th>${L('الحالة','Status')}</th></tr>
      ${breached.map(o=>`<tr><td>${esc(o.id)}</td>
        <td>${esc((S.lang==='ar'?o.zone_name_ar:o.zone_name_en)||'')} · ${esc(o.point_label||'—')}</td>
        <td><span class="badge cancel">${elapsedStr(o.created_at)}</span></td>
        <td>${esc(o.status)}</td></tr>`).join('')}</table>`)}

  ${card(L('تعذّر التسليم','Failed deliveries'), failedDelivery,
    `<table class="datatable"><tr><th>${L('الطلب','Order')}</th><th>${L('الموقع','Location')}</th><th></th></tr>
      ${failedDelivery.map(o=>`<tr><td>${esc(o.id)}</td>
        <td>${esc(o.point_label||'—')}</td>
        <td><button class="btn-small" onclick="App.openRefund('${esc(o.id)}')">${L('استرجاع','Refund')}</button></td></tr>`).join('')}</table>`)}

  <div class="panel">
    <h3>${L('استرجاع طلب','Refund an order')}</h3>
    <p class="ph">${L('الاسترجاع يخصّ طلبًا مكتملًا، وهو بطبيعته خارج طابور التشغيل — لذا يُفتح برقم الطلب لا من قائمة.','A refund concerns a completed order, which by definition has already left the operations queue — so it is opened by order number rather than from a list.')}</p>
    <div class="formfield"><label>${L('رقم الطلب','Order number')}</label>
      <input id="rfLookup" placeholder="ORD-1801" onkeydown="if(event.key==='Enter') App.openRefund(this.value.trim())"></div>
    <div class="actrow"><button class="btn-small brass" onclick="App.openRefund(document.getElementById('rfLookup').value.trim())">${L('فتح الاسترجاع','Open refund')}</button></div>
  </div>

  <div class="panel">
    <h3>${L('تنبيهات الموقع','Site Notifications')}</h3>
    <p class="ph">${L('آخر ما أرسله النظام — للاطلاع، لا يحتاج إجراءً بذاته','Latest system notifications — informational, no action required by themselves')}</p>
    ${notifs.length ? `<table class="datatable"><tr><th>${L('الحدث','Event')}</th><th>${L('الطلب','Order')}</th><th>${L('الوقت','When')}</th></tr>
      ${notifs.slice(0,25).map(n=>`<tr><td>${esc(n.event||n.type||'')}</td><td>${esc(n.order_id||'—')}</td>
        <td>${n.created_at?new Date(n.created_at).toLocaleString(S.lang==='ar'?'ar':'en'):'—'}</td></tr>`).join('')}</table>`
      : `<div class="statepanel on-dark" style="padding:16px 8px"><div class="glyph">—</div><p>${L('لا تنبيهات','No notifications')}</p></div>`}
  </div>`;
}

/* نافذة الاسترجاع — عملية مالية، فتأكيد صريح ومنع إرسال مزدوج.
   مفتاح idempotency يُولَّد عند الفتح ويُرسل مع الطلب: إعادة الضغط تُعيد
   النتيجة الأصلية من الخادم بدل تنفيذ استرجاع ثانٍ. */
function renderRefundModal(){
  const L=(ar,en)=>S.lang==='ar'?ar:en;
  const r = S.ui.refundFor; if(!r) return '';
  const hist = S.orderRefunds && S.orderRefunds.orderId === r.orderId ? S.orderRefunds.rows : null;
  const already = (hist||[]).reduce((a,x)=>a+(x.amount||0),0);

  return `<div class="ordmodal" onclick="if(event.target===this) App.dismissRefund()"><div class="ordsheet">
    <h3>${L('استرجاع','Refund')} — ${esc(r.orderId)}</h3>
    <div class="notebox" style="background:var(--amber-100);color:var(--amber-500);margin:10px 0">
      ${L('عملية مالية لا تُلغى تلقائيًا. تأكّد من المبلغ والسبب قبل التنفيذ.','A financial operation that is not automatically reversible. Confirm the amount and reason before proceeding.')}
    </div>

    ${hist===null ? '<div class="skeleton skeleton-row"></div>'
      : hist.length ? `<div style="margin-bottom:12px">
          <label style="display:block;font-size:12px;font-weight:700;color:var(--ink-300);margin-bottom:6px">${L('استرجاعات سابقة','Previous refunds')}</label>
          <table class="datatable"><tr><th>${L('المبلغ','Amount')}</th><th>${L('النوع','Type')}</th><th>${L('بواسطة','By')}</th></tr>
          ${hist.map(x=>`<tr><td>${money(x.amount||0)}</td><td>${esc(x.type||'')}</td><td>${esc(x.actor||'')}</td></tr>`).join('')}</table>
          <p class="ph" style="margin-top:6px">${L('إجمالي ما استُرجع','Already refunded')}: ${money(already)}</p>
        </div>`
      : `<p class="ph" style="margin-bottom:12px">${L('لا استرجاعات سابقة على هذا الطلب','No previous refunds on this order')}</p>`}

    <div class="formfield"><label>${L('المبلغ (اتركه فارغًا لاسترجاع كامل)','Amount (leave empty for a full refund)')}</label>
      <input id="rfAmount" type="number" step="0.01" placeholder="${L('كامل','Full')}"></div>
    <div class="formfield"><label>${L('السبب (مطلوب)','Reason (required)')}</label>
      <input id="rfReason" placeholder="${L('سبب الاسترجاع','Reason for the refund')}"></div>

    ${r.error ? `<div class="errbox" style="margin-top:10px">${esc(r.error)}</div>`:''}

    <div class="actrow">
      <button class="btn-danger-line" onclick="App.submitRefund()" ${r.submitting?'disabled':''}>
        ${r.submitting ? L('جارٍ التنفيذ…','Processing…') : L('تأكيد الاسترجاع','Confirm refund')}
      </button>
      <button class="ghostbtn" onclick="App.dismissRefund()" ${r.submitting?'disabled':''}>${t('close')}</button>
    </div>
  </div></div>`;
}

/* Corrective — حالة الشريك وإجراءات الانتقال داخل ملف الشريك.
   لا يُعرض إلا ما تُرجعه allowedTransitions من الخادم: الخيار المحجوب
   (مثل الإغلاق مع طلبات مفتوحة) لا يظهر كزر يفشل، بل يُصرَّح بسببه. */
/* G4 — سياسة تجميع التسليم على العقار.
   النقطة PATCH /api/admin/properties/:id موجودة منذ Q01 وبعزل مُثبَت،
   ولم يكن لها أي مرجع في الواجهة -- قرار تشغيلي حقيقي محجوب. تُستخدم
   النقطة نفسها بلا منطق موازٍ. */
function renderDeliveryGrouping(partnerId, L){
  const props = (S.properties || []).filter(x => x.partner_id === partnerId);
  if(!props.length) return '';
  return `<div style="margin-top:12px">
    <label style="display:block;font-size:12px;font-weight:700;color:var(--ink-300);margin-bottom:6px">${L('سياسة التسليم','Delivery policy')}</label>
    ${props.map(pr=>`<div class="totalline" style="color:var(--ink-200)">
      <span>${esc(S.lang==='ar'?pr.name_ar:pr.name_en)}</span>
      <span style="display:flex;gap:6px">
        <button class="btn-small ${pr.delivery_grouping!=='separate'?'brass':''}" onclick="App.setDeliveryGrouping('${esc(pr.id)}','grouped')">${L('مُجمَّع','Grouped')}</button>
        <button class="btn-small ${pr.delivery_grouping==='separate'?'brass':''}" onclick="App.setDeliveryGrouping('${esc(pr.id)}','separate')">${L('منفصل','Separate')}</button>
      </span></div>`).join('')}
    <p class="ph" style="margin-top:6px">${L('المُجمَّع: الراكض يستلم كل شيء بعد جهوزية الجميع. المنفصل: كل منفذ يُسلَّم فور جهوزيته.','Grouped: the runner collects everything once all outlets are ready. Separate: each outlet is delivered as soon as it is ready.')}</p>
  </div>`;
}

/* P0-02 — تسليم رابط التفعيل. يُعرض **مرة واحدة**: الرمز مُخزَّن مُجزَّأً
   على الخادم ولا يمكن استرجاعه بعد إغلاق النافذة -- وهذا مقصود، والبديل
   الوحيد هو إعادة إصدار رمز جديد. */
function renderActivationHandoff(){
  const L=(ar,en)=>S.lang==='ar'?ar:en;
  const st = S.ui.activationHandoff; if(!st) return '';
  if(!st.token) return '';
  const exp = st.expiresAt ? new Date(st.expiresAt).toLocaleString(S.lang==='ar'?'ar':'en') : '—';
  return `<div class="ordmodal" onclick="if(event.target===this) App.dismissActivationHandoff()"><div class="ordsheet">
    <h3>${st.reissued ? L('رابط تفعيل جديد','New activation link') : L('تم إنشاء الحساب','Account created')} — ${esc(st.username)}</h3>
    <div class="notebox" style="background:var(--amber-100);color:var(--amber-500);margin:10px 0">
      ${L('هذا الرابط يظهر مرة واحدة فقط ولا يمكن استرجاعه. انسخه وسلّمه للمستخدم الآن.','This link is shown once and cannot be retrieved later. Copy it and hand it over now.')}
    </div>
    ${st.reissued ? `<p class="ph">${L('أي رابط سابق أُبطل، وكلمة المرور الحالية لم تعد صالحة.','Any earlier link is now void, and the current password no longer works.')}</p>`:''}
    <div class="formfield"><label>${L('رابط التفعيل','Activation link')}</label>
      <input id="actLink" readonly value="${esc(st.url)}" onclick="this.select()"></div>
    <p class="ph">${L('صالح حتى','Valid until')}: ${exp}</p>
    <p class="ph">${L('المستخدم يفتح الرابط ويضع كلمة مروره بنفسه — لا أحد غيره يعرفها.','The user opens the link and sets their own password — nobody else knows it.')}</p>
    <div class="actrow">
      <button class="btn-small brass" onclick="App.copyActivationLink()">${L('نسخ الرابط','Copy link')}</button>
      <button class="ghostbtn" onclick="App.dismissActivationHandoff()">${t('close')}</button>
    </div>
  </div></div>`;
}

function renderPartnerStatusCard(partnerId){
  const L=(ar,en)=>S.lang==='ar'?ar:en;
  const st = S.partnerStatusInfo;
  if(!st || st.partnerId !== partnerId) return '<div class="panel"><div class="skeleton skeleton-row"></div></div>';
  if(st.error) return `<div class="panel"><p class="ph">${L('تعذّر قراءة الحالة','Could not read status')}</p></div>`;

  const LABEL = { Draft:L('مسودة','Draft'), Active:L('فعّال','Active'),
                  Suspended:L('موقوف','Suspended'), Closed:L('مُغلق','Closed') };
  const TONE = { Draft:'pending', Active:'ok', Suspended:'cancel', Closed:'cancel' };
  const BLOCK = { PARTNER_HAS_OPEN_ORDERS: L('توجد طلبات مفتوحة','Open orders exist') };
  const allowed = st.allowedTransitions || [];
  const blocked = st.blockedTransitions || [];

  return `
  <div class="panel">
    <h3>${L('حالة الشريك','Partner Status')}</h3>
    <div class="totalline" style="color:var(--ink-200)">
      <span>${L('الحالة الحالية','Current status')}</span>
      <span><span class="badge ${TONE[st.status]||'pending'}">${LABEL[st.status]||esc(st.status)}</span></span>
    </div>
    ${st.status==='Draft' ? `<div class="notebox" style="background:var(--amber-100);color:var(--amber-500);margin-top:10px">
      ${L('هذا الشريك في مرحلة الإعداد ولم يُفعَّل بعد: رمز QR لا يُحلّ ولا يُقبل أي طلب. فعّله عند اكتمال الإعداد.','This partner is still in setup and not live: the QR does not resolve and no order is accepted. Activate it once setup is complete.')}
    </div>`:''}
    ${typeof st.openOrders === 'number' ? `<div class="totalline" style="color:var(--ink-200)">
      <span>${L('طلبات مفتوحة','Open orders')}</span><span>${st.openOrders}</span></div>`:''}

    ${allowed.length ? `<div class="actrow" style="flex-wrap:wrap">
      ${allowed.map(to=>`<button class="btn-small ${to==='Active'?'brass':''}"
        ${to==='Closed'?'style="color:var(--red-500);border-color:var(--red-500)"':''}
        onclick="App.openStatusChange('${esc(partnerId)}','${esc(to)}')">
        ${L('تحويل إلى','Move to')} ${LABEL[to]||esc(to)}</button>`).join('')}
    </div>`:`<p class="ph" style="margin-top:10px">${L('لا انتقالات متاحة الآن','No transitions available right now')}</p>`}

    ${blocked.length ? `<div style="margin-top:10px">
      ${blocked.map(b=>`<div class="attentionrow medium"><span class="dot"></span>
        <span class="txt">${L('محجوب','Blocked')}: ${LABEL[b.to]||esc(b.to)} — ${BLOCK[b.code]||esc(b.code||'')}${b.openOrders?` (${b.openOrders})`:''}</span>
        <span class="sev">${L('شرط','Precondition')}</span></div>`).join('')}
    </div>`:''}
  </div>`;
}

/* نافذة تأكيد الانتقال -- تغيير حالة الشريك يوقف أو يفتح أعمالًا، فيُؤكَّد صراحةً. */
function renderStatusChangeModal(){
  const L=(ar,en)=>S.lang==='ar'?ar:en;
  const c = S.ui.statusChange; if(!c) return '';
  const LABEL = { Draft:L('مسودة','Draft'), Active:L('فعّال','Active'),
                  Suspended:L('موقوف','Suspended'), Closed:L('مُغلق','Closed') };
  const EFFECT = {
    Active: L('سيبدأ قبول الطلبات ويعمل رمز QR.','Ordering starts and the QR begins resolving.'),
    Suspended: L('سيتوقف قبول الطلبات الجديدة، وتُكمل الطلبات المفتوحة، وتبقى التسويات متاحة.','New orders stop, open orders continue to completion, and settlements remain available.'),
    Closed: L('إغلاق تشغيلي دائم. لا دخول ولا طلبات — والتاريخ المالي والتدقيق يبقى كاملًا.','Permanent operational closure. No login and no orders — the full financial history and audit are retained.'),
    Draft: L('عودة إلى مرحلة الإعداد.','Back to the setup stage.'),
  };
  return `<div class="ordmodal" onclick="if(event.target===this) App.dismissStatusChange()"><div class="ordsheet">
    <h3>${L('تحويل الحالة إلى','Move status to')} ${LABEL[c.to]||esc(c.to)}</h3>
    <div class="notebox" style="background:var(--amber-100);color:var(--amber-500);margin:10px 0">${EFFECT[c.to]||''}</div>
    <div class="formfield"><label>${L('السبب (مطلوب)','Reason (required)')}</label>
      <input id="scReason" placeholder="${L('سبب التغيير — يُسجَّل في التدقيق','Reason — recorded in the audit log')}"></div>
    ${c.error ? `<div class="errbox" style="margin-top:10px">${esc(c.error)}</div>`:''}
    <div class="actrow">
      <button class="${c.to==='Closed'?'btn-danger-line':'btn-small brass'}" onclick="App.submitStatusChange()" ${c.submitting?'disabled':''}>
        ${c.submitting ? L('جارٍ التنفيذ…','Processing…') : L('تأكيد','Confirm')}</button>
      <button class="ghostbtn" onclick="App.dismissStatusChange()" ${c.submitting?'disabled':''}>${t('close')}</button>
    </div>
  </div></div>`;
}

function renderPartnerProfile(){
  const L=(ar,en)=>S.lang==='ar'?ar:en;
  const pf = S.partnerProfile;
  if(!pf) return `<div class="statepanel on-dark"><div class="glyph">—</div><h4>${L('لم يُختَر شريك','No partner selected')}</h4><p>${L('افتح ملف شريك من شاشة الشركاء والباقات.','Open a partner profile from the Tenants & Plans screen.')}</p></div>`;
  if(pf.loading) return kpiDashboardSkeleton(4) + '<div class="panel"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div>';

  const partner = (S.tenants||[]).find(x=>x.id===pf.partnerId) || {};
  const err = o => o && o.__error;
  const ov = err(pf.overview) ? null : pf.overview;
  const sub = err(pf.subscription) ? null : pf.subscription;
  const eng = err(pf.engage) ? null : pf.engage;

  // كل قائمة تُصفّى لهذا الشريك — لا تسريب بيانات شريك آخر في الصفحة
  const users = err(pf.users) ? [] : (pf.users||[]).filter(u=>u.partner_scope===pf.partnerId);
  const zones = err(pf.zones) ? [] : (pf.zones||[]);
  const outlets = err(pf.outlets) ? [] : (pf.outlets||[]);
  const settlements = err(pf.settlements) ? [] : (pf.settlements||[]).filter(x=>x.partner_id===pf.partnerId);

  // وحدة فشلت؟ تُعلَن باسمها بدل رسالة خطأ عامة تُسقط الصفحة (§13)
  const failed = [
    err(pf.overview) && L('الأداء','Performance'), err(pf.subscription) && L('الاشتراك','Subscription'),
    err(pf.users) && L('المستخدمون','Users'), err(pf.zones) && L('المناطق','Zones'),
    err(pf.outlets) && L('المنافذ','Outlets'), err(pf.settlements) && L('التسويات','Settlements'),
    err(pf.engage) && 'Engage',
  ].filter(Boolean);

  const money2s = v => v==null ? '—' : money(v);
  const line = (k,v) => `<div class="totalline" style="color:var(--ink-200)"><span>${k}</span><span>${v}</span></div>`;

  return `
  <div class="panel" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <div style="flex:1;min-width:180px">
      <h3 style="margin:0">${esc(S.lang==='ar'?partner.name_ar:partner.name_en)||pf.partnerId}</h3>
      <p class="ph" style="margin:2px 0 0">${esc(pf.partnerId)}</p>
    </div>
    <button class="btn-small" onclick="App.setStaffScreen('tenants')">${L('عودة للشركاء','Back to partners')}</button>
  </div>

  ${failed.length ? `<div class="notebox" style="background:var(--amber-100);color:var(--amber-500)">
    <b>${L('تعذّر تحميل بعض الوحدات','Some modules could not load')}:</b> ${failed.join(' · ')}
    — ${L('بقية الصفحة سليمة.','the rest of the page is intact.')}
  </div>`:''}

  <!-- Overview -->
  <div class="kpirow">
    <div class="kpi"><div class="lbl">${L('مبيعات اليوم','Sales today')}</div><div class="val">${ov&&ov.today?money2s(ov.today.grossSales):'—'}</div><div class="sub">SAR</div></div>
    <div class="kpi"><div class="lbl">${L('طلبات اليوم','Orders today')}</div><div class="val">${ov&&ov.today?ov.today.orders:'—'}</div></div>
    <div class="kpi"><div class="lbl">${L('منافذ نشطة','Active outlets')}</div><div class="val">${ov&&ov.today?ov.today.activeOutlets:'—'}</div></div>
    <div class="kpi"><div class="lbl">${L('تنبيهات','Attention')}</div><div class="val" style="color:${ov&&ov.attention&&ov.attention.length?'var(--red-500)':'inherit'}">${ov&&ov.attention?ov.attention.length:'—'}</div></div>
  </div>

  ${renderPartnerStatusCard(pf.partnerId)}

  <div class="grid2">
    <!-- Plan / Subscription -->
    <div class="panel"><h3>${L('الباقة والاشتراك','Plan & Subscription')}</h3>
      ${sub ? `
        ${line(L('الباقة','Plan'), esc(sub.planCode||sub.code||'—'))}
        ${line(L('الحالة','Status'), `<span class="badge ${sub.status==='Active'?'ok':'cancel'}">${esc(sub.status||'—')}</span>`)}
        ${line(L('الرسم الشهري','Monthly fee'), money2s(sub.monthlyFee||sub.monthly_fee))}
        <div style="margin-top:12px">
          <label style="display:block;font-size:12px;font-weight:700;color:var(--ink-300);margin-bottom:6px">${L('المزايا المُفعّلة','Active entitlements')}</label>
          <div style="display:flex;flex-wrap:wrap;gap:5px">
            ${Object.entries(sub.features||{}).filter(([,v])=>v===true).map(([k])=>`<span class="badge ok">${esc(k)}</span>`).join('') || `<span class="ph">${L('لا مزايا مُفعّلة','none active')}</span>`}
          </div>
        </div>`
      : `<p class="ph">${L('لا اشتراك','No subscription')}</p>`}
    </div>

    <!-- Engage -->
    <div class="panel"><h3>Engage</h3>
      ${eng ? `
        ${line(L('الحالة الفعّالة','Effective'), `<span class="badge ${eng.effective?'ok':'cancel'}">${eng.effective?L('مُفعّل','Active'):L('غير مُفعّل','Not active')}</span>`)}
        ${!eng.effective && eng.blockedBy ? `<p class="ph" style="margin-top:8px">${L('السبب','Reason')}: ${esc(eng.blockedBy)}</p>`:''}
        <div class="actrow"><button class="btn-small" onclick="App.setStaffScreen('engagecontrol')">${L('فتح تحكّم Engage','Open Engage Control')}</button></div>`
      : `<p class="ph">${L('غير متاح','Unavailable')}</p>`}
    </div>
  </div>

  <div class="grid2">
    <!-- Users -->
    <div class="panel"><h3>${L('المستخدمون','Users')} <span class="cnt">${users.length}</span></h3>
      ${users.length ? `<table class="datatable"><tr><th>${L('المستخدم','User')}</th><th>${L('الدور','Role')}</th><th>${L('الحالة','Status')}</th></tr>
        ${users.map(u=>`<tr><td>${esc(u.username)}</td><td>${esc(u.role)}</td>
          <td><span class="badge ${u.status==='active'?'ok':u.status==='pending_activation'?'pending':'cancel'}">${esc(u.status||(u.active?'active':'suspended'))}</span></td></tr>`).join('')}</table>`
      : `<p class="ph">${L('لا مستخدمون لهذا الشريك','No users for this partner')}</p>`}
      <div class="actrow"><button class="btn-small" onclick="App.setStaffScreen('users')">${L('إدارة المستخدمين','Manage users')}</button></div>
    </div>

    <!-- Operations -->
    <div class="panel"><h3>${L('العمليات','Operations')}</h3>
      ${line(L('المنافذ','Outlets'), outlets.length)}
      ${line(L('المناطق','Zones'), zones.length)}
      ${renderDeliveryGrouping(pf.partnerId, L)}
      <div class="actrow" style="flex-wrap:wrap">
        <button class="btn-small" onclick="App.setStaffScreen('outlets')">${L('المنافذ','Outlets')}</button>
        <button class="btn-small" onclick="App.setStaffScreen('zones')">${L('المناطق ورموز QR','Zones & QR')}</button>
        <button class="btn-small" onclick="App.setStaffScreen('catalog')">${L('القائمة','Catalog')}</button>
      </div>
    </div>
  </div>

  <div class="grid2">
    <!-- Finance -->
    <div class="panel"><h3>${L('ملخّص مالي','Finance Summary')}</h3>
      ${line(L('تسويات','Settlements'), settlements.length)}
      ${line(L('حصة الشريك (إجمالي)','Partner share (total)'), money2s(settlements.reduce((a,x)=>a+(x.partner_share||0),0)))}
      ${settlements.some(x=>x.status==='Disputed') ? `<div class="attentionrow high" style="margin-top:10px"><span class="dot"></span><span class="txt">${L('توجد تسوية متنازع عليها','A disputed settlement exists')}</span><span class="sev">${L('عالٍ','High')}</span></div>`:''}
      <div class="actrow"><button class="btn-small" onclick="App.setStaffScreen('settlements')">${L('التسويات','Settlements')}</button>
        <button class="btn-small" onclick="App.setStaffScreen('revledger')">${L('دفتر الإيراد','Revenue Ledger')}</button></div>
    </div>

    <!-- Branding & Audit -->
    <div class="panel"><h3>${L('العلامة والتدقيق','Branding & Audit')}</h3>
      <p class="ph">${L('العلامة البيضاء تُطبَّق على واجهة الضيف فقط ولا تمسّ الشاشات الإدارية.','White label applies to the guest surface only and never to admin screens.')}</p>
      <div class="actrow"><button class="btn-small" onclick="App.setStaffScreen('branding')">${L('العلامة التجارية','Branding')}</button>
        <button class="btn-small" onclick="App.setStaffScreen('audit')">${L('سجل التدقيق','Audit log')}</button></div>
    </div>
  </div>`;
}

function renderEngageControl(){
  const L=(ar,en)=>S.lang==='ar'?ar:en;
  const ks = S.killSwitch;
  const allowed = ks ? (ks.enabled !== false) : null;
  const partners = S.tenants || [];
  const sel = S.engageState && S.engageState.partnerId;

  return `
  <div class="panel">
    <h3>${L('مفتاح الإيقاف العام','Global Kill Switch')}</h3>
    <p class="ph">${L('يوقف Engage فورًا على المنصة كاملة. لا يمكن لأي شريك تجاوزه — التجارب الجارية تنتهي بهدوء ولا تنكسر رحلة أي طلب.','Pauses Engage instantly across the entire platform. No partner can override it — in-flight experiences end calmly and no order journey breaks.')}</p>
    ${ks===null ? '<div class="skeleton skeleton-row"></div>' : `
      <div class="attentionrow ${allowed?'':'high'}" style="background:${allowed?'var(--sage-100)':'var(--red-100)'}">
        <span class="dot" style="background:${allowed?'var(--sage-500)':'var(--red-500)'}"></span>
        <span class="txt" style="color:${allowed?'#20452F':'#5E1F1B'}"><b>${allowed?L('Engage مسموح على المنصة','Engage allowed platform-wide'):L('Engage موقوف على المنصة','Engage paused platform-wide')}</b></span>
      </div>
      <div class="actrow">
        ${allowed
          ? `<button class="btn-small" style="color:var(--red-500);border-color:var(--red-500)" onclick="App.toggleKillSwitch(false)">${L('إيقاف Engage على المنصة','Pause Engage platform-wide')}</button>`
          : `<button class="btn-small brass" onclick="App.toggleKillSwitch(true)">${L('استئناف Engage','Resume Engage')}</button>`}
      </div>`}
  </div>

  <div class="panel">
    <h3>${L('حالة شريك','Partner State')}</h3>
    <p class="ph">${L('اختر شريكًا لعرض طبقات التفعيل الأربع وسبب المنع إن وُجد','Pick a partner to see the four activation layers and the blocking reason if any')}</p>
    <div class="formfield">
      <select onchange="App.loadEngageState(this.value)">
        <option value="">${L('— اختر شريكًا —','— select a partner —')}</option>
        ${partners.map(p=>`<option value="${esc(p.id)}" ${sel===p.id?'selected':''}>${esc(S.lang==='ar'?p.name_ar:p.name_en)}</option>`).join('')}
      </select>
    </div>
  </div>
  ${sel ? engageEffectiveCard(S.engageState, false) : ''}

  <div class="panel">
    <h3>${L('تقييدات السياسة','Policy Overrides')}</h3>
    <p class="ph">${L('التقييد يعمل باتجاه واحد: يستطيع تضييق ما تسمح به الباقة، ولا يستطيع توسيعه أبدًا.','Overrides work one way only: they can narrow what the plan allows, never widen it.')}</p>
    ${S.policyOverrides===null ? '<div class="skeleton skeleton-row"></div>'
      : S.policyOverrides.length===0 ? `<div class="statepanel on-dark"><div class="glyph">—</div><h4>${L('لا تقييدات','No overrides')}</h4><p>${L('كل العقارات والمناطق تتبع إعداد الباقة.','Every property and zone follows the plan setting.')}</p></div>`
      : `<table class="datatable"><tr><th>${L('النطاق','Scope')}</th><th>${L('المُعرّف','Id')}</th><th>${L('المفتاح','Key')}</th><th>${L('بواسطة','By')}</th></tr>
        ${S.policyOverrides.map(o=>`<tr><td>${esc(o.scope_type||'')}</td><td>${esc(o.scope_id||'')}</td><td>${esc(o.policy_key||'')}</td><td>${esc(o.set_by||'')}</td></tr>`).join('')}</table>`}
  </div>`;
}

// §2 — Engage للشريك: نظرة نطاقه فقط، بلا سجل كامل وبلا مفتاح إيقاف
function renderPartnerEngage(){
  const L=(ar,en)=>S.lang==='ar'?ar:en;
  const canRestrict = S.session && S.session.user.role === 'PartnerAdmin';
  const ov = S.partnerEngage;
  return `
  ${engageEffectiveCard(S.engageState, true)}
  <div class="panel">
    <h3>${L('نشاط التجربة','Experience Activity')}</h3>
    ${ov===null ? '<div class="skeleton skeleton-row"></div>'
      : `<div class="kpirow" style="margin-bottom:0">
          <div class="kpi"><div class="lbl">${L('جلسات','Sessions')}</div><div class="val">${ov.sessions==null?'—':ov.sessions}</div></div>
          <div class="kpi"><div class="lbl">${L('لحظات','Moments')}</div><div class="val">${ov.moments==null?'—':ov.moments}</div></div>
          <div class="kpi"><div class="lbl">${L('تصاريح','Passes')}</div><div class="val">${ov.passes==null?'—':ov.passes}</div></div>
        </div>`}
    <p class="ph" style="margin-top:12px">${L('أرقام مُجمّعة لشريكك فقط. لا يُعرض محتوى أي تجربة فردية ولا أي بيانات ضيف.','Aggregates for your partner only. No individual experience content or guest data is shown.')}</p>
  </div>
  ${canRestrict ? `<div class="panel">
    <h3>${L('تقييد داخل نطاقك','Restrict within your scope')}</h3>
    <p class="ph">${L('تستطيع إيقاف Engage على عقار أو منطقة تخصّك. لا تستطيع تفعيله فوق ما تسمح به باقتك أو ما توقفه المنصة.','You can pause Engage on a property or zone you own. You cannot enable it beyond what your plan allows or what the platform has paused.')}</p>
    ${(S.admin && S.admin.zones && S.admin.zones.length)
      ? `<table class="datatable"><tr><th>${L('المنطقة','Zone')}</th><th></th></tr>
          ${S.admin.zones.map(z=>`<tr><td>${esc(S.lang==='ar'?z.name_ar:z.name_en)}</td>
            <td><button class="btn-small" style="color:var(--red-500);border-color:var(--red-500)" onclick="App.setScopeOverride('zone','${esc(z.id)}',false)">${L('إيقاف هنا','Pause here')}</button>
                <button class="btn-small" onclick="App.setScopeOverride('zone','${esc(z.id)}',true)">${L('السماح','Allow')}</button></td></tr>`).join('')}</table>`
      : `<p class="ph">${L('لا مناطق بعد','No zones yet')}</p>`}
  </div>`:''}`;
}

// §6 — دفتر الإيراد
function renderRevenueLedger(){
  const L=(ar,en)=>S.lang==='ar'?ar:en;
  const led = S.revenueLedger;
  return `
  <div class="panel">
    <h3>${L('دفتر الإيراد','Revenue Ledger')}</h3>
    <p class="ph">${L('آخر 100 قيد · مُقيَّد بنطاقك تلقائيًا من الخادم','Last 100 entries · automatically scoped to your permissions server-side')}</p>
    ${led===null ? '<div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>'
      : led.length===0 ? `<div class="statepanel on-dark"><div class="glyph">—</div><h4>${L('لا قيود','No entries')}</h4><p>${L('لم تُسجَّل أي حركة إيراد بعد.','No revenue movement recorded yet.')}</p></div>`
      : `<table class="datatable"><tr><th>${L('الطلب','Order')}</th><th>${L('النوع','Type')}</th><th>${L('الأساس','Base')}</th><th>${L('حصة الشريك','Partner')}</th><th>${L('رسم تقني','Tech')}</th></tr>
        ${led.slice(0,100).map(r=>`<tr><td>${esc(r.order_id||'')}</td><td>${esc(r.type||'sale')}</td>
          <td>${money(r.eligible_base||0)}</td><td>${money(r.partner_amount||0)}</td><td>${money(r.tech_fee||0)}</td></tr>`).join('')}</table>`}
  </div>`;
}

function renderMechanicLab(){
  const L=(ar,en)=>S.lang==='ar'?ar:en;
  const m = S.mechanics;
  const STATES = { draft:L('مسودة','Draft'), simulated:L('محاكاة','Simulated'), canary:L('تجريبي','Canary'),
                   emerging:L('صاعد','Emerging'), promoted:L('معتمد','Promoted'), retired:L('متقاعد','Retired'),
                   held:L('موقوف','Held'), rejected:L('مرفوض','Rejected') };
  return `
  <div class="panel">
    <h3>${L('مختبر الآليات','Mechanic Lab')}</h3>
    <p class="ph">${L('دورة حياة من ثماني حالات · التجريبي مسقوف بـ5% · الترقية تتطلب حدًّا أدنى من العيّنة','Eight-state lifecycle · Canary capped at 5% · Promotion requires a minimum sample')}</p>
    ${m===null ? '<div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>'
      : m.length===0 ? `<div class="statepanel on-dark"><div class="glyph">—</div><h4>${L('لا توجد آليات','No mechanics')}</h4><p>${L('لم تُقترح أي آلية تجربة بعد.','No experience mechanic has been proposed yet.')}</p></div>`
      : `<table class="datatable"><tr><th>${L('الاسم','Name')}</th><th>${L('الشخصية','Personality')}</th><th>${L('الحالة','State')}</th><th>${L('الفئة','Category')}</th><th>${L('إجراءات','Actions')}</th></tr>
        ${m.map(x=>`<tr><td>${esc(x.name||'')}</td><td>${esc(x.personality||'—')}</td>
          <td><span class="badge ${x.lifecycle_state==='promoted'?'ok':x.lifecycle_state==='rejected'||x.lifecycle_state==='held'?'cancel':'pending'}">${STATES[x.lifecycle_state]||esc(x.lifecycle_state||'')}</span></td>
          <td>${esc(x.category||'')}</td>
          <td>${mechanicActions(x, L, STATES)}</td></tr>`).join('')}</table>`}
    <div class="actrow"><button class="btn-small brass" onclick="App.openProposeMechanic()">+ ${L('اقتراح آلية','Propose mechanic')}</button></div>
  </div>
  ${S.simResult ? `<div class="panel"><h3>${L('نتيجة المحاكاة','Simulation result')}</h3>
    <p class="ph">${esc(S.simResult.id)}</p>
    <div class="body" style="font-family:var(--mono);font-size:11px;white-space:pre-wrap">${esc(JSON.stringify(S.simResult, null, 1).slice(0, 900))}</div></div>`:''}`;
}

/* G1 — الانتقالات المعروضة تتبع دورة الحياة المعتمدة. الخادم هو الحَكَم
   النهائي، والواجهة لا تعرض ما لا معنى له في الحالة الحالية حتى لا تقدّم
   زرًا يفشل حتمًا. */
function mechanicActions(x, L, STATES){
  const NEXT = {
    draft:      ['simulated', 'rejected'],
    simulated:  ['canary', 'held', 'rejected'],
    canary:     ['emerging', 'held', 'rejected'],
    emerging:   ['promoted', 'held', 'rejected'],
    promoted:   ['retired'],
    held:       ['simulated', 'rejected'],
  };
  const st = x.lifecycle_state;
  const outs = NEXT[st] || [];
  const canSim = st === 'draft' || st === 'simulated' || st === 'held';
  return `
    ${canSim ? `<button class="btn-small" onclick="App.simulateMechanic('${esc(x.id)}')">${L('محاكاة','Simulate')}</button>`:''}
    ${outs.map(to=>`<button class="btn-small ${to==='rejected'||to==='held'?'':'brass'}"
      ${to==='rejected'?'style="color:var(--red-500);border-color:var(--red-500)"':''}
      onclick="App.openTransition('${esc(x.id)}','${to}','${esc(st||'')}')">${STATES[to]||to}</button>`).join('')}`;
}

function renderProposeModal(){
  const L=(ar,en)=>S.lang==='ar'?ar:en;
  const st = S.ui.proposeMechanic; if(!st) return '';
  const P = ['RESET','SPARK','DISCOVER','PLAY','MIND'];
  return `<div class="ordmodal" onclick="if(event.target===this) App.dismissPropose()"><div class="ordsheet">
    <h3>${L('اقتراح آلية تجربة','Propose an experience mechanic')}</h3>
    <p class="ph">${L('تبدأ في حالة مسودة، ولا تصل لأي ضيف قبل المحاكاة والترقية.','Starts as a draft — it reaches no guest before simulation and promotion.')}</p>
    <div class="formfield"><label>${L('الاسم','Name')}</label><input id="mkName" placeholder="Quick riddle"></div>
    <div class="formfield"><label>${L('الشخصية','Personality')}</label>
      <select id="mkPersonality">${P.map(x=>`<option value="${x}">${x}</option>`).join('')}</select></div>
    <div class="formfield"><label>${L('العنوان','Kicker')}</label><input id="mkTitleAr"></div>
    <div class="formfield"><label>${L('نص اللحظة (AR)','Moment text (AR)')}</label><input id="mkBodyAr"></div>
    <div class="formfield"><label>${L('نص اللحظة (EN)','Moment text (EN)')}</label><input id="mkBodyEn"></div>
    ${st.error?`<div class="errbox" style="margin-top:10px">${esc(st.error)}</div>`:''}
    <div class="actrow">
      <button class="btn-small brass" onclick="App.submitPropose()" ${st.submitting?'disabled':''}>${st.submitting?L('جارٍ…','Working…'):L('اقتراح','Propose')}</button>
      <button class="ghostbtn" onclick="App.dismissPropose()">${t('close')}</button>
    </div>
  </div></div>`;
}

function renderMechTransitionModal(){
  const L=(ar,en)=>S.lang==='ar'?ar:en;
  const st = S.ui.mechTransition; if(!st) return '';
  return `<div class="ordmodal" onclick="if(event.target===this) App.dismissTransition()"><div class="ordsheet">
    <h3>${L('نقل الآلية إلى','Move mechanic to')} ${esc(st.toState)}</h3>
    <p class="ph">${L('من','From')}: ${esc(st.currentState)}</p>
    ${st.toState==='canary'?`<div class="formfield"><label>${L('نسبة الحركة %','Traffic %')}</label>
      <input id="mtCanary" type="number" step="0.5" value="5">
      <p class="ph" style="margin-top:4px">${L('الخادم يفرض سقفًا صلبًا 5%','The server enforces a hard 5% cap')}</p></div>`:''}
    <div class="formfield"><label>${L('السبب (مطلوب)','Reason (required)')}</label><input id="mtReason"></div>
    ${st.error?`<div class="errbox" style="margin-top:10px">${esc(st.error)}</div>`:''}
    <div class="actrow">
      <button class="btn-small brass" onclick="App.submitTransition()" ${st.submitting?'disabled':''}>${st.submitting?L('جارٍ…','Working…'):L('تأكيد','Confirm')}</button>
      <button class="ghostbtn" onclick="App.dismissTransition()">${t('close')}</button>
    </div>
  </div></div>`;
}

function renderBulkPointsModal(){
  const L=(ar,en)=>S.lang==='ar'?ar:en;
  const st = S.ui.bulkPoints; if(!st) return '';
  if(st.result) return `<div class="ordmodal" onclick="if(event.target===this) App.dismissBulkPoints()"><div class="ordsheet">
    <h3>${L('تم التوليد','Generated')}</h3>
    <p class="ph">${st.result.count} ${L('رمزًا','codes')}</p>
    <table class="datatable"><tr><th>${L('النقطة','Point')}</th><th>${L('الرمز','Token')}</th></tr>
      ${st.result.points.map(x=>`<tr><td>${esc(x.label)}</td><td style="font-family:var(--mono);font-size:11px">${esc(x.token)}</td></tr>`).join('')}</table>
    <div class="actrow"><button class="btn-small brass" onclick="App.dismissBulkPoints()">${t('close')}</button></div>
  </div></div>`;
  return `<div class="ordmodal" onclick="if(event.target===this) App.dismissBulkPoints()"><div class="ordsheet">
    <h3>${L('توليد رموز QR بالجملة','Bulk QR generation')}</h3>
    <p class="ph">${L('حتى 50 رمزًا في الدفعة الواحدة. تُنشأ الدفعة كاملة أو لا شيء.','Up to 50 codes per batch. The batch is created in full or not at all.')}</p>
    <div class="formfield"><label>${L('البادئة','Label prefix')}</label><input id="bpPrefix" value="${L('طاولة','Table')}"></div>
    <div class="formfield"><label>${L('العدد','Count')}</label><input id="bpCount" type="number" min="1" max="50" value="10"></div>
    <div class="formfield"><label>${L('يبدأ من','Start at')}</label><input id="bpStart" type="number" min="1" value="1"></div>
    ${st.error?`<div class="errbox" style="margin-top:10px">${esc(st.error)}</div>`:''}
    <div class="actrow">
      <button class="btn-small brass" onclick="App.submitBulkPoints()" ${st.submitting?'disabled':''}>${st.submitting?L('جارٍ…','Working…'):L('توليد','Generate')}</button>
      <button class="ghostbtn" onclick="App.dismissBulkPoints()">${t('close')}</button>
    </div>
  </div></div>`;
}



function renderEngageOverviewAdmin(){
  const L=(ar,en)=>S.lang==='ar'?ar:en;
  const o = S.engageOverview;
  if(o===null) return kpiDashboardSkeleton(4);
  const n = v => (v==null?'—':v);
  return `
  <div class="kpirow">
    <div class="kpi"><div class="lbl">${L('جلسات','Sessions')}</div><div class="val">${n(o.sessions)}</div></div>
    <div class="kpi"><div class="lbl">${L('لحظات مُقدَّمة','Moments served')}</div><div class="val">${n(o.moments)}</div></div>
    <div class="kpi"><div class="lbl">${L('تصاريح','Passes')}</div><div class="val">${n(o.passes)}</div></div>
    <div class="kpi"><div class="lbl">${L('حوادث سلامة','Safety incidents')}</div><div class="val" style="color:${o.safetyIncidents?'var(--red-500)':'inherit'}">${n(o.safetyIncidents)}</div></div>
  </div>
  <div class="panel"><h3>${L('ملاحظة الصلاحية','Permission note')}</h3>
    <p class="ph">${L('مفتاح الإيقاف العام وتقييدات السياسة محصورة بـSuperAdmin — لا تظهر هنا لأن الخادم لا يسمح بها لهذا الدور.','The global kill switch and policy overrides are restricted to SuperAdmin — they are not shown here because the server does not permit them for this role.')}</p>
  </div>`;
}

function renderSafetyIncidents(){
  const L=(ar,en)=>S.lang==='ar'?ar:en;
  const inc = S.safetyIncidents;
  return `
  <div class="panel">
    <h3>${L('حوادث السلامة','Safety Incidents')}</h3>
    ${inc===null ? '<div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>'
      : inc.length===0 ? `<div class="statepanel on-dark"><div class="glyph" style="color:var(--sage-500)">✓</div><h4>${L('لا حوادث','No incidents')}</h4><p>${L('لم تُسجَّل أي حادثة سلامة على أي آلية.','No safety incident has been recorded against any mechanic.')}</p></div>`
      : `<table class="datatable"><tr><th>${L('الآلية','Mechanic')}</th><th>${L('النوع','Kind')}</th><th>${L('الحالة','Status')}</th><th></th></tr>
        ${inc.map(i=>`<tr><td>${esc(i.mechanicName||'')}</td><td>${esc(i.kind||i.reason||'')}</td>
          <td><span class="badge ${i.resolved_at?'ok':'cancel'}">${i.resolved_at?L('مُعالَجة','Resolved'):L('مفتوحة','Open')}</span></td>
          <td>${i.resolved_at?'':`<button class="btn-small brass" onclick="App.resolveIncident('${esc(i.id)}')">${L('معالجة','Resolve')}</button>`}</td></tr>`).join('')}</table>`}
  </div>`;
}

function renderEngageLedger(){
  const L=(ar,en)=>S.lang==='ar'?ar:en;
  const led = S.engageLedger;
  return `
  <div class="panel">
    <h3>${L('سجل التجارب','Experience Ledger')}</h3>
    <p class="ph">${L('آخر 50 قيدًا · بلا أي رموز قدرة أو داخليات ذكاء اصطناعي','Last 50 entries · no capability tokens or AI internals')}</p>
    ${led===null ? '<div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>'
      : led.length===0 ? `<div class="statepanel on-dark"><div class="glyph">—</div><h4>${L('السجل فارغ','Ledger is empty')}</h4><p>${L('لم تُقدَّم أي تجربة بعد.','No experience has been served yet.')}</p></div>`
      : `<table class="datatable"><tr><th>${L('الحدث','Event')}</th><th>${L('الشخصية','Personality')}</th><th>${L('الوقت','When')}</th></tr>
        ${led.slice(0,50).map(e=>`<tr><td>${esc(e.event_type||e.outcome||'')}</td><td>${esc(e.personality||'—')}</td>
          <td>${e.created_at?new Date(e.created_at).toLocaleString(S.lang==='ar'?'ar':'en'):'—'}</td></tr>`).join('')}</table>`}
  </div>`;
}

function renderPlansAdmin(){
  const L = (ar,en) => S.lang==='ar'?ar:en;
  const plans = S.adminPlans;
  const ENT = [
    ['qrOrdering', L('الطلب عبر QR','QR Ordering')],
    ['digitalPayment', L('الدفع الرقمي','Digital Payment')],
    ['partnerDashboard', L('لوحة الشريك','Partner Dashboard')],
    ['analytics', L('التحليلات','Analytics')],
    ['multiOutlet', L('تعدد المنافذ','Multi-Outlet')],
    ['unifiedCart', L('السلة الموحّدة','Unified Cart')],
    ['corporateWallet', L('محافظ الشركات','Corporate Wallets')],
    ['whiteLabel', L('العلامة البيضاء','White Label')],
    ['multiProperty', L('تعدد العقارات','Multi-Property')],
    ['loyalty_enabled', L('الولاء — الكسب','Loyalty — Earn')],
    ['loyalty_redeem_enabled', L('الولاء — الاستبدال','Loyalty — Redeem')],
    ['engage_enabled', L('Engage','Engage')],
  ];

  return `
  ${(plans && plans.length===0) ? `<div class="notebox" style="background:var(--amber-100);color:var(--amber-500)">
    <b>${L('لا توجد باقات بعد','No plans exist yet')}</b> — ${L('أنشئ باقة أولًا، فبدونها لا يمكن إنشاء أي شريك.','create a plan first — no partner can be onboarded without one.')}
  </div>`:''}
  <div class="grid2">
    <div class="panel">
      <h3>${L('باقة جديدة','New Plan')}</h3>
      <p class="ph">${L('الرمز غير قابل للتغيير بعد الإنشاء','The code cannot be changed after creation')}</p>
      <div class="formgrid">
        <div class="formfield"><label>${L('الرمز','Code')}</label><input id="plCode" placeholder="LAUNCH"></div>
        <div class="formfield"><label>${L('الرسم الشهري','Monthly Fee')}</label><input id="plFee" type="number" placeholder="3000"></div>
        <div class="formfield"><label>${L('الاسم (AR)','Name (AR)')}</label><input id="plNameAr" placeholder="${L('باقة الإطلاق','')}"></div>
        <div class="formfield"><label>${L('الاسم (EN)','Name (EN)')}</label><input id="plNameEn" placeholder="Launch Plan"></div>
        <div class="formfield"><label>${L('الرسم التقني %','Tech Fee %')}</label><input id="plRate" type="number" step="0.1" placeholder="2.2"></div>
      </div>
      <label style="display:block;font-size:12px;font-weight:700;color:var(--ink-300);margin:14px 0 6px">${L('المزايا','Entitlements')}</label>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${ENT.map(([k,lbl])=>`<label class="optrow" style="flex:0 0 auto;padding:7px 10px;cursor:pointer"><input type="checkbox" data-ent="${k}"> <span style="font-size:11.5px">${lbl}</span></label>`).join('')}
      </div>
      <div class="actrow"><button class="btn-small brass" onclick="App.createPlan()">+ ${L('إنشاء الباقة','Create Plan')}</button></div>
    </div>

    <div class="panel">
      <h3>${L('الباقات الحالية','Existing Plans')}</h3>
      ${plans===null ? '<div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>'
        : plans.length===0 ? `<div class="statepanel on-dark"><div class="glyph">—</div><p>${L('لا توجد باقات','No plans')}</p></div>`
        : `<table class="datatable"><tr><th>${L('الرمز','Code')}</th><th>${L('الرسم','Fee')}</th><th>${L('تقني','Tech')}</th><th>${L('مشتركون','Subs')}</th><th></th></tr>
          ${plans.map(p=>`<tr>
            <td><b>${p.code}</b></td>
            <td>${money(p.monthlyFee)}</td>
            <td>${(p.techFeeRate*100).toFixed(1)}%</td>
            <td>${p.subscribers}</td>
            <td>${p.subscribers===0 ? `<button class="btn-small" style="color:var(--red-500);border-color:var(--red-500)" onclick="App.deletePlan('${p.id}')">${L('حذف','Delete')}</button>` : `<span class="ph">${L('مستخدمة','in use')}</span>`}</td>
          </tr>`).join('')}</table>`}
    </div>
  </div>`;
}

function renderPartnerOverview(){
  const ov = S.partner.overview; if(!ov) return kpiDashboardSkeleton(4);
  const today = ov.today || {};
  const allTime = ov.allTime || {};
  const perf = ov.performance || {};
  const moneyLayer = ov.money || {};
  const attention = ov.attention || [];

  // UX-3 (spec §8): every value here comes from the server's computed
  // decision layers — nothing is derived or estimated client-side. Where
  // the server genuinely could not compute a signal (no feedback yet, no
  // recorded fulfillment timings, no prior period to compare against) it
  // returns null and we say so plainly rather than showing a fake 0.
  const dash = (v, suffix) => v==null ? `<span style="color:var(--ink-400);font-weight:600;font-size:15px">—</span>` : `${v}${suffix||''}`;

  const attentionLabels = {
    sla_breach:      a => S.lang==='ar'? `${a.count} طلب تجاوز مهلة التجهيز الآن` : `${a.count} order(s) past their prep SLA right now`,
    disabled_points: a => S.lang==='ar'? `${a.count} نقطة معطّلة` : `${a.count} disabled point(s)`,
    refunds_elevated: a => S.lang==='ar'
      ? `نسبة الاسترجاع مرتفعة: ${a.ratePercent}% من مبيعات 7 أيام (الحد ${a.thresholdPercent}%) — ${a.count} عملية بقيمة ${money2(a.amount)} ر.س`
      : `Elevated refund rate: ${a.ratePercent}% of 7-day sales (threshold ${a.thresholdPercent}%) — ${a.count} refund(s), ${money2(a.amount)} SAR`,
    low_rating:      a => S.lang==='ar'? `متوسط التقييم منخفض: ★ ${a.value}` : `Low average rating: ★ ${a.value}`,
    settlement_disputed: a => S.lang==='ar'? `${a.count} تسوية متنازع عليها` : `${a.count} disputed settlement(s)`,
  };

  return `
  <!-- Layer 1: Today snapshot -->
  <div class="kpirow">
    <div class="kpi"><div class="lbl">${S.lang==='ar'?'مبيعات اليوم':'Sales today'}</div><div class="val">${money2(today.grossSales)}</div><div class="sub">SAR</div></div>
    <div class="kpi"><div class="lbl">${S.lang==='ar'?'طلبات اليوم':'Orders today'}</div><div class="val">${today.orders!=null?today.orders:'—'}</div></div>
    <div class="kpi"><div class="lbl">${S.lang==='ar'?'الالتزام بالمهلة (اليوم)':'Service SLA (today)'}</div><div class="val" style="color:${today.slaPercent==null?'inherit':today.slaPercent>=90?'var(--sage-500)':today.slaPercent>=75?'var(--amber-500)':'var(--red-500)'}">${dash(today.slaPercent,'%')}</div><div class="sub">${slaSubline(today)}</div></div>
    <div class="kpi"><div class="lbl">${S.lang==='ar'?'التقييم (اليوم)':'Rating (today)'}</div><div class="val">${today.avgRating!=null?('★ '+today.avgRating):'—'}</div><div class="sub">${today.ratingCount?`${today.ratingCount} ${S.lang==='ar'?'تقييم اليوم':'ratings today'}`:(allTime.avgRating!=null?`${S.lang==='ar'?'الإجمالي':'All-time'}: ★ ${allTime.avgRating} (${allTime.ratingCount})`:(S.lang==='ar'?'لا تقييمات بعد':'no ratings yet'))}</div></div>
  </div>

  <!-- Layer 2: Attention — what needs action, before any table -->
  <div class="panel">
    <h3>${S.lang==='ar'?'يحتاج انتباهك':'Needs your attention'}</h3>
    ${attention.length===0
      ? `<div class="statepanel on-dark" style="padding:18px 8px"><div class="glyph" style="color:var(--sage-500)">✓</div><h4>${S.lang==='ar'?'لا توجد تنبيهات':'Nothing needs attention'}</h4><p>${S.lang==='ar'?'لا توجد تجاوزات مهلة أو نقاط معطّلة أو تسويات متنازع عليها الآن.':'No SLA breaches, disabled points, or disputed settlements right now.'}</p></div>`
      : attention.map(a=>`<div class="attentionrow ${a.severity}">
          <span class="dot"></span>
          <span class="txt">${(attentionLabels[a.kind]||(()=>a.kind))(a)}</span>
          <span class="sev">${a.severity==='high'?(S.lang==='ar'?'عالٍ':'High'):(S.lang==='ar'?'متوسط':'Medium')}</span>
        </div>`).join('')}
  </div>

  <!-- Layer 3: Performance -->
  <div class="grid2">
    <div class="panel"><h3>${S.lang==='ar'?'الأداء':'Performance'}</h3>
      <div class="totalline" style="color:var(--ink-200)"><span>${S.lang==='ar'?'أفضل منفذ':'Top outlet'}</span><span>${perf.topOutlet?(S.lang==='ar'?perf.topOutlet.name_ar:perf.topOutlet.name_en):'—'}</span></div>
      <div class="totalline" style="color:var(--ink-200)"><span>${S.lang==='ar'?'أضعف منفذ':'Bottom outlet'}</span><span>${perf.bottomOutlet?(S.lang==='ar'?perf.bottomOutlet.name_ar:perf.bottomOutlet.name_en):'—'}</span></div>
      <div class="totalline" style="color:var(--ink-200)"><span>${S.lang==='ar'?'أفضل منطقة':'Top zone'}</span><span>${perf.topZone?`${perf.topZone.zone} (${perf.topZone.count})`:'—'}</span></div>
      <div class="totalline" style="color:var(--ink-200)"><span>${S.lang==='ar'?'أضعف منطقة':'Bottom zone'}</span><span>${perf.bottomZone?`${perf.bottomZone.zone} (${perf.bottomZone.count})`:'—'}</span></div>
      <div class="totalline" style="color:var(--ink-200)"><span>${S.lang==='ar'?'آخر 7 أيام':'Last 7 days'}</span><span>${money2(perf.last7Gross)} SAR</span></div>
      <div class="totalline" style="border-top:1px dashed var(--ink-600);padding-top:8px;margin-top:6px;color:${perf.trendPercent==null?'var(--ink-400)':perf.trendPercent>=0?'var(--sage-500)':'var(--red-500)'};font-weight:800">
        <span>${S.lang==='ar'?'مقارنة بالـ7 السابقة':'vs prior 7 days'}</span>
        <span>${perf.trendPercent==null?(S.lang==='ar'?'لا فترة سابقة للمقارنة':'no prior period'):`${perf.trendPercent>=0?'▲ +':'▼ '}${perf.trendPercent}%`}</span></div>
    </div>
    <!-- Layer 4: Money -->
    <div class="panel"><h3>${S.lang==='ar'?'المالية':'Money'}</h3>
      <div class="totalline" style="color:var(--ink-200)"><span>${t('partnerShare')}</span><span>${money2(moneyLayer.partnerShare)} SAR</span></div>
      <div class="totalline" style="color:var(--ink-200)"><span>${S.lang==='ar'?'تسويات معلّقة':'Pending settlements'}</span><span>${moneyLayer.pendingSettlementCount||0}${moneyLayer.pendingSettlementAmount?` · ${money2(moneyLayer.pendingSettlementAmount)} SAR`:''}</span></div>
      <div class="totalline" style="color:var(--ink-200)"><span>${t('discounts')}</span><span>${money2(moneyLayer.discounts)} SAR</span></div>
      <div class="totalline" style="color:var(--ink-200)"><span>${t('refunds')}</span><span>${money2(moneyLayer.refunds)} SAR</span></div>
      <div class="totalline" style="border-top:1px dashed var(--ink-600);padding-top:8px;margin-top:6px;color:var(--ink-200)">
        <span>${S.lang==='ar'?'التسوية القادمة':'Next settlement'}</span>
        <span>${moneyLayer.nextSettlement
          ? `${moneyLayer.nextSettlement.period} · ${money2(moneyLayer.nextSettlement.amount)} SAR <span class="badge ${moneyLayer.nextSettlement.status==='Disputed'?'cancel':'pending'}" style="margin-inline-start:6px">${moneyLayer.nextSettlement.status}</span>`
          : `<span style="color:var(--ink-400)">${S.lang==='ar'?'لا توجد تسوية معلّقة':'none outstanding'}</span>`}</span></div>
    </div>
  </div>

  <!-- Detail tables: below the decision layers, per spec ("Actions... secondary to operational insight") -->
  <div class="grid2">
    <div class="panel"><h3>${t('topZones')}</h3><table class="datatable"><tr><th>${S.lang==='ar'?'المنطقة':'Zone'}</th><th>${t('orders')}</th></tr>
      ${ov.topZones.map(z=>`<tr><td>${z.zone}</td><td>${z.count}</td></tr>`).join('') || '<tr><td colspan="2">—</td></tr>'}</table></div>
    <div class="panel"><h3>${S.lang==='ar'?'الأداء حسب المنفذ':'Performance by Outlet'}</h3>
      <table class="datatable"><tr><th>${S.lang==='ar'?'المنفذ':'Outlet'}</th><th>${t('orders')}</th><th>${S.lang==='ar'?'إجمالي':'Gross'}</th><th>${S.lang==='ar'?'حصة الشريك':'Partner'}</th><th>${S.lang==='ar'?'التقييم':'Rating'}</th></tr>
      ${(ov.outletPerformance||[]).map(o=>`<tr><td>${S.lang==='ar'?o.name_ar:o.name_en}</td><td>${o.orders}</td><td>${money(o.gross)}</td><td>${money(o.partnerAmount)}</td><td>${o.avgRating!=null?('★ '+o.avgRating):'—'}</td></tr>`).join('') || `<tr><td colspan="5">—</td></tr>`}
      </table>
    </div>
  </div>`;
}
// UX-3: money() formats a number; money2() additionally tolerates null
// (returning an em-dash) so a genuinely-unavailable figure never renders
// as a misleading "0.00".
function money2(n){ return n==null ? '—' : money(n); }

/* UX-5 corrective round: HTML output encoding.
   render() writes through innerHTML, so ANY dynamic string interpolated
   into a template becomes live markup. Engage content is the sharpest
   case -- it can originate from an AI provider or Mechanic Lab, so it is
   untrusted by definition, and Content/AI Safety gates are about MEANING,
   not about markup: they are not a substitute for output encoding and
   must never be treated as one.

   This encodes the five HTML-significant characters at the point of
   output, which is the correct layer -- not a blocklist of "<script>"
   style patterns, which would miss event handlers, svg/onload, entity
   tricks and every other vector. Arabic, English, digits, punctuation
   and emoji pass through untouched because none of them are in the
   replacement set. */
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// UX-3 corrective round: the SLA card must state honestly HOW MANY orders
// the percentage actually rests on, and how many were deliberately left
// out because this system cannot yet measure them correctly (multi-outlet
// orders have no per-child fulfillment timestamps — see
// partnerDecisionLayers in server.js). Silence there would leave a
// partner reading a percentage without knowing its real basis.
function slaSubline(t){
  if(t.slaPercent==null){
    return S.lang==='ar'?'لا توجد بيانات تجهيز مسجّلة اليوم':'no recorded prep timings today';
  }
  const base = S.lang==='ar' ? `من ${t.slaMeasured} طلب` : `from ${t.slaMeasured} order(s)`;
  const excl = t.slaExcludedMultiOutlet
    ? (S.lang==='ar' ? ` · ${t.slaExcludedMultiOutlet} متعدد المنافذ غير محتسب` : ` · ${t.slaExcludedMultiOutlet} multi-outlet not measurable`)
    : '';
  return base + excl;
}

function renderSettlements(){
  const rows = S.settlements || [];
  const role = S.session.user.role;
  const canCreate = role==='AlnadlFinance' || role==='SuperAdmin';
  const flow = { Draft:['Reviewed'], Reviewed:['Partner Review'], 'Partner Review':['Approved','Disputed'], Disputed:['Reviewed'], Approved:['Paid'] };
  const partnerCanAct = role==='PartnerViewer' || role==='PartnerAdmin';
  return `
    ${canCreate? `<div class="panel" style="display:flex;justify-content:space-between;align-items:center">
      <div><h3 style="margin:0">${t('revShareTitle')}</h3><p class="ph" style="margin:4px 0 0">${S.lang==='ar'?'إنشاء تسوية للفترة الحالية':'Create a settlement for the current period'}</p></div>
      <button class="btn-small brass" onclick="App.createSettlement()">+ ${S.lang==='ar'?'إنشاء تسوية':'New settlement'}</button>
    </div>`:''}
    ${rows.length===0? `<div class="panel"><div class="empty-hint" style="color:var(--ink-300)">${S.lang==='ar'?'لا توجد تسويات بعد':'No settlements yet'}</div></div>` : rows.map(s=>{
      const next = flow[s.status] || [];
      const actionable = next.filter(n => partnerCanAct ? ['Approved','Disputed'].includes(n) : true);
      return `<div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div><h3 style="margin:0">${s.period}</h3><p class="ph" style="margin:4px 0 10px">${s.partner_id}</p></div>
          <span class="badge ${s.status==='Approved'||s.status==='Paid'?'ready':s.status==='Disputed'?'cancel':'pending'}">${s.status}</span>
        </div>
        <div class="totalline" style="color:var(--ink-200)"><span>${t('grossSales')}</span><span>${money(s.gross)}</span></div>
        <div class="totalline" style="color:var(--ink-200)"><span>${t('discounts')}</span><span>${money(s.discounts)}</span></div>
        <div class="totalline" style="color:var(--ink-200)"><span>${t('refunds')}</span><span>${money(s.refunds)}</span></div>
        <div class="totalline" style="color:var(--ink-200)"><span>${t('eligibleBase')}</span><span>${money(s.eligible_base)}</span></div>
        <div class="totalline" style="color:var(--brass-300);font-weight:800;font-size:15px;border-top:1px dashed var(--ink-600);padding-top:8px;margin-top:6px;">
          <span>${t('partnerShare')} (${Math.round(s.share_rate*100)}%)</span><span>${money(s.partner_share)}</span></div>
        ${actionable.length? `<div class="actrow">${actionable.map(n=>`<button class="btn-small ${n==='Disputed'?'':'brass'}" onclick="App.settlementTransition('${s.id}','${n}')">${n}</button>`).join('')}</div>`:''}
      </div>`;
    }).join('')}
  `;
}

function renderPortfolio(){
  const pf = S.portfolio; if(!pf) return kpiDashboardSkeleton(4);
  return `<div class="kpirow">
    <div class="kpi"><div class="lbl">${S.lang==='ar'?'إجمالي المبيعات (GMV)':'Total GMV'}</div><div class="val">${money(pf.totalGmv)}</div><div class="sub">SAR</div></div>
    <div class="kpi"><div class="lbl">${S.lang==='ar'?'عدد المواقع':'Sites'}</div><div class="val">${pf.sites}</div></div>
    <div class="kpi"><div class="lbl">${t('orders')}</div><div class="val">${pf.totalOrders}</div></div>
    <div class="kpi"><div class="lbl">${S.lang==='ar'?'تنبيهات تشغيلية':'Operational alerts'}</div><div class="val" style="color:${pf.alerts>0?'var(--red-500)':'var(--cream-050)'}">${pf.alerts}</div></div>
  </div>
  <div class="grid2">
    <div class="panel"><h3>${S.lang==='ar'?'أفضل موقع':'Top site'}</h3>${pf.topSite? `<p style="color:var(--cream-050);font-size:14px;font-weight:700">${S.lang==='ar'?pf.topSite.name_ar:pf.topSite.name_en}</p><p class="ph">${money(pf.topSite.gmv)} SAR · ${pf.topSite.orders} ${S.lang==='ar'?'طلب':'orders'}</p>`:'—'}</div>
    <div class="panel"><h3>${S.lang==='ar'?'أضعف موقع':'Lowest site'}</h3>${pf.lowestSite? `<p style="color:var(--cream-050);font-size:14px;font-weight:700">${S.lang==='ar'?pf.lowestSite.name_ar:pf.lowestSite.name_en}</p><p class="ph">${money(pf.lowestSite.gmv)} SAR · ${pf.lowestSite.orders} ${S.lang==='ar'?'طلب':'orders'}</p>`:'—'}</div>
  </div>
  <div class="panel"><h3>${S.lang==='ar'?'كل المواقع':'All sites'}</h3><table class="datatable">
    <tr><th>${S.lang==='ar'?'الشريك':'Partner'}</th><th>GMV</th><th>${t('orders')}</th></tr>
    ${pf.bySite.map(s=>`<tr><td>${S.lang==='ar'?s.name_ar:s.name_en}</td><td>${money(s.gmv)}</td><td>${s.orders}</td></tr>`).join('')}
  </table></div>`;
}

function renderLiveManager(){
  const l = S.live; if(!l) return kpiDashboardSkeleton(4);
  return `<div class="kpirow">
    <div class="kpi"><div class="lbl">${S.lang==='ar'?'مبيعات اليوم':'Sales today'}</div><div class="val">${money(l.salesToday)}</div><div class="sub">SAR</div></div>
    <div class="kpi"><div class="lbl">${t('orders')}</div><div class="val">${l.ordersToday}</div></div>
    <div class="kpi"><div class="lbl">${S.lang==='ar'?'متوسط التجهيز':'Avg prep'}</div><div class="val">${l.avgPrepMin}</div><div class="sub">${S.lang==='ar'?'دقيقة':'min'}</div></div>
    <div class="kpi"><div class="lbl">${S.lang==='ar'?'متوسط التسليم':'Avg delivery'}</div><div class="val">${l.avgDeliveryMin}</div><div class="sub">${S.lang==='ar'?'دقيقة':'min'}</div></div>
  </div>
  <div class="panel"><h3>${S.lang==='ar'?'الحالة الآن':'Right now'}</h3>
    <div class="kpirow" style="margin-bottom:0">
      <div class="kpi"><div class="lbl">${t('newCol')}</div><div class="val">${l.counts.New}</div></div>
      <div class="kpi"><div class="lbl">${t('prepCol')}</div><div class="val">${l.counts.Preparing}</div></div>
      <div class="kpi"><div class="lbl">${t('readyCol')}</div><div class="val">${l.counts.Ready}</div></div>
      <div class="kpi"><div class="lbl">${S.lang==='ar'?'متأخر':'Delayed'}</div><div class="val" style="color:${l.counts.Delayed>0?'var(--red-500)':'var(--cream-050)'}">${l.counts.Delayed}</div></div>
    </div>
  </div>
  ${l.topZone? `<div class="panel"><h3>${S.lang==='ar'?'أفضل منطقة':'Top zone'}</h3><p style="color:var(--brass-300);font-weight:800">${l.topZone}</p></div>`:''}`;
}

function renderOutlets(){
  const rows = S.outlets || [];
  const typeLabels = { coffee:'☕ Coffee', restaurant:'🍽️ Restaurant', bakery:'🥐 Bakery', service:'🛎️ Service', other:'📦 Other' };
  const operatorLabels = S.lang==='ar'
    ? { alnadl:'مُشغَّل من النادل', partner:'مُشغَّل من الشريك', third_party:'طرف ثالث' }
    : { alnadl:'Alnadl-operated', partner:'Partner-operated', third_party:'Third party' };
  return `<div class="grid2"><div>
    <div class="panel"><h3>${S.lang==='ar'?'إضافة منفذ (Outlet)':'Add an outlet'}</h3>
      <p class="ph">${S.lang==='ar'?'كل منفذ (كوفي/مطعم/مخبز...) كيان مستقل بمحطة تجهيز وهوية خاصة به — ليس تصنيفًا داخل قائمة واحدة':'Each outlet (coffee/restaurant/bakery...) is an independent entity with its own station and identity — not a category inside one shared menu'}</p>
      <div class="darkfield"><label>${S.lang==='ar'?'اسم المنفذ (AR)':'Outlet name (AR)'}</label><input id="outAr" placeholder="مخبز الفجر"></div>
      <div class="darkfield"><label>${S.lang==='ar'?'اسم المنفذ (EN)':'Outlet name (EN)'}</label><input id="outEn" placeholder="Dawn Bakery"></div>
      <div class="formgrid">
        <div class="darkfield"><label>${S.lang==='ar'?'النوع':'Type'}</label><select id="outType"><option value="coffee">Coffee</option><option value="restaurant">Restaurant</option><option value="bakery">Bakery</option><option value="service">Service</option><option value="other">Other</option></select></div>
        <div class="darkfield"><label>${S.lang==='ar'?'الجهة المشغّلة':'Operator'}</label><select id="outOperator"><option value="partner">Partner</option><option value="alnadl">Alnadl</option><option value="third_party">Third party</option></select></div>
      </div>
      <button class="btn-small brass" onclick="App.addOutlet()">+ ${S.lang==='ar'?'إضافة':'Add'}</button>
      <p class="ph" style="margin-top:8px">${S.lang==='ar'?'منفذ إضافي (بعد الأول) يتطلب باقة تشمل Multi-Outlet (CONNECT أو PLATFORM)':'An additional outlet (beyond the first) requires a plan that includes Multi-Outlet (CONNECT or PLATFORM)'}</p>
    </div></div>
    <div class="panel"><h3>${S.lang==='ar'?'المنافذ الحالية':'Current outlets'}</h3>
      ${rows.length? rows.map(o=>`
        <div class="pointrow" style="flex-direction:column;align-items:stretch;gap:6px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <b style="color:var(--cream-050)">${typeLabels[o.type]||o.type} — ${S.lang==='ar'?o.name_ar:o.name_en}</b>
            <button class="togglepill ${o.status==='Active'?'active':'inactive'}" onclick="App.toggleOutlet('${o.id}',${o.status==='Active'})">${o.status==='Active'?t('active'):t('inactive')}</button>
          </div>
          <span style="font-size:11px;color:var(--ink-300)">${operatorLabels[o.operator]||o.operator}${o.legacy_merchant_id? (S.lang==='ar'?' · مُرحَّل من Merchants':' · migrated from Merchants'):''}</span>
          <button class="btn-small line" style="align-self:flex-start;font-size:11px" onclick="App.toggleAvailabilityPanel('${o.id}')">🕐 ${S.lang==='ar'?'قواعد التوفر الزمني':'Availability rules'}</button>
          ${S.ui.availabilityFor===o.id? `
            <div class="notebox" style="margin-top:4px">
              ${(S.ui.availabilityRules||[]).length? (S.ui.availabilityRules||[]).map(r=>`
                <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--ink-700)">
                  <span style="direction:ltr;unicode-bidi:embed;font-size:11px">
                    ${r.day_of_week!=null? ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][r.day_of_week] : (S.lang==='ar'?'كل يوم':'Every day')}
                    ${r.time_from&&r.time_to? ` · ${r.time_from}-${r.time_to}` : (S.lang==='ar'?' · طوال اليوم':' · all day')}
                  </span>
                  <button class="ghostbtn" style="padding:2px 8px;font-size:10px" onclick="App.removeAvailabilityRule('${o.id}','${r.id}')">✕</button>
                </div>`).join('') : `<div style="font-size:11px;color:var(--ink-400)">${S.lang==='ar'?'بلا قيود — متاح دائمًا وفي كل مكان (الافتراضي)':'No rules — always available everywhere (default)'}</div>`}
              <div style="display:flex;gap:6px;margin-top:8px">
                <select id="availDay" style="flex:1;background:var(--ink-800);border:1px solid var(--ink-700);border-radius:6px;color:var(--cream-050);font-size:11px">
                  <option value="">${S.lang==='ar'?'كل يوم':'Every day'}</option>
                  <option value="0">Sun</option><option value="1">Mon</option><option value="2">Tue</option><option value="3">Wed</option><option value="4">Thu</option><option value="5">Fri</option><option value="6">Sat</option>
                </select>
                <input id="availFrom" type="time" style="flex:1;background:var(--ink-800);border:1px solid var(--ink-700);border-radius:6px;color:var(--cream-050);font-size:11px">
                <input id="availTo" type="time" style="flex:1;background:var(--ink-800);border:1px solid var(--ink-700);border-radius:6px;color:var(--cream-050);font-size:11px">
                <button class="btn-small brass" style="font-size:11px" onclick="App.addAvailabilityRule('${o.id}')">+</button>
              </div>
            </div>` : ''}
        </div>`).join('') : `<div class="empty-hint" style="color:var(--ink-300)">${S.lang==='ar'?'لا توجد منافذ بعد':'No outlets yet'}</div>`}
    </div></div>`;
}

function renderRevenueModels(){
  const outlets = S.outlets || [];
  const typeNames = { share: S.lang==='ar'?'مشاركة إيراد':'Revenue Share', commission: S.lang==='ar'?'عمولة':'Commission', fixed: S.lang==='ar'?'رسم ثابت':'Fixed Fee', hybrid: S.lang==='ar'?'مختلط':'Hybrid' };
  return `
    <div class="panel"><p class="ph" style="margin:0">${S.lang==='ar'?'كل منفذ له نموذج إيراد مستقل. تغيير النموذج لا يُعيد كتابة أي معاملة سابقة — كل سطر في السجل يحتفظ بلقطة من النموذج المستخدم وقتها.':'Each outlet has its own revenue model. Changing it never rewrites past transactions — every ledger row keeps a snapshot of the model that was active when it was recorded.'}</p></div>
    ${outlets.map(o=>{
      const current = S.revenueModels[o.id];
      const draft = (S.ui.revModelDraft && S.ui.revModelDraft[o.id]) || {};
      const type = draft.type || (current ? current.type : 'commission');
      return `<div class="panel">
        <h3>${S.lang==='ar'?o.name_ar:o.name_en} <span style="color:var(--ink-300);font-weight:400;font-size:12px">— ${current? typeNames[current.type] + (current.implicit? (S.lang==='ar'?' (افتراضي)':' (default)'):'') : ''}</span></h3>
        <div class="formgrid">
          <div class="darkfield"><label>${S.lang==='ar'?'نوع النموذج':'Model type'}</label>
            <select id="revType_${o.id}" onchange="App.setRevModelType('${o.id}', this.value)">
              <option value="commission" ${type==='commission'?'selected':''}>${typeNames.commission}</option>
              <option value="share" ${type==='share'?'selected':''}>${typeNames.share}</option>
              <option value="fixed" ${type==='fixed'?'selected':''}>${typeNames.fixed}</option>
              <option value="hybrid" ${type==='hybrid'?'selected':''}>${typeNames.hybrid}</option>
            </select>
          </div>
          ${type==='share'? `<div class="darkfield"><label>${S.lang==='ar'?'نسبة الشريك %':'Partner share %'}</label><input id="revShare_${o.id}" type="number" value="${current&&current.share_rate!=null?Math.round(current.share_rate*100):70}"></div>`:''}
          ${(type==='commission'||type==='hybrid')? `<div class="darkfield"><label>${S.lang==='ar'?'نسبة عمولة النادل %':'Alnadl commission %'}</label><input id="revCommission_${o.id}" type="number" value="${current&&current.commission_rate!=null?Math.round(current.commission_rate*100):10}"></div>`:''}
          ${(type==='fixed'||type==='hybrid')? `<div class="darkfield"><label>${S.lang==='ar'?'رسم ثابت (ر.س)':'Fixed fee (SAR)'}</label><input id="revFixed_${o.id}" type="number" value="${current&&current.fixed_amount!=null?current.fixed_amount:5}"></div>`:''}
        </div>
        <button class="btn-small brass" onclick="App.saveRevenueModel('${o.id}')">${t('save')}</button>
      </div>`;
    }).join('')}
    <div class="panel"><h3>${S.lang==='ar'?'سجل التوزيع المالي (آخر المعاملات)':'Allocation ledger (recent transactions)'}</h3>
      <table class="datatable"><tr><th>${S.lang==='ar'?'الطلب':'Order'}</th><th>${S.lang==='ar'?'المنفذ':'Outlet'}</th><th>${S.lang==='ar'?'إجمالي':'Gross'}</th><th>${S.lang==='ar'?'حصة الشريك':'Partner'}</th><th>${S.lang==='ar'?'حصة النادل':'Alnadl'}</th></tr>
        ${(S.revenueLedger||[]).slice(0,15).map(r=>{
          const model = JSON.parse(r.model_snapshot_json||'{}');
          const o = outlets.find(x=>x.id===r.outlet_id);
          return `<tr><td style="font-family:var(--mono)">${r.order_id}</td><td>${o?(S.lang==='ar'?o.name_ar:o.name_en):r.outlet_id}</td><td>${money(r.gross_amount)}</td><td>${money(r.partner_amount)}</td><td>${money(r.alnadl_amount)}</td></tr>`;
        }).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--ink-400)">${S.lang==='ar'?'لا توجد معاملات بعد':'No transactions yet'}</td></tr>`}
      </table>
    </div>`;
}

function renderBranding(){
  const b = S.branding || { mode:'alnadl', show_powered_by:1, fee_model:'included' };
  const modeLabels = S.lang==='ar'
    ? { alnadl:'علامة النادل (افتراضي)', co_branded:'علامة مشتركة', full_white_label:'علامة كاملة للشريك' }
    : { alnadl:'Alnadl branding (default)', co_branded:'Co-branded', full_white_label:'Full white label' };
  const feeLabels = S.lang==='ar'
    ? { included:'ضمن الباقة', setup:'رسم تأسيس فقط', monthly:'اشتراك شهري', annual:'اشتراك سنوي', setup_recurring:'تأسيس + اشتراك دوري' }
    : { included:'Included in plan', setup:'Setup fee only', monthly:'Monthly subscription', annual:'Annual subscription', setup_recurring:'Setup + recurring' };
  return `
  <div class="panel"><p class="ph" style="margin:0">${S.lang==='ar'?'يُطبَّق فقط على واجهة العميل الأمامية (Platform Shell) — هوية كل منفذ (Outlet) مستقلة تمامًا ولا تتأثر. يتطلب باقة PLATFORM. تغيير الوضع أو النطاق المخصص إداري فقط.':'Applies only to the customer-facing Platform Shell — each Outlet keeps its own independent identity. Requires the PLATFORM plan. Mode/domain changes are Admin-only.'}</p></div>
  <div class="panel">
    <h3>${S.lang==='ar'?'إعدادات العلامة التجارية —':'Branding settings —'} ${S.PARTNER_ID}</h3>
    <div class="formgrid">
      <div class="darkfield"><label>${S.lang==='ar'?'الوضع':'Mode'}</label>
        <select id="brMode">
          <option value="alnadl" ${b.mode==='alnadl'?'selected':''}>${modeLabels.alnadl}</option>
          <option value="co_branded" ${b.mode==='co_branded'?'selected':''}>${modeLabels.co_branded}</option>
          <option value="full_white_label" ${b.mode==='full_white_label'?'selected':''}>${modeLabels.full_white_label}</option>
        </select>
      </div>
      <div class="darkfield"><label>${S.lang==='ar'?'نص الشعار (أول حرف يظهر)':'Logo text (first letter shown)'}</label><input id="brLogo" value="${b.logo_text||''}" placeholder="Nova Order"></div>
      <div class="darkfield"><label>${S.lang==='ar'?'اللون الأساسي':'Primary color'}</label><input id="brColor" type="text" value="${b.primary_color||'#C08A3E'}" placeholder="#2E5C4B"></div>
      <div class="darkfield"><label style="display:flex;align-items:center;gap:6px;margin-top:18px"><input id="brPoweredBy" type="checkbox" ${b.show_powered_by!==0?'checked':''}> ${S.lang==='ar'?'إظهار "مقدَّم من ALNADL"':'Show "Powered by ALNADL"'}</label></div>
      <div class="darkfield" style="grid-column:1/-1"><label>${S.lang==='ar'?'نص ترحيبي مخصص (AR)':'Custom welcome text (AR)'}</label><input id="brWelcomeAr" value="${b.welcome_text_ar||''}" placeholder="مرحبًا بك في تجربة نوفا الخاصة"></div>
      <div class="darkfield" style="grid-column:1/-1"><label>${S.lang==='ar'?'نص ترحيبي مخصص (EN)':'Custom welcome text (EN)'}</label><input id="brWelcomeEn" value="${b.welcome_text_en||''}" placeholder="Welcome to the Nova experience"></div>
    </div>
    <div class="section-sm">${S.lang==='ar'?'النموذج التجاري لهذه الخدمة':'Commercial model for this service'}</div>
    <div class="formgrid">
      <div class="darkfield"><label>${S.lang==='ar'?'نوع الرسوم':'Fee model'}</label>
        <select id="brFeeModel">
          ${Object.entries(feeLabels).map(([k,v])=>`<option value="${k}" ${b.fee_model===k?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      <div class="darkfield"><label>${S.lang==='ar'?'رسم التأسيس (ر.س)':'Setup fee (SAR)'}</label><input id="brSetupFee" type="number" value="${b.setup_fee_amount||0}"></div>
      <div class="darkfield"><label>${S.lang==='ar'?'الرسم الدوري (ر.س)':'Recurring fee (SAR)'}</label><input id="brRecurringFee" type="number" value="${b.recurring_fee_amount||0}"></div>
      <div class="darkfield"><label>${S.lang==='ar'?'دورة التجديد':'Recurring cycle'}</label>
        <select id="brRecurringCycle"><option value="monthly" ${b.recurring_cycle==='monthly'?'selected':''}>${S.lang==='ar'?'شهري':'Monthly'}</option><option value="annual" ${b.recurring_cycle==='annual'?'selected':''}>${S.lang==='ar'?'سنوي':'Annual'}</option></select>
      </div>
    </div>
    <button class="btn-small brass" onclick="App.saveBranding()">${t('save')}</button>
  </div>`;
}

function renderRefunds(){
  const o = S.refundLookupOrder;
  const totalPaid = o ? o.total : 0;
  const alreadyRefunded = (S.refundLookupRefunds||[]).filter(r=>r.status==='Refunded').reduce((s,r)=>s+r.amount,0);
  const remaining = Math.round((totalPaid - alreadyRefunded) * 100) / 100;
  const refundable = o && ['Delivered','Partially Refunded','Cancelled'].includes(o.status);
  return `
  <div class="panel"><h3>${S.lang==='ar'?'البحث عن طلب':'Look up an order'}</h3>
    <p class="ph">${S.lang==='ar'?'أدخل رقم الطلب (مثال: ORD-1806) لمعالجة استرجاع كامل أو جزئي':'Enter an order ID (e.g. ORD-1806) to process a full or partial refund'}</p>
    <div style="display:flex;gap:8px">
      <input id="refundOrderId" placeholder="ORD-1806" value="${S.refundOrderIdInput||''}" oninput="S.refundOrderIdInput=this.value" style="flex:1;background:var(--ink-800);border:1px solid var(--ink-700);border-radius:8px;padding:9px 12px;color:var(--cream-050)">
      <button class="btn-small brass" onclick="App.lookupOrderForRefund()">${S.lang==='ar'?'بحث':'Search'}</button>
    </div>
  </div>
  ${o? `
  <div class="grid2">
    <div class="panel">
      <h3>${o.id} <span class="badge ${refundable?'ready':'cancel'}" style="margin-inline-start:8px">${o.status}</span></h3>
      <div class="notebox" style="direction:ltr;unicode-bidi:embed;text-align:start">
        Total paid: ${totalPaid} SAR &nbsp;·&nbsp; Already refunded: ${alreadyRefunded} SAR &nbsp;·&nbsp; Remaining refundable: ${remaining} SAR
      </div>
      ${refundable? `
        <div class="darkfield" style="margin-top:12px"><label>${S.lang==='ar'?'المبلغ (ر.س)':'Amount (SAR)'}</label><input id="refundAmount" type="number" max="${remaining}" value="${remaining}"></div>
        <div class="darkfield"><label>${S.lang==='ar'?'السبب (إلزامي لسجل التدقيق)':'Reason (required for audit trail)'}</label><input id="refundReason" placeholder="${S.lang==='ar'?'مثال: خطأ في الطلب':'e.g. Order error'}"></div>
        <button class="btn-small brass" onclick="App.submitRefund()">${S.lang==='ar'?'معالجة الاسترجاع':'Process Refund'}</button>
      ` : `<p class="ph">${S.lang==='ar'?'هذا الطلب غير قابل للاسترجاع في حالته الحالية (يتطلب Delivered أو Cancelled)':'This order is not refundable in its current state (requires Delivered or Cancelled)'}</p>`}
    </div>
    <div class="panel"><h3>${S.lang==='ar'?'سجل الاسترجاعات لهذا الطلب':'Refund history for this order'}</h3>
      <table class="datatable"><tr><th>${S.lang==='ar'?'المبلغ':'Amount'}</th><th>${S.lang==='ar'?'النوع':'Type'}</th><th>${S.lang==='ar'?'السبب':'Reason'}</th><th>${S.lang==='ar'?'بواسطة':'By'}</th></tr>
      ${(S.refundLookupRefunds||[]).map(r=>`<tr><td>${money(r.amount)}</td><td>${r.type}</td><td>${r.reason&&r.reason.startsWith('__idem__')?'—':r.reason}</td><td>${r.actor}</td></tr>`).join('') || `<tr><td colspan="4" style="text-align:center;color:var(--ink-400)">${S.lang==='ar'?'لا استرجاعات سابقة':'No prior refunds'}</td></tr>`}
      </table>
    </div>
  </div>`:''}`;
}

function renderMerchants(){
  const rows = S.merchants || [];
  const featureOn = S.subscription ? S.subscription.features?.marketplace : true; // SuperAdmin has no single subscription context; PartnerAdmin's is loaded
  return `<div class="grid2"><div>
    <div class="panel"><h3>${S.lang==='ar'?'إضافة شريك تجاري (مطعم/خدمة)':'Add a merchant (restaurant/service)'}</h3>
      <p class="ph">${S.lang==='ar'?'يظهر منتجاته ضمن قائمة العميل تحت قسم منفصل بعلامة "شريك" — يتطلب باقة PLATFORM':'Shows up in the customer menu under a separate "Partner" section — requires the PLATFORM plan'}</p>
      <div class="darkfield"><label>${S.lang==='ar'?'اسم الشريك (AR)':'Merchant name (AR)'}</label><input id="merAr" placeholder="مطعم الواحة"></div>
      <div class="darkfield"><label>${S.lang==='ar'?'اسم الشريك (EN)':'Merchant name (EN)'}</label><input id="merEn" placeholder="Oasis Restaurant"></div>
      <div class="darkfield"><label>${S.lang==='ar'?'نسبة العمولة %':'Commission rate %'}</label><input id="merCommission" type="number" value="10"></div>
      <button class="btn-small brass" onclick="App.addMerchant()">+ ${S.lang==='ar'?'إضافة':'Add'}</button>
    </div></div>
    <div class="panel"><h3>${S.lang==='ar'?'الشركاء الحاليون':'Current merchants'}</h3>
      ${rows.length? rows.map(m=>`<div class="prodlistrow"><div class="nm">${S.lang==='ar'?m.name_ar:m.name_en}<span style="display:block">${m.kind==='alnadl'?(S.lang==='ar'?'مُدار من النادل':'Alnadl-operated'):(S.lang==='ar'?`شريك · عمولة ${Math.round(m.commission_rate*100)}%`:`Partner · ${Math.round(m.commission_rate*100)}% commission`)}</span></div>
        <span class="badge ${m.status==='Active'?'ready':'cancel'}">${m.status}</span></div>`).join('') : `<div class="empty-hint" style="color:var(--ink-300)">${S.lang==='ar'?'لا يوجد شركاء بعد':'No merchants yet'}</div>`}
    </div></div>`;
}

function renderWallets(){
  const rows = S.wallets || [];
  return `<div class="grid2"><div>
    <div class="panel"><h3>${S.lang==='ar'?'محفظة شركة جديدة':'New corporate wallet'}</h3>
      <p class="ph">${S.lang==='ar'?'للعملاء المؤسسيين — رصيد شهري مشترك مع سقف اختياري لكل طلب':'For corporate clients — a shared monthly budget with an optional per-order cap'}</p>
      <div class="darkfield"><label>${S.lang==='ar'?'اسم الجهة':'Owner name'}</label><input id="walOwner" placeholder="Engineering Dept"></div>
      <div class="darkfield"><label>${S.lang==='ar'?'معرّف الربط (يُستخدم عند الدفع)':'Owner reference (used at checkout)'}</label><input id="walRef" placeholder="dept:engineering"></div>
      <div class="formgrid">
        <div class="darkfield"><label>${S.lang==='ar'?'الميزانية الشهرية':'Monthly budget'}</label><input id="walBudget" type="number" placeholder="500"></div>
        <div class="darkfield"><label>${S.lang==='ar'?'سقف لكل طلب (اختياري)':'Per-order cap (optional)'}</label><input id="walCap" type="number" placeholder="60"></div>
      </div>
      <button class="btn-small brass" onclick="App.addWallet()">+ ${S.lang==='ar'?'إنشاء':'Create'}</button>
    </div></div>
    <div class="panel"><h3>${S.lang==='ar'?'المحافظ الحالية':'Current wallets'}</h3>
      ${rows.length? rows.map(w=>{
        const pct = w.monthly_budget>0 ? Math.min(100, Math.round((w.spent_this_period/w.monthly_budget)*100)) : 0;
        const policy = JSON.parse(w.policy_json||'{}');
        return `<div class="pointrow" style="flex-direction:column;align-items:stretch;gap:8px">
          <div style="display:flex;justify-content:space-between"><b style="color:var(--cream-050)">${w.owner_name}</b><span style="font-family:var(--mono);font-size:11px;color:var(--ink-300)">${w.owner_ref}</span></div>
          <div style="background:var(--ink-800);border-radius:999px;height:6px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${pct>85?'var(--red-500)':'var(--brass-500)'}"></div></div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink-300)">
            <span style="direction:ltr;unicode-bidi:embed">${money(w.spent_this_period)} / ${money(w.monthly_budget)} SAR</span>
            ${policy.perOrderCap? `<span>${S.lang==='ar'?'سقف الطلب':'order cap'}: ${money(policy.perOrderCap)}</span>`:''}
          </div>
        </div>`;
      }).join('') : `<div class="empty-hint" style="color:var(--ink-300)">${S.lang==='ar'?'لا توجد محافظ بعد':'No wallets yet'}</div>`}
    </div></div>`;
}

function renderUsers(){
  const rows = S.users || [];
  const roleOpts = S.session.user.role==='PartnerAdmin'
    ? ['Operator','Runner','SiteManager','PartnerViewer']
    : ['Operator','Runner','SiteManager','PartnerViewer','PartnerAdmin','AlnadlFinance','SuperAdmin'];
  return `<div class="grid2"><div>
    <div class="panel"><h3>${S.lang==='ar'?'مستخدم جديد':'New user'}</h3>
      <div class="darkfield"><label>${S.lang==='ar'?'اسم المستخدم':'Username'}</label><input id="newUserName" placeholder="jane_operator"></div>
      <div class="darkfield"><label>${S.lang==='ar'?'الدور':'Role'}</label><select id="newUserRole">${roleOpts.map(r=>`<option value="${r}">${r}</option>`).join('')}</select></div>
      <button class="btn-small brass" onclick="App.createUser()">+ ${S.lang==='ar'?'إنشاء':'Create'}</button>
      <p class="ph" style="margin-top:8px">${S.lang==='ar'
        ? 'يُنشأ الحساب بلا كلمة مرور. سيظهر رابط تفعيل لمرة واحدة تُسلّمه للمستخدم ليضع كلمة مروره بنفسه.'
        : 'The account is created with no password. A one-time activation link appears for you to hand over; the user sets their own password.'}</p>
    </div></div>
    <div class="panel"><h3>${S.lang==='ar'?'المستخدمون الحاليون':'Current users'}</h3>
      ${rows.map(u=>{
        const pending = u.status==='pending_activation';
        const badge = pending ? (S.lang==='ar'?'بانتظار التفعيل':'Pending activation')
                    : (u.status==='suspended'||!u.active) ? (S.lang==='ar'?'موقوف':'Suspended')
                    : (S.lang==='ar'?'فعّال':'Active');
        const tone = pending ? 'pending' : (u.status==='suspended'||!u.active) ? 'cancel' : 'ok';
        return `<div class="prodlistrow"><div class="nm">${esc(u.username)}
          <span style="display:block">${esc(u.role)}${u.partner_scope? ' · '+esc(u.partner_scope):''}${u.last_login? ' · '+new Date(u.last_login).toLocaleDateString('en-US') : (S.lang==='ar'?' · لم يسجل دخول بعد':' · never logged in')}</span></div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <span class="badge ${tone}">${badge}</span>
            <button class="btn-small" onclick="App.reissueActivation('${esc(u.id)}','${esc(u.username)}')">${S.lang==='ar'?'رابط تفعيل':'Activation link'}</button>
            <button class="togglepill ${u.active?'active':'inactive'}" onclick="App.toggleUser('${esc(u.id)}',${!!u.active})">${u.active?t('active'):t('inactive')}</button>
          </div></div>`;}).join('')}
    </div></div>`;
}

/* ---------------- boot ---------------- */
// UX-0 corrective round: this is now App.boot(), an exposed function
// rather than an auto-running IIFE, so index.html can trigger it AFTER
// both app.js and dev-tools.js (if the server delivered it) have fully
// loaded and executed — script tags run in document order, so by the
// time the inline trigger below calls App.boot(), window.AlnadlDevTools
// is already correctly populated (dev/staging) or correctly absent
// (production), and every render() call from this point on sees the
// right answer with no race, no flash of the wrong state, and no
// separate network round-trip needed to ask the server "which mode am I
// in" — the mode IS whether dev-tools.js physically arrived.
App.boot = async function(){
  document.documentElement.dir='rtl';
  const params = new URLSearchParams(location.search);
  const tkn = params.get('t');
  if(tkn){ await App.loadQrContext(tkn); } else { render(); }
  setInterval(()=>{
    if(S.session && S.screen==='kds') App.loadOpsQueue();
    if(S.session && S.screen==='runnerq') App.loadRunnerQueue();
    if(!S.session && S.screen==='tracking') App.refreshOrder();
  }, 3000);
};
