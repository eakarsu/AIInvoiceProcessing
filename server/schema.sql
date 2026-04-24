-- AI Invoice Processing & AP Automation Schema

DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS duplicate_detections CASCADE;
DROP TABLE IF EXISTS currency_conversions CASCADE;
DROP TABLE IF EXISTS credit_notes CASCADE;
DROP TABLE IF EXISTS bank_reconciliations CASCADE;
DROP TABLE IF EXISTS reports CASCADE;
DROP TABLE IF EXISTS tax_records CASCADE;
DROP TABLE IF EXISTS receipts CASCADE;
DROP TABLE IF EXISTS budgets CASCADE;
DROP TABLE IF EXISTS expense_categories CASCADE;
DROP TABLE IF EXISTS approval_workflows CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS purchase_orders CASCADE;
DROP TABLE IF EXISTS vendors CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Users
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Invoices
CREATE TABLE invoices (
  id SERIAL PRIMARY KEY,
  invoice_number VARCHAR(100) NOT NULL,
  vendor_name VARCHAR(255) NOT NULL,
  vendor_id INTEGER,
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(10) DEFAULT 'USD',
  status VARCHAR(50) DEFAULT 'pending',
  due_date DATE,
  issue_date DATE,
  description TEXT,
  line_items JSONB DEFAULT '[]',
  ai_extracted_data JSONB,
  ai_confidence_score DECIMAL(5,2),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Vendors
CREATE TABLE vendors (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  tax_id VARCHAR(100),
  payment_terms INTEGER DEFAULT 30,
  category VARCHAR(100),
  rating DECIMAL(3,2) DEFAULT 0,
  total_invoices INTEGER DEFAULT 0,
  total_spent DECIMAL(15,2) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Purchase Orders
CREATE TABLE purchase_orders (
  id SERIAL PRIMARY KEY,
  po_number VARCHAR(100) NOT NULL,
  vendor_id INTEGER REFERENCES vendors(id),
  vendor_name VARCHAR(255),
  amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(50) DEFAULT 'draft',
  items JSONB DEFAULT '[]',
  requested_by VARCHAR(255),
  approved_by VARCHAR(255),
  delivery_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Payments
CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  payment_number VARCHAR(100) NOT NULL,
  invoice_id INTEGER REFERENCES invoices(id),
  vendor_name VARCHAR(255),
  amount DECIMAL(12,2) NOT NULL,
  method VARCHAR(50) DEFAULT 'bank_transfer',
  status VARCHAR(50) DEFAULT 'pending',
  payment_date DATE,
  reference VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Approval Workflows
CREATE TABLE approval_workflows (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  document_type VARCHAR(100) NOT NULL,
  document_id INTEGER,
  document_ref VARCHAR(255),
  amount DECIMAL(12,2),
  status VARCHAR(50) DEFAULT 'pending',
  current_approver VARCHAR(255),
  approvers JSONB DEFAULT '[]',
  approval_history JSONB DEFAULT '[]',
  priority VARCHAR(20) DEFAULT 'normal',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Expense Categories
CREATE TABLE expense_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50),
  parent_category VARCHAR(255),
  budget_limit DECIMAL(12,2),
  current_spend DECIMAL(12,2) DEFAULT 0,
  description TEXT,
  gl_account VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Budgets
CREATE TABLE budgets (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  department VARCHAR(255),
  category VARCHAR(255),
  fiscal_year INTEGER,
  fiscal_quarter VARCHAR(10),
  allocated_amount DECIMAL(12,2) NOT NULL,
  spent_amount DECIMAL(12,2) DEFAULT 0,
  remaining_amount DECIMAL(12,2),
  status VARCHAR(50) DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Receipts
CREATE TABLE receipts (
  id SERIAL PRIMARY KEY,
  receipt_number VARCHAR(100),
  vendor_name VARCHAR(255),
  amount DECIMAL(12,2) NOT NULL,
  category VARCHAR(255),
  receipt_date DATE,
  employee VARCHAR(255),
  description TEXT,
  ai_extracted_data JSONB,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tax Records
CREATE TABLE tax_records (
  id SERIAL PRIMARY KEY,
  tax_type VARCHAR(100) NOT NULL,
  vendor_name VARCHAR(255),
  tax_id VARCHAR(100),
  amount DECIMAL(12,2) NOT NULL,
  tax_amount DECIMAL(12,2),
  tax_rate DECIMAL(5,2),
  period VARCHAR(50),
  status VARCHAR(50) DEFAULT 'pending',
  jurisdiction VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Reports
CREATE TABLE reports (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  report_type VARCHAR(100),
  date_range VARCHAR(100),
  generated_by VARCHAR(255),
  data JSONB,
  summary TEXT,
  status VARCHAR(50) DEFAULT 'generated',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Bank Reconciliations
CREATE TABLE bank_reconciliations (
  id SERIAL PRIMARY KEY,
  account_name VARCHAR(255) NOT NULL,
  account_number VARCHAR(100),
  statement_date DATE,
  statement_balance DECIMAL(12,2),
  book_balance DECIMAL(12,2),
  difference DECIMAL(12,2),
  matched_transactions INTEGER DEFAULT 0,
  unmatched_transactions INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'in_progress',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Credit Notes
CREATE TABLE credit_notes (
  id SERIAL PRIMARY KEY,
  credit_note_number VARCHAR(100) NOT NULL,
  invoice_id INTEGER REFERENCES invoices(id),
  vendor_name VARCHAR(255),
  amount DECIMAL(12,2) NOT NULL,
  reason TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  issue_date DATE,
  applied_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Currency Conversions
CREATE TABLE currency_conversions (
  id SERIAL PRIMARY KEY,
  from_currency VARCHAR(10) NOT NULL,
  to_currency VARCHAR(10) NOT NULL,
  exchange_rate DECIMAL(12,6) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  converted_amount DECIMAL(12,2) NOT NULL,
  source VARCHAR(100),
  conversion_date DATE,
  invoice_ref VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Duplicate Detections
CREATE TABLE duplicate_detections (
  id SERIAL PRIMARY KEY,
  invoice_id_1 INTEGER,
  invoice_id_2 INTEGER,
  invoice_ref_1 VARCHAR(100),
  invoice_ref_2 VARCHAR(100),
  vendor_name VARCHAR(255),
  amount DECIMAL(12,2),
  similarity_score DECIMAL(5,2),
  detection_method VARCHAR(100),
  status VARCHAR(50) DEFAULT 'flagged',
  resolution TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Audit Logs
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100),
  entity_id INTEGER,
  user_name VARCHAR(255),
  details TEXT,
  ip_address VARCHAR(50),
  changes JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
