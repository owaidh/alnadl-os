// db.js — Alnadl Hospitality OS
// Schema follows Screen Spec §11 (نموذج البيانات الأساسي). Zero external
// dependencies: uses Node's built-in node:sqlite (Node >= 22).
'use strict';
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, 'data.sqlite');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
// WAL mode (Write-Ahead Logging): allows readers to proceed concurrently
// with a writer instead of the whole database locking during a write
// transaction — the default rollback-journal mode blocks ALL other
// connections for the duration of any BEGIN...COMMIT, which became a real
// problem the moment server.js started wrapping payment writes in an
// explicit transaction (P5-Inc-1 corrective round, atomicity fix) while a
// second connection (e.g. a test, or a future reporting/admin connection)
// tries to read the same file. busy_timeout is defense in depth for the
// remaining brief exclusive-lock window WAL still has for writer-vs-writer.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

function uid(prefix) { return prefix + '_' + crypto.randomBytes(5).toString('hex'); }

db.exec(`
CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY, name_ar TEXT, name_en TEXT, legal_name TEXT,
  contract_ref TEXT, status TEXT DEFAULT 'Active'
);
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY, partner_id TEXT, name_ar TEXT, name_en TEXT,
  timezone TEXT DEFAULT 'Asia/Riyadh', address TEXT, status TEXT DEFAULT 'Active'
);
CREATE TABLE IF NOT EXISTS zones (
  id TEXT PRIMARY KEY, property_id TEXT, name_ar TEXT, name_en TEXT, type TEXT, status TEXT DEFAULT 'Active'
);
CREATE TABLE IF NOT EXISTS points (
  id TEXT PRIMARY KEY, zone_id TEXT, code TEXT, label TEXT, type TEXT, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS qr_tokens (
  id TEXT PRIMARY KEY, point_id TEXT, token TEXT UNIQUE, active INTEGER DEFAULT 1, created_at INTEGER,
  qr_type TEXT DEFAULT 'table' -- table | office | room | zone | counter_pickup (§5)
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, property_id TEXT, name_ar TEXT, name_en TEXT, sort_order INTEGER DEFAULT 0, status TEXT DEFAULT 'Active'
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, category_id TEXT, merchant_id TEXT, outlet_id TEXT, sku TEXT, name_ar TEXT, name_en TEXT,
  description_ar TEXT, description_en TEXT, base_price REAL, tax_code TEXT DEFAULT 'VAT15',
  status TEXT DEFAULT 'Active', image_url TEXT
);
CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY, product_id TEXT, name_ar TEXT, name_en TEXT, price_delta REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS addons (
  id TEXT PRIMARY KEY, product_id TEXT, name_ar TEXT, name_en TEXT, price REAL DEFAULT 0, required INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, partner_id TEXT, property_id TEXT, zone_id TEXT, point_id TEXT,
  customer_name TEXT, customer_phone TEXT, status TEXT DEFAULT 'Created',
  subtotal REAL, vat REAL, total REAL, payment_ref TEXT, cancel_reason TEXT,
  promo_code TEXT, discount_amount REAL DEFAULT 0,
  loyalty_points_used INTEGER DEFAULT 0, loyalty_account_id TEXT,
  wallet_id TEXT, wallet_covered REAL DEFAULT 0,
  created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY, order_id TEXT, product_id TEXT, merchant_id TEXT, outlet_id TEXT, child_order_id TEXT, name_ar TEXT, name_en TEXT,
  qty INTEGER, unit_price REAL, variant_json TEXT, addons_json TEXT, notes TEXT, line_total REAL
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, order_id TEXT, gateway_ref TEXT, amount REAL, status TEXT,
  method TEXT, fees REAL DEFAULT 0, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS fulfillment (
  order_id TEXT PRIMARY KEY, station TEXT, runner_id TEXT,
  accepted_at INTEGER, preparing_at INTEGER, ready_at INTEGER, out_at INTEGER, delivered_at INTEGER
);
CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY, partner_id TEXT, period TEXT, gross REAL, discounts REAL, refunds REAL,
  eligible_base REAL, share_rate REAL, partner_share REAL, status TEXT DEFAULT 'Draft', created_at INTEGER
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, role TEXT, action TEXT, entity TEXT,
  before TEXT, after TEXT, reason TEXT, ts INTEGER
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY, code TEXT UNIQUE, name_ar TEXT, name_en TEXT,
  monthly_fee REAL, tech_fee_rate REAL, features_json TEXT
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY, partner_id TEXT UNIQUE, plan_id TEXT, status TEXT DEFAULT 'Active',
  started_at INTEGER, renews_at INTEGER
);
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY, order_id TEXT, stars INTEGER, tags_json TEXT, comment TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS promotions (
  id TEXT PRIMARY KEY, property_id TEXT, code TEXT UNIQUE, discount_type TEXT, discount_value REAL,
  valid_from INTEGER, valid_to INTEGER, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT, order_id TEXT, recipient_role TEXT, channel TEXT, payload TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, role TEXT,
  partner_scope TEXT, active INTEGER DEFAULT 1, last_login INTEGER, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS settlement_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, settlement_id TEXT, from_status TEXT, to_status TEXT, actor TEXT, ts INTEGER
);
-- ===== Phase 2/3: Loyalty, Corporate Wallet, Restaurant/Marketplace (§15, §19, §9) =====
CREATE TABLE IF NOT EXISTS loyalty_accounts (
  -- customer_key is deliberately NOT globally UNIQUE: the same phone is a
  -- separate loyalty account at each partner (Go-Live P0 3.4). Uniqueness is
  -- enforced per-partner by idx_loyalty_partner_customer in migration 015.
  id TEXT PRIMARY KEY, customer_key TEXT, points_balance INTEGER DEFAULT 0, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id TEXT PRIMARY KEY, account_id TEXT, order_id TEXT, points_delta INTEGER, reason TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY, property_id TEXT, name_ar TEXT, name_en TEXT, kind TEXT DEFAULT 'alnadl',
  commission_rate REAL DEFAULT 0, status TEXT DEFAULT 'Active'
);
CREATE TABLE IF NOT EXISTS wallet_accounts (
  id TEXT PRIMARY KEY, partner_id TEXT, owner_name TEXT, owner_ref TEXT,
  monthly_budget REAL, spent_this_period REAL DEFAULT 0, period_start INTEGER,
  policy_json TEXT, status TEXT DEFAULT 'Active', created_at INTEGER
);
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY, wallet_id TEXT, order_id TEXT, amount REAL, type TEXT, created_at INTEGER
);
-- ===== Phase 4 Increment 1: Outlet Architecture (§6, §7 of Phase 4 Change Request) =====
-- Purely additive — no existing table's columns are removed or repurposed.
-- "merchants" (Phase 3) is left completely untouched and keeps working exactly
-- as before; "outlets" is a richer parallel entity that Phase 3 merchants are
-- migrated INTO (see migratePhase4Outlets() below), never the other way round.
CREATE TABLE IF NOT EXISTS outlets (
  id TEXT PRIMARY KEY, property_id TEXT, name_ar TEXT, name_en TEXT,
  type TEXT DEFAULT 'coffee', -- coffee | restaurant | bakery | service | other
  operator TEXT DEFAULT 'alnadl', -- alnadl | partner | third_party
  branding_json TEXT DEFAULT '{}', -- { logo, theme, favicon } — independent of Platform branding (§11)
  operating_hours_json TEXT DEFAULT '{}', -- {} = always open (24/7 default, matches current system behavior)
  station_id TEXT, -- KDS/fulfillment station this outlet's orders route to
  delivery_mode TEXT DEFAULT 'runner', -- runner | pickup | room | office
  sla_prep_min INTEGER DEFAULT 8,
  sla_delivery_min INTEGER DEFAULT 10,
  commission_rate REAL DEFAULT 0, -- carried over from merchants; superseded once revenue_models (Increment 3) exists
  legacy_merchant_id TEXT, -- traceability: which "merchants" row this outlet was migrated from, if any
  status TEXT DEFAULT 'Active',
  created_at INTEGER
);
-- Zone/Point <-> Outlet availability, WITH a time dimension (§5 — corrected from
-- the first Gap Analysis draft, which had wrongly modeled this as a flat field).
-- No row for an outlet at a zone/point = "always available there" (so a fresh
-- single-outlet property needs zero rows here, matching today's behavior).
CREATE TABLE IF NOT EXISTS outlet_availability (
  id TEXT PRIMARY KEY, outlet_id TEXT, zone_id TEXT, point_id TEXT,
  day_of_week INTEGER, -- 0(Sun)-6(Sat), NULL = every day
  time_from TEXT, time_to TEXT -- 'HH:MM' 24h, NULL = all day
);
-- QR analytics events (§5) — scans vs resulting orders, per token.
CREATE TABLE IF NOT EXISTS qr_analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT, event_type TEXT, order_id TEXT, ts INTEGER
);
-- ===== Phase 4 Increment 2: Unified Cart / Parent-Child Orders (§8) =====
-- Purely additive. An "orders" row is created EXACTLY as before for every
-- single-outlet cart (the overwhelming majority, and 100% of everything
-- built before Phase 4) -- "child_orders" rows only get created when a cart
-- actually spans more than one outlet AND the partner's plan includes
-- unifiedCart. "orders.status" remains the single source of truth the
-- customer tracking screen reads; when children exist it is derived from
-- them (see deriveParentStatus in server.js) rather than set directly.
CREATE TABLE IF NOT EXISTS child_orders (
  id TEXT PRIMARY KEY, parent_order_id TEXT, outlet_id TEXT, status TEXT DEFAULT 'Paid',
  subtotal REAL, station_id TEXT, cancel_reason TEXT, created_at INTEGER, updated_at INTEGER
);
-- ===== Phase 4 Increment 3: Revenue Model Engine + Allocation Ledger (§9, §10) =====
-- An outlet with NO row here falls back to an implicit Commission model
-- built from outlets.commission_rate (see lib/revenue-engine.js) -- this is
-- what lets every outlet migrated in Increment 1 keep working with zero
-- configuration required.
CREATE TABLE IF NOT EXISTS revenue_models (
  id TEXT PRIMARY KEY, outlet_id TEXT, type TEXT, -- share | commission | fixed | hybrid
  share_rate REAL, commission_rate REAL, fixed_amount REAL, fixed_cycle TEXT, -- per_order | monthly
  calculation_base TEXT DEFAULT 'gross', -- gross | net_after_discounts | net_after_refunds
  active INTEGER DEFAULT 1, created_at INTEGER
);
-- One row per outlet-portion of a paid order. Written ONCE, at the moment
-- payment succeeds, with a full JSON snapshot of the model that was used --
-- a later change to revenue_models NEVER rewrites a historical ledger row
-- (same "no retroactive rewrite" principle already applied to settlements
-- in Phase 3's lib/settlement.js).
CREATE TABLE IF NOT EXISTS revenue_ledger (
  id TEXT PRIMARY KEY, order_id TEXT, outlet_id TEXT,
  gross_amount REAL, discount_amount REAL, eligible_base REAL,
  partner_amount REAL, alnadl_amount REAL, model_snapshot_json TEXT, created_at INTEGER
);
-- ===== Phase 4 Increment 4: White Label / Multi-Tenant Branding (§11, §12) =====
-- Applies ONLY to the "Platform Shell" (header bar, welcome screen accent) --
-- an Outlet's own branding_json (Increment 1) is completely independent and
-- is never overridden by this. Gated by the whiteLabel plan feature
-- (PLATFORM tier) -- a partner_id with no row here (every partner today)
-- renders with Alnadl's default brass/ink theme, unchanged.
CREATE TABLE IF NOT EXISTS partner_branding (
  partner_id TEXT PRIMARY KEY,
  mode TEXT DEFAULT 'alnadl', -- alnadl | co_branded | full_white_label
  logo_text TEXT, primary_color TEXT, welcome_text_ar TEXT, welcome_text_en TEXT,
  show_powered_by INTEGER DEFAULT 1, custom_domain TEXT,
  fee_model TEXT DEFAULT 'included', -- included | setup | monthly | annual | setup_recurring
  setup_fee_amount REAL DEFAULT 0, recurring_fee_amount REAL DEFAULT 0, recurring_cycle TEXT DEFAULT 'monthly',
  updated_at INTEGER
);
`);

function hash(pw) { return crypto.createHash('sha256').update(pw).digest('hex'); } // legacy — kept only so verifyPassword() can still check any not-yet-upgraded row; login() upgrades it to PBKDF2 automatically on next successful sign-in (see lib/auth.js)
function hashPbkdf2(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const iterations = 100000;
  const derived = crypto.pbkdf2Sync(pw, salt, iterations, 32, 'sha256').toString('hex');
  return `pbkdf2:${iterations}:${salt}:${derived}`;
}
function verifyPassword(pw, stored) {
  if (stored.startsWith('pbkdf2:')) {
    const [, iterStr, salt, expected] = stored.split(':');
    const derived = crypto.pbkdf2Sync(pw, salt, parseInt(iterStr), 32, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(derived), Buffer.from(expected));
  }
  // legacy SHA-256 hash (pre-Q06) — still verified for any not-yet-migrated
  // row, but never produced for a new password.
  return stored === hash(pw);
}

function seedIfEmpty() {
  const has = db.prepare('SELECT COUNT(*) c FROM partners').get().c;
  if (has > 0) return;

  const partnerId = 'pt_nova';
  db.prepare(`INSERT INTO partners (id,name_ar,name_en,legal_name,contract_ref,status) VALUES (?,?,?,?,?,?)`)
    .run(partnerId, 'فندق نوفا', 'Hotel Nova', 'Nova Hospitality Co.', 'CNT-2026-014', 'Active');

  const propId = 'prop_nova_main';
  db.prepare(`INSERT INTO properties (id,partner_id,name_ar,name_en,timezone,address,status) VALUES (?,?,?,?,?,?,?)`)
    .run(propId, partnerId, 'اللوبي والمسبح', 'Lobby & Pool Deck', 'Asia/Riyadh', 'Riyadh, KSA', 'Active');

  const zones = [
    ['z_lobby', 'اللوبي', 'Lobby', 'Lounge'],
    ['z_pool', 'المسبح', 'Pool Deck', 'Leisure'],
    ['z_meet', 'قاعات الاجتماعات', 'Meeting Rooms', 'Business'],
  ];
  for (const [id, ar, en, type] of zones) {
    db.prepare(`INSERT INTO zones (id,property_id,name_ar,name_en,type,status) VALUES (?,?,?,?,?,'Active')`)
      .run(id, propId, ar, en, type);
  }

  const points = [
    ['PT-014', 'z_lobby', 'Table 17', 'Table'],
    ['PT-021', 'z_pool', 'Pool P08', 'Seat'],
    ['PT-033', 'z_meet', 'Meeting M3', 'Room'],
  ];
  for (const [id, zoneId, label, type] of points) {
    db.prepare(`INSERT INTO points (id,zone_id,code,label,type,active) VALUES (?,?,?,?,?,1)`)
      .run(id, zoneId, id, label, type);
    db.prepare(`INSERT INTO qr_tokens (id,point_id,token,active,created_at) VALUES (?,?,?,1,?)`)
      .run(uid('qr'), id, crypto.randomBytes(6).toString('hex'), Date.now());
  }

  const cats = [
    ['cat_coffee', 'قهوة', 'Coffee', 1],
    ['cat_bakery', 'مخبوزات', 'Bakery', 2],
    ['cat_food', 'أطعمة', 'Food', 3],
    ['cat_dessert', 'حلويات', 'Desserts', 4],
  ];
  for (const [id, ar, en, order] of cats) {
    db.prepare(`INSERT INTO categories (id,property_id,name_ar,name_en,sort_order,status) VALUES (?,?,?,?,?,'Active')`)
      .run(id, propId, ar, en, order);
  }

  // ---- Merchants (Restaurant/Marketplace Integration, §9/§15) ----
  const merchantAlnadl = 'mer_alnadl';
  db.prepare(`INSERT INTO merchants (id,property_id,name_ar,name_en,kind,commission_rate,status) VALUES (?,?,?,?,?,?,'Active')`)
    .run(merchantAlnadl, propId, 'قهوة النادل', 'Coffee by Alnadl', 'alnadl', 0);
  const merchantRestaurant = 'mer_novarest';
  db.prepare(`INSERT INTO merchants (id,property_id,name_ar,name_en,kind,commission_rate,status) VALUES (?,?,?,?,?,?,'Active')`)
    .run(merchantRestaurant, propId, 'مطعم نوفا', 'Nova Restaurant (Partner)', 'partner_restaurant', 0.12);

  const products = [
    ['p_latte', 'cat_coffee', merchantAlnadl, 'SKU-001', 'لاتيه إسباني', 'Spanish Latte', 22],
    ['p_amer', 'cat_coffee', merchantAlnadl, 'SKU-002', 'قهوة أمريكانو', 'Americano', 16],
    ['p_capp', 'cat_coffee', merchantAlnadl, 'SKU-003', 'كابتشينو', 'Cappuccino', 19],
    ['p_croi', 'cat_bakery', merchantAlnadl, 'SKU-004', 'كرواسون', 'Croissant', 14],
    ['p_muff', 'cat_bakery', merchantAlnadl, 'SKU-005', 'مافن توت', 'Berry Muffin', 15],
    ['p_sand', 'cat_food', merchantAlnadl, 'SKU-006', 'ساندويتش دجاج', 'Chicken Sandwich', 32],
    ['p_cake', 'cat_dessert', merchantAlnadl, 'SKU-007', 'تشيز كيك', 'Cheesecake', 24],
    ['p_grill', 'cat_food', merchantRestaurant, 'SKU-008', 'مشاوير مشكلة', 'Mixed Grill Platter', 68],
    ['p_pasta', 'cat_food', merchantRestaurant, 'SKU-009', 'باستا ألفريدو', 'Alfredo Pasta', 46],
  ];
  for (const [id, catId, merchantId, sku, ar, en, price] of products) {
    db.prepare(`INSERT INTO products (id,category_id,merchant_id,sku,name_ar,name_en,base_price,status) VALUES (?,?,?,?,?,?,?,'Active')`)
      .run(id, catId, merchantId, sku, ar, en, price);
  }
  db.prepare("UPDATE products SET status='Inactive' WHERE id='p_muff'").run();

  const variants = [
    ['p_latte', 'صغير', 'Small', 0], ['p_latte', 'وسط', 'Medium', 3], ['p_latte', 'كبير', 'Large', 6],
    ['p_amer', 'صغير', 'Small', 0], ['p_amer', 'وسط', 'Medium', 3], ['p_amer', 'كبير', 'Large', 5],
    ['p_capp', 'صغير', 'Small', 0], ['p_capp', 'كبير', 'Large', 5],
  ];
  for (const [pid, ar, en, delta] of variants) {
    db.prepare(`INSERT INTO variants (id,product_id,name_ar,name_en,price_delta) VALUES (?,?,?,?,?)`)
      .run(uid('vr'), pid, ar, en, delta);
  }

  const addonsSeed = [
    ['p_latte', 'شوت إضافي', 'Extra Shot', 5], ['p_latte', 'حليب شوفان', 'Oat Milk', 6], ['p_latte', 'شراب فانيليا', 'Vanilla Syrup', 4],
    ['p_amer', 'شوت إضافي', 'Extra Shot', 5],
    ['p_croi', 'مربى', 'Jam', 3], ['p_croi', 'زبدة إضافية', 'Extra Butter', 2],
    ['p_sand', 'بطاطس', 'Fries', 8],
  ];
  for (const [pid, ar, en, price] of addonsSeed) {
    db.prepare(`INSERT INTO addons (id,product_id,name_ar,name_en,price,required) VALUES (?,?,?,?,?,0)`)
      .run(uid('ad'), pid, ar, en, price);
  }

  // ---- SaaS commercial packages (§12 من وثيقة المفهوم؛ CONNECT أُضيفت في Phase 4 §4) ----
  const now = Date.now();
  const plans = [
    ['plan_operate', 'OPERATE', 'ALNADL OPERATE', 'ALNADL OPERATE', 0, 0,
      { qrOrdering:false, digitalPayment:false, partnerDashboard:false, loyalty:false, marketplace:false, analytics:false, corporateWallet:false,
        multiOutlet:false, unifiedCart:false, restaurantIntegration:false, whiteLabel:false, multiProperty:false }],
    ['plan_smart', 'SMART', 'ALNADL SMART', 'ALNADL SMART', 2500, 0.02,
      { qrOrdering:true, digitalPayment:true, partnerDashboard:true, loyalty:false, marketplace:false, analytics:true, corporateWallet:false,
        multiOutlet:false, unifiedCart:false, restaurantIntegration:false, whiteLabel:false, multiProperty:false }],
    ['plan_connect', 'CONNECT', 'ALNADL CONNECT', 'ALNADL CONNECT', 4000, 0.022,
      { qrOrdering:true, digitalPayment:true, partnerDashboard:true, loyalty:false, marketplace:true, analytics:true, corporateWallet:false,
        multiOutlet:true, unifiedCart:true, restaurantIntegration:true, whiteLabel:false, multiProperty:false }],
    ['plan_platform', 'PLATFORM', 'ALNADL PLATFORM', 'ALNADL PLATFORM', 6000, 0.025,
      { qrOrdering:true, digitalPayment:true, partnerDashboard:true, loyalty:true, marketplace:true, analytics:true, corporateWallet:true,
        multiOutlet:true, unifiedCart:true, restaurantIntegration:true, whiteLabel:true, multiProperty:true,
        // Go-Live P0 3.7 — capability flags replace the plan-name gate.
        // The legacy `loyalty` flag above is kept so existing subscriptions
        // keep working; lib/loyalty.js prefers these when present.
        loyalty_enabled:true, loyalty_redeem_enabled:true }],
  ];
  for (const [id, code, ar, en, fee, techRate, features] of plans) {
    db.prepare(`INSERT INTO plans (id,code,name_ar,name_en,monthly_fee,tech_fee_rate,features_json) VALUES (?,?,?,?,?,?,?)`)
      .run(id, code, ar, en, fee, techRate, JSON.stringify(features));
  }
  db.prepare(`INSERT INTO subscriptions (id,partner_id,plan_id,status,started_at,renews_at) VALUES (?,?,?,?,?,?)`)
    .run(uid('sub'), partnerId, 'plan_platform', 'Active', now, now + 30 * 86400000);

  // ---- second tenant, to prove real multi-tenant isolation, not a single-client build ----
  const partner2 = 'pt_alrowad';
  db.prepare(`INSERT INTO partners (id,name_ar,name_en,legal_name,contract_ref,status) VALUES (?,?,?,?,?,?)`)
    .run(partner2, 'شركة الرواد', 'Al-Rowad Corporate HQ', 'Al-Rowad Holding', 'CNT-2026-021', 'Active');
  const prop2 = 'prop_alrowad_hq';
  db.prepare(`INSERT INTO properties (id,partner_id,name_ar,name_en,timezone,address,status) VALUES (?,?,?,?,?,?,?)`)
    .run(prop2, partner2, 'المقر الرئيسي', 'Head Office', 'Asia/Riyadh', 'Riyadh, KSA', 'Active');
  db.prepare(`INSERT INTO subscriptions (id,partner_id,plan_id,status,started_at,renews_at) VALUES (?,?,?,?,?,?)`)
    .run(uid('sub'), partner2, 'plan_platform', 'Active', now, now + 30 * 86400000);

  // ---- corporate wallet demo (Al-Rowad HQ is exactly the "corporate" use case from §8) ----
  const walletId = uid('wal');
  db.prepare(`INSERT INTO wallet_accounts (id,partner_id,owner_name,owner_ref,monthly_budget,spent_this_period,period_start,policy_json,status,created_at)
              VALUES (?,?,?,?,?,?,?,?,'Active',?)`)
    .run(walletId, partner2, 'Employee Wallet Pool', 'dept:engineering', 500, 0, now, JSON.stringify({ perOrderCap: 60 }), now);
  // also on Hotel Nova (PLATFORM tier), so the seeded QR points can demo split payment out of the box
  db.prepare(`INSERT INTO wallet_accounts (id,partner_id,owner_name,owner_ref,monthly_budget,spent_this_period,period_start,policy_json,status,created_at)
              VALUES (?,?,?,?,?,?,?,?,'Active',?)`)
    .run(uid('wal'), partnerId, 'Executive Lounge Wallet', 'guest:exec-lounge', 300, 0, now, JSON.stringify({ perOrderCap: 40 }), now);

  // ---- loyalty account demo ----
  const loyaltyId = uid('loy');
  db.prepare(`INSERT INTO loyalty_accounts (id,customer_key,points_balance,created_at) VALUES (?,?,?,?)`)
    .run(loyaltyId, '+9665xxxxxxx', 340, now);

  const users = [
    ['customer_demo', 'Customer', partnerId],
    ['operator', 'Operator', partnerId],
    ['runner', 'Runner', partnerId],
    ['manager', 'SiteManager', partnerId],
    ['partner', 'PartnerViewer', partnerId],
    ['partneradmin', 'PartnerAdmin', partnerId],
    ['finance', 'AlnadlFinance', null],
    ['admin', 'SuperAdmin', null],
    // Phase 5 P5-Inc-6: Engage-specific internal roles, integrated into
    // this SAME users table and RBAC mechanism -- not a separate
    // permissions system. Scope is null (internal/ALNADL-side roles, not
    // tenant-scoped), matching 'admin'/'finance' above.
    ['safetyreviewer', 'SafetyReviewer', null],
    ['productadmin', 'ProductAdmin', null],
  ];
  for (const [username, role, scope] of users) {
    db.prepare(`INSERT INTO users (id,username,password_hash,role,partner_scope,active,created_at) VALUES (?,?,?,?,?,1,?)`)
      .run(uid('u'), username, hashPbkdf2(username), role, scope, Date.now());
  }

  // a couple of demo promo codes
  db.prepare(`INSERT INTO promotions (id,property_id,code,discount_type,discount_value,valid_from,valid_to,active) VALUES (?,?,?,?,?,?,?,?)`)
    .run(uid('promo'), propId, 'WELCOME10', 'percent', 10, 0, now + 365 * 86400000, 1);
  db.prepare(`INSERT INTO promotions (id,property_id,code,discount_type,discount_value,valid_from,valid_to,active) VALUES (?,?,?,?,?,?,?,?)`)
    .run(uid('promo'), propId, 'SAVE5', 'flat', 5, 0, now + 365 * 86400000, 1);

  // a little order history so KDS / partner screens aren't empty on first boot
  seedOrders(propId, partnerId);
}

function seedOrders(propId, partnerId) {
  const now = Date.now();
  const rows = [
    ['ORD-1836', 'z_meet', 'PT-033', 'Delivered', 48, [['p_sand', 2, 32, 'Chicken Sandwich x2 + Fries']]],
    ['ORD-1839', 'z_meet', 'PT-033', 'Ready', 9, [['p_cake', 1, 24, 'Cheesecake']]],
    ['ORD-1842', 'z_lobby', 'PT-014', 'Preparing', 3, [['p_latte', 2, 31, 'Spanish Latte (Large, Oat Milk)'], ['p_croi', 1, 14, 'Croissant']]],
    ['ORD-1843', 'z_pool', 'PT-021', 'Accepted', 1, [['p_amer', 4, 16, 'Americano']]],
    ['ORD-1844', 'z_lobby', 'PT-014', 'Delivered', 22, [['p_capp', 1, 19, 'Cappuccino']]],
  ];
  for (const [id, zoneId, pointId, status, minAgo, items] of rows) {
    const createdAt = now - minAgo * 60000;
    const subtotal = items.reduce((s, it) => s + it[1] * it[2], 0);
    const vat = subtotal * 0.15;
    db.prepare(`INSERT INTO orders (id,partner_id,property_id,zone_id,point_id,status,subtotal,vat,total,payment_ref,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, partnerId, propId, zoneId, pointId, status, subtotal, vat, subtotal + vat, uid('pay'), createdAt, createdAt);
    for (const [pid, qty, unit, label] of items) {
      db.prepare(`INSERT INTO order_items (id,order_id,product_id,name_ar,name_en,qty,unit_price,variant_json,addons_json,notes,line_total)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(uid('oi'), id, pid, label, label, qty, unit, '{}', '[]', '', qty * unit);
    }
    db.prepare(`INSERT INTO payments (id,order_id,gateway_ref,amount,status,method,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(uid('pay'), id, uid('gw'), subtotal + vat, 'Captured', 'card', createdAt);
  }
}

// Q06/Production-bootstrap (2nd corrective round): seedIfEmpty() populates
// full demo data (fake partners, orders, users with `password = username`)
// — this must NEVER run in production. A real deployment needs exactly one
// admin account to bootstrap from, created from environment variables, with
// zero demo partners/products/orders alongside it.
function bootstrapProductionIfEmpty() {
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount > 0) return; // already bootstrapped or migrated from an existing deployment
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!username || !password || password.length < 12) {
    console.error('\n❌ FATAL: NODE_ENV=production with an empty database requires');
    console.error('   ADMIN_BOOTSTRAP_USERNAME and ADMIN_BOOTSTRAP_PASSWORD (12+ chars)');
    console.error('   to create the first SuperAdmin account. No demo data is seeded in');
    console.error('   production. See docs/DEPLOYMENT.md "Production Bootstrap".\n');
    process.exit(1);
  }
  db.prepare(`INSERT INTO users (id,username,password_hash,role,partner_scope,active,created_at) VALUES (?,?,?,?,?,1,?)`)
    .run(uid('u'), username, hashPbkdf2(password), 'SuperAdmin', null, Date.now());
  console.log(`Production bootstrap: created initial SuperAdmin account "${username}". No demo data seeded.`);
}

if (process.env.NODE_ENV === 'production') {
  bootstrapProductionIfEmpty();
} else {
  seedIfEmpty(); // demo/dev only — full fake dataset for exploring every role
}

// ===========================================================================
// Phase 4 Increment 1 — Outlet migration (§16, §22 of Phase 4 Change Request)
// Idempotent: safe to run on every startup, whether the DB is brand new
// (seedIfEmpty just populated it) or an existing Phase 1-3 production
// database that has never seen Phase 4 code before. Never DROPs or rewrites
// anything — only ADDs columns (if missing) and BACKFILLs new rows.
// ===========================================================================
function migratePhase4Outlets() {
  // --- 1) Column safety net for pre-existing DBs created before this code existed ---
  // CREATE TABLE already defines these for fresh installs; ALTER TABLE here
  // covers DBs that existed before this migration was written. SQLite has no
  // "ADD COLUMN IF NOT EXISTS", so each is wrapped and failures (column
  // already exists) are silently ignored — that's the expected path on a
  // fresh install where CREATE TABLE already included the column.
  const tryAlter = (sql) => { try { db.exec(sql); } catch (e) { /* column already exists — fine */ } };
  tryAlter(`ALTER TABLE qr_tokens ADD COLUMN qr_type TEXT DEFAULT 'table'`);
  tryAlter(`ALTER TABLE products ADD COLUMN outlet_id TEXT`);
  // UX-1 (spec §20 audit: "Introduce product media model, image
  // placeholder component, lazy loading, aspect-ratio crop, fallback
  // brand illustration" — the placeholder/fallback half of this shipped
  // in UX-0; this is the "real media" half, deferred there on purpose).
  // Nullable by design: a product with no image_url set still renders
  // correctly via the UX-0 monogram fallback — this is additive, not a
  // hard requirement every product must satisfy immediately.
  tryAlter(`ALTER TABLE products ADD COLUMN image_url TEXT`);
  tryAlter(`ALTER TABLE order_items ADD COLUMN outlet_id TEXT`);
  tryAlter(`ALTER TABLE order_items ADD COLUMN child_order_id TEXT`);

  // --- 2) Backfill: every property with zero outlets gets one created from
  //        its existing merchants (Phase 3) — or a single default outlet if
  //        it somehow has none. This is what guarantees §17 Backward
  //        Compatibility: "كل Property قائم ينشأ له Default Outlet". ---
  const properties = db.prepare('SELECT * FROM properties').all();
  for (const prop of properties) {
    const existingOutlets = db.prepare('SELECT COUNT(*) c FROM outlets WHERE property_id = ?').get(prop.id).c;
    if (existingOutlets > 0) continue; // already migrated — idempotent, skip

    const merchants = db.prepare('SELECT * FROM merchants WHERE property_id = ?').all(prop.id);
    const now = Date.now();
    if (merchants.length > 0) {
      for (const m of merchants) {
        const outletId = uid('out');
        const operator = m.kind === 'alnadl' ? 'alnadl' : (m.kind === 'partner_restaurant' ? 'partner' : 'third_party');
        const type = m.kind === 'alnadl' ? 'coffee' : 'restaurant';
        db.prepare(`INSERT INTO outlets (id,property_id,name_ar,name_en,type,operator,branding_json,operating_hours_json,delivery_mode,sla_prep_min,sla_delivery_min,commission_rate,legacy_merchant_id,status,created_at)
                    VALUES (?,?,?,?,?,?,'{}','{}','runner',8,10,?,?,'Active',?)`)
          .run(outletId, prop.id, m.name_ar, m.name_en, type, operator, m.commission_rate || 0, m.id, now);
        // backfill products that belonged to this merchant
        db.prepare('UPDATE products SET outlet_id = ? WHERE merchant_id = ? AND outlet_id IS NULL').run(outletId, m.id);
      }
    } else {
      // no merchants at all for this property (e.g. Al-Rowad HQ, which never had a menu) —
      // create one default outlet so the property structurally always has >= 1 (§17)
      const outletId = uid('out');
      db.prepare(`INSERT INTO outlets (id,property_id,name_ar,name_en,type,operator,branding_json,operating_hours_json,delivery_mode,sla_prep_min,sla_delivery_min,commission_rate,legacy_merchant_id,status,created_at)
                  VALUES (?,?,?,?,?,'alnadl','{}','{}','runner',8,10,0,NULL,'Active',?)`)
        .run(outletId, prop.id, prop.name_ar, prop.name_en, 'coffee', now);
    }
  }
}
migratePhase4Outlets();

// Versioned migrations (Q08) run last, after all bootstrap/backfill data
// exists — this is what lets migration 001 safely rebuild tables with real
// FOREIGN KEY constraints (Q09) without racing the data that populates them.
const { runMigrations } = require('./lib/migrate.js');
const migrationResults = runMigrations(db);
if (migrationResults.length) {
  console.log(`Applied ${migrationResults.length} migration(s): ${migrationResults.map(r => r.id).join(', ')}`);
}

module.exports = { db, uid, hash, hashPbkdf2, verifyPassword };
