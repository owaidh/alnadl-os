// migrations/006_engage_inc2.js — Phase 5 P5-Inc-2
//
// Context Personality Engine + Engagement Ceiling + Approved Static/Fallback
// Content + Policy Precedence. No AI, no Mechanic Lab lifecycle (Inc-7/8) --
// the mechanic/mechanic_version tables created here hold only pre-approved,
// static, human-curated content ("Approved Static/Fallback Content" per the
// approved scope), seeded directly as lifecycle_state='promoted'. Inc-8 adds
// the self-inventing/Canary/Promote governance ON TOP of this same schema;
// it is not re-invented later.
'use strict';

const STATIC_CONTENT = {
  RESET: [
    { title_ar: 'لحظة هدوء', title_en: 'A Moment of Calm', body_ar: 'خذ نفسًا عميقًا. طلبك في الطريق.', body_en: 'Take a deep breath. Your order is on its way.' },
  ],
  SPARK: [
    { title_ar: 'هل تعلم؟', title_en: 'Did You Know?', body_ar: 'القهوة اكتُشفت أول مرة في إثيوبيا.', body_en: 'Coffee was first discovered in Ethiopia.' },
    { title_ar: 'سؤال سريع', title_en: 'Quick Question', body_ar: 'ما مزاجك اليوم؟ ☕', body_en: 'What is your mood today? ☕' },
    { title_ar: 'نكتة خفيفة', title_en: 'A Light Joke', body_ar: 'لماذا أحب القهوة الصباح؟ لأنها تبدأ بحرف الصباح!', body_en: 'Why does coffee love mornings? Because they go so well together!' },
  ],
  DISCOVER: [
    { title_ar: 'اكتشف المكان', title_en: 'Discover the Place', body_ar: 'هل تعلم أن هذا الفندق يضم حديقة على السطح؟', body_en: 'Did you know this hotel has a rooftop garden?' },
    { title_ar: 'نصيحة سفر', title_en: 'Travel Tip', body_ar: 'أفضل وقت لزيارة المسبح هو عصرًا.', body_en: 'The best time to visit the pool is in the afternoon.' },
  ],
  PLAY: [
    { title_ar: 'لغز سريع', title_en: 'Quick Riddle', body_ar: 'ما الذي يزداد كلما أخذت منه؟ الحفرة!', body_en: 'What gets bigger the more you take from it? A hole!' },
    { title_ar: 'تحدي', title_en: 'Challenge', body_ar: 'عد إلى 10 بالعكس بأسرع وقت!', body_en: 'Count down from 10 as fast as you can!' },
    { title_ar: 'لعبة تخمين', title_en: 'Guessing Game', body_ar: 'خمّن لون الطاولة المجاورة!', body_en: 'Guess the color of the next table!' },
  ],
  MIND: [
    { title_ar: 'اقتباس اليوم', title_en: 'Quote of the Day', body_ar: 'الهدوء قوة.', body_en: 'Calm is a superpower.' },
  ],
};

function up(db) {
  db.exec(`
    ALTER TABLE properties ADD COLUMN venue_context TEXT;
  `);
  // Backfill the two existing seeded properties with a real, evidence-based
  // context -- new properties default to NULL (resolver falls back to zone
  // signals, then the safest personality, RESET).
  db.prepare(`UPDATE properties SET venue_context = 'hotel' WHERE id = 'prop_nova_main'`).run();
  db.prepare(`UPDATE properties SET venue_context = 'corporate' WHERE id = 'prop_alrowad_hq'`).run();

  db.exec(`
    CREATE TABLE mechanic (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
      created_by TEXT NOT NULL CHECK(created_by IN ('ai','alnadl_admin')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE mechanic_version (
      id TEXT PRIMARY KEY,
      mechanic_id TEXT NOT NULL REFERENCES mechanic(id) ON DELETE CASCADE ON UPDATE CASCADE,
      version_number INTEGER NOT NULL, schema_json TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL DEFAULT 'draft'
        CHECK(lifecycle_state IN ('draft','simulated','canary','emerging','promoted','held','rejected','retired')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE moment (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES engage_session(id) ON DELETE CASCADE ON UPDATE CASCADE,
      mechanic_version_id TEXT NOT NULL REFERENCES mechanic_version(id) ON DELETE RESTRICT ON UPDATE CASCADE,
      sequence_index INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'served' CHECK(status IN ('pending','served','skipped','completed')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE payload_version (
      id TEXT PRIMARY KEY,
      moment_id TEXT NOT NULL REFERENCES moment(id) ON DELETE CASCADE ON UPDATE CASCADE,
      rendered_payload_json TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('ai_generated','approved_fallback','static_template')),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE venue_policy_override (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('partner','property','zone')),
      scope_id TEXT NOT NULL,
      policy_key TEXT NOT NULL,
      policy_value_json TEXT NOT NULL,
      set_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // Seed exactly one built-in, pre-approved, static mechanic PER personality
  // -- these ARE the "Approved Static/Fallback Content" the scope calls for.
  // lifecycle_state='promoted' + created_by='alnadl_admin' because they never
  // went through AI generation or a Canary rollout; they are hand-curated
  // and safe by construction. Inc-8's Mechanic Lab lifecycle governs future
  // AI-authored mechanics on this same table -- these seed rows are not
  // touched by that governance since they were never 'draft'.
  const now = Date.now();
  for (const personality of Object.keys(STATIC_CONTENT)) {
    const mechanicId = 'mech_static_' + personality.toLowerCase();
    db.prepare(`INSERT INTO mechanic (id,name,category,created_by,created_at) VALUES (?,?,?,?,?)`)
      .run(mechanicId, `Static Fallback — ${personality}`, 'static_fallback', 'alnadl_admin', now);
    const versionId = mechanicId + '_v1';
    db.prepare(`INSERT INTO mechanic_version (id,mechanic_id,version_number,schema_json,lifecycle_state,created_at) VALUES (?,?,?,?,?,?)`)
      .run(versionId, mechanicId, 1, JSON.stringify({ personality, pool: STATIC_CONTENT[personality] }), 'promoted', now);
  }
}

module.exports = { up };
