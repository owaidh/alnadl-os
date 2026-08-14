// lib/logger.js — Structured logging (Go-Live P1 §4.2).
//
// JSON lines on stdout, which is what every log shipper (CloudWatch, Loki,
// Datadog, ELK) ingests without a custom parser. Human-readable pretty
// printing is deliberately NOT added: a second format is a second thing to
// keep correct, and `jq` covers local reading.
//
// REDACTION IS THE POINT, NOT AN AFTERTHOUGHT
// §4.2 forbids logging tokens, passwords, payment secrets, OTPs and
// unnecessary PII. Rather than trusting every future call site to remember
// that, redaction happens HERE, on the way out, by key name and by value
// shape. A field named `code`, `otp`, `token`, `password`, `secret`,
// `paymentRef` or `authorization` never reaches stdout in the clear no
// matter who logs it.
'use strict';

const REDACT_KEYS = /^(password|passwordHash|token|accessToken|sessionToken|access_token|refresh_token|secret|sessionSecret|apiKey|api_key|authorization|cookie|code|otp|challengeCode|paymentRef|payment_ref|card|cardNumber|cvv)$/i;

// Phone numbers and emails are PII. They are not removed outright -- an
// operator genuinely needs to correlate a loyalty issue to a guest -- but
// they are masked so a log dump is not a contact database.
function maskPhone(v) {
  const d = String(v).replace(/\D/g, '');
  return d.length >= 4 ? `***${d.slice(-4)}` : '***';
}

function redact(value, key, depth = 0) {
  if (depth > 6) return '[deep]';
  if (value == null) return value;
  if (key && REDACT_KEYS.test(key)) return '[redacted]';
  if (key && /^(phone|customerPhone|customer_key|msisdn)$/i.test(key)) return maskPhone(value);
  if (key && /email/i.test(key) && typeof value === 'string') return value.replace(/^(.).*(@.*)$/, '$1***$2');
  if (Array.isArray(value)) return value.map(v => redact(v, null, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k, depth + 1);
    return out;
  }
  return value;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
function threshold() {
  return LEVELS[process.env.LOG_LEVEL] || (process.env.NODE_ENV === 'production' ? LEVELS.info : LEVELS.debug);
}

function emit(level, event, fields) {
  if (LEVELS[level] < threshold()) return;
  if (process.env.LOG_SILENT === '1') return; // tests keep their output readable
  const line = { ts: new Date().toISOString(), level, event, ...redact(fields || {}) };
  process.stdout.write(JSON.stringify(line) + '\n');
}

const log = {
  debug: (event, fields) => emit('debug', event, fields),
  info: (event, fields) => emit('info', event, fields),
  warn: (event, fields) => emit('warn', event, fields),
  /** Errors log the MESSAGE, never the stack, to stdout in production --
   *  stacks leak internal paths and structure. The stack is kept for
   *  non-production where it is genuinely useful for debugging. */
  error: (event, fields, err) => emit('error', event, {
    ...fields,
    error: err ? String(err.message || err) : undefined,
    stack: (err && process.env.NODE_ENV !== 'production') ? String(err.stack || '').split('\n').slice(0, 4).join(' | ') : undefined,
  }),
};

/** Correlation id: honour an upstream one from the reverse proxy so a
 *  request can be traced across the whole hop chain, otherwise mint one. */
function correlationId(req) {
  const incoming = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  if (incoming && /^[A-Za-z0-9._-]{1,128}$/.test(String(incoming))) return String(incoming);
  return require('crypto').randomBytes(8).toString('hex');
}

module.exports = { log, correlationId, redact, maskPhone };
