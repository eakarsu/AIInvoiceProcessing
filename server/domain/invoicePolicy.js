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
  if (!['number','string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(parsed) || parsed < 0) errors.push(`${name} must be a non-negative number`);
  return parsed;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function validateExtraction(candidate, tolerance = 0.01) {
  const errors = [];
  if (!Number.isFinite(tolerance) || tolerance < 0) errors.push('valid tolerance required');
  const day = String(candidate?.invoiceDate || '');
  if (!Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10) !== day) errors.push('invoiceDate must be a real calendar date');
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
  const number = value => ['number','string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
  if (!number(amountTolerance) || !number(quantityTolerance)) exceptions.push({code:'INVALID_TOLERANCE'});
  if (!invoice || !Array.isArray(invoice.lines) || !invoice.lines.length) exceptions.push({code:'INVOICE_LINES_REQUIRED'});
  if (!purchaseOrder || !Array.isArray(purchaseOrder.lines) || !purchaseOrder.lines.length) exceptions.push({ code: 'PO_MISSING', field: 'purchaseOrder' });
  if (!receipt || !Array.isArray(receipt.lines) || !receipt.lines.length) exceptions.push({ code: 'RECEIPT_MISSING', field: 'receipt' });
  if (!invoice?.vendorId || !purchaseOrder?.vendorId || String(invoice.vendorId) !== String(purchaseOrder.vendorId)) exceptions.push({ code: 'VENDOR_MISMATCH', field: 'vendorId' });
  const poLines = new Map(), received = new Map(), billed = new Map();
  for (const line of Array.isArray(purchaseOrder?.lines) ? purchaseOrder.lines : []) {
    const id = String(line?.lineId ?? '').trim();
    if (!id || poLines.has(id) || !number(line?.unitPrice)) { exceptions.push({code:'INVALID_PO_LINE',line:id}); continue; }
    poLines.set(id,line);
  }
  for (const line of Array.isArray(receipt?.lines) ? receipt.lines : []) {
    const id = String(line?.poLineId ?? '').trim();
    if (!id || !number(line?.quantity)) { exceptions.push({code:'INVALID_RECEIPT_LINE',line:id}); continue; }
    received.set(id,(received.get(id) || 0) + Number(line.quantity));
  }
  for (const line of Array.isArray(invoice?.lines) ? invoice.lines : []) {
    const id = String(line?.poLineId ?? '').trim();
    if (!id || !number(line?.quantity) || !number(line?.unitPrice)) { exceptions.push({code:'INVALID_INVOICE_LINE',line:id}); continue; }
    billed.set(id,(billed.get(id) || 0) + Number(line.quantity));
    const po = poLines.get(id);
    if (!po) { exceptions.push({code:'PO_LINE_MISSING',line:id}); continue; }
    if (Math.abs(Number(line.unitPrice)-Number(po.unitPrice)) > Number(amountTolerance)) exceptions.push({code:'PRICE_OUTSIDE_TOLERANCE',line:id});
  }
  for (const [id,quantity] of billed) {
    if (!received.has(id)) exceptions.push({code:'RECEIPT_LINE_MISSING',line:id});
    else if (!Number.isFinite(quantity) || !Number.isFinite(received.get(id)) || quantity-received.get(id) > Number(quantityTolerance)) exceptions.push({code:'QUANTITY_OVER_RECEIPT',line:id});
    const ordered = poLines.get(id)?.quantity;
    if (ordered !== undefined && (!number(ordered) || quantity-Number(ordered) > Number(quantityTolerance))) exceptions.push({code:'QUANTITY_OVER_PO',line:id});
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
    if (!actor?.id || !submitterId || String(actor.id) === String(submitterId)) errors.push('submitter cannot approve their invoice');
    if (!['number','string'].includes(typeof amount) || String(amount).trim() === '' || !Number.isFinite(Number(amount)) || Number(amount) < 0) errors.push('valid invoice amount required');
    const distinct = new Set(approvals.filter((item) => item.decision === 'approve' && item.actorId != null && String(item.actorId).trim() && String(item.actorId) !== String(submitterId)).map((item) => String(item.actorId)));
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
