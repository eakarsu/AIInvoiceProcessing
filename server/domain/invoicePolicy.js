'use strict';

const crypto = require('crypto');

const TRANSITIONS = Object.freeze({
  ingested: new Set(['extracted', 'rejected']),
  extracted: new Set(['validated', 'exception', 'rejected']),
  validated: new Set(['matched', 'exception', 'rejected']),
  matched: new Set(['approval_pending', 'exception']),
  exception: new Set(['validated', 'rejected']),
  approval_pending: new Set(['approved', 'rejected']),
  approved: new Set(['posting_pending', 'rejected']),
  posting_pending: new Set(['posted', 'exception']),
  posted: new Set(['reconciled', 'exception']),
  reconciled: new Set(),
  rejected: new Set(),
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function money(value, name, errors) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) errors.push(`${name} must be a non-negative number`);
  return parsed;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function validateExtraction(candidate, tolerance = 0.01) {
  const errors = [];
  if (!String(candidate?.vendorId || '').trim()) errors.push('vendorId is required');
  if (!String(candidate?.invoiceNumber || '').trim()) errors.push('invoiceNumber is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(candidate?.invoiceDate || ''))) errors.push('invoiceDate must be YYYY-MM-DD');
  if (!/^[A-Z]{3}$/.test(String(candidate?.currency || ''))) errors.push('currency must be an ISO-style three-letter code');
  if (!Array.isArray(candidate?.lines) || candidate.lines.length === 0) errors.push('at least one invoice line is required');
  const lines = Array.isArray(candidate?.lines) ? candidate.lines : [];
  let computedSubtotal = 0;
  let computedTax = 0;
  lines.forEach((line, index) => {
    if (!String(line?.description || '').trim()) errors.push(`line ${index} description is required`);
    const quantity = money(line?.quantity, `line ${index} quantity`, errors);
    const unitPrice = money(line?.unitPrice, `line ${index} unitPrice`, errors);
    const taxRate = money(line?.taxRate ?? 0, `line ${index} taxRate`, errors);
    if (taxRate > 1) errors.push(`line ${index} taxRate must be a decimal from 0 to 1`);
    const net = roundMoney(quantity * unitPrice);
    const declaredNet = money(line?.net, `line ${index} net`, errors);
    if (Math.abs(net - declaredNet) > tolerance) errors.push(`line ${index} net does not equal quantity × unitPrice`);
    computedSubtotal += net;
    computedTax += roundMoney(net * taxRate);
  });
  computedSubtotal = roundMoney(computedSubtotal);
  computedTax = roundMoney(computedTax);
  const subtotal = money(candidate?.subtotal, 'subtotal', errors);
  const tax = money(candidate?.tax, 'tax', errors);
  const total = money(candidate?.total, 'total', errors);
  if (Math.abs(subtotal - computedSubtotal) > tolerance) errors.push('subtotal does not equal line totals');
  if (Math.abs(tax - computedTax) > tolerance) errors.push('tax does not equal line tax');
  if (Math.abs(total - roundMoney(subtotal + tax)) > tolerance) errors.push('total does not equal subtotal plus tax');
  return { ok: errors.length === 0, errors, computed: { subtotal: computedSubtotal, tax: computedTax, total: roundMoney(computedSubtotal + computedTax) }, evidenceDigest: digest(candidate) };
}

function duplicateFingerprint(invoice) {
  const canonical = {
    tenantId: invoice.tenantId,
    vendorId: String(invoice.vendorId || '').trim().toLowerCase(),
    invoiceNumber: String(invoice.invoiceNumber || '').replace(/[^a-z0-9]/gi, '').toLowerCase(),
    invoiceDate: invoice.invoiceDate,
    total: roundMoney(invoice.total),
    currency: String(invoice.currency || '').toUpperCase(),
  };
  return digest(canonical);
}

function threeWayMatch({ invoice, purchaseOrder, receipt, amountTolerance = 0.01, quantityTolerance = 0 }) {
  const exceptions = [];
  if (!purchaseOrder) exceptions.push({ code: 'PO_MISSING', field: 'purchaseOrder' });
  if (!receipt) exceptions.push({ code: 'RECEIPT_MISSING', field: 'receipt' });
  if (purchaseOrder && String(invoice.vendorId) !== String(purchaseOrder.vendorId)) exceptions.push({ code: 'VENDOR_MISMATCH', field: 'vendorId' });
  const invoiceLines = invoice.lines || [];
  const poLines = purchaseOrder?.lines || [];
  const receiptLines = receipt?.lines || [];
  for (const line of invoiceLines) {
    const po = poLines.find((candidate) => String(candidate.lineId) === String(line.poLineId));
    const received = receiptLines.find((candidate) => String(candidate.poLineId) === String(line.poLineId));
    if (!po) { exceptions.push({ code: 'PO_LINE_MISSING', line: line.poLineId }); continue; }
    if (!received) { exceptions.push({ code: 'RECEIPT_LINE_MISSING', line: line.poLineId }); continue; }
    if (Number(line.quantity) - Number(received.quantity) > quantityTolerance) exceptions.push({ code: 'QUANTITY_OVER_RECEIPT', line: line.poLineId });
    if (Math.abs(Number(line.unitPrice) - Number(po.unitPrice)) > amountTolerance) exceptions.push({ code: 'PRICE_OUTSIDE_TOLERANCE', line: line.poLineId });
  }
  return { matched: exceptions.length === 0, exceptions, evidenceDigest: digest({ invoice, purchaseOrder, receipt, amountTolerance, quantityTolerance }) };
}

function requiredApprovalCount(amount, threshold = 10000) {
  return Number(amount) >= Number(threshold) ? 2 : 1;
}

function authorizeTransition({ current, next, actor, submitterId, amount, approvals = [], postingIdempotencyKey, erpReady, reconciliationEvidence }) {
  const errors = [];
  if (!TRANSITIONS[current]?.has(next)) errors.push(`transition ${current} -> ${next} is not allowed`);
  const role = actor?.role;
  if (!['submitter', 'ap_analyst', 'approver', 'payment_operator', 'auditor', 'admin'].includes(role)) errors.push('recognized AP role is required');
  if (['validated', 'matched', 'exception', 'approval_pending'].includes(next) && !['ap_analyst', 'admin'].includes(role)) {
    errors.push('AP analyst role is required for validation and matching state changes');
  }
  if (next === 'approved') {
    if (!['approver', 'admin'].includes(role)) errors.push('approver role is required');
    if (Number(actor?.id) === Number(submitterId)) errors.push('submitter cannot approve their invoice');
    const distinct = new Set(approvals.filter((item) => item.decision === 'approve' && Number(item.actorId) !== Number(submitterId)).map((item) => item.actorId));
    if (distinct.size < requiredApprovalCount(amount)) errors.push('required distinct approvals are missing');
  }
  if (next === 'posting_pending' && !['ap_analyst', 'admin'].includes(role)) errors.push('AP analyst role is required to request posting');
  if (next === 'posting_pending' && (!postingIdempotencyKey || !erpReady)) errors.push('ready ERP connector and posting idempotency key are required');
  if (next === 'posted') errors.push('posted state requires a verified ERP posting outcome');
  if (next === 'reconciled' && (!['auditor', 'admin'].includes(role) || !reconciliationEvidence?.erpDocumentId)) {
    errors.push('auditor role and ERP reconciliation evidence are required');
  }
  if (role === 'payment_operator' && !['posted', 'reconciled'].includes(current)) errors.push('payment role cannot alter pre-posting invoice state');
  return { ok: errors.length === 0, errors, evidenceDigest: reconciliationEvidence ? digest(reconciliationEvidence) : null };
}

module.exports = { TRANSITIONS, authorizeTransition, digest, duplicateFingerprint, requiredApprovalCount, threeWayMatch, validateExtraction };
