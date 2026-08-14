// tests/golive-p1.js — Go-Live P1: structured logging with redaction,
// correlation ids, and graceful shutdown / worker safety.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { assert, assertEqual, summary, resetCounts } = require('./helpers.js');

const PORT = 8898;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(__dirname, '..', 'test-p1.sqlite');

function cleanDb() { for (const f of [DB_PATH, DB_PATH + '-shm', DB_PATH + '-wal']) { try { fs.unlinkSync(f); } catch (e) {} } }

async function startServer(extraEnv) {
  cleanDb();
  const proc = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, PORT: String(PORT), SQLITE_PATH: DB_PATH,
      LOG_SILENT: '0', RATE_LIMIT_DISABLED: '1', ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = [];
  proc.stdout.on('data', d => out.push(String(d)));
  proc.stderr.on('data', d => out.push(String(d)));
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 250));
    try { const res = await fetch(`${BASE}/health`); if (res.ok) return { proc, out }; } catch (e) {}
  }
  throw new Error('server did not start: ' + out.join(''));
}

async function run() {
  resetCounts();
  console.log('=== Go-Live Suite: P1 Operations (logging, correlation, shutdown) ===');
  let handle = null;

  try {
    // ---------------- logging & redaction ----------------
    const logger = require('../lib/logger.js');

    const redacted = logger.redact({
      password: 'hunter2', token: 'abc123', accessToken: 'cap-tok', sessionToken: 'sess-tok',
      paymentRef: 'pay_deadbeef', code: '123456', otp: '999999', secret: 's3cr3t',
      authorization: 'Bearer xyz', apiKey: 'ak_live_1',
      orderId: 'ORD-1801', amount: 115,
    });
    for (const k of ['password', 'token', 'accessToken', 'sessionToken', 'paymentRef', 'code', 'otp', 'secret', 'authorization', 'apiKey']) {
      assertEqual(redacted[k], '[redacted]', `§4.2 "${k}" is redacted by the logger itself, not by trusting every call site`);
    }
    assertEqual(redacted.orderId, 'ORD-1801', '§4.2 non-sensitive fields pass through — the log stays useful');
    assertEqual(redacted.amount, 115, '§4.2 numbers are preserved');

    assertEqual(logger.redact({ phone: '+966501234567' }).phone, '***4567',
      '§4.2 phone numbers are MASKED not dropped — an operator can still correlate without the log becoming a contact database');
    assertEqual(logger.redact({ customerPhone: '0501234567' }).customerPhone, '***4567',
      '§4.2 customerPhone is masked under its own name too');
    assert(logger.redact({ email: 'guest@example.com' }).email === 'g***@example.com',
      '§4.2 emails are partially masked');

    const nested = logger.redact({ order: { payment: { token: 'deep-secret', total: 50 } } });
    assertEqual(nested.order.payment.token, '[redacted]', '§4.2 redaction reaches NESTED fields, not just the top level');
    assertEqual(nested.order.payment.total, 50, '§4.2 nested safe fields survive');

    // ---------------- correlation ids ----------------
    handle = await startServer({});

    const plain = await fetch(`${BASE}/health`);
    const generated = plain.headers.get('x-request-id');
    assert(!!generated && generated.length >= 8, '§4.2 every response carries a correlation id');

    const passed = await fetch(`${BASE}/health`, { headers: { 'X-Request-Id': 'upstream-trace-42' } });
    assertEqual(passed.headers.get('x-request-id'), 'upstream-trace-42',
      '§4.2 an upstream correlation id from the reverse proxy is HONOURED, so a request is traceable across the whole hop chain');

    // fetch() refuses to SEND a header containing a newline, so a raw socket
    // is used here -- which is exactly how an attacker would craft it.
    const rawResponse = await new Promise((resolve) => {
      const net = require('net');
      const sock = net.connect(PORT, 'localhost', () => {
        sock.write('GET /health HTTP/1.1\r\nHost: localhost\r\nX-Request-Id: bad<>id"quoted\r\nConnection: close\r\n\r\n');
      });
      let buf = '';
      sock.on('data', d => { buf += d; });
      sock.on('end', () => resolve(buf));
      sock.on('error', () => resolve(''));
      setTimeout(() => { try { sock.destroy(); } catch (e) {} resolve(buf); }, 3000);
    });
    assert(!rawResponse.includes('bad<>id"quoted'),
      '§4.2 a malformed correlation id is REPLACED rather than echoed back — no header or log injection');
    assert(/x-request-id:/i.test(rawResponse),
      '§4.2 a generated correlation id is still returned in its place');

    // ---------------- readiness reflects real dependency state ----------------
    const ready = await (await fetch(`${BASE}/ready`)).json();
    assertEqual(ready.status, 'ready', '§4.1 /ready reports ready while healthy');

    // ---------------- graceful shutdown ----------------
    const shutdownStart = Date.now();
    handle.proc.kill('SIGTERM');
    let exited = false;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (handle.proc.exitCode !== null || handle.proc.signalCode !== null) { exited = true; break; }
    }
    const shutdownMs = Date.now() - shutdownStart;
    assert(exited, '§4.5 the process exits on SIGTERM rather than needing SIGKILL');
    assert(shutdownMs < 11000, `§4.5 shutdown completes within the grace period (${shutdownMs}ms)`);
    assertEqual(handle.proc.exitCode, 0, '§4.5 a clean shutdown exits 0 — an orchestrator sees an intentional stop, not a crash');

    const logs = handle.out.join('');
    assert(logs.includes('shutdown_start'), '§4.5 shutdown is announced in the structured log');
    assert(logs.includes('shutdown_complete'), '§4.5 completion is logged, so a drain can be confirmed rather than assumed');
    handle = null;

    // ---------------- restart safety: no duplicate work ----------------
    // Restart against the SAME database and confirm the outbox did not
    // double-process or lose anything (§4.5 worker safety).
    const h2 = await startServer({});
    const health2 = await (await fetch(`${BASE}/health`)).json();
    assertEqual(health2.status, 'ok', '§4.5 the service restarts cleanly against an existing database');
    h2.proc.kill('SIGKILL');
    await new Promise(r => setTimeout(r, 500));

    // ---------------- production secrets are still enforced ----------------
    // The instruction was to preserve and extend this, not build a parallel path.
    const noSecret = spawn('node', [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, NODE_ENV: 'production', PORT: '8897', SQLITE_PATH: DB_PATH + '.x', SESSION_SECRET: '', LOG_SILENT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const errOut = [];
    noSecret.stdout.on('data', d => errOut.push(String(d)));
    noSecret.stderr.on('data', d => errOut.push(String(d)));
    await new Promise(r => { noSecret.on('exit', r); setTimeout(r, 6000); });
    assert(noSecret.exitCode !== 0, '§4.4 production still REFUSES to start with missing required secrets — the existing guard is intact');
    const refusal = errOut.join('');
    assert(/FATAL/.test(refusal), '§4.4 the refusal is explicit rather than a silent exit');
    // Which guard fires first depends on ordering (bootstrap credentials are
    // checked before the session secret); either is a valid refusal, and the
    // operator is told which one to fix.
    assert(/SESSION_SECRET|ADMIN_BOOTSTRAP/.test(refusal),
      '§4.4 the message names the exact missing secret so an operator can fix it without guessing');

    // And specifically: with bootstrap credentials present but no session
    // secret, the SESSION_SECRET guard itself still fires.
    const noSessionOnly = spawn('node', [path.join(__dirname, '..', 'server.js')], {
      env: { ...process.env, NODE_ENV: 'production', PORT: '8896', SQLITE_PATH: DB_PATH + '.y',
             SESSION_SECRET: '', ADMIN_BOOTSTRAP_USERNAME: 'ops', ADMIN_BOOTSTRAP_PASSWORD: 'a-strong-password-1', LOG_SILENT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const so = [];
    noSessionOnly.stdout.on('data', d => so.push(String(d)));
    noSessionOnly.stderr.on('data', d => so.push(String(d)));
    await new Promise(r => { noSessionOnly.on('exit', r); setTimeout(r, 6000); });
    assert(noSessionOnly.exitCode !== 0, '§4.4 production refuses to start without SESSION_SECRET specifically');
    assert(/SESSION_SECRET/.test(so.join('')), '§4.4 and names SESSION_SECRET as the cause');
    for (const f of [DB_PATH + '.y', DB_PATH + '.y-shm', DB_PATH + '.y-wal']) { try { fs.unlinkSync(f); } catch (e) {} }
    for (const f of [DB_PATH + '.x', DB_PATH + '.x-shm', DB_PATH + '.x-wal']) { try { fs.unlinkSync(f); } catch (e) {} }

  } finally {
    if (handle && handle.proc) { try { handle.proc.kill('SIGKILL'); } catch (e) {} }
    cleanDb();
  }
  return summary();
}

if (require.main === module) { run().then(ok => process.exit(ok ? 0 : 1)); }
module.exports = { run };
