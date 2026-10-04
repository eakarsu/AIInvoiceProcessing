'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256, detectedType, assertOriginal, sourceText, positionAt, verifyCandidateEvidence } = require('../server/domain/invoiceSource');

const raw = Buffer.from('Vendor: Alpha Inc\r\nInvoice No: INV-123\r\nDate: 2026-10-04\r\nService  2  50.00  100.00\r\nTotal: 100.00\r\n');
const document = { content_digest: sha256(raw), media_type: 'text/plain', byte_size: raw.length };
const blob = { content: raw, content_digest: sha256(raw), media_type: 'text/plain', byte_size: raw.length };
const candidate = {
  vendorId: 'alpha', invoiceNumber: 'INV-123', invoiceDate: '2026-10-04', currency: 'USD',
  lines: [{ description: 'Service', quantity: 2, unitPrice: 50, taxRate: 0, net: 100 }],
  subtotal: 100, tax: 0, total: 100,
};
const { text } = sourceText(document, blob);
const span = quote => {
  const start = text.indexOf(quote);
  return { quote, position: positionAt(text, start, quote.length) };
};
const evidence = {
  invoiceNumber: span('Invoice No: INV-123'),
  invoiceDate: span('Date: 2026-10-04'),
  total: span('Total: 100.00'),
  lines: [span('Service  2  50.00  100.00')],
};

test('stored original and required candidate fields are tied to exact source bytes and spans', () => {
  assert.equal(detectedType(raw), 'text/plain');
  assert.deepEqual(assertOriginal(document, blob), raw);
  assert.equal(text.includes('\r'), false);
  assert.equal(evidence.lines[0].position.line, 4);
  assert.equal(verifyCandidateEvidence(text, candidate, evidence).verified, true);
});

test('checksum, span, and value mismatches fail closed', () => {
  assert.throws(() => assertOriginal({ ...document, content_digest: '0'.repeat(64) }, blob), /metadata/);
  assert.throws(() => verifyCandidateEvidence(text, candidate, {
    ...evidence, total: { ...evidence.total, quote: 'Total: 900.00' },
  }), /exact span/);
  assert.throws(() => verifyCandidateEvidence(text, { ...candidate, total: 900 }, evidence), /not supported/);
  assert.throws(() => verifyCandidateEvidence(text, candidate, {
    ...evidence, lines: [{ ...evidence.lines[0], position: { ...evidence.lines[0].position, page: 2 } }],
  }), /position/);
  const wholeDocument = span(text);
  assert.throws(() => verifyCandidateEvidence(text, candidate, {
    ...evidence, lines: [wholeDocument],
  }), /exact span/);
});

test('PDF original can be stored but has no claimed OCR text', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
  assert.equal(detectedType(pdf), 'application/pdf');
  const pdfDoc = { content_digest: sha256(pdf), media_type: 'application/pdf', byte_size: pdf.length };
  const pdfBlob = { ...pdfDoc, content: pdf };
  assert.throws(() => sourceText(pdfDoc, pdfBlob), /OCR is not configured/);
});
