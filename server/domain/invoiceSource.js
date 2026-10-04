'use strict';

const crypto = require('node:crypto');

const MAX_BYTES = 20 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'text/plain']);

function sourceError(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function detectedType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_BYTES) return null;
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-' && bytes.subarray(-1024).toString('ascii').includes('%%EOF')) return 'application/pdf';
  if (bytes.length >= 12 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) && bytes.subarray(-2).equals(Buffer.from([0xff, 0xd9]))) return 'image/jpeg';
  if (bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0 &&
      bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND') return 'image/png';
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.trim() && !/[\x00-\x08\x0b\x0e-\x1f]/.test(text)) return 'text/plain';
  } catch (_) { /* not valid UTF-8 text */ }
  return null;
}

function assertOriginal(document, blob) {
  if (!document || !blob?.content) throw sourceError('ORIGINAL_MISSING', 'The original invoice file is not stored for this case.');
  const bytes = Buffer.from(blob.content);
  const actual = sha256(bytes);
  if (actual !== document.content_digest || actual !== blob.content_digest ||
      bytes.length !== Number(document.byte_size) || bytes.length !== Number(blob.byte_size) ||
      document.media_type !== blob.media_type || !SUPPORTED_TYPES.has(document.media_type)) {
    throw sourceError('ORIGINAL_CHECKSUM_MISMATCH', 'Stored invoice bytes do not match the immutable document metadata.');
  }
  return bytes;
}

function sourceText(document, blob, derived = null) {
  const bytes = assertOriginal(document, blob);
  if (document.media_type !== 'text/plain') {
    if (!derived || derived.source_content_digest !== document.content_digest ||
        String(derived.document_id) !== String(document.id) ||
        String(derived.invoice_case_id) !== String(document.invoice_case_id) ||
        String(derived.tenant_id) !== String(document.tenant_id)) {
      throw sourceError('SOURCE_TEXT_UNAVAILABLE', 'The original is stored, but PDF/image text extraction or OCR is not configured for this document.');
    }
    const text = String(derived.text_content || '');
    const digest = sha256(Buffer.from(text, 'utf8'));
    if (!text.trim() || text.includes('\0') || text.length > 300000 || digest !== derived.text_digest) {
      throw sourceError('SOURCE_TEXT_CHECKSUM_MISMATCH', 'Stored recognition text does not match its immutable digest.');
    }
    return { text, textDigest: digest, sourceTextId: derived.id, recognition: derived.recognition };
  }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n'); }
  catch (_) { throw sourceError('SOURCE_TEXT_INVALID', 'The stored text invoice is not valid UTF-8.'); }
  if (!text.trim() || text.includes('\0')) throw sourceError('SOURCE_TEXT_INVALID', 'The stored text invoice has no usable text.');
  return { text, textDigest: sha256(Buffer.from(text, 'utf8')) };
}

function positionAt(text, start, length) {
  const before = text.slice(0, start);
  const page = before.split('\f').length;
  const pageText = before.slice(before.lastIndexOf('\f') + 1);
  const line = pageText.split('\n').length;
  const column = pageText.slice(pageText.lastIndexOf('\n') + 1).length + 1;
  return { page, line, column, charStart: start, charEnd: start + length };
}

function verifiedSpan(text, item, label) {
  const quote = item?.quote;
  const position = item?.position;
  const start = Number(position?.charStart), end = Number(position?.charEnd);
  if (typeof quote !== 'string' || !quote.trim() || quote.length > 1000 || /[\n\f]/.test(quote) ||
      !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > text.length ||
      text.slice(start, end) !== quote) {
    throw sourceError('SOURCE_SPAN_MISMATCH', `${label} must quote an exact span of the stored original.`);
  }
  const actual = positionAt(text, start, quote.length);
  if (['page', 'line', 'column', 'charStart', 'charEnd'].some(key => Number(position[key]) !== actual[key])) {
    throw sourceError('SOURCE_SPAN_MISMATCH', `${label} page, line, or character position does not match the stored original.`);
  }
  return quote;
}

function numbersIn(quote) {
  return [...quote.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)]
    .map(match => Number(match[0].replace(/,/g, '')))
    .filter(Number.isFinite);
}

function containsNumber(quote, value) {
  return numbersIn(quote).some(number => Math.abs(number - Number(value)) <= 0.001);
}

function dateIn(quote, expected) {
  if (quote.includes(expected)) return true;
  for (const match of quote.matchAll(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g)) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    if (`${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` === expected) return true;
  }
  return false;
}

function verifyCandidateEvidence(text, candidate, evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw sourceError('SOURCE_EVIDENCE_REQUIRED', 'Field and line source evidence is required.');
  }
  const invoiceNo = verifiedSpan(text, evidence.invoiceNumber, 'invoiceNumber');
  const invoiceDate = verifiedSpan(text, evidence.invoiceDate, 'invoiceDate');
  const total = verifiedSpan(text, evidence.total, 'total');
  const compact = value => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (!compact(invoiceNo).includes(compact(candidate.invoiceNumber)) || !dateIn(invoiceDate, String(candidate.invoiceDate || '')) || !containsNumber(total, candidate.total)) {
    throw sourceError('SOURCE_VALUE_MISMATCH', 'Invoice number, date, or total is not supported by its cited original span.');
  }
  if (!Array.isArray(candidate.lines) || !Array.isArray(evidence.lines) || evidence.lines.length !== candidate.lines.length) {
    throw sourceError('SOURCE_EVIDENCE_REQUIRED', 'Every candidate line needs one cited original line.');
  }
  evidence.lines.forEach((span, index) => {
    const quote = verifiedSpan(text, span, `line ${index + 1}`);
    const line = candidate.lines[index];
    if (!compact(quote).includes(compact(line.description)) ||
        ![line.quantity, line.unitPrice, line.net].every(value => containsNumber(quote, value))) {
      throw sourceError('SOURCE_VALUE_MISMATCH', `Line ${index + 1} values are not supported by the cited original span.`);
    }
  });
  return { verified: true, evidenceDigest: sha256(Buffer.from(JSON.stringify(evidence), 'utf8')) };
}

module.exports = { MAX_BYTES, SUPPORTED_TYPES, sha256, detectedType, assertOriginal, sourceText, positionAt, verifyCandidateEvidence, sourceError };
