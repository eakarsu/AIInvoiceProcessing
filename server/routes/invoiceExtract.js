/**
 * Invoice field extraction (the "OCR" stage of AP).
 *
 * TOP20.md launch condition for rank 15: "OCR/accounting integrations and
 * reconciliation". This is the extraction half.
 *
 * Rules:
 *   - pluggable provider; with no OCR key it reports provider: "none",
 *     connected: false and processes supplied text only. It never pretends to
 *     have read an image it could not read.
 *   - every field carries the source span it came from and a confidence.
 *   - fields below the confidence floor come back null for manual entry.
 */
const { Router } = require('express');



const router = Router();
const CONFIDENCE_FLOOR = Number(process.env.OCR_CONFIDENCE_FLOOR ?? 0.6);

function ocrProvider() {
  const key = process.env.OCR_API_KEY;
  const provider = process.env.OCR_PROVIDER || 'none';
  if (!key || provider === 'none') {
    return { name: 'none', connected: false, reason: 'No OCR_API_KEY configured; processing supplied text only.' };
  }
  return { name: provider, connected: true, reason: null };
}

const AMOUNT = /(?:USD|EUR|GBP|\$|€|£)?\s*(-?\d{1,3}(?:,\d{3})*(?:\.\d{2})|-\d+(?:\.\d{2})?)/;
const INVOICE_NO = /\b(?:invoice|inv|bill)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-\/]{2,29})\b/i;
const DATE = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}-\d{1,2}-\d{2,4})\b/;
const VENDOR_LINE = /^\s*(?:from|vendor|supplier|bill\s*to)\s*[:\-]\s*(.+)$/im;

function field(value, confidence, evidence, basis) {
  const ok = value != null && confidence >= CONFIDENCE_FLOOR;
  return {
    value: ok ? value : null,
    confidence: Number(confidence.toFixed(2)),
    evidence,
    basis: ok ? basis : basis + ' Below the ' + CONFIDENCE_FLOOR + ' confidence floor — left for manual entry.',
  };
}

function normaliseDate(raw) {
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const us = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(s);
  if (us) {
    const y = us[3].length === 2 ? '20' + us[3] : us[3];
    return y + '-' + us[1].padStart(2, '0') + '-' + us[2].padStart(2, '0');
  }
  return null;
}

function extractFields(text) {
  const src = String(text ?? '');
  const lines = src.split(/\r?\n/);

  const labelledNo = INVOICE_NO.exec(src);
  const invoiceNumber = labelledNo
    ? field(labelledNo[1], 0.95, labelledNo[0].trim(), 'Labelled "invoice/number/#" match.')
    : field(null, 0, null, 'No labelled invoice number found.');

  const labelledDate = /\b(?:invoice\s*date|date)\s*[:\-]?\s*/i.exec(src);
  const dateMatch = labelledDate ? DATE.exec(src.slice(labelledDate.index, labelledDate.index + 60)) : null;
  const invoiceDate = field(
    dateMatch ? normaliseDate(dateMatch[1]) : null,
    dateMatch ? (labelledDate ? 0.9 : 0.55) : 0,
    dateMatch ? dateMatch[0].trim() : null,
    dateMatch
      ? labelledDate
        ? 'Found a date immediately after a "date" label.'
        : 'Found a date pattern with no label; could be a due date.'
      : 'No date pattern found.'
  );

  const labelledTotal = /\b(?:total\s*(?:amount|due)?|amount\s*due|grand\s*total|balance\s*due)\s*[:\-]?\s*/i.exec(src);
  let amountValue = null, amountEvidence = null, amountConfidence = 0;
  let amountBasis = 'No monetary amount found.';

  if (labelledTotal) {
    const near = src.slice(labelledTotal.index, labelledTotal.index + 60);
    const m = AMOUNT.exec(near);
    if (m) {
      amountValue = Number(m[1].replace(/,/g, ''));
      amountEvidence = (labelledTotal[0] + m[1]).trim();
      amountConfidence = 0.95;
      amountBasis = 'Found a monetary amount immediately after a "total"/"amount due" label.';
    }
  }
  if (amountValue == null) {
    const all = [...src.matchAll(new RegExp(AMOUNT.source, 'g'))]
      .map((m) => Number(m[1].replace(/,/g, '')))
      .filter((n) => Number.isFinite(n));
    if (all.length) {
      amountValue = Math.max(...all);
      amountEvidence = String(amountValue);
      // Surfaced (not nulled) but clearly below a labelled total: the basis
      // warns it may be a line item, and the clerk decides.
      amountConfidence = 0.65;
      amountBasis = 'No labelled total; took the largest amount on the page. This may be a line item, not the total.';
    }
  }
  const amount = field(amountValue, amountConfidence, amountEvidence, amountBasis);

  const vendorLabel = VENDOR_LINE.exec(src);
  const firstLine = (lines.find((l) => l.trim().length > 2) ?? '').trim();
  const vendor = vendorLabel
    ? field(vendorLabel[1].trim().slice(0, 160), 0.9, vendorLabel[0].trim(), 'Labelled "from/vendor/supplier" line.')
    : field(firstLine.slice(0, 160) || null, 0.4, firstLine || null, 'No vendor label; used the first non-empty line of the document.');

  const entries = [['invoiceNumber', invoiceNumber], ['invoiceDate', invoiceDate], ['amount', amount], ['vendor', vendor]];

  return {
    invoiceNumber, invoiceDate, amount, vendor,
    extractedFieldCount: entries.filter(([, f]) => f.value != null).length,
    needsManualEntry: entries.filter(([, f]) => f.value == null).map(([k]) => k),
  };
}

function createInvoiceExtractRouter(authMiddleware, pool) {

/** Run extraction over supplied document text. */
  router.post('/extract', authenticateToken, async (req, res) => {
  try {
    const provider = ocrProvider();
    const { text, imageBase64 } = req.body || {};

    if (!text && imageBase64) {
      if (!provider.connected) {
        return res.status(503).json({
          error: 'Image supplied but no OCR provider is configured (OCR_API_KEY). Pass `text` with the recognised content, or configure a provider.',
          provider,
        });
      }
      return res.status(501).json({
        error: 'OCR provider "' + provider.name + '" is configured but its recognition adapter is not implemented.',
        provider,
      });
    }
    if (!String(text ?? '').trim()) {
      return res.status(400).json({ error: 'text (recognised document content) is required' });
    }

    res.json({
      provider,
      extraction: extractFields(String(text)),
      confidenceFloor: CONFIDENCE_FLOOR,
      assumptions: [
        'Extraction is deterministic pattern matching over the supplied text; no model is consulted.',
        'Confidence reflects match ambiguity, and values below the floor are returned as null.',
        'Every field names the source span it was read from.',
        'An unlabelled amount is flagged as possibly a line item rather than the total.',
      ],
    });
  } catch (e) {
    console.error('extract error:', e);
    res.status(500).json({ error: e.message || 'Extraction failed' });
  }
});

/** Extract and persist onto an invoice row, advancing it to "extracted". */
  router.post('/extract/:id', authenticateToken, async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!String(text ?? '').trim()) return res.status(400).json({ error: 'text is required' });

    const existing = (await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Invoice not found' });

    const extraction = extractFields(String(text));
    const changes = {};
    const set = (col, key) => {
      const f = extraction[key];
      if (f.value == null) return;
      if (String(existing[col] ?? '') !== String(f.value)) {
        changes[col] = { from: existing[col], to: f.value, confidence: f.confidence };
      }
    };
    set('invoice_number', 'invoiceNumber');
    set('invoice_date', 'invoiceDate');
    set('amount', 'amount');

    if (Object.keys(changes).length === 0) {
      return res.json({ updated: false, extraction, note: 'Extraction produced no changes; the row already matches.' });
    }

    const cols = Object.keys(changes);
    const assigns = cols.map((c, i) => c + ' = $' + (i + 1)).join(', ');
    await pool.query(
      'UPDATE invoices SET ' + assigns + " , status = CASE WHEN status = 'ingested' THEN 'extracted' ELSE status END, revision = revision + 1, updated_at = NOW() WHERE id = $" + (cols.length + 1),
      [...cols.map((c) => changes[c].to), req.params.id]
    );

    res.json({
      updated: true, changes, extraction,
      needsManualEntry: extraction.needsManualEntry,
      note: 'Status advanced to "extracted" only from "ingested"; reviewed states are not downgraded.',
    });
  } catch (e) {
    console.error('extract-persist error:', e);
    res.status(500).json({ error: e.message || 'Extraction failed' });
  }
});

  return router;
}

module.exports = createInvoiceExtractRouter;
module.exports.extractFields = extractFields;
