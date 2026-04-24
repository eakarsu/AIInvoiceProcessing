const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = require('./db');
const { aiFeatures } = require('./ai');

const app = express();
const PORT = process.env.BACKEND_PORT || 4001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'client')));

// Auth middleware
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ====== AUTH ROUTES ======
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.full_name }, process.env.JWT_SECRET || 'secret', { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.full_name, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====== GENERIC CRUD FACTORY ======
function createCRUD(tableName, aiAnalyzer) {
  const router = express.Router();

  // GET all
  router.get('/', async (req, res) => {
    try {
      const result = await pool.query(`SELECT * FROM ${tableName} ORDER BY id DESC`);
      res.json(result.rows);
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

  // POST create
  router.post('/', async (req, res) => {
    try {
      const keys = Object.keys(req.body);
      const values = Object.values(req.body).map(v => typeof v === 'object' ? JSON.stringify(v) : v);
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

  // PUT update
  router.put('/:id', async (req, res) => {
    try {
      const keys = Object.keys(req.body);
      const values = Object.values(req.body).map(v => typeof v === 'object' ? JSON.stringify(v) : v);
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

  // AI Analysis
  if (aiAnalyzer) {
    router.post('/:id/analyze', async (req, res) => {
      try {
        const result = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1`, [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const analysis = await aiAnalyzer(result.rows[0]);
        res.json(analysis);
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

// Catch-all: serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
