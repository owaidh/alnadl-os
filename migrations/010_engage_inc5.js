// migrations/010_engage_inc5.js — Phase 5 P5-Inc-5: Social / Group Invite.
//
// Core Isolation maintained: zero changes to any Core table. An invite is
// intrinsically scoped to the ONE session (and therefore ONE tenant) that
// created it -- there is no tenant/property parameter anywhere in the
// invite/join flow for a caller to swap, the same "no id to substitute"
// pattern already proven for Pass/Session capability tokens in Inc-2/3.
'use strict';

function up(db) {
  db.exec(`
    CREATE TABLE group_room (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES engage_session(id) ON DELETE CASCADE ON UPDATE CASCADE,
      invite_token TEXT NOT NULL,
      max_participants INTEGER NOT NULL DEFAULT 8,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX idx_group_room_token ON group_room(invite_token);

    CREATE TABLE engage_participant (
      id TEXT PRIMARY KEY,
      group_room_id TEXT NOT NULL REFERENCES group_room(id) ON DELETE CASCADE ON UPDATE CASCADE,
      role TEXT NOT NULL DEFAULT 'invitee' CHECK(role IN ('host','invitee')),
      display_name TEXT,
      joined_at INTEGER NOT NULL
    );
    CREATE INDEX idx_engage_participant_room ON engage_participant(group_room_id);
  `);
}

module.exports = { up };
