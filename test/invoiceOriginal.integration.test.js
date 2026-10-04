'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { sha256, positionAt } = require('../server/domain/invoiceSource');

test('stored invoice originals and review evidence are tenant scoped', {
  skip: process.env.RUN_INVOICE_DB_TEST !== '1' && 'requires a disposable migrated PostgreSQL database',
}, async () => {
  const pool = require('../server/db');
  const database = (await pool.query('SELECT current_database() AS name')).rows[0].name;
  if (!/^codex_invoice_test_/.test(database)) {
    await pool.end();
    throw new Error('integration test refuses a non-disposable database');
  }

  const [tenant, otherTenant] = await Promise.all([
    pool.query("INSERT INTO organizations(name) VALUES ('Invoice source test') RETURNING id"),
    pool.query("INSERT INTO organizations(name) VALUES ('Other invoice source test') RETURNING id"),
  ]);
  const users = [];
  for (let index = 0; index < 4; index += 1) {
    users.push((await pool.query(
      'INSERT INTO users(email,password,full_name) VALUES($1,$2,$3) RETURNING id',
      [`invoice-source-${index}@example.invalid`, 'test-only', `Invoice test user ${index}`]
    )).rows[0].id);
  }
  const identities = {
    submitter: { id: users[0], role: 'submitter', tenantId: tenant.rows[0].id },
    analyst: { id: users[1], role: 'ap_analyst', tenantId: tenant.rows[0].id },
    outsider: { id: users[2], role: 'ap_analyst', tenantId: otherTenant.rows[0].id },
    peer: { id: users[3], role: 'submitter', tenantId: tenant.rows[0].id },
  };
  const auth = (req, res, next) => {
    const identity = identities[String(req.get('Authorization') || '').replace(/^Bearer /, '')];
    if (!identity) return res.status(401).json({ error: 'unauthenticated' });
    req.user = identity;
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/api/governed-invoices', require('../server/routes/governedInvoiceWorkflow')(auth));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/governed-invoices`;
  const request = (path, identity, options = {}) => fetch(`${base}${path}`, {
    ...options,
    headers: { ...(identity ? { Authorization: `Bearer ${identity}` } : {}), ...options.headers },
  });
  const upload = (contents, filename = 'invoice.txt') => {
    const form = new FormData();
    form.set('source', 'test_upload');
    form.set('file', new Blob([contents], { type: 'text/plain' }), filename);
    return form;
  };

  try {
    const original = Buffer.from('Vendor: Alpha Inc\r\nInvoice No: INV-123\r\nDate: 2026-10-04\r\nService  2  50.00  100.00\r\nTotal: 100.00\r\n');
    const contentDigest = sha256(original);
    const uploaded = await request('/ingest-upload', 'submitter', {
      method: 'POST', headers: { 'Idempotency-Key': 'original-upload-1' }, body: upload(original),
    });
    assert.equal(uploaded.status, 201, await uploaded.clone().text());
    const created = await uploaded.json();
    const caseId = created.invoiceCase.id;
    const documentId = created.documentId;

    const replay = await request('/ingest-upload', 'submitter', {
      method: 'POST', headers: { 'Idempotency-Key': 'original-upload-1' }, body: upload(original),
    });
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).documentId, documentId);
    const peerReplay = await request('/ingest-upload', 'peer', {
      method: 'POST', headers: { 'Idempotency-Key': 'original-upload-1' }, body: upload(original),
    });
    assert.equal(peerReplay.status, 404);
    const conflict = await request('/ingest-upload', 'submitter', {
      method: 'POST', headers: { 'Idempotency-Key': 'original-upload-1' }, body: upload('different source bytes'),
    });
    assert.equal(conflict.status, 409);

    const detail = await request(`/${caseId}`, 'submitter');
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).documents[0].original_stored, true);
    assert.equal((await request(`/${caseId}/documents/${documentId}/content`)).status, 401);
    assert.equal((await request(`/${caseId}/documents/${documentId}/content`, 'outsider')).status, 404);
    assert.equal((await request(`/${caseId}/documents/${documentId}/content`, 'peer')).status, 404);
    const content = await request(`/${caseId}/documents/${documentId}/content`, 'submitter');
    assert.equal(content.status, 200);
    assert.equal(content.headers.get('content-disposition')?.startsWith('attachment;'), true);
    assert.deepEqual(Buffer.from(await content.arrayBuffer()), original);

    const hintsResponse = await request(`/${caseId}/documents/${documentId}/source-hints`, 'analyst');
    assert.equal(hintsResponse.status, 200, await hintsResponse.clone().text());
    const hints = await hintsResponse.json();
    assert.equal(hints.sourceContentDigest, contentDigest);
    assert.equal(hints.provider.ocrCalled, false);
    assert.equal(hints.provider.modelCalled, false);
    assert.equal(hints.sourceEvidenceTemplate.lines[0].position.line, 4);
    const candidate = {
      vendorId: 'alpha', invoiceNumber: 'INV-123', invoiceDate: '2026-10-04', currency: 'USD',
      lines: [{ description: 'Service', quantity: 2, unitPrice: 50, taxRate: 0, net: 100 }],
      subtotal: 100, tax: 0, total: 100,
    };
    const extraction = {
      candidate, extractionVersion: 'source-test-1', sourceDocumentId: documentId,
      sourceContentDigest: hints.sourceContentDigest, sourceTextDigest: hints.sourceTextDigest,
      sourceEvidence: hints.sourceEvidenceTemplate,
    };
    const submitExtraction = value => request(`/${caseId}/extractions`, 'analyst', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
    });
    assert.equal((await submitExtraction({ ...extraction, sourceContentDigest: '0'.repeat(64) })).status, 409);
    assert.equal((await submitExtraction({ ...extraction, sourceEvidence: {
      ...extraction.sourceEvidence, total: { ...extraction.sourceEvidence.total, quote: 'Total: 900.00' },
    } })).status, 409);
    const saved = await submitExtraction(extraction);
    assert.equal(saved.status, 201, await saved.clone().text());
    assert.equal((await saved.json()).nextStatus, 'extracted');
    const validated = await request(`/${caseId}/transition`, 'analyst', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': '2' },
      body: JSON.stringify({ nextStatus: 'validated' }),
    });
    assert.equal(validated.status, 200, await validated.clone().text());
    assert.equal((await validated.json()).status, 'validated');

    if (process.env.RUN_INVOICE_OCR_TEST === '1') {
      const fs = require('node:fs');
      const os = require('node:os');
      const path = require('node:path');
      const { execFileSync } = require('node:child_process');
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-ocr-http-'));
      try {
        const image = path.join(directory, 'invoice.png');
        execFileSync('magick', ['-size', '1700x600', 'xc:white', '-font', 'Helvetica', '-pointsize', '60',
          '-fill', 'black', '-annotate', '+50+120', 'Invoice No: INV-124',
          '-annotate', '+50+240', 'Date: 2026-10-04',
          '-annotate', '+50+360', 'Service  2  50.00  100.00',
          '-annotate', '+50+480', 'Total: 100.00', image]);
        const form = new FormData(); form.set('source', 'test_ocr');
        form.set('file', new Blob([fs.readFileSync(image)], { type: 'image/png' }), 'invoice.png');
        const uploadedImage = await request('/ingest-upload', 'submitter', {
          method: 'POST', headers: { 'Idempotency-Key': 'ocr-upload-1' }, body: form,
        });
        assert.equal(uploadedImage.status, 201, await uploadedImage.clone().text());
        const imageCase = await uploadedImage.json();
        const ocrPath = `/${imageCase.invoiceCase.id}/documents/${imageCase.documentId}`;
        assert.equal((await request(`${ocrPath}/recognize`, 'outsider', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
        const recognized = await request(`${ocrPath}/recognize`, 'analyst', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(recognized.status, 201, await recognized.clone().text());
        const recognition = await recognized.json();
        assert.equal(recognition.recognition.method, 'tesseract_image');
        assert.ok(recognition.recognition.meanConfidence > 0.5);
        const replay = await request(`${ocrPath}/recognize`, 'analyst', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal((await replay.json()).sourceTextId, recognition.sourceTextId);
        const ocrHints = await request(`${ocrPath}/source-hints`, 'analyst');
        assert.equal(ocrHints.status, 200, await ocrHints.clone().text());
        const ocr = await ocrHints.json();
        assert.equal(ocr.provider.ocrCalled, true);
        assert.equal(ocr.sourceTextId, recognition.sourceTextId);
        assert.match(ocr.recognizedText, /INV-124/);
        const service = ocr.recognizedText.split(/[\n\f]/).find(line => line.startsWith('Service'));
        assert.ok(service);
        const start = ocr.recognizedText.indexOf(service);
        const ocrCandidate = { ...candidate, invoiceNumber: 'INV-124' };
        const ocrEvidence = { ...ocr.sourceEvidenceTemplate,
          lines: [{ quote: service, position: positionAt(ocr.recognizedText, start, service.length) }] };
        const ocrSaved = await request(`/${imageCase.invoiceCase.id}/extractions`, 'analyst', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            candidate: ocrCandidate, extractionVersion: 'ocr-review-1',
            sourceDocumentId: imageCase.documentId, sourceTextId: ocr.sourceTextId,
            sourceContentDigest: ocr.sourceContentDigest, sourceTextDigest: ocr.sourceTextDigest,
            sourceEvidence: ocrEvidence,
          }),
        });
        assert.equal(ocrSaved.status, 201, await ocrSaved.clone().text());
        assert.equal((await request(`/${imageCase.invoiceCase.id}/transition`, 'analyst', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': '2' },
          body: JSON.stringify({ nextStatus: 'validated' }),
        })).status, 200);
        await assert.rejects(pool.query('UPDATE invoice_source_texts SET text_content=$1 WHERE id=$2',
          ['tamper', ocr.sourceTextId]), /append-only/);
      } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    }
    await assert.rejects(pool.query('UPDATE invoice_document_blobs SET content=$1 WHERE document_id=$2', [Buffer.from('tamper'), documentId]), /append-only/);
    await assert.rejects(pool.query('UPDATE invoice_documents SET content_digest=$1 WHERE id=$2', ['0'.repeat(64), documentId]), /append-only/);
    await assert.rejects(pool.query('UPDATE invoice_extractions SET source_content_digest=$1 WHERE invoice_case_id=$2', ['0'.repeat(64), caseId]), /append-only/);

    const metadataOnly = await request('/ingest', 'submitter', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'metadata-only-1' },
      body: JSON.stringify({ source: 'external', storageObjectKey: 'external-1', contentDigest: sha256(Buffer.from('Legacy invoice')),
        mediaType: 'text/plain', byteSize: Buffer.byteLength('Legacy invoice') }),
    });
    assert.equal(metadataOnly.status, 201, await metadataOnly.clone().text());
    const legacyCaseId = (await metadataOnly.json()).invoiceCase.id;
    const metadata = await request(`/${legacyCaseId}`, 'submitter');
    const legacyDocumentId = (await metadata.json()).documents[0].id;
    assert.equal((await request(`/${legacyCaseId}/documents/${legacyDocumentId}/content`, 'submitter')).status, 409);
    assert.equal((await request(`/${legacyCaseId}/documents/${legacyDocumentId}/upload`, 'submitter', {
      method: 'POST', body: upload('wrong bytes'),
    })).status, 409);
    const attached = await request(`/${legacyCaseId}/documents/${legacyDocumentId}/upload`, 'submitter', {
      method: 'POST', body: upload('Legacy invoice'),
    });
    assert.equal(attached.status, 201, await attached.clone().text());

    const older = await pool.query(
      `INSERT INTO invoice_cases(tenant_id,idempotency_key,submitter_id,status)
       VALUES ($1,'legacy-unverified-1',$2,'extracted') RETURNING id`, [tenant.rows[0].id, users[0]]
    );
    await pool.query(
      `INSERT INTO invoice_extractions(tenant_id,invoice_case_id,extraction_version,provider_name,
        candidate,deterministic_validation,evidence_digest,created_by)
       VALUES ($1,$2,'legacy','legacy', $3, $4, $5,$6)`,
      [tenant.rows[0].id, older.rows[0].id, candidate, { ok: true }, sha256(Buffer.from('legacy')), users[1]]
    );
    const blockedReview = await request(`/${older.rows[0].id}/transition`, 'analyst', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': '1' },
      body: JSON.stringify({ nextStatus: 'validated' }),
    });
    assert.equal(blockedReview.status, 409);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
  }
});
