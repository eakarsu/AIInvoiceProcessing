'use strict';

const express = require('express');
const crypto = require('node:crypto');
const multer = require('multer');
const pool = require('../db');
const { authorizeTransition, digest, duplicateFingerprint, threeWayMatch, validateExtraction } = require('../domain/invoicePolicy');
const { MAX_BYTES, sha256, detectedType, assertOriginal, sourceText, positionAt, verifyCandidateEvidence, sourceError } = require('../domain/invoiceSource');
const { recognizeOriginal } = require('../domain/localInvoiceRecognition');
const { extractFields } = require('./invoiceExtract');
const { providerReadiness } = require('../services/providerBoundary');

function buildGovernedInvoiceRouter(authMiddleware) {
  const router = express.Router();
  router.use(authMiddleware);

  const tenantId = (req) => String(req.user?.tenantId || '');
  const roles = (...allowed) => (req, res, next) => allowed.includes(req.user?.role) ? next() : res.status(403).json({ error: 'insufficient AP role' });
  const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: MAX_BYTES } });
  const oneFile = (req, res, next) => upload.single('file')(req, res, error => {
    if (error) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 422).json({ error: error.message });
    next();
  });

  async function transaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  function fail(res, error, fallback) {
    if (error.code === '23505') return res.status(409).json({ error: 'duplicate invoice or idempotency conflict' });
    const status = error.status || (/required|must|missing|outside|does not/.test(error.message) ? 422 : 500);
    res.status(status).json({ error: status === 500 ? fallback : error.message });
  }

  function checkedUpload(req) {
    if (!req.file?.buffer?.length) throw sourceError('ORIGINAL_FILE_REQUIRED', 'Choose an original invoice file.', 422);
    const mediaType = detectedType(req.file.buffer);
    if (!mediaType) throw sourceError('ORIGINAL_FILE_INVALID', 'Upload a readable PDF, JPEG, PNG, or UTF-8 text invoice up to 20 MB.', 422);
    if (req.file.mimetype && !['application/octet-stream', mediaType].includes(req.file.mimetype)) {
      throw sourceError('ORIGINAL_TYPE_MISMATCH', 'The declared file type does not match the invoice bytes.', 422);
    }
    return { bytes: req.file.buffer, mediaType, contentDigest: sha256(req.file.buffer), byteSize: req.file.buffer.length };
  }

  async function storedDocument(queryable, tenant, caseId, documentId) {
    const rows = await queryable.query(
      `SELECT d.id, d.tenant_id, d.invoice_case_id, d.source, d.storage_object_key,
              d.content_digest, d.media_type, d.byte_size,
              b.content, b.content_digest AS blob_digest, b.media_type AS blob_media_type,
              b.byte_size AS blob_byte_size, b.stored_at
       FROM invoice_documents d LEFT JOIN invoice_document_blobs b
         ON b.document_id=d.id AND b.tenant_id=d.tenant_id AND b.invoice_case_id=d.invoice_case_id
       WHERE d.id=$1 AND d.invoice_case_id=$2 AND d.tenant_id=$3`,
      [documentId, caseId, tenant]
    );
    const row = rows.rows[0];
    if (!row) throw sourceError('DOCUMENT_NOT_FOUND', 'Invoice document not found in this tenant case.', 404);
    const document = { ...row };
    const blob = row.content ? {
      content: row.content, content_digest: row.blob_digest,
      media_type: row.blob_media_type, byte_size: row.blob_byte_size,
    } : null;
    return { document, blob };
  }

  async function storedRecognition(queryable, tenant, caseId, documentId, sourceTextId = null) {
    const rows = await queryable.query(
      `SELECT * FROM invoice_source_texts WHERE tenant_id=$1 AND invoice_case_id=$2 AND document_id=$3
       ${sourceTextId == null ? '' : 'AND id=$4'} ORDER BY created_at DESC,id DESC LIMIT 1`,
      sourceTextId == null ? [tenant, caseId, documentId] : [tenant, caseId, documentId, sourceTextId]
    );
    return rows.rows[0] || null;
  }

  async function reviewedSource(queryable, tenant, caseId) {
    const latest = await queryable.query(
      `SELECT source_document_id, source_text_id, source_content_digest, source_text_digest,
              source_evidence, candidate, deterministic_validation
       FROM invoice_extractions WHERE tenant_id=$1 AND invoice_case_id=$2
       ORDER BY created_at DESC,id DESC LIMIT 1`, [tenant, caseId]
    );
    const extraction = latest.rows[0];
    if (!extraction?.source_document_id || extraction.deterministic_validation?.ok !== true) {
      throw sourceError('VERIFIED_EXTRACTION_REQUIRED', 'Review requires a valid extraction tied to a stored original.');
    }
    const { document, blob } = await storedDocument(queryable, tenant, caseId, extraction.source_document_id);
    const derived = extraction.source_text_id == null ? null :
      await storedRecognition(queryable, tenant, caseId, document.id, extraction.source_text_id);
    const { text, textDigest } = sourceText(document, blob, derived);
    if (document.content_digest !== extraction.source_content_digest || textDigest !== extraction.source_text_digest) {
      throw sourceError('SOURCE_CHECKSUM_MISMATCH', 'The reviewed extraction no longer matches the stored original.');
    }
    verifyCandidateEvidence(text, extraction.candidate, extraction.source_evidence);
    return extraction;
  }

  router.get('/providers/readiness', (_req, res) => {
    const readiness = providerReadiness();
    res.status(readiness.ready ? 200 : 503).json(readiness);
  });

  router.get('/', roles('submitter', 'ap_analyst', 'approver', 'auditor', 'admin'), async (req, res) => {
    try {
      const tenant = tenantId(req);
      if (!tenant) return res.status(403).json({ error: 'active tenant membership is required' });
      const rows = await pool.query(
        `SELECT id,submitter_id,vendor_id,invoice_number,invoice_date,amount,currency,status,revision,created_at,updated_at
         FROM invoice_cases WHERE tenant_id=$1 AND ($2<>'submitter' OR submitter_id=$3)
         ORDER BY created_at DESC,id DESC LIMIT 200`, [tenant, req.user.role, req.user.id]);
      res.json(rows.rows);
    } catch (error) { fail(res, error, 'invoice cases could not be loaded'); }
  });

  router.get('/:id', roles('submitter', 'ap_analyst', 'approver', 'auditor', 'admin'), async (req, res) => {
    try {
      const tenant = tenantId(req);
      if (!tenant) return res.status(403).json({ error: 'active tenant membership is required' });
      const cases = await pool.query(
        `SELECT * FROM invoice_cases WHERE id=$1 AND tenant_id=$2 AND ($3<>'submitter' OR submitter_id=$4)`,
        [req.params.id, tenant, req.user.role, req.user.id]);
      if (!cases.rows[0]) return res.status(404).json({ error: 'invoice case not found' });
      const id = cases.rows[0].id;
      const [documents, extractions, matches, exceptions, approvals, events, reconciliations] = await Promise.all([
        pool.query(`SELECT d.id,d.tenant_id,d.invoice_case_id,d.source,d.storage_object_key,
                          d.content_digest,d.media_type,d.byte_size,d.received_at,
                          (b.document_id IS NOT NULL) AS original_stored,b.stored_at
                   FROM invoice_documents d LEFT JOIN invoice_document_blobs b
                     ON b.document_id=d.id AND b.tenant_id=d.tenant_id AND b.invoice_case_id=d.invoice_case_id
                   WHERE d.invoice_case_id=$1 AND d.tenant_id=$2 ORDER BY d.id`, [id, tenant]),
        pool.query('SELECT * FROM invoice_extractions WHERE invoice_case_id=$1 AND tenant_id=$2 ORDER BY created_at DESC,id DESC', [id, tenant]),
        pool.query('SELECT * FROM invoice_match_results WHERE invoice_case_id=$1 AND tenant_id=$2 ORDER BY created_at DESC,id DESC', [id, tenant]),
        pool.query('SELECT * FROM invoice_exceptions WHERE invoice_case_id=$1 AND tenant_id=$2 ORDER BY created_at,id', [id, tenant]),
        pool.query('SELECT actor_id,decision,created_at FROM invoice_approvals WHERE invoice_case_id=$1 AND tenant_id=$2 ORDER BY created_at,id', [id, tenant]),
        pool.query('SELECT * FROM invoice_workflow_events WHERE invoice_case_id=$1 AND tenant_id=$2 ORDER BY occurred_at,id', [id, tenant]),
        pool.query('SELECT * FROM invoice_reconciliations WHERE invoice_case_id=$1 AND tenant_id=$2 ORDER BY id DESC', [id, tenant]),
      ]);
      res.json({ invoiceCase: cases.rows[0], documents: documents.rows, extractions: extractions.rows,
        matches: matches.rows, exceptions: exceptions.rows, approvals: approvals.rows,
        events: events.rows, reconciliations: reconciliations.rows });
    } catch (error) { fail(res, error, 'invoice case could not be loaded'); }
  });

  router.post('/ingest-upload', roles('submitter', 'ap_analyst', 'admin'), oneFile, async (req, res) => {
    try {
      const tenant = tenantId(req);
      if (!tenant) return res.status(403).json({ error: 'active tenant membership is required' });
      const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
      if (!idempotencyKey || idempotencyKey.length > 128) return res.status(422).json({ error: 'a 1–128 character idempotency key is required' });
      const original = checkedUpload(req);
      const source = String(req.body?.source || 'staff_upload').trim().slice(0, 120);
      if (!source) return res.status(422).json({ error: 'source is required' });
      const result = await transaction(async client => {
        const replay = await client.query('SELECT * FROM invoice_cases WHERE tenant_id=$1 AND idempotency_key=$2', [tenant, idempotencyKey]);
        if (replay.rows[0]) {
          if (req.user.role === 'submitter' && Number(replay.rows[0].submitter_id) !== Number(req.user.id)) {
            throw sourceError('IDEMPOTENCY_SCOPE', 'Invoice case not found for this submitter.', 404);
          }
          const documents = await client.query('SELECT id FROM invoice_documents WHERE tenant_id=$1 AND invoice_case_id=$2 ORDER BY id LIMIT 1', [tenant, replay.rows[0].id]);
          if (!documents.rows[0]) throw sourceError('IDEMPOTENCY_CONFLICT', 'This key belongs to a case without the uploaded original.');
          const { document, blob } = await storedDocument(client, tenant, replay.rows[0].id, documents.rows[0].id);
          assertOriginal(document, blob);
          if (document.content_digest !== original.contentDigest || Number(document.byte_size) !== original.byteSize || document.media_type !== original.mediaType) {
            throw sourceError('IDEMPOTENCY_CONFLICT', 'This key was used with different original bytes.');
          }
          return { invoiceCase: replay.rows[0], documentId: document.id, replayed: true };
        }
        const created = await client.query(
          `INSERT INTO invoice_cases (tenant_id,idempotency_key,submitter_id,status)
           VALUES ($1,$2,$3,'ingested') RETURNING *`, [tenant, idempotencyKey, req.user.id]
        );
        const document = await client.query(
          `INSERT INTO invoice_documents
           (tenant_id,invoice_case_id,source,storage_object_key,content_digest,media_type,byte_size)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [tenant, created.rows[0].id, source, `postgres-original:${crypto.randomUUID()}`,
            original.contentDigest, original.mediaType, original.byteSize]
        );
        await client.query(
          `INSERT INTO invoice_document_blobs
           (document_id,tenant_id,invoice_case_id,content,content_digest,media_type,byte_size)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [document.rows[0].id, tenant, created.rows[0].id, original.bytes,
            original.contentDigest, original.mediaType, original.byteSize]
        );
        await client.query(
          `INSERT INTO invoice_workflow_events
           (tenant_id,invoice_case_id,actor_id,event_type,to_status,payload,evidence_digest)
           VALUES ($1,$2,$3,'original_uploaded','ingested',$4,$5)`,
          [tenant, created.rows[0].id, req.user.id,
            { documentId: document.rows[0].id, source, mediaType: original.mediaType, byteSize: original.byteSize }, original.contentDigest]
        );
        return { invoiceCase: created.rows[0], documentId: document.rows[0].id, replayed: false };
      });
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) { fail(res, error, 'original invoice upload failed'); }
  });

  router.post('/:id/documents/:documentId/upload', roles('submitter', 'ap_analyst', 'admin'), oneFile, async (req, res) => {
    try {
      const tenant = tenantId(req);
      if (!tenant) return res.status(403).json({ error: 'active tenant membership is required' });
      const original = checkedUpload(req);
      const result = await transaction(async client => {
        const cases = await client.query(
          `SELECT id,submitter_id,status FROM invoice_cases WHERE id=$1 AND tenant_id=$2
           AND ($3<>'submitter' OR submitter_id=$4) FOR UPDATE`,
          [req.params.id, tenant, req.user.role, req.user.id]
        );
        const invoice = cases.rows[0];
        if (!invoice) throw sourceError('CASE_NOT_FOUND', 'Invoice case not found in your tenant scope.', 404);
        if (!['ingested', 'extracted', 'exception', 'validated'].includes(invoice.status)) {
          throw sourceError('ORIGINAL_ATTACH_CLOSED', 'This case no longer accepts an original attachment.');
        }
        const { document, blob } = await storedDocument(client, tenant, invoice.id, req.params.documentId);
        if (blob) throw sourceError('ORIGINAL_ALREADY_STORED', 'This document already has immutable original bytes.');
        if (document.content_digest !== original.contentDigest || Number(document.byte_size) !== original.byteSize || document.media_type !== original.mediaType) {
          throw sourceError('ORIGINAL_CHECKSUM_MISMATCH', 'Selected bytes do not match the registered document digest, size, and type.');
        }
        await client.query(
          `INSERT INTO invoice_document_blobs
           (document_id,tenant_id,invoice_case_id,content,content_digest,media_type,byte_size)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [document.id, tenant, invoice.id, original.bytes,
            original.contentDigest, original.mediaType, original.byteSize]
        );
        await client.query(
          `INSERT INTO invoice_workflow_events
           (tenant_id,invoice_case_id,actor_id,event_type,from_status,to_status,payload,evidence_digest)
           VALUES ($1,$2,$3,'original_attached',$4,$4,$5,$6)`,
          [tenant, invoice.id, req.user.id, invoice.status, { documentId: document.id, mediaType: original.mediaType }, original.contentDigest]
        );
        return { documentId: document.id, contentDigest: original.contentDigest, byteSize: original.byteSize };
      });
      res.status(201).json(result);
    } catch (error) { fail(res, error, 'original invoice attachment failed'); }
  });

  router.get('/:id/documents/:documentId/content', roles('submitter', 'ap_analyst', 'approver', 'auditor', 'admin'), async (req, res) => {
    try {
      const tenant = tenantId(req);
      if (!tenant) return res.status(403).json({ error: 'active tenant membership is required' });
      const cases = await pool.query(
        `SELECT id FROM invoice_cases WHERE id=$1 AND tenant_id=$2
         AND ($3<>'submitter' OR submitter_id=$4)`,
        [req.params.id, tenant, req.user.role, req.user.id]
      );
      if (!cases.rows[0]) return res.status(404).json({ error: 'invoice case not found' });
      const { document, blob } = await storedDocument(pool, tenant, req.params.id, req.params.documentId);
      const bytes = assertOriginal(document, blob);
      const extension = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'text/plain': 'txt' }[document.media_type];
      res.set({
        'Content-Type': document.media_type,
        'Content-Length': String(bytes.length),
        'Content-Disposition': `attachment; filename="invoice-original-${document.id}.${extension}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox',
      });
      res.send(bytes);
    } catch (error) { fail(res, error, 'original invoice retrieval failed'); }
  });

  router.post('/:id/documents/:documentId/recognize', roles('ap_analyst', 'admin'), async (req, res) => {
    try {
      const tenant = tenantId(req);
      if (!tenant) return res.status(403).json({ error: 'active tenant membership is required' });
      const cases = await pool.query('SELECT id,status FROM invoice_cases WHERE id=$1 AND tenant_id=$2', [req.params.id, tenant]);
      if (!cases.rows[0]) return res.status(404).json({ error: 'invoice case not found' });
      if (!['ingested', 'extracted', 'exception'].includes(cases.rows[0].status)) {
        return res.status(409).json({ error: 'invoice no longer accepts recognition evidence' });
      }
      const { document, blob } = await storedDocument(pool, tenant, req.params.id, req.params.documentId);
      const bytes = assertOriginal(document, blob);
      if (document.media_type === 'text/plain') return res.status(422).json({ error: 'Text originals do not need OCR.' });
      const mode = req.body?.mode || 'auto';
      if (!['auto', 'ocr'].includes(mode)) return res.status(422).json({ error: 'Recognition mode must be auto or ocr.' });
      if (req.body?.force !== true) {
        const existing = await storedRecognition(pool, tenant, req.params.id, document.id);
        if (existing) return res.json({ sourceTextId: existing.id, sourceTextDigest: existing.text_digest,
          recognition: existing.recognition, replayed: true });
      }
      const result = await recognizeOriginal(bytes, document.media_type, { forceOcr: mode === 'ocr' });
      const textDigest = sha256(Buffer.from(result.text, 'utf8'));
      const stored = await transaction(async client => {
        const check = await storedDocument(client, tenant, req.params.id, document.id);
        assertOriginal(check.document, check.blob);
        const inserted = await client.query(
          `INSERT INTO invoice_source_texts
           (tenant_id,invoice_case_id,document_id,source_content_digest,text_content,text_digest,recognition,created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (document_id,text_digest) DO NOTHING RETURNING *`,
          [tenant, req.params.id, document.id, document.content_digest, result.text, textDigest, result.recognition, req.user.id]
        );
        if (!inserted.rows[0]) {
          const replay = await client.query(
            'SELECT * FROM invoice_source_texts WHERE tenant_id=$1 AND invoice_case_id=$2 AND document_id=$3 AND text_digest=$4',
            [tenant, req.params.id, document.id, textDigest]
          );
          return { row: replay.rows[0], replayed: true };
        }
        await client.query(
          `INSERT INTO invoice_workflow_events
           (tenant_id,invoice_case_id,actor_id,event_type,from_status,to_status,payload,evidence_digest)
           VALUES ($1,$2,$3,'source_recognized',$4,$4,$5,$6)`,
          [tenant, req.params.id, req.user.id, cases.rows[0].status,
            { documentId: document.id, sourceTextId: inserted.rows[0].id,
              method: result.recognition.method, pages: result.recognition.pages,
              meanConfidence: result.recognition.meanConfidence }, textDigest]
        );
        return { row: inserted.rows[0], replayed: false };
      });
      res.status(stored.replayed ? 200 : 201).json({ sourceTextId: stored.row.id, sourceTextDigest: stored.row.text_digest,
        recognition: stored.row.recognition, replayed: stored.replayed });
    } catch (error) { fail(res, error, 'invoice recognition failed'); }
  });

  router.get('/:id/documents/:documentId/source-hints', roles('submitter', 'ap_analyst', 'admin'), async (req, res) => {
    try {
      const tenant = tenantId(req);
      if (!tenant) return res.status(403).json({ error: 'active tenant membership is required' });
      const cases = await pool.query(
        `SELECT id FROM invoice_cases WHERE id=$1 AND tenant_id=$2
         AND ($3<>'submitter' OR submitter_id=$4)`,
        [req.params.id, tenant, req.user.role, req.user.id]
      );
      if (!cases.rows[0]) return res.status(404).json({ error: 'invoice case not found' });
      const { document, blob } = await storedDocument(pool, tenant, req.params.id, req.params.documentId);
      const derived = document.media_type === 'text/plain' ? null :
        await storedRecognition(pool, tenant, req.params.id, document.id);
      const { text, textDigest, sourceTextId, recognition } = sourceText(document, blob, derived);
      const extraction = extractFields(text);
      if (Array.isArray(recognition?.lineBoxes)) {
        const boxes = new Map(recognition.lineBoxes.map(line => [`${line.page}:${line.line}`, line]));
        for (const hint of [extraction.invoiceNumber, extraction.invoiceDate, extraction.amount, extraction.vendor,
          ...extraction.lineCandidates]) {
          const location = hint?.sourcePosition;
          const found = location && boxes.get(`${location.page}:${location.line}`);
          if (found) {
            hint.recognitionConfidence = found.confidence;
            hint.sourcePosition.box = found.box;
          }
        }
      }
      const span = hint => {
        if (!hint?.evidence) return null;
        let start = hint.sourcePosition?.charStart;
        if (!Number.isSafeInteger(start) || text.slice(start, start + hint.evidence.length) !== hint.evidence) start = text.indexOf(hint.evidence);
        return start < 0 ? null : { quote: hint.evidence, position: positionAt(text, start, hint.evidence.length) };
      };
      res.set('Cache-Control', 'private, no-store');
      res.json({
        sourceDocumentId: document.id, sourceContentDigest: document.content_digest,
        sourceTextId: sourceTextId || null, sourceTextDigest: textDigest, extraction,
        sourceEvidenceTemplate: {
          invoiceNumber: span(extraction.invoiceNumber), invoiceDate: span(extraction.invoiceDate),
          total: span(extraction.amount), lines: extraction.lineCandidates.map(span),
        },
        provider: { name: recognition?.method || 'stored_text_pattern_matching', modelCalled: false,
          ocrCalled: Boolean(recognition?.method?.startsWith('tesseract')) },
        recognition: recognition || null,
        recognizedText: document.media_type === 'text/plain' ? null : text,
        note: document.media_type === 'text/plain'
          ? 'Positions refer to the UTF-8 text decoded from the stored original. Verify every candidate before AP review.'
          : 'Positions and page line numbers refer to immutable recognized text derived from the stored original. Compare the original image/PDF and every candidate before AP review; OCR can misread values.',
      });
    } catch (error) { fail(res, error, 'stored source hints failed'); }
  });

  router.post('/ingest', roles('submitter', 'ap_analyst', 'admin'), async (req, res) => {
    try {
      const tenant = tenantId(req);
      if (!tenant) return res.status(403).json({ error: 'active tenant membership is required' });
      const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
      const { source, storageObjectKey, contentDigest, mediaType, byteSize } = req.body || {};
      if (!idempotencyKey || !String(source || '').trim() || !String(storageObjectKey || '').trim() || !/^[a-f0-9]{64}$/.test(String(contentDigest || '')) || !String(mediaType || '').trim() || !Number.isInteger(Number(byteSize)) || Number(byteSize) <= 0) {
        return res.status(422).json({ error: 'idempotency key and valid immutable document metadata are required' });
      }
      const result = await transaction(async (client) => {
        const replay = await client.query('SELECT * FROM invoice_cases WHERE tenant_id=$1 AND idempotency_key=$2', [tenant, idempotencyKey]);
        if (replay.rows[0]) return { invoiceCase: replay.rows[0], replayed: true };
        const created = await client.query(
          `INSERT INTO invoice_cases (tenant_id,idempotency_key,submitter_id,status)
           VALUES ($1,$2,$3,'ingested') RETURNING *`, [tenant, idempotencyKey, req.user.id]
        );
        await client.query(
          `INSERT INTO invoice_documents
           (tenant_id,invoice_case_id,source,storage_object_key,content_digest,media_type,byte_size)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenant, created.rows[0].id, source, storageObjectKey, contentDigest, mediaType, Number(byteSize)]
        );
        await client.query(
          `INSERT INTO invoice_workflow_events
           (tenant_id,invoice_case_id,actor_id,event_type,to_status,payload,evidence_digest)
           VALUES ($1,$2,$3,'document_ingested','ingested',$4,$5)`,
          [tenant, created.rows[0].id, req.user.id, { source, storageObjectKey, mediaType, byteSize }, contentDigest]
        );
        return { invoiceCase: created.rows[0], replayed: false };
      });
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) { fail(res, error, 'document ingestion failed'); }
  });

  router.post('/:id/extractions', roles('ap_analyst', 'admin'), async (req, res) => {
    try {
      const tenant = tenantId(req);
      if (!tenant) return res.status(403).json({ error: 'active tenant membership is required' });
      const validation = validateExtraction(req.body?.candidate || {});
      const sourceDocumentId = Number(req.body?.sourceDocumentId);
      const sourceTextId = req.body?.sourceTextId == null ? null : Number(req.body.sourceTextId);
      const sourceContentDigest = String(req.body?.sourceContentDigest || '');
      const sourceTextDigest = String(req.body?.sourceTextDigest || '');
      const extractionVersion = String(req.body?.extractionVersion || '');
      if (!Number.isSafeInteger(sourceDocumentId) || sourceDocumentId < 1 ||
          !/^[a-f0-9]{64}$/.test(sourceContentDigest) || !/^[a-f0-9]{64}$/.test(sourceTextDigest) ||
          (sourceTextId !== null && (!Number.isSafeInteger(sourceTextId) || sourceTextId < 1)) ||
          !extractionVersion || extractionVersion.length > 128) {
        return res.status(422).json({ error: 'stored source ID, checksums, and extraction version are required' });
      }
      const result = await transaction(async (client) => {
        const found = await client.query('SELECT * FROM invoice_cases WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.id, tenant]);
        const invoice = found.rows[0];
        if (!invoice) throw Object.assign(new Error('invoice case not found'), { status: 404 });
        if (!['ingested', 'extracted', 'exception'].includes(invoice.status)) throw Object.assign(new Error('invoice is not accepting extraction evidence'), { status: 409 });
        const candidate = req.body?.candidate || {};
        const { document, blob } = await storedDocument(client, tenant, invoice.id, sourceDocumentId);
        if (document.media_type === 'text/plain' && sourceTextId !== null) {
          throw sourceError('SOURCE_TEXT_ID_UNEXPECTED', 'Text originals do not use a derived recognition ID.', 422);
        }
        const derived = sourceTextId == null ? null :
          await storedRecognition(client, tenant, invoice.id, document.id, sourceTextId);
        const { text, textDigest } = sourceText(document, blob, derived);
        if (sourceContentDigest !== document.content_digest || sourceTextDigest !== textDigest) {
          throw sourceError('SOURCE_CHECKSUM_MISMATCH', 'The candidate source checksums do not match the stored original.');
        }
        const sourceVerification = verifyCandidateEvidence(text, candidate, req.body?.sourceEvidence);
        const recordedValidation = { ...validation, sourceEvidenceDigest: sourceVerification.evidenceDigest };
        const fingerprint = validation.ok ? duplicateFingerprint({ ...candidate, tenantId: tenant }) : null;
        const extraction = await client.query(
          `INSERT INTO invoice_extractions
           (tenant_id,invoice_case_id,extraction_version,provider_name,candidate,deterministic_validation,
            evidence_digest,created_by,source_document_id,source_content_digest,source_text_digest,source_evidence,source_text_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [tenant, invoice.id, extractionVersion,
            document.media_type === 'text/plain' ? 'manual_review_stored_text' : 'manual_review_local_recognition',
            candidate, recordedValidation, validation.evidenceDigest,
            req.user.id, document.id, document.content_digest, textDigest, req.body.sourceEvidence, sourceTextId]
        );
        const next = validation.ok ? 'extracted' : 'exception';
        await client.query(
          `UPDATE invoice_cases SET vendor_id=$1,invoice_number=$2,invoice_date=$3,amount=$4,currency=$5,
           duplicate_fingerprint=$6,status=$7,revision=revision+1,updated_at=NOW() WHERE id=$8 AND tenant_id=$9`,
          [candidate.vendorId || null, candidate.invoiceNumber || null, candidate.invoiceDate || null,
            validation.computed.total || null, candidate.currency || null, fingerprint, next, invoice.id, tenant]
        );
        if (!validation.ok) {
          for (const message of validation.errors) {
            await client.query(
              `INSERT INTO invoice_exceptions (tenant_id,invoice_case_id,code,detail)
               VALUES ($1,$2,'EXTRACTION_VALIDATION',$3)`, [tenant, invoice.id, { message }]
            );
          }
        }
        await client.query(
          `INSERT INTO invoice_workflow_events
           (tenant_id,invoice_case_id,actor_id,event_type,from_status,to_status,payload,evidence_digest)
           VALUES ($1,$2,$3,'extraction_validated',$4,$5,$6,$7)`,
          [tenant, invoice.id, req.user.id, invoice.status, next,
            { errors: validation.errors, sourceDocumentId: document.id, sourceContentDigest: document.content_digest,
              sourceTextDigest: textDigest, sourceEvidenceDigest: sourceVerification.evidenceDigest }, validation.evidenceDigest]
        );
        return { extraction: extraction.rows[0], validation: recordedValidation, nextStatus: next };
      });
      res.status(validation.ok ? 201 : 422).json(result);
    } catch (error) { fail(res, error, 'extraction could not be recorded'); }
  });

  router.post('/:id/matches', roles('ap_analyst', 'admin'), async (req, res) => {
    try {
      const tenant = tenantId(req);
      if (!tenant) return res.status(403).json({ error: 'active tenant membership is required' });
      const result = await transaction(async (client) => {
        const found = await client.query('SELECT * FROM invoice_cases WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.id, tenant]);
        const invoice = found.rows[0];
        if (!invoice) throw Object.assign(new Error('invoice case not found'), { status: 404 });
        if (invoice.status !== 'validated') throw Object.assign(new Error('invoice must be validated before matching'), { status: 409 });
        await reviewedSource(client, tenant, invoice.id);
        const extraction = await client.query(
          `SELECT candidate FROM invoice_extractions WHERE tenant_id=$1 AND invoice_case_id=$2
           ORDER BY created_at DESC,id DESC LIMIT 1`, [tenant, invoice.id]
        );
        if (!extraction.rows[0]) throw Object.assign(new Error('validated extraction evidence is missing'), { status: 409 });
        const match = threeWayMatch({
          invoice: extraction.rows[0].candidate,
          purchaseOrder: req.body.purchaseOrder,
          receipt: req.body.receipt,
          amountTolerance: req.body.amountTolerance,
          quantityTolerance: req.body.quantityTolerance,
        });
        const next = match.matched ? 'matched' : 'exception';
        await client.query(
          `INSERT INTO invoice_match_results
           (tenant_id,invoice_case_id,po_reference,receipt_reference,amount_tolerance,quantity_tolerance,matched,exceptions,evidence_digest,created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [tenant, invoice.id, req.body.purchaseOrder?.poNumber || null, req.body.receipt?.receiptNumber || null,
            req.body.amountTolerance ?? 0.01, req.body.quantityTolerance ?? 0, match.matched, match.exceptions, match.evidenceDigest, req.user.id]
        );
        for (const exception of match.exceptions) {
          await client.query('INSERT INTO invoice_exceptions (tenant_id,invoice_case_id,code,detail) VALUES ($1,$2,$3,$4)', [tenant, invoice.id, exception.code, exception]);
        }
        await client.query('UPDATE invoice_cases SET status=$1,revision=revision+1,updated_at=NOW() WHERE id=$2 AND tenant_id=$3', [next, invoice.id, tenant]);
        await client.query(
          `INSERT INTO invoice_workflow_events
           (tenant_id,invoice_case_id,actor_id,event_type,from_status,to_status,payload,evidence_digest)
           VALUES ($1,$2,$3,'three_way_match',$4,$5,$6,$7)`,
          [tenant, invoice.id, req.user.id, invoice.status, next, { exceptions: match.exceptions }, match.evidenceDigest]
        );
        return { ...match, nextStatus: next };
      });
      res.status(result.matched ? 201 : 422).json(result);
    } catch (error) { fail(res, error, 'three-way match failed'); }
  });

  router.post('/:id/approvals', roles('approver', 'admin'), async (req, res) => {
    try {
      const tenant = tenantId(req);
      if (!tenant) return res.status(403).json({ error: 'active tenant membership is required' });
      if (!['approve', 'reject'].includes(req.body?.decision) || !String(req.body?.attestation || '').trim()) return res.status(422).json({ error: 'decision and attestation are required' });
      const invoice = await pool.query('SELECT id,submitter_id,status FROM invoice_cases WHERE id=$1 AND tenant_id=$2', [req.params.id, tenant]);
      if (!invoice.rows[0]) return res.status(404).json({ error: 'invoice case not found' });
      if (invoice.rows[0].status !== 'approval_pending') return res.status(409).json({ error: 'invoice is not awaiting approval' });
      if (Number(invoice.rows[0].submitter_id) === Number(req.user.id)) return res.status(409).json({ error: 'submitter cannot approve their invoice' });
      await reviewedSource(pool, tenant, req.params.id);
      const attestationDigest = digest({ decision: req.body.decision, attestation: req.body.attestation });
      const result = await pool.query(
        `INSERT INTO invoice_approvals (tenant_id,invoice_case_id,actor_id,decision,attestation_digest)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id,invoice_case_id,actor_id)
         DO UPDATE SET decision=EXCLUDED.decision,attestation_digest=EXCLUDED.attestation_digest,created_at=NOW() RETURNING *`,
        [tenant, req.params.id, req.user.id, req.body.decision, attestationDigest]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) { fail(res, error, 'approval could not be recorded'); }
  });

  router.post('/:id/transition', async (req, res) => {
    try {
      const tenant = tenantId(req);
      if (!tenant) return res.status(403).json({ error: 'active tenant membership is required' });
      const expectedRevision = Number(req.get('If-Match'));
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) return res.status(400).json({ error: 'If-Match must be a positive revision' });
      const result = await transaction(async (client) => {
        const found = await client.query('SELECT * FROM invoice_cases WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.id, tenant]);
        const invoice = found.rows[0];
        if (!invoice) throw Object.assign(new Error('invoice case not found'), { status: 404 });
        if (invoice.revision !== expectedRevision) throw Object.assign(new Error('invoice revision conflict'), { status: 409 });
        if (['validated', 'matched', 'approval_pending', 'approved', 'posting_pending'].includes(req.body?.nextStatus)) {
          await reviewedSource(client, tenant, invoice.id);
        }
        const approvals = (await client.query(
          'SELECT actor_id AS "actorId",decision FROM invoice_approvals WHERE tenant_id=$1 AND invoice_case_id=$2', [tenant, invoice.id]
        )).rows;
        const erp = providerReadiness().providers.find((provider) => provider.name === 'erp');
        const authorization = authorizeTransition({
          current: invoice.status, next: req.body?.nextStatus, actor: req.user, submitterId: invoice.submitter_id,
          amount: invoice.amount, approvals, postingIdempotencyKey: req.body?.postingIdempotencyKey,
          erpReady: erp?.ready, reconciliationEvidence: req.body?.reconciliationEvidence,
        });
        if (!authorization.ok) throw Object.assign(new Error(authorization.errors.join('; ')), { status: 422 });
        const updated = await client.query(
          `UPDATE invoice_cases SET status=$1,revision=revision+1,updated_at=NOW()
           WHERE id=$2 AND tenant_id=$3 AND revision=$4 RETURNING *`,
          [req.body.nextStatus, invoice.id, tenant, expectedRevision]
        );
        if (req.body.nextStatus === 'posting_pending') {
          await client.query(
            `INSERT INTO invoice_posting_outbox (tenant_id,invoice_case_id,posting_idempotency_key,payload)
             VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,posting_idempotency_key) DO NOTHING`,
            [tenant, invoice.id, req.body.postingIdempotencyKey, { amount: invoice.amount, currency: invoice.currency, autonomousPayment: false }]
          );
        }
        await client.query(
          `INSERT INTO invoice_workflow_events
           (tenant_id,invoice_case_id,actor_id,event_type,from_status,to_status,payload,evidence_digest)
           VALUES ($1,$2,$3,'state_transition',$4,$5,$6,$7)`,
          [tenant, invoice.id, req.user.id, invoice.status, req.body.nextStatus, { postingRequested: req.body.nextStatus === 'posting_pending' }, authorization.evidenceDigest]
        );
        return updated.rows[0];
      });
      res.json(result);
    } catch (error) { fail(res, error, 'invoice transition failed'); }
  });

  router.post('/:id/posting-outcomes', roles('ap_analyst', 'admin'), async (req, res) => {
    try {
      const tenant = tenantId(req);
      if (!tenant) return res.status(403).json({ error: 'active tenant membership is required' });
      const { postingIdempotencyKey, erpDocumentId, receiptDigest, outcome, errorCode } = req.body || {};
      if (!String(postingIdempotencyKey || '').trim() || !['posted', 'failed'].includes(outcome)) {
        return res.status(422).json({ error: 'posting idempotency key and posted|failed outcome are required' });
      }
      if (outcome === 'posted' && (!String(erpDocumentId || '').trim() || !/^[a-f0-9]{64}$/.test(String(receiptDigest || '')))) {
        return res.status(422).json({ error: 'posted outcome requires ERP document ID and receipt SHA-256 digest' });
      }
      const erp = providerReadiness().providers.find((provider) => provider.name === 'erp');
      if (!erp?.ready) return res.status(503).json({ error: 'ERP provider is not operationally ready' });
      const result = await transaction(async (client) => {
        const invoice = await client.query('SELECT * FROM invoice_cases WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.id, tenant]);
        if (!invoice.rows[0]) throw Object.assign(new Error('invoice case not found'), { status: 404 });
        if (invoice.rows[0].status !== 'posting_pending') throw Object.assign(new Error('invoice is not awaiting ERP posting'), { status: 409 });
        await reviewedSource(client, tenant, req.params.id);
        const outbox = await client.query(
          `SELECT * FROM invoice_posting_outbox
           WHERE tenant_id=$1 AND invoice_case_id=$2 AND posting_idempotency_key=$3 FOR UPDATE`,
          [tenant, req.params.id, postingIdempotencyKey]
        );
        if (!outbox.rows[0]) throw Object.assign(new Error('posting request not found'), { status: 404 });
        if (outcome === 'failed') {
          await client.query(
            `UPDATE invoice_posting_outbox SET status='dead_letter',attempts=attempts+1,last_error=$1
             WHERE id=$2`, [String(errorCode || 'ERP_POST_FAILED').slice(0, 200), outbox.rows[0].id]
          );
          await client.query(
            `INSERT INTO invoice_integration_failures
             (tenant_id,integration,operation,invoice_case_id,retryable,error_code,sanitized_detail)
             VALUES ($1,'erp','post_invoice',$2,FALSE,$3,'ERP posting failed; detail redacted')`,
            [tenant, req.params.id, String(errorCode || 'ERP_POST_FAILED').slice(0, 100)]
          );
          await client.query("UPDATE invoice_cases SET status='exception',revision=revision+1,updated_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, tenant]);
          return { status: 'exception', posted: false };
        }
        await client.query(
          `UPDATE invoice_posting_outbox SET status='posted',erp_document_id=$1,attempts=attempts+1,last_error=NULL
           WHERE id=$2`, [erpDocumentId, outbox.rows[0].id]
        );
        const updated = await client.query(
          `UPDATE invoice_cases SET status='posted',revision=revision+1,updated_at=NOW()
           WHERE id=$1 AND tenant_id=$2 RETURNING *`, [req.params.id, tenant]
        );
        await client.query(
          `INSERT INTO invoice_workflow_events
           (tenant_id,invoice_case_id,actor_id,event_type,from_status,to_status,payload,evidence_digest)
           VALUES ($1,$2,$3,'erp_posting_outcome','posting_pending','posted',$4,$5)`,
          [tenant, req.params.id, req.user.id, { erpDocumentId }, receiptDigest]
        );
        return updated.rows[0];
      });
      res.status(outcome === 'posted' ? 200 : 502).json(result);
    } catch (error) { fail(res, error, 'posting outcome could not be recorded'); }
  });

  router.post('/:id/reconciliations', roles('auditor', 'admin'), async (req, res) => {
    try {
      const tenant = tenantId(req);
      if (!tenant) return res.status(403).json({ error: 'active tenant membership is required' });
      const { erpDocumentId, postedAmount, postedCurrency } = req.body || {};
      if (!String(erpDocumentId || '').trim() || !Number.isFinite(Number(postedAmount)) || !/^[A-Z]{3}$/.test(String(postedCurrency || ''))) {
        return res.status(422).json({ error: 'ERP document, amount, and currency are required' });
      }
      const result = await transaction(async (client) => {
        const invoice = await client.query('SELECT * FROM invoice_cases WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.id, tenant]);
        if (!invoice.rows[0]) throw Object.assign(new Error('invoice case not found'), { status: 404 });
        if (invoice.rows[0].status !== 'posted') throw Object.assign(new Error('only posted invoices can be reconciled'), { status: 409 });
        await reviewedSource(client, tenant, req.params.id);
        const matched = Number(invoice.rows[0].amount) === Number(postedAmount) && invoice.rows[0].currency === postedCurrency;
        const inserted = await client.query(
          `INSERT INTO invoice_reconciliations
           (tenant_id,invoice_case_id,erp_document_id,posted_amount,posted_currency,matched,discrepancy,reconciled_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [tenant, req.params.id, erpDocumentId, postedAmount, postedCurrency, matched,
            matched ? null : { expectedAmount: invoice.rows[0].amount, expectedCurrency: invoice.rows[0].currency }, req.user.id]
        );
        const next = matched ? 'reconciled' : 'exception';
        await client.query('UPDATE invoice_cases SET status=$1,revision=revision+1,updated_at=NOW() WHERE id=$2 AND tenant_id=$3', [next, req.params.id, tenant]);
        await client.query(
          `INSERT INTO invoice_workflow_events
           (tenant_id,invoice_case_id,actor_id,event_type,from_status,to_status,payload,evidence_digest)
           VALUES ($1,$2,$3,'erp_reconciliation','posted',$4,$5,$6)`,
          [tenant, req.params.id, req.user.id, next, { erpDocumentId, matched }, digest({ erpDocumentId, postedAmount, postedCurrency })]
        );
        return { reconciliation: inserted.rows[0], nextStatus: next, matched };
      });
      res.status(result.matched ? 201 : 409).json(result);
    } catch (error) { fail(res, error, 'reconciliation could not be recorded'); }
  });

  return router;
}

module.exports = buildGovernedInvoiceRouter;
