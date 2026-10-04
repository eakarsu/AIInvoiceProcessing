BEGIN;

-- The original bytes are local to Postgres and cannot be replaced after intake.
-- Existing metadata-only cases remain visible, but review requires an attached
-- original whose actual bytes match invoice_documents.
CREATE TABLE IF NOT EXISTS invoice_document_blobs (
  document_id BIGINT PRIMARY KEY REFERENCES invoice_documents(id) ON DELETE RESTRICT,
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  invoice_case_id BIGINT NOT NULL REFERENCES invoice_cases(id) ON DELETE RESTRICT,
  content BYTEA NOT NULL,
  content_digest CHAR(64) NOT NULL CHECK (content_digest ~ '^[a-f0-9]{64}$'),
  media_type TEXT NOT NULL CHECK (media_type IN ('application/pdf','image/jpeg','image/png','text/plain')),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  stored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (octet_length(content) = byte_size),
  CHECK (encode(digest(content, 'sha256'), 'hex') = content_digest)
);
CREATE UNIQUE INDEX IF NOT EXISTS invoice_documents_scoped_identity_idx
  ON invoice_documents(id, tenant_id, invoice_case_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_document_blobs_scoped_document_fk') THEN
    ALTER TABLE invoice_document_blobs ADD CONSTRAINT invoice_document_blobs_scoped_document_fk
      FOREIGN KEY (document_id, tenant_id, invoice_case_id)
      REFERENCES invoice_documents(id, tenant_id, invoice_case_id) ON DELETE RESTRICT;
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS invoice_document_blobs_scope_idx
  ON invoice_document_blobs(tenant_id, invoice_case_id, document_id);

ALTER TABLE invoice_extractions ADD COLUMN IF NOT EXISTS source_document_id BIGINT REFERENCES invoice_documents(id) ON DELETE RESTRICT;
ALTER TABLE invoice_extractions ADD COLUMN IF NOT EXISTS source_content_digest CHAR(64);
ALTER TABLE invoice_extractions ADD COLUMN IF NOT EXISTS source_text_digest CHAR(64);
ALTER TABLE invoice_extractions ADD COLUMN IF NOT EXISTS source_evidence JSONB;

DROP TRIGGER IF EXISTS invoice_documents_append_only ON invoice_documents;
CREATE TRIGGER invoice_documents_append_only BEFORE UPDATE OR DELETE ON invoice_documents
FOR EACH ROW EXECUTE FUNCTION prevent_invoice_event_mutation();
DROP TRIGGER IF EXISTS invoice_document_blobs_append_only ON invoice_document_blobs;
CREATE TRIGGER invoice_document_blobs_append_only BEFORE UPDATE OR DELETE ON invoice_document_blobs
FOR EACH ROW EXECUTE FUNCTION prevent_invoice_event_mutation();
DROP TRIGGER IF EXISTS invoice_extractions_append_only ON invoice_extractions;
CREATE TRIGGER invoice_extractions_append_only BEFORE UPDATE OR DELETE ON invoice_extractions
FOR EACH ROW EXECUTE FUNCTION prevent_invoice_event_mutation();

COMMIT;
