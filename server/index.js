const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const multer = require('multer');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Startup validation
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET not set');
  process.exit(1);
}

const pool = require('./db');
const { aiFeatures, callOpenRouterWithVision, callOpenRouter } = require('./ai');

const app = express();
const PORT = process.env.BACKEND_PORT || 4001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'client')));

// ====== RATE LIMITER ======
const aiRateLimitStore = new Map();
function aiRateLimiter(req, res, next) {
  const key = req.user?.id || req.ip;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const max = 20;

  if (!aiRateLimitStore.has(key)) {
    aiRateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return next();
  }

  const entry = aiRateLimitStore.get(key);
  if (now > entry.resetAt) {
    aiRateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return next();
  }

  if (entry.count >= max) {
    return res.status(429).json({
      error: 'Rate limit exceeded. You may make up to 20 AI requests per hour.',
      retryAfter: Math.ceil((entry.resetAt - now) / 1000)
    });
  }

  entry.count++;
  next();
}

// Auth middleware
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ====== COLUMN ALLOWLISTS ======
const COLUMN_ALLOWLISTS = {
  invoices: ['vendor_id', 'po_id', 'invoice_number', 'vendor_name', 'amount', 'currency', 'due_date', 'issue_date', 'status', 'tax_amount', 'description', 'line_items', 'ai_extracted_data', 'ai_confidence_score'],
  vendors: ['name', 'email', 'phone', 'address', 'payment_terms', 'tax_id', 'category', 'rating', 'total_invoices', 'total_spent', 'status'],
  purchase_orders: ['po_number', 'vendor_id', 'vendor_name', 'amount', 'status', 'items', 'requested_by', 'approved_by', 'delivery_date', 'notes'],
  payments: ['invoice_id', 'payment_number', 'vendor_name', 'amount', 'payment_date', 'method', 'reference', 'status', 'notes'],
  approval_workflows: ['name', 'document_type', 'document_id', 'document_ref', 'amount', 'status', 'current_approver', 'approvers', 'approval_history', 'priority'],
  expense_categories: ['name', 'code', 'parent_category', 'budget_limit', 'current_spend', 'description', 'gl_account', 'is_active'],
  budgets: ['name', 'department', 'category', 'fiscal_year', 'fiscal_quarter', 'allocated_amount', 'spent_amount', 'remaining_amount', 'status', 'notes'],
  receipts: ['receipt_number', 'vendor_name', 'amount', 'category', 'receipt_date', 'employee', 'description', 'ai_extracted_data', 'status'],
  tax_records: ['tax_type', 'vendor_name', 'tax_id', 'amount', 'tax_amount', 'tax_rate', 'period', 'status', 'jurisdiction', 'notes'],
  reports: ['name', 'report_type', 'date_range', 'generated_by', 'data', 'summary', 'status'],
  bank_reconciliations: ['account_name', 'account_number', 'statement_date', 'statement_balance', 'book_balance', 'difference', 'matched_transactions', 'unmatched_transactions', 'status', 'notes'],
  credit_notes: ['credit_note_number', 'invoice_id', 'vendor_name', 'amount', 'reason', 'status', 'issue_date', 'applied_date', 'notes'],
  currency_conversions: ['from_currency', 'to_currency', 'exchange_rate', 'amount', 'converted_amount', 'source', 'conversion_date', 'invoice_ref'],
  duplicate_detections: ['invoice_id_1', 'invoice_id_2', 'invoice_ref_1', 'invoice_ref_2', 'vendor_name', 'amount', 'similarity_score', 'detection_method', 'status', 'resolution'],
  audit_logs: ['action', 'entity_type', 'entity_id', 'user_name', 'details', 'ip_address', 'changes'],
};

function filterBody(tableName, body) {
  const allowed = COLUMN_ALLOWLISTS[tableName];
  if (!allowed) return body;
  return Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
}

// ====== MULTER SETUP ======
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, and PDF files are allowed'), false);
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ====== AUTH ROUTES ======
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.full_name }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.full_name, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====== GENERIC CRUD FACTORY ======
function createCRUD(tableName, aiAnalyzer) {
  const router = express.Router();

  // GET all - with pagination
  router.get('/', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const offset = (page - 1) * limit;

      const [dataResult, countResult] = await Promise.all([
        pool.query(`SELECT * FROM ${tableName} ORDER BY id DESC LIMIT $1 OFFSET $2`, [limit, offset]),
        pool.query(`SELECT COUNT(*) FROM ${tableName}`)
      ]);

      const total = parseInt(countResult.rows[0].count);
      res.json({
        data: dataResult.rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET by id
  router.get('/:id', async (req, res) => {
    try {
      const result = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1`, [req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST create - with column whitelisting
  router.post('/', async (req, res) => {
    try {
      const filtered = filterBody(tableName, req.body);
      const keys = Object.keys(filtered);
      if (keys.length === 0) return res.status(400).json({ error: 'No valid fields provided' });
      const values = Object.values(filtered).map(v => typeof v === 'object' ? JSON.stringify(v) : v);
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const result = await pool.query(
        `INSERT INTO ${tableName} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        values
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT update - with column whitelisting
  router.put('/:id', async (req, res) => {
    try {
      const filtered = filterBody(tableName, req.body);
      const keys = Object.keys(filtered);
      if (keys.length === 0) return res.status(400).json({ error: 'No valid fields provided' });
      const values = Object.values(filtered).map(v => typeof v === 'object' ? JSON.stringify(v) : v);
      const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
      values.push(req.params.id);
      const result = await pool.query(
        `UPDATE ${tableName} SET ${setClause} WHERE id = $${values.length} RETURNING *`,
        values
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE
  router.delete('/:id', async (req, res) => {
    try {
      const result = await pool.query(`DELETE FROM ${tableName} WHERE id = $1 RETURNING *`, [req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      res.json({ message: 'Deleted successfully', item: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // AI Analysis - with rate limiter and structured output
  if (aiAnalyzer) {
    router.post('/:id/analyze', authMiddleware, aiRateLimiter, async (req, res) => {
      try {
        const result = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1`, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const raw = await aiAnalyzer(result.rows[0]);

        // Attempt structured JSON parsing
        let structured = null;
        if (raw.success && raw.content) {
          try {
            const stripped = raw.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
            structured = JSON.parse(stripped);
          } catch {
            structured = null;
          }
        }

        res.json({ ...raw, structured, raw: raw.content });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  return router;
}

// ====== REGISTER ALL ROUTES ======
app.use('/api/invoices', createCRUD('invoices', aiFeatures.analyzeInvoice));
app.use('/api/vendors', createCRUD('vendors', aiFeatures.analyzeVendor));
app.use('/api/purchase-orders', createCRUD('purchase_orders', aiFeatures.analyzePurchaseOrder));
app.use('/api/payments', createCRUD('payments', aiFeatures.analyzePayment));
app.use('/api/approvals', createCRUD('approval_workflows', aiFeatures.analyzeApproval));
app.use('/api/expense-categories', createCRUD('expense_categories', aiFeatures.analyzeExpenseCategory));
app.use('/api/budgets', createCRUD('budgets', aiFeatures.analyzeBudget));
app.use('/api/receipts', createCRUD('receipts', aiFeatures.analyzeReceipt));
app.use('/api/tax-records', createCRUD('tax_records', aiFeatures.analyzeTax));
app.use('/api/reports', createCRUD('reports', aiFeatures.analyzeReport));
app.use('/api/bank-reconciliations', createCRUD('bank_reconciliations', aiFeatures.analyzeReconciliation));
app.use('/api/credit-notes', createCRUD('credit_notes', aiFeatures.analyzeCreditNote));
app.use('/api/currency-conversions', createCRUD('currency_conversions', aiFeatures.analyzeCurrency));
app.use('/api/duplicate-detections', createCRUD('duplicate_detections', aiFeatures.analyzeDuplicate));
app.use('/api/audit-logs', createCRUD('audit_logs', aiFeatures.analyzeAuditLog));

// ====== OCR UPLOAD ======
app.post('/api/invoices/ocr-upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { mimetype, buffer } = req.file;
    let extracted = null;

    if (mimetype === 'application/pdf') {
      // For PDF: return placeholder - vision API needs image
      return res.status(400).json({ error: 'PDF OCR not supported yet. Please upload a JPEG or PNG image.' });
    }

    // Image: convert to base64 and call OpenRouter vision
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mimetype};base64,${base64}`;

    const systemPrompt = 'Extract invoice data from this image. Return JSON only, no prose: { "vendor_name": string, "invoice_number": string, "invoice_date": string, "due_date": string, "line_items": [{"description": string, "quantity": number, "unit_price": number, "total": number}], "subtotal": number, "tax": number, "total_amount": number, "payment_terms": string }';

    const result = await callOpenRouterWithVision(dataUrl, systemPrompt);
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'AI extraction failed' });
    }

    try {
      const stripped = result.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      extracted = JSON.parse(stripped);
    } catch {
      extracted = { raw: result.content };
    }

    // Auto-create invoice in DB
    let invoice_id = null;
    if (extracted && extracted.vendor_name) {
      try {
        const inv = await pool.query(
          `INSERT INTO invoices (invoice_number, vendor_name, amount, due_date, issue_date, description, line_items, ai_extracted_data, ai_confidence_score, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending') RETURNING id`,
          [
            extracted.invoice_number || 'OCR-' + Date.now(),
            extracted.vendor_name,
            extracted.total_amount || 0,
            extracted.due_date || null,
            extracted.invoice_date || null,
            'Auto-created via OCR upload',
            JSON.stringify(extracted.line_items || []),
            JSON.stringify(extracted),
            85
          ]
        );
        invoice_id = inv.rows[0].id;
      } catch (dbErr) {
        console.error('Failed to save invoice:', dbErr.message);
      }
    }

    res.json({ extracted, invoice_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====== 3-WAY MATCH ======
app.post('/api/invoices/:id/three-way-match', authMiddleware, aiRateLimiter, async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch invoice
    const invResult = await pool.query('SELECT * FROM invoices WHERE id = $1', [id]);
    if (invResult.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    const invoice = invResult.rows[0];

    // Find related PO
    let po = null;
    try {
      if (invoice.po_id) {
        const poRes = await pool.query('SELECT * FROM purchase_orders WHERE id = $1', [invoice.po_id]);
        po = poRes.rows[0] || null;
      }
      if (!po && invoice.vendor_name) {
        const poRes = await pool.query(
          `SELECT * FROM purchase_orders WHERE vendor_name ILIKE $1 AND ABS(amount - $2) / GREATEST(amount, 1) < 0.1 ORDER BY id DESC LIMIT 1`,
          [invoice.vendor_name, invoice.amount]
        );
        po = poRes.rows[0] || null;
      }
    } catch { /* receipts table may not exist */ }

    // Find related receipt
    let receipt = null;
    try {
      const recRes = await pool.query(
        `SELECT * FROM receipts WHERE vendor_name ILIKE $1 AND ABS(amount - $2) / GREATEST(amount, 1) < 0.15 ORDER BY id DESC LIMIT 1`,
        [invoice.vendor_name, invoice.amount]
      );
      receipt = recRes.rows[0] || null;
    } catch { /* receipts table may not exist */ }

    const { callOpenRouter } = require('./ai');
    const prompt = `Perform a 3-way match audit between Invoice, Purchase Order, and Receipt.

Invoice: ${JSON.stringify(invoice, null, 2)}

Purchase Order: ${po ? JSON.stringify(po, null, 2) : 'NOT FOUND'}

Receipt/Delivery Confirmation: ${receipt ? JSON.stringify(receipt, null, 2) : 'NOT FOUND'}

Return JSON only:
{
  "match_status": "approved|discrepancy|missing_docs",
  "discrepancies": ["list of discrepancies if any"],
  "recommended_action": "string",
  "approval_confidence": 0.0-1.0,
  "summary": "brief explanation"
}`;

    const aiResult = await callOpenRouter(prompt);
    let matchData = null;
    if (aiResult.success && aiResult.content) {
      try {
        const stripped = aiResult.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
        matchData = JSON.parse(stripped);
      } catch {
        matchData = { raw: aiResult.content };
      }
    }

    // Update invoice status if approved
    if (matchData && matchData.match_status === 'approved') {
      await pool.query(
        `UPDATE invoices SET status = 'matched', ai_extracted_data = $1 WHERE id = $2`,
        [JSON.stringify({ ...invoice.ai_extracted_data, three_way_match: matchData }), id]
      );
    }

    res.json({
      invoice_id: id,
      po_found: !!po,
      receipt_found: !!receipt,
      match_result: matchData,
      raw_ai: aiResult.content
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dashboard stats
app.get('/api/dashboard', async (req, res) => {
  try {
    const [invoices, vendors, payments, pos, approvals, budgets] = await Promise.all([
      pool.query('SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total, status FROM invoices GROUP BY status'),
      pool.query('SELECT COUNT(*) as count FROM vendors WHERE status = $1', ['active']),
      pool.query("SELECT COUNT(*) as count, COALESCE(SUM(amount),0) as total FROM payments WHERE status = 'completed'"),
      pool.query('SELECT COUNT(*) as count FROM purchase_orders'),
      pool.query("SELECT COUNT(*) as count FROM approval_workflows WHERE status = 'pending'"),
      pool.query('SELECT COALESCE(SUM(allocated_amount),0) as allocated, COALESCE(SUM(spent_amount),0) as spent FROM budgets')
    ]);

    let totalInvoices = 0, totalInvoiceAmount = 0, pendingInvoices = 0;
    invoices.rows.forEach(r => {
      totalInvoices += parseInt(r.count);
      totalInvoiceAmount += parseFloat(r.total);
      if (r.status === 'pending') pendingInvoices = parseInt(r.count);
    });

    res.json({
      totalInvoices,
      totalInvoiceAmount,
      pendingInvoices,
      activeVendors: parseInt(vendors.rows[0].count),
      completedPayments: parseInt(payments.rows[0].count),
      totalPaid: parseFloat(payments.rows[0].total),
      purchaseOrders: parseInt(pos.rows[0].count),
      pendingApprovals: parseInt(approvals.rows[0].count),
      budgetAllocated: parseFloat(budgets.rows[0].allocated),
      budgetSpent: parseFloat(budgets.rows[0].spent)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI: Duplicate invoice detection
app.post('/api/invoices/:id/duplicate-detection', authMiddleware, aiRateLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const invRes = await pool.query('SELECT * FROM invoices WHERE id = $1', [id]);
    if (invRes.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
    const invoice = invRes.rows[0];

    const candidates = await pool.query(
      `SELECT id, invoice_number, vendor_name, amount, issue_date, due_date, status FROM invoices
       WHERE id <> $1
         AND (
           (vendor_name ILIKE $2 AND ABS(amount - $3) / GREATEST(amount, 1) < 0.05)
           OR invoice_number ILIKE $4
         )
       ORDER BY id DESC LIMIT 25`,
      [id, invoice.vendor_name || '', invoice.amount || 0, invoice.invoice_number || '%']
    ).catch(() => ({ rows: [] }));

    const prompt = `You are an AP duplicate-payment detection expert. Decide if any candidate is a duplicate or near-duplicate of the subject invoice.

Subject invoice: ${JSON.stringify(invoice)}

Candidate invoices: ${JSON.stringify(candidates.rows)}

Return JSON:
{
  "duplicates": [{ "candidate_id": number, "score_0_100": number, "reasons": [string], "confidence": "low|medium|high" }],
  "near_duplicates": [{ "candidate_id": number, "score_0_100": number, "reasons": [string] }],
  "recommended_action": "block|hold_for_review|allow",
  "rationale": string
}`;

    const result = await callOpenRouter(prompt, 'You are an AP duplicate-payment detection AI. Return JSON only.');
    if (!result.success) {
      const code = result.statusCode || 500;
      return res.status(code).json({ error: result.error || 'AI call failed' });
    }

    let parsed = null;
    try {
      const stripped = result.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      parsed = JSON.parse(stripped);
    } catch {
      parsed = { raw: result.content };
    }
    res.json({ subject: invoice.id, candidates_examined: candidates.rows.length, analysis: parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI: Payment-term advisor
app.post('/api/vendors/:id/payment-term-advisor', authMiddleware, aiRateLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const vRes = await pool.query('SELECT * FROM vendors WHERE id = $1', [id]);
    if (vRes.rows.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    const vendor = vRes.rows[0];

    const recentInvoices = await pool.query(
      `SELECT id, invoice_number, amount, status, issue_date, due_date FROM invoices
       WHERE vendor_name ILIKE $1 ORDER BY id DESC LIMIT 30`,
      [vendor.name || '']
    ).catch(() => ({ rows: [] }));

    const recentPayments = await pool.query(
      `SELECT id, payment_number, amount, method, status, payment_date FROM payments
       WHERE vendor_name ILIKE $1 ORDER BY id DESC LIMIT 30`,
      [vendor.name || '']
    ).catch(() => ({ rows: [] }));

    const prompt = `You are an AP payment-term strategist. Recommend the optimal payment terms (net days), early-pay discount target, and timing strategy for this vendor based on history. Be specific and quantitative.

Vendor: ${JSON.stringify(vendor)}
Recent invoices: ${JSON.stringify(recentInvoices.rows)}
Recent payments: ${JSON.stringify(recentPayments.rows)}

Return JSON:
{
  "current_terms_days": number,
  "recommended_terms_days": number,
  "early_pay_discount_target_pct": number,
  "expected_savings_annual_usd": number,
  "negotiation_leverage": [string],
  "risks": [string],
  "negotiation_script_outline": [string],
  "rationale": string
}`;

    const result = await callOpenRouter(prompt, 'You are an AP payment-term strategist AI. Return JSON only.');
    if (!result.success) {
      const code = result.statusCode || 500;
      return res.status(code).json({ error: result.error || 'AI call failed' });
    }

    let parsed = null;
    try {
      const stripped = result.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      parsed = JSON.parse(stripped);
    } catch {
      parsed = { raw: result.content };
    }
    res.json({ vendor: vendor.name, advisory: parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI: Budget forecast (project remaining quarter / fiscal year)
app.post('/api/budgets/forecast', authMiddleware, aiRateLimiter, async (req, res) => {
  try {
    const { horizon } = req.body || {};
    const budgets = await pool.query('SELECT * FROM budgets').catch(() => ({ rows: [] }));
    const ytdInvoices = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM invoices
       WHERE issue_date >= date_trunc('year', CURRENT_DATE)`
    ).catch(() => ({ rows: [{ total: 0, count: 0 }] }));
    const monthlyInvoices = await pool.query(
      `SELECT to_char(date_trunc('month', issue_date), 'YYYY-MM') AS month,
              COALESCE(SUM(amount), 0) AS total
       FROM invoices
       WHERE issue_date >= CURRENT_DATE - INTERVAL '12 months'
       GROUP BY 1 ORDER BY 1`
    ).catch(() => ({ rows: [] }));

    const prompt = `You are a finance forecasting AI. Project spend for the requested horizon based on YTD and trailing-12-month data.

Horizon requested: ${horizon || 'quarter'}
Budgets: ${JSON.stringify(budgets.rows)}
YTD invoices (single row): ${JSON.stringify(ytdInvoices.rows[0])}
Trailing 12 months by month: ${JSON.stringify(monthlyInvoices.rows)}

Return JSON:
{
  "horizon": string,
  "projected_spend_low": number,
  "projected_spend_central": number,
  "projected_spend_high": number,
  "by_category": [{ "category": string, "projected_spend": number, "vs_budget_pct": number }],
  "key_drivers": [string],
  "risk_alerts": [string],
  "recommended_actions": [string],
  "confidence_0_100": number,
  "summary": string
}`;

    const result = await callOpenRouter(prompt, 'You are a corporate finance forecasting AI. Return JSON only.');
    if (!result.success) {
      const code = result.statusCode || 500;
      return res.status(code).json({ error: result.error || 'AI call failed' });
    }

    let parsed = null;
    try {
      const stripped = result.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      parsed = JSON.parse(stripped);
    } catch {
      parsed = { raw: result.content };
    }
    res.json({ forecast: parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AI: Supplier scorecard - composite vendor performance score
app.post('/api/vendors/:id/scorecard', authMiddleware, aiRateLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const vRes = await pool.query('SELECT * FROM vendors WHERE id = $1', [id]);
    if (vRes.rows.length === 0) return res.status(404).json({ error: 'Vendor not found' });
    const vendor = vRes.rows[0];

    const recentInvoices = await pool.query(
      `SELECT id, invoice_number, amount, status, issue_date, due_date FROM invoices
       WHERE vendor_name ILIKE $1 ORDER BY id DESC LIMIT 50`,
      [vendor.name || '']
    ).catch(() => ({ rows: [] }));

    const recentPayments = await pool.query(
      `SELECT id, payment_number, amount, method, status, payment_date FROM payments
       WHERE vendor_name ILIKE $1 ORDER BY id DESC LIMIT 50`,
      [vendor.name || '']
    ).catch(() => ({ rows: [] }));

    const recentPOs = await pool.query(
      `SELECT id, po_number, amount, status FROM purchase_orders
       WHERE vendor_name ILIKE $1 ORDER BY id DESC LIMIT 30`,
      [vendor.name || '']
    ).catch(() => ({ rows: [] }));

    // Quick numeric stats
    const total = recentInvoices.rows.length;
    const paid = recentInvoices.rows.filter(i => i.status === 'paid').length;
    const overdue = recentInvoices.rows.filter(i => i.status === 'overdue').length;
    const disputed = recentInvoices.rows.filter(i => i.status === 'disputed').length;

    const prompt = `You are a procurement supplier-performance AI. Generate a composite scorecard for the vendor across delivery, billing accuracy, payment compliance, dispute frequency, and overall risk.

Vendor: ${JSON.stringify(vendor)}
Quick stats: ${JSON.stringify({ total, paid, overdue, disputed })}
Recent invoices: ${JSON.stringify(recentInvoices.rows)}
Recent payments: ${JSON.stringify(recentPayments.rows)}
Recent POs: ${JSON.stringify(recentPOs.rows)}

Return JSON:
{
  "overall_score_0_100": number,
  "grade": "A|B|C|D|F",
  "category_scores": {
    "delivery_reliability": number,
    "billing_accuracy": number,
    "payment_compliance": number,
    "dispute_rate": number,
    "spend_concentration_risk": number
  },
  "strengths": [string],
  "weaknesses": [string],
  "trend": "improving|stable|declining",
  "recommended_actions": [{ "priority": number, "action": string, "owner": string }],
  "risk_flags": [{ "severity": "low|medium|high", "description": string }],
  "executive_summary": string
}`;

    const result = await callOpenRouter(prompt, 'You are a procurement supplier-performance AI. Return JSON only.');
    if (!result.success) {
      const code = result.statusCode || 500;
      return res.status(code).json({ error: result.error || 'AI call failed' });
    }

    let parsed = null;
    try {
      const stripped = result.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      parsed = JSON.parse(stripped);
    } catch {
      parsed = { raw: result.content };
    }
    res.json({ vendor: vendor.name, scorecard: parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catch-all: serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// === BATCH 05 AUTO-MOUNT (custom feature suggestions) ===
app.use('/api/email-ingest', require('./routes/email-ingest-agent'));
app.use('/api/payment-run-scheduler', require('./routes/payment-run-scheduler'));
app.use('/api/vendor-benchmarking', require('./routes/vendor-benchmarking'));
app.use('/api/three-way-resolver', require('./routes/three-way-resolver'));
app.use('/api/erp-webhook', require('./routes/erp-webhook'));

// === Batch 05 Gaps & Frontend Mounts ===
try { const _gap_cash_flow_forecast = require('./routes/gap-cash-flow-forecast'); app.use('/api/gap-cash-flow-forecast', _gap_cash_flow_forecast); } catch(e) { console.error('gap mount fail cash-flow-forecast:', e.message); }
try { const _gap_early_pay_discount_optimizer = require('./routes/gap-early-pay-discount-optimizer'); app.use('/api/gap-early-pay-discount-optimizer', _gap_early_pay_discount_optimizer); } catch(e) { console.error('gap mount fail early-pay-discount-optimizer:', e.message); }
try { const _gap_expense_category_classifier = require('./routes/gap-expense-category-classifier'); app.use('/api/gap-expense-category-classifier', _gap_expense_category_classifier); } catch(e) { console.error('gap mount fail expense-category-classifier:', e.message); }
try { const _gap_vendor_risk_monitor = require('./routes/gap-vendor-risk-monitor'); app.use('/api/gap-vendor-risk-monitor', _gap_vendor_risk_monitor); } catch(e) { console.error('gap mount fail vendor-risk-monitor:', e.message); }
try { const _gap_webhooks = require('./routes/gap-webhooks'); app.use('/api/gap-webhooks', _gap_webhooks); } catch(e) { console.error('gap mount fail webhooks:', e.message); }
try { const _gap_multi_entity = require('./routes/gap-multi-entity'); app.use('/api/gap-multi-entity', _gap_multi_entity); } catch(e) { console.error('gap mount fail multi-entity:', e.message); }
try { const _gap_role_based = require('./routes/gap-role-based'); app.use('/api/gap-role-based', _gap_role_based); } catch(e) { console.error('gap mount fail role-based:', e.message); }
try { const _gap_notification_alerting = require('./routes/gap-notification-alerting'); app.use('/api/gap-notification-alerting', _gap_notification_alerting); } catch(e) { console.error('gap mount fail notification-alerting:', e.message); }
try { const _gap_e_signature = require('./routes/gap-e-signature'); app.use('/api/gap-e-signature', _gap_e_signature); } catch(e) { console.error('gap mount fail e-signature:', e.message); }
try { const _gap_customer_facing = require('./routes/gap-customer-facing'); app.use('/api/gap-customer-facing', _gap_customer_facing); } catch(e) { console.error('gap mount fail customer-facing:', e.message); }
try { const _gap_substantive = require('./routes/gap-substantive'); app.use('/api/gap-substantive', _gap_substantive); } catch(e) { console.error('gap mount fail substantive:', e.message); }
// === End Batch 05 Mounts ===
