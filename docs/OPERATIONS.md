# Governed invoice-processing operations

The governed workflow stores the original invoice bytes in PostgreSQL with a server-computed SHA-256 digest and append-only document records. A versioned extraction candidate cites exact positions in the stored source text. Deterministic line/tax/total validation, duplicate fingerprints, three-way PO/receipt matching, exceptions, approvals, an idempotent ERP posting request, and reconciliation remain governed steps. Pattern-matched text hints are non-authoritative candidates and are never persisted as invoices automatically.

## Original invoice source

Upload PDF, JPEG, PNG, or UTF-8 text originals up to 20 MB through the governed AP page. Authorized users can retrieve the original only within their tenant and case scope. The server verifies the stored bytes against the document digest, type, and size before retrieval or review. Metadata-only cases created before this change need the exact original attached before extraction or review; the attachment must match the registered digest, size, and media type. The original document, bytes, and extraction evidence are append-only in PostgreSQL. Protect and back up the database as sensitive invoice storage.

The local extraction helper parses stored UTF-8 text. An AP analyst can explicitly recognize a stored PDF/image through Poppler and Tesseract on the application host. Text-layer PDFs use `pdftotext`; image-only PDFs up to five pages and PNG/JPEG images use Tesseract. A reviewer can re-run a mixed PDF as a scan when its selectable text is incomplete. Recognition outputs are append-only records tied to the original byte digest, with source text digest, method, page count, mean OCR confidence and word-line boxes where available. Migration `003_verified_source_text.sql` must be applied for this route. Set the `INVOICE_*` tool paths and language in the deployment environment; uninstalled tools fail closed. The recognizable PDF limit is five pages, with a 25–30 second limit per tool invocation. The application does not silently truncate longer invoices.

Each accepted candidate must cite exact page, line, column, and character spans in the immutable stored text or derived recognition text for its invoice number, date, total, and every line item. OCR line confidence and coordinates are shown separately from pattern-match confidence; a reviewer must compare them to the original PDF/image. OCR can misread numbers and a PDF text layer has no pixel boxes. Recognition does not approve an invoice, and ERP posting still requires its own configured provider and verified receipts. Run local PDF/OCR tools in an isolated worker and add malware scanning before handling untrusted production files.

## Lifecycle

1. Copy `.env.example` to an untracked runtime environment and supply secrets through a secret manager.
2. Run `./scripts/bootstrap.sh` to install the lockfile. It never touches database state.
3. Back up and review the target, then run `ALLOW_SCHEMA_MUTATION=yes DATABASE_URL=... ./scripts/migrate.sh`.
4. Optional demo data is separately guarded by `ALLOW_DEVELOPMENT_SEED=yes` and prohibited in production.
5. Run `./start.sh`. It refuses incomplete configuration, weak JWT secrets, missing dependencies, and occupied ports. It never installs, creates/migrates/seeds a database, or kills another process.

## Financial control boundary

Submitters cannot approve their own invoices. Large invoices require two distinct approvals. Only AP analysts can request an idempotent ERP posting after approvals and connector readiness. Posting requests enter an outbox; they are not payments. The payment role cannot alter pre-posting invoice state, and no endpoint autonomously initiates a payment. Auditors reconcile the returned ERP document, amount, and currency. Append-only workflow events preserve evidence.

Generated `gap-*` and batch-05 feature routes are retained for provenance review but are not mounted. Generic CRUD for invoices, vendors, purchase orders, payments, approvals, and audit records is read-only; governed writes use tenant-scoped routes.

## External release gates

Authorized OCR/storage, ERP/accounting, vendor-master, PO/receipt, payment, and tax sandboxes; contract fixtures; malware scanning/document retention; reconciliation; migration/rollback and backup/restore rehearsals; security/load testing; and qualified AP, accounting, tax, security, privacy, and finance approval remain required. Source changes and local tests do not satisfy these gates.
