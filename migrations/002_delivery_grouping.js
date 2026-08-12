// migrations/002_delivery_grouping.js
//
// Q01: adds the Grouped/Separate delivery policy at the property level.
// Default 'grouped' is chosen deliberately to match EXACTLY how the system
// already behaved before this migration (Runner only ever saw a parent
// order once every child was Ready) — so this migration changes zero
// observable behavior for any existing property until someone explicitly
// switches a property to 'separate'.
'use strict';

function up(db) {
  try {
    db.exec(`ALTER TABLE properties ADD COLUMN delivery_grouping TEXT DEFAULT 'grouped'`);
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e;
  }
}

module.exports = { up };
