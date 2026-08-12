// lib/statemachine.js — Order State Machine (Screen Spec §10)
// The UI never changes an order's state directly; every transition passes
// through here so an invalid jump is structurally impossible.
'use strict';

const TRANSITIONS = {
  'Created':           { to: ['Payment Pending', 'Cancelled'],           by: ['System', 'Customer'] },
  'Payment Pending':    { to: ['Paid', 'Failed', 'Cancelled'],            by: ['Gateway', 'System'] },
  'Paid':               { to: ['Accepted', 'Cancelled'],                 by: ['Operator', 'SiteManager'] },
  'Accepted':           { to: ['Preparing', 'Cancelled'],                by: ['Operator'] },
  'Preparing':          { to: ['Ready', 'Cancelled'],                    by: ['Operator', 'SiteManager'] },
  'Ready':              { to: ['Out for Delivery', 'Delivered'],         by: ['Runner', 'Operator'] },
  'Out for Delivery':   { to: ['Delivered', 'Delivery Failed'],          by: ['Runner'] },
  'Delivery Failed':    { to: ['Out for Delivery', 'Cancelled'],         by: ['SiteManager'] },
  'Delivered':          { to: ['Refunded'],                              by: ['AlnadlFinance', 'SiteManager'] },
};

function canTransition(from, to) {
  return !!(TRANSITIONS[from] && TRANSITIONS[from].to.includes(to));
}
function actorAllowed(from, role) {
  return !!(TRANSITIONS[from] && TRANSITIONS[from].by.includes(role));
}

module.exports = { TRANSITIONS, canTransition, actorAllowed };
