CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES organizations(id);
CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('submitter','ap_analyst','approver','payment_operator','auditor','admin')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (tenant_id,user_id)
);

CREATE TABLE IF NOT EXISTS invoice_cases (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  idempotency_key TEXT NOT NULL,
  submitter_id INTEGER NOT NULL REFERENCES users(id),
  vendor_id TEXT,
  invoice_number TEXT,
  invoice_date DATE,
  amount NUMERIC,
  currency CHAR(3),
  duplicate_fingerprint CHAR(64),
  status TEXT NOT NULL DEFAULT 'ingested' CHECK (status IN ('ingested','extracted','validated','matched','exception','approval_pending','approved','posting_pending','posted','reconciled','rejected')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS invoice_case_duplicate_idx ON invoice_cases(tenant_id,duplicate_fingerprint) WHERE duplicate_fingerprint IS NOT NULL AND status <> 'rejected';

CREATE TABLE IF NOT EXISTS invoice_documents (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  invoice_case_id BIGINT NOT NULL REFERENCES invoice_cases(id),
  source TEXT NOT NULL,
  storage_object_key TEXT NOT NULL,
  content_digest CHAR(64) NOT NULL,
  media_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,content_digest)
);
CREATE TABLE IF NOT EXISTS invoice_extractions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  invoice_case_id BIGINT NOT NULL REFERENCES invoice_cases(id),
  extraction_version TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  candidate JSONB NOT NULL,
  deterministic_validation JSONB NOT NULL,
  evidence_digest CHAR(64) NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,invoice_case_id,extraction_version)
);
CREATE TABLE IF NOT EXISTS invoice_match_results (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  invoice_case_id BIGINT NOT NULL REFERENCES invoice_cases(id),
  po_reference TEXT,
  receipt_reference TEXT,
  amount_tolerance NUMERIC NOT NULL,
  quantity_tolerance NUMERIC NOT NULL,
  matched BOOLEAN NOT NULL,
  exceptions JSONB NOT NULL,
  evidence_digest CHAR(64) NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS invoice_exceptions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  invoice_case_id BIGINT NOT NULL REFERENCES invoice_cases(id),
  code TEXT NOT NULL,
  detail JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','waived')),
  resolved_by INTEGER REFERENCES users(id),
  resolution_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS invoice_approvals (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  invoice_case_id BIGINT NOT NULL REFERENCES invoice_cases(id),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('approve','reject')),
  attestation_digest CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,invoice_case_id,actor_id)
);

CREATE TABLE IF NOT EXISTS invoice_workflow_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  invoice_case_id BIGINT NOT NULL REFERENCES invoice_cases(id),
  actor_id INTEGER REFERENCES users(id),
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_digest CHAR(64),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE OR REPLACE FUNCTION prevent_invoice_event_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'invoice workflow evidence is append-only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS invoice_workflow_events_append_only ON invoice_workflow_events;
CREATE TRIGGER invoice_workflow_events_append_only BEFORE UPDATE OR DELETE ON invoice_workflow_events
FOR EACH ROW EXECUTE FUNCTION prevent_invoice_event_mutation();

CREATE TABLE IF NOT EXISTS invoice_posting_outbox (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  invoice_case_id BIGINT NOT NULL REFERENCES invoice_cases(id),
  posting_idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','posted','dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  erp_document_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id,posting_idempotency_key)
);
CREATE TABLE IF NOT EXISTS invoice_integration_failures (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  integration TEXT NOT NULL,
  operation TEXT NOT NULL,
  invoice_case_id BIGINT,
  retryable BOOLEAN NOT NULL,
  error_code TEXT NOT NULL,
  sanitized_detail TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS invoice_reconciliations (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  invoice_case_id BIGINT NOT NULL REFERENCES invoice_cases(id),
  erp_document_id TEXT NOT NULL,
  posted_amount NUMERIC NOT NULL,
  posted_currency CHAR(3) NOT NULL,
  matched BOOLEAN NOT NULL,
  discrepancy JSONB,
  reconciled_by INTEGER NOT NULL REFERENCES users(id),
  reconciled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
