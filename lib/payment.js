// lib/payment.js — Payment Gateway abstraction.
//
// WHY THIS FILE EXISTS
// The rest of the codebase (server.js, the order flow, the frontend) never
// talks to a payment provider directly — it only calls the three methods
// below. That is the seam where a real Saudi payment gateway (Moyasar,
// HyperPay, PayTabs, Tap, etc.) gets plugged in later: implement a new
// class with the same three methods, flip PAYMENT_PROVIDER, done. No other
// file needs to change.
//
// WHAT'S REAL vs WHAT'S A PLACEHOLDER RIGHT NOW
//   - Idempotency, webhook shape, and the Created→Payment Pending→Paid/Failed
//     state transitions ARE real and match how every card gateway in Saudi
//     works (create an intent, redirect/charge, receive an async webhook,
//     reconcile by reference — never trust the client's redirect alone).
//   - MockGateway.createIntent / capture below just flip a coin (or honor
//     ?simulateFail) instead of calling out to a real API. That is the ONLY
//     thing that changes when you wire up a real provider.
//
// INTEGRATION CHECKLIST FOR THE REAL GATEWAY (do this, nothing else):
//   1. Create lib/gateways/<provider>.js implementing createIntent/capture/refund
//      (see the interface comment above MockGateway below).
//   2. Add its API key(s) to environment variables — never hardcode secrets.
//   3. In server.js, the webhook receiver at POST /api/payments/webhook
//      already exists and is provider-agnostic — point the real gateway's
//      webhook URL at it and verify the signature inside your new adapter's
//      `verifyWebhook()` before calling markCaptured().
//   4. Switch PAYMENT_PROVIDER=<name> in .env. Nothing in server.js,
//      db.js, or the frontend needs to change.
'use strict';
const crypto = require('crypto');

/**
 * Interface every gateway adapter must implement:
 *   async createIntent({ orderId, amount, currency, method }) -> { intentId, redirectUrl? }
 *   async capture(intentId, simulateFail) -> { gatewayRef, status: 'Captured'|'Failed', fees }
 *   async refund(gatewayRef, amount) -> { refundRef, status: 'Refunded'|'Failed' }
 *   verifyWebhook(rawBody, headers) -> boolean
 */
class MockGateway {
  constructor() { this.name = 'mock'; }

  async createIntent({ orderId, amount, currency = 'SAR', method = 'card' }) {
    return { intentId: 'intent_' + crypto.randomBytes(8).toString('hex'), redirectUrl: null };
  }

  // In a real adapter this method does NOT decide success/failure — the
  // provider does, and tells us asynchronously via webhook. The
  // simulateFail flag here exists purely so this sandbox can demo both
  // paths without a real card network.
  async capture(intentId, simulateFail = false) {
    const gatewayRef = 'gw_' + crypto.randomBytes(8).toString('hex');
    if (simulateFail) return { gatewayRef, status: 'Failed', fees: 0 };
    return { gatewayRef, status: 'Captured', fees: 0 }; // real adapters report the provider's actual fee here
  }

  async refund(gatewayRef, amount) {
    return { refundRef: 'rf_' + crypto.randomBytes(8).toString('hex'), status: 'Refunded' };
  }

  verifyWebhook(rawBody, headers) { return true; } // real adapters must verify an HMAC signature header here
}

// PAYMENT_PROVIDER env var selects the adapter. Only 'mock' exists today —
// this switch is the entire integration point for the real gateway.
function getGateway() {
  const provider = process.env.PAYMENT_PROVIDER || 'mock';
  switch (provider) {
    case 'mock': return new MockGateway();
    // case 'moyasar': return new (require('./gateways/moyasar'))();
    // case 'hyperpay': return new (require('./gateways/hyperpay'))();
    default: return new MockGateway();
  }
}

module.exports = { getGateway, MockGateway };
