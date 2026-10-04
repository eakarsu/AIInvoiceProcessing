BEGIN;

-- Derived text is append-only and always tied to the immutable original bytes.
-- Reviewers can compare the saved recognition output with the original file.
CREATE TABLE IF NOT EXISTS invoice_source_texts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  invoice_case_id BIGINT NOT NULL REFERENCES invoice_cases(id) ON DELETE RESTRICT,
  document_id BIGINT NOT NULL REFERENCES invoice_documents(id) ON DELETE RESTRICT,
  source_content_digest CHAR(64) NOT NULL CHECK (source_content_digest ~ '^[a-f0-9]{64}$'),
  text_content TEXT NOT NULL CHECK (length(text_content) > 0 AND length(text_content) <= 300000),
  text_digest CHAR(64) NOT NULL CHECK (text_digest ~ '^[a-f0-9]{64}$'),
  recognition JSONB NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, text_digest),
  FOREIGN KEY (document_id, tenant_id, invoice_case_id)
    REFERENCES invoice_documents(id, tenant_id, invoice_case_id) ON DELETE RESTRICT,
  CHECK (encode(digest(convert_to(text_content, 'UTF8'), 'sha256'), 'hex') = text_digest)
);
CREATE INDEX IF NOT EXISTS invoice_source_texts_scope_idx
  ON invoice_source_texts(tenant_id, invoice_case_id, document_id, created_at DESC);
ALTER TABLE invoice_extractions ADD COLUMN IF NOT EXISTS source_text_id BIGINT REFERENCES invoice_source_texts(id) ON DELETE RESTRICT;
DROP TRIGGER IF EXISTS invoice_source_texts_append_only ON invoice_source_texts;
CREATE TRIGGER invoice_source_texts_append_only BEFORE UPDATE OR DELETE ON invoice_source_texts
FOR EACH ROW EXECUTE FUNCTION prevent_invoice_event_mutation();

COMMIT;
