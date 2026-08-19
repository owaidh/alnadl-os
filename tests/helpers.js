// tests/helpers.js — shared setup for the automated test suite (Q10).
//
// Design: zero test-framework dependency (matches the project's own
// zero-dependency philosophy). Each test file is a plain Node script that
// exits 0 on success, non-zero on failure, and prints PASS/FAIL lines a CI
// system or a human can grep. tests/run-all.js runs them all and prints a
// final report.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.TEST_PORT || 8799; // separate port so it never collides with a dev server on 8787

let serverProcess = null;

function startServer() {
  return new Promise((resolve, reject) => {
    const dataPath = path.join(ROOT, `test-data-${Date.now()}.sqlite`);
    serverProcess = spawn('node', ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT, SQLITE_PATH: dataPath },
    });
    serverProcess._dataPath = dataPath;
    let ready = false;
    const onData = (data) => {
      if (!ready && data.toString().includes('listening on')) {
        ready = true;
        resolve();
      }
    };
    serverProcess.stdout.on('data', onData);
    serverProcess.stderr.on('data', onData); // the ExperimentalWarning line also confirms boot progress
    serverProcess.on('error', reject);
    setTimeout(() => { if (!ready) reject(new Error('Server did not start within 5s')); }, 5000);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    // WAL يُنتج ملفَّين شقيقَين (-wal و -shm)، وهذا التنظيف كان يحذف الملف
    // الأصلي وحده منذ ما قبل تفعيل WAL. النتيجة تراكم صامت: مئات الملفات
    // في جذر المستودع بعد كل تشغيل كامل، دخلت فعليًا في حزمة تسليم.
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try { fs.unlinkSync(serverProcess._dataPath + suffix); } catch {}
    }
    serverProcess = null;
  }
}

const BASE = () => `http://localhost:${PORT}`;

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE() + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function loginAs(username) {
  const r = await api('POST', '/api/auth/login', { username, password: username });
  if (r.status !== 200) throw new Error(`Login failed for ${username}: ${JSON.stringify(r.data)}`);
  return r.data.token;
}

let passCount = 0, failCount = 0;
function assert(condition, message) {
  if (condition) { passCount++; console.log(`  PASS: ${message}`); }
  else { failCount++; console.log(`  FAIL: ${message}`); }
}
function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}
function summary() {
  console.log(`\n  ${passCount} passed, ${failCount} failed`);
  return failCount === 0;
}
function resetCounts() { passCount = 0; failCount = 0; }

function getDataPath() { return serverProcess ? serverProcess._dataPath : null; }

module.exports = { startServer, stopServer, api, loginAs, assert, assertEqual, summary, resetCounts, BASE, getDataPath };
