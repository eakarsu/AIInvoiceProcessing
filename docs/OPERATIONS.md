# Governed invoice-processing operations

The governed workflow records immutable document metadata, a versioned extraction candidate, deterministic line/tax/total validation, duplicate fingerprints, three-way PO/receipt matching, exceptions, approvals, an idempotent ERP posting request, and reconciliation. OCR/model output is a non-authoritative candidate and is never persisted as an invoice automatically.

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
