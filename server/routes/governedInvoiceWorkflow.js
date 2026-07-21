'use strict';

const express = require('express');
const pool = require('../db');
const { authorizeTransition, digest, duplicateFingerprint, threeWayMatch, validateExtraction } = require('../domain/invoicePolicy');
const { providerReadiness } = require('../services/providerBoundary');

function buildGovernedInvoiceRouter(authMiddleware) {
  const router = express.Router();
  router.use(authMiddleware);

  const tenantId = (req) => String(req.user?.tenantId || '');
  const roles = (...allowed) => (req, res, next) => allowed.includes(req.user?.role) ? next() : res.status(403).json({ error: 'insufficient AP role' });

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

  router.get('/providers/readiness', (_req, res) => {
    const readiness = providerReadiness();
    res.status(readiness.ready ? 200 : 503).json(readiness);
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
      const result = await transaction(async (client) => {
        const found = await client.query('SELECT * FROM invoice_cases WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.id, tenant]);
        const invoice = found.rows[0];
        if (!invoice) throw Object.assign(new Error('invoice case not found'), { status: 404 });
        if (!['ingested', 'extracted', 'exception'].includes(invoice.status)) throw Object.assign(new Error('invoice is not accepting extraction evidence'), { status: 409 });
        const candidate = req.body.candidate;
        const fingerprint = validation.ok ? duplicateFingerprint({ ...candidate, tenantId: tenant }) : null;
        const extraction = await client.query(
          `INSERT INTO invoice_extractions
           (tenant_id,invoice_case_id,extraction_version,provider_name,candidate,deterministic_validation,evidence_digest,created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [tenant, invoice.id, req.body.extractionVersion, req.body.providerName || 'candidate', candidate, validation, validation.evidenceDigest, req.user.id]
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
          [tenant, invoice.id, req.user.id, invoice.status, next, { errors: validation.errors }, validation.evidenceDigest]
        );
        return { extraction: extraction.rows[0], validation, nextStatus: next };
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
