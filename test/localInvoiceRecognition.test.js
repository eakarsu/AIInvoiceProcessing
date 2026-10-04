'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { recognizeOriginal } = require('../server/domain/localInvoiceRecognition');

const run = process.env.RUN_INVOICE_OCR_TEST === '1' ? test : test.skip;

function textLayerPdf() {
  const drawing = 'BT /F1 20 Tf 40 700 Td (Invoice No: INV-125) Tj 0 -35 Td (Date: 2026-10-04) Tj 0 -35 Td (Total: 100.00) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(drawing)} >>\nstream\n${drawing}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

run('real image, scanned PDF, and text-layer PDF recognition preserve method and source evidence', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'invoice-ocr-test-'));
  try {
    const image = path.join(directory, 'invoice.png');
    const pdf = path.join(directory, 'invoice.pdf');
    execFileSync('magick', ['-size', '1700x600', 'xc:white', '-font', 'Helvetica', '-pointsize', '60',
      '-fill', 'black', '-annotate', '+50+120', 'Invoice No: INV-123',
      '-annotate', '+50+240', 'Date: 2026-10-04',
      '-annotate', '+50+360', 'Service  2  50.00  100.00',
      '-annotate', '+50+480', 'Total: 100.00', image]);
    execFileSync('magick', [image, pdf]);
    for (const [file, mediaType, method] of [
      [image, 'image/png', 'tesseract_image'],
      [pdf, 'application/pdf', 'tesseract_pdf_pages'],
    ]) {
      const result = await recognizeOriginal(await fs.readFile(file), mediaType);
      assert.match(result.text, /INV-123/);
      assert.match(result.text, /100\.00/);
      assert.equal(result.recognition.method, method);
      assert.equal(result.recognition.pages, 1);
      assert.ok(result.recognition.meanConfidence > 0.5);
      assert.ok(result.recognition.lineBoxes.some(line => line.box.width > 0 && line.confidence > 0.5));
    }
    const selectable = await recognizeOriginal(textLayerPdf(), 'application/pdf');
    assert.equal(selectable.recognition.method, 'pdf_text_layer');
    assert.match(selectable.text, /INV-125/);
    assert.equal(selectable.recognition.meanConfidence, null);
    const forced = await recognizeOriginal(textLayerPdf(), 'application/pdf', { forceOcr: true });
    assert.equal(forced.recognition.method, 'tesseract_pdf_pages');
    assert.match(forced.text, /INV-125/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
