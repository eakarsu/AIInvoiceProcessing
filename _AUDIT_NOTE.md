# Audit Apply Notes — AIInvoiceProcessing

## Source
`/Users/erolakarsu/projects/_AUDIT/reports/batch_05.md` section 1.

Note: audit recognized backend was misreported by TSV; existing code already implements:
- `POST /api/invoices/ocr-upload` — vision-based invoice extraction (covers `/invoice-extract`).
- `POST /api/invoices/:id/three-way-match` — 3-way match.
- `aiFeatures` exports analyze* functions for invoice/vendor/PO/payment/approval.

## Original Recommendations (AI Counterparts)
- `/invoice-extract` — already exists as `/api/invoices/ocr-upload`
- `/duplicate-invoice-detection` — MISSING (added)
- `/payment-term-advisor` — MISSING (added)
- `/budget-forecast` — MISSING (added)

## Implemented (this pass)
Three endpoints appended to `server/index.js` using existing `callOpenRouter` (added to existing destructure import) and `aiRateLimiter`:

- `POST /api/invoices/:id/duplicate-detection` — pulls subject invoice + candidate matches via vendor name + 5% amount tolerance + invoice number; AI returns duplicate / near-duplicate scoring and recommended action (block/hold/allow).
- `POST /api/vendors/:id/payment-term-advisor` — pulls vendor + last 30 invoices and 30 payments; AI returns recommended terms days, early-pay discount target, expected annual savings, negotiation script.
- `POST /api/budgets/forecast` — pulls budgets, YTD invoice spend, trailing-12-month series; AI returns low/central/high projection by category with confidence and recommended actions.

Syntax: `node --check` passes.

## Backlog
- Custom: vision auto-capture from email/mobile (extension of existing `/ocr-upload`), agentic approval routing, cross-vendor negotiation insights, autonomous payment scheduling, public ERP webhooks, deeper 3-way match agentic resolution.
- Non-AI: supplier scorecard (could compose new `/payment-term-advisor` + existing analyzeVendor), ERP webhooks (SAP/NetSuite/Coupa), multi-entity support.

## Categorization
- MECHANICAL: 3 endpoints (done — exhausts the audit's missing list).
- NEEDS-CREDS: ERP integrations.
- NEEDS-PRODUCT-DECISION: agent autonomy bounds, multi-entity model, payment-scheduler safety policy.

## Apply pass 3 (frontend)

- LEFT-AS-IS. The vanilla-JS SPA in `client/app.js` already wires every backend AI endpoint (`/invoices/ocr-upload`, `/invoices/:id/three-way-match`, `/invoices/:id/duplicate-detection`, `/vendors/:id/payment-term-advisor`, `/budgets/forecast`) using `localStorage.getItem('token')` Bearer auth and the existing toast/error styling.
- No code changes.

## Apply pass 4 (mechanical backlog)

- LEFT-AS-IS. The audit's missing-AI list (3 endpoints) was exhausted in prior passes; an additional `/vendors/:id/scorecard` AI endpoint already exists in `server/index.js` and is wired in `client/app.js` (Supplier Scorecard tab). All remaining backlog items are NEEDS-CREDS (ERP webhooks: SAP/NetSuite/Coupa) or NEEDS-PRODUCT-DECISION (multi-entity model, agent autonomy bounds, payment-scheduler safety policy). No code changes this pass.
