import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { extractFields } = require('./invoiceExtract.js');

const DOC = `ACME INDUSTRIAL SUPPLY
From: Acme Industrial Supply
Invoice Number: INV-4471
Invoice Date: 2026-08-14

Line items:
  Bearing kit            1,200.00
  Labour                    800.00

Total Due: 2,000.00`;

test('extracts labelled invoice number, date, vendor and total with evidence', () => {
  const r = extractFields(DOC);
  assert.equal(r.invoiceNumber.value, 'INV-4471');
  assert.equal(r.invoiceDate.value, '2026-08-14');
  assert.equal(r.amount.value, 2000);
  assert.equal(r.vendor.value, 'Acme Industrial Supply');
  assert.equal(r.extractedFieldCount, 4);
  assert.ok(r.amount.evidence.includes('Total Due'));
  assert.ok(r.amount.basis.includes('total'));
});

test('an unlabelled total is flagged as possibly a line item', () => {
  const r = extractFields('Some Vendor\nWidget 1,200.00\nGadget 800.00');
  assert.equal(r.amount.value, 1200);
  assert.match(r.amount.basis, /largest amount on the page/);
  assert.match(r.amount.basis, /may be a line item/);
});

test('fields below the confidence floor are null, not guessed', () => {
  const r = extractFields('Just some prose with no structured data at all.');
  assert.equal(r.invoiceNumber.value, null);
  assert.equal(r.invoiceDate.value, null);
  assert.equal(r.amount.value, null);
  assert.deepEqual(r.needsManualEntry.sort(), ['amount', 'invoiceDate', 'invoiceNumber', 'vendor']);
});

test('US dates are normalised to ISO', () => {
  const r = extractFields('Date: 8/14/26\nTotal Due: 50.00');
  assert.equal(r.invoiceDate.value, '2026-08-14');
});

test('confidence reflects ambiguity: labelled beats unlabelled', () => {
  const labelled = extractFields('Invoice Number: A-1\nTotal Due: 10.00');
  const bare = extractFields('X\n10.00');
  assert.ok(labelled.amount.confidence > bare.amount.confidence);
});
