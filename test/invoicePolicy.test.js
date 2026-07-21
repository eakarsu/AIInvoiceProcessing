'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizeTransition, duplicateFingerprint, requiredApprovalCount, threeWayMatch, validateExtraction } = require('../server/domain/invoicePolicy');
const { providerReadiness, requireProvider } = require('../server/services/providerBoundary');

function candidate() {
  return {
    vendorId: 'V-1', invoiceNumber: 'INV-100', invoiceDate: '2026-07-01', currency: 'USD',
    lines: [
      { poLineId: '1', description: 'parts', quantity: 2, unitPrice: 10, net: 20, taxRate: 0.1 },
      { poLineId: '2', description: 'freight', quantity: 1, unitPrice: 5, net: 5, taxRate: 0 },
    ],
    subtotal: 25, tax: 2, total: 27,
  };
}

test('validates extracted lines, totals, and tax deterministically', () => {
  const result = validateExtraction(candidate());
  assert.equal(result.ok, true);
  assert.deepEqual(result.computed, { subtotal: 25, tax: 2, total: 27 });
});

test('rejects malformed extraction and arithmetic disagreement', () => {
  const invoice = candidate();
  invoice.lines[0].net = 19;
  invoice.total = 100;
  const result = validateExtraction(invoice);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes('quantity')), true);
  assert.equal(result.errors.some((error) => error.includes('subtotal plus tax')), true);
});

test('duplicate fingerprint normalizes invoice formatting', () => {
  const one = duplicateFingerprint({ ...candidate(), tenantId: 'tenant-a' });
  const two = duplicateFingerprint({ ...candidate(), tenantId: 'tenant-a', invoiceNumber: ' inv 100 ' });
  assert.equal(one, two);
});

test('three-way match accepts lines within amount and quantity tolerances', () => {
  const invoice = candidate();
  const result = threeWayMatch({
    invoice,
    purchaseOrder: { vendorId: 'V-1', lines: [{ lineId: '1', unitPrice: 10 }, { lineId: '2', unitPrice: 5 }] },
    receipt: { lines: [{ poLineId: '1', quantity: 2 }, { poLineId: '2', quantity: 1 }] },
  });
  assert.equal(result.matched, true);
});

test('three-way match produces typed missing, quantity, price, and vendor exceptions', () => {
  const invoice = candidate();
  const result = threeWayMatch({
    invoice,
    purchaseOrder: { vendorId: 'OTHER', lines: [{ lineId: '1', unitPrice: 9 }] },
    receipt: { lines: [{ poLineId: '1', quantity: 1 }] },
  });
  assert.equal(result.matched, false);
  assert.equal(new Set(result.exceptions.map((item) => item.code)).has('VENDOR_MISMATCH'), true);
  assert.equal(new Set(result.exceptions.map((item) => item.code)).has('QUANTITY_OVER_RECEIPT'), true);
  assert.equal(new Set(result.exceptions.map((item) => item.code)).has('PRICE_OUTSIDE_TOLERANCE'), true);
  assert.equal(new Set(result.exceptions.map((item) => item.code)).has('PO_LINE_MISSING'), true);
});

test('large invoices require two approvals', () => {
  assert.equal(requiredApprovalCount(9999), 1);
  assert.equal(requiredApprovalCount(10000), 2);
});

test('submitter cannot self-approve and dual approval is enforced', () => {
  const self = authorizeTransition({
    current: 'approval_pending', next: 'approved', actor: { id: 1, role: 'approver' }, submitterId: 1,
    amount: 20000, approvals: [{ actorId: 1, decision: 'approve' }, { actorId: 2, decision: 'approve' }],
  });
  assert.equal(self.ok, false);
  const approved = authorizeTransition({
    current: 'approval_pending', next: 'approved', actor: { id: 3, role: 'approver' }, submitterId: 1,
    amount: 20000, approvals: [{ actorId: 2, decision: 'approve' }, { actorId: 3, decision: 'approve' }],
  });
  assert.equal(approved.ok, true);
});

test('posting requires AP role, idempotency, and ready ERP but never authorizes payment', () => {
  const blocked = authorizeTransition({ current: 'approved', next: 'posting_pending', actor: { id: 2, role: 'ap_analyst' }, erpReady: false });
  assert.equal(blocked.ok, false);
  const allowed = authorizeTransition({
    current: 'approved', next: 'posting_pending', actor: { id: 2, role: 'ap_analyst' },
    postingIdempotencyKey: 'post-1', erpReady: true,
  });
  assert.equal(allowed.ok, true);
});

test('payment operator cannot alter pre-posting invoice state', () => {
  const result = authorizeTransition({ current: 'approval_pending', next: 'rejected', actor: { id: 5, role: 'payment_operator' } });
  assert.equal(result.ok, false);
});

test('providers fail closed until every boundary is explicitly configured', () => {
  assert.equal(providerReadiness({}).ready, false);
  assert.throws(() => requireProvider('erp', {}), /not ready/);
  const env = {};
  for (const name of ['OCR', 'DOCUMENT_STORAGE', 'ERP', 'VENDOR_MASTER', 'PURCHASE_ORDERS', 'RECEIPTS', 'PAYMENTS', 'TAX']) {
    env[`${name}_ENABLED`] = 'true';
    env[`${name}_URL`] = `https://${name.toLowerCase()}.example.invalid`;
    env[`${name}_TOKEN`] = 'configured-at-runtime';
  }
  assert.equal(providerReadiness(env).ready, true);
});
