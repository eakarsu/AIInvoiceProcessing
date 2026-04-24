const pool = require('./db');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

async function seed() {
  const client = await pool.connect();
  try {
    // Run schema
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schema);
    console.log('Schema created successfully');

    // Seed Users
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await client.query(`INSERT INTO users (email, password, full_name, role) VALUES
      ('admin@company.com', $1, 'Admin User', 'admin'),
      ('john@company.com', $1, 'John Smith', 'manager'),
      ('jane@company.com', $1, 'Jane Doe', 'user')
    `, [hashedPassword]);
    console.log('Users seeded');

    // Seed Vendors (15+)
    await client.query(`INSERT INTO vendors (name, email, phone, address, tax_id, payment_terms, category, rating, total_invoices, total_spent, status) VALUES
      ('Acme Corporation', 'billing@acme.com', '555-0101', '123 Main St, New York, NY 10001', 'TAX-001-ACME', 30, 'Supplies', 4.8, 45, 125000.00, 'active'),
      ('TechFlow Solutions', 'ap@techflow.io', '555-0102', '456 Tech Ave, San Francisco, CA 94102', 'TAX-002-TECH', 45, 'Technology', 4.5, 32, 250000.00, 'active'),
      ('Global Logistics Inc', 'finance@globallog.com', '555-0103', '789 Shipping Blvd, Chicago, IL 60601', 'TAX-003-GLOB', 30, 'Logistics', 4.2, 28, 180000.00, 'active'),
      ('Premier Office Supplies', 'orders@premieroffice.com', '555-0104', '321 Commerce Dr, Dallas, TX 75201', 'TAX-004-PREM', 15, 'Office Supplies', 4.6, 52, 45000.00, 'active'),
      ('CloudHost Services', 'billing@cloudhost.com', '555-0105', '654 Cloud Lane, Seattle, WA 98101', 'TAX-005-CLOU', 30, 'Cloud Services', 4.9, 12, 360000.00, 'active'),
      ('Green Energy Co', 'invoices@greenenergy.com', '555-0106', '987 Solar Rd, Austin, TX 73301', 'TAX-006-GREE', 60, 'Utilities', 4.1, 24, 92000.00, 'active'),
      ('DataSecure Inc', 'accounts@datasecure.com', '555-0107', '147 Security Blvd, Boston, MA 02101', 'TAX-007-DATA', 30, 'Security', 4.7, 18, 156000.00, 'active'),
      ('Marketing Pro Agency', 'billing@marketingpro.com', '555-0108', '258 Creative Ave, Los Angeles, CA 90001', 'TAX-008-MARK', 30, 'Marketing', 4.3, 36, 210000.00, 'active'),
      ('FastShip Couriers', 'finance@fastship.com', '555-0109', '369 Express Way, Miami, FL 33101', 'TAX-009-FAST', 15, 'Shipping', 3.9, 65, 78000.00, 'active'),
      ('Legal Associates LLP', 'billing@legalassoc.com', '555-0110', '741 Justice Ct, Washington, DC 20001', 'TAX-010-LEGA', 45, 'Legal', 4.4, 15, 195000.00, 'active'),
      ('CleanSpace Janitorial', 'invoices@cleanspace.com', '555-0111', '852 Clean St, Denver, CO 80201', 'TAX-011-CLEA', 30, 'Facilities', 4.0, 48, 36000.00, 'active'),
      ('ProTraining Institute', 'accounts@protraining.com', '555-0112', '963 Learning Ln, Portland, OR 97201', 'TAX-012-PROT', 30, 'Training', 4.6, 8, 42000.00, 'active'),
      ('AutoFleet Services', 'billing@autofleet.com', '555-0113', '159 Motor Dr, Detroit, MI 48201', 'TAX-013-AUTO', 30, 'Fleet', 4.2, 22, 88000.00, 'active'),
      ('Pinnacle Consulting', 'ap@pinnacle.com', '555-0114', '357 Strategy Blvd, Atlanta, GA 30301', 'TAX-014-PINN', 45, 'Consulting', 4.8, 19, 320000.00, 'active'),
      ('FreshFood Catering', 'orders@freshfood.com', '555-0115', '468 Culinary Ave, Houston, TX 77001', 'TAX-015-FRES', 15, 'Catering', 4.5, 42, 55000.00, 'active'),
      ('InsureSafe Corp', 'billing@insuresafe.com', '555-0116', '579 Coverage Rd, Philadelphia, PA 19101', 'TAX-016-INSU', 60, 'Insurance', 4.3, 6, 145000.00, 'active')
    `);
    console.log('Vendors seeded');

    // Seed Invoices (15+)
    await client.query(`INSERT INTO invoices (invoice_number, vendor_name, vendor_id, amount, currency, status, due_date, issue_date, description, line_items) VALUES
      ('INV-2024-001', 'Acme Corporation', 1, 15750.00, 'USD', 'pending', '2024-04-15', '2024-03-15', 'Office supplies Q1 2024', '[{"item":"Printer Paper (50 boxes)","qty":50,"price":45.00},{"item":"Ink Cartridges","qty":20,"price":120.00},{"item":"Desk Organizers","qty":30,"price":75.00}]'),
      ('INV-2024-002', 'TechFlow Solutions', 2, 45000.00, 'USD', 'approved', '2024-04-20', '2024-03-20', 'Software licenses annual renewal', '[{"item":"Enterprise License","qty":50,"price":800.00},{"item":"Support Package","qty":1,"price":5000.00}]'),
      ('INV-2024-003', 'Global Logistics Inc', 3, 8900.00, 'USD', 'paid', '2024-03-30', '2024-03-01', 'Freight charges March 2024', '[{"item":"Ground Shipping","qty":45,"price":120.00},{"item":"Express Delivery","qty":15,"price":180.00}]'),
      ('INV-2024-004', 'CloudHost Services', 5, 12500.00, 'USD', 'pending', '2024-04-25', '2024-03-25', 'Cloud infrastructure Q1', '[{"item":"Compute Instances","qty":10,"price":800.00},{"item":"Storage (TB)","qty":5,"price":500.00},{"item":"CDN Bandwidth","qty":1,"price":500.00}]'),
      ('INV-2024-005', 'Green Energy Co', 6, 3200.00, 'USD', 'approved', '2024-04-10', '2024-03-10', 'Electricity March 2024', '[{"item":"Peak Usage (kWh)","qty":8000,"price":0.25},{"item":"Off-Peak Usage (kWh)","qty":6000,"price":0.12},{"item":"Service Fee","qty":1,"price":80.00}]'),
      ('INV-2024-006', 'DataSecure Inc', 7, 28000.00, 'USD', 'pending', '2024-05-01', '2024-04-01', 'Annual security audit & monitoring', '[{"item":"Security Audit","qty":1,"price":15000.00},{"item":"24/7 Monitoring (Annual)","qty":1,"price":13000.00}]'),
      ('INV-2024-007', 'Marketing Pro Agency', 8, 18500.00, 'USD', 'rejected', '2024-04-15', '2024-03-15', 'Q1 Marketing campaign', '[{"item":"Social Media Campaign","qty":1,"price":8000.00},{"item":"Content Creation","qty":1,"price":5500.00},{"item":"PPC Management","qty":1,"price":5000.00}]'),
      ('INV-2024-008', 'FastShip Couriers', 9, 2340.00, 'USD', 'paid', '2024-03-20', '2024-03-05', 'Express deliveries week 10-11', '[{"item":"Same-Day Delivery","qty":12,"price":85.00},{"item":"Next-Day Delivery","qty":24,"price":45.00}]'),
      ('INV-2024-009', 'Legal Associates LLP', 10, 35000.00, 'USD', 'approved', '2024-05-15', '2024-04-15', 'Legal retainer Q2 2024', '[{"item":"Legal Retainer","qty":1,"price":25000.00},{"item":"Contract Review","qty":5,"price":2000.00}]'),
      ('INV-2024-010', 'Premier Office Supplies', 4, 4560.00, 'USD', 'pending', '2024-04-30', '2024-03-30', 'Furniture order - new hires', '[{"item":"Ergonomic Chairs","qty":6,"price":450.00},{"item":"Standing Desks","qty":3,"price":520.00}]'),
      ('INV-2024-011', 'Pinnacle Consulting', 14, 52000.00, 'USD', 'approved', '2024-05-20', '2024-04-20', 'Strategy consulting April', '[{"item":"Strategy Workshop","qty":4,"price":8000.00},{"item":"Market Analysis","qty":1,"price":20000.00}]'),
      ('INV-2024-012', 'AutoFleet Services', 13, 6800.00, 'USD', 'pending', '2024-04-15', '2024-03-15', 'Fleet maintenance March', '[{"item":"Oil Change & Service","qty":8,"price":350.00},{"item":"Tire Replacement","qty":4,"price":850.00}]'),
      ('INV-2024-013', 'ProTraining Institute', 12, 9500.00, 'USD', 'paid', '2024-03-25', '2024-02-25', 'Employee training program', '[{"item":"Leadership Training","qty":5,"price":1200.00},{"item":"Technical Workshop","qty":10,"price":350.00}]'),
      ('INV-2024-014', 'CleanSpace Janitorial', 11, 2800.00, 'USD', 'approved', '2024-04-05', '2024-03-05', 'Cleaning services March', '[{"item":"Daily Cleaning","qty":22,"price":100.00},{"item":"Deep Clean","qty":2,"price":300.00}]'),
      ('INV-2024-015', 'FreshFood Catering', 15, 3750.00, 'USD', 'pending', '2024-04-10', '2024-03-10', 'Catering for company events', '[{"item":"Team Lunch (50 ppl)","qty":3,"price":750.00},{"item":"Executive Dinner","qty":1,"price":1500.00}]'),
      ('INV-2024-016', 'InsureSafe Corp', 16, 24000.00, 'USD', 'approved', '2024-06-01', '2024-03-01', 'Business insurance renewal', '[{"item":"General Liability","qty":1,"price":12000.00},{"item":"Property Insurance","qty":1,"price":8000.00},{"item":"Cyber Insurance","qty":1,"price":4000.00}]')
    `);
    console.log('Invoices seeded');

    // Seed Purchase Orders (15+)
    await client.query(`INSERT INTO purchase_orders (po_number, vendor_id, vendor_name, amount, status, items, requested_by, approved_by, delivery_date, notes) VALUES
      ('PO-2024-001', 1, 'Acme Corporation', 8500.00, 'approved', '[{"item":"Printer Paper","qty":100,"price":45},{"item":"Toner","qty":20,"price":200}]', 'John Smith', 'Jane Doe', '2024-04-01', 'Quarterly office supply restock'),
      ('PO-2024-002', 2, 'TechFlow Solutions', 32000.00, 'pending', '[{"item":"Developer Licenses","qty":20,"price":1600}]', 'Mike Johnson', NULL, '2024-04-15', 'New developer team licenses'),
      ('PO-2024-003', 3, 'Global Logistics Inc', 5600.00, 'approved', '[{"item":"Warehouse Storage","qty":4,"price":1400}]', 'Sarah Wilson', 'John Smith', '2024-03-25', 'Q2 warehouse space'),
      ('PO-2024-004', 5, 'CloudHost Services', 18000.00, 'sent', '[{"item":"GPU Instances","qty":5,"price":2400},{"item":"Storage Upgrade","qty":10,"price":600}]', 'Dev Team', 'CTO', '2024-04-10', 'ML infrastructure expansion'),
      ('PO-2024-005', 4, 'Premier Office Supplies', 12400.00, 'approved', '[{"item":"Ergonomic Chairs","qty":15,"price":450},{"item":"Monitor Arms","qty":15,"price":120},{"item":"Keyboard Trays","qty":15,"price":80}]', 'HR Dept', 'CFO', '2024-04-20', 'New hire equipment'),
      ('PO-2024-006', 8, 'Marketing Pro Agency', 25000.00, 'draft', '[{"item":"Q2 Campaign","qty":1,"price":15000},{"item":"Brand Refresh","qty":1,"price":10000}]', 'Marketing Dir', NULL, '2024-05-01', 'Q2 marketing initiatives'),
      ('PO-2024-007', 7, 'DataSecure Inc', 42000.00, 'approved', '[{"item":"Penetration Testing","qty":2,"price":12000},{"item":"SOC2 Compliance","qty":1,"price":18000}]', 'CISO', 'CEO', '2024-04-30', 'Annual security compliance'),
      ('PO-2024-008', 6, 'Green Energy Co', 15000.00, 'sent', '[{"item":"Solar Panel Install","qty":1,"price":15000}]', 'Facilities', 'CFO', '2024-06-01', 'Rooftop solar installation'),
      ('PO-2024-009', 10, 'Legal Associates LLP', 20000.00, 'approved', '[{"item":"IP Review","qty":1,"price":12000},{"item":"Employment Contracts","qty":1,"price":8000}]', 'Legal Dept', 'CEO', '2024-04-15', 'Q2 legal services'),
      ('PO-2024-010', 12, 'ProTraining Institute', 16800.00, 'pending', '[{"item":"AWS Certification","qty":12,"price":800},{"item":"Agile Training","qty":20,"price":420}]', 'L&D Manager', NULL, '2024-05-15', 'Employee upskilling program'),
      ('PO-2024-011', 13, 'AutoFleet Services', 45000.00, 'approved', '[{"item":"Vehicle Lease","qty":3,"price":12000},{"item":"Insurance","qty":3,"price":3000}]', 'Operations', 'CFO', '2024-04-01', 'Fleet expansion'),
      ('PO-2024-012', 14, 'Pinnacle Consulting', 60000.00, 'sent', '[{"item":"Digital Transformation","qty":1,"price":40000},{"item":"Change Management","qty":1,"price":20000}]', 'CEO', 'Board', '2024-07-01', 'Strategic initiative H2'),
      ('PO-2024-013', 15, 'FreshFood Catering', 8400.00, 'approved', '[{"item":"Monthly Catering","qty":6,"price":1400}]', 'Office Manager', 'HR Dir', '2024-09-30', 'H1 catering contract'),
      ('PO-2024-014', 9, 'FastShip Couriers', 3600.00, 'approved', '[{"item":"Monthly Courier Plan","qty":3,"price":1200}]', 'Operations', 'COO', '2024-06-30', 'Q2 courier services'),
      ('PO-2024-015', 11, 'CleanSpace Janitorial', 9600.00, 'pending', '[{"item":"Enhanced Cleaning","qty":12,"price":800}]', 'Facilities', NULL, '2024-12-31', 'Annual cleaning contract renewal')
    `);
    console.log('Purchase Orders seeded');

    // Seed Payments (15+)
    await client.query(`INSERT INTO payments (payment_number, invoice_id, vendor_name, amount, method, status, payment_date, reference, notes) VALUES
      ('PAY-2024-001', 3, 'Global Logistics Inc', 8900.00, 'bank_transfer', 'completed', '2024-03-28', 'BT-REF-001', 'Freight charges March'),
      ('PAY-2024-002', 8, 'FastShip Couriers', 2340.00, 'bank_transfer', 'completed', '2024-03-19', 'BT-REF-002', 'Express deliveries'),
      ('PAY-2024-003', 13, 'ProTraining Institute', 9500.00, 'check', 'completed', '2024-03-24', 'CHK-5542', 'Training program payment'),
      ('PAY-2024-004', 2, 'TechFlow Solutions', 45000.00, 'wire', 'processing', '2024-04-18', 'WIRE-TF-001', 'Software licenses'),
      ('PAY-2024-005', 5, 'Green Energy Co', 3200.00, 'ach', 'completed', '2024-04-08', 'ACH-GE-001', 'Electricity March'),
      ('PAY-2024-006', 9, 'Legal Associates LLP', 35000.00, 'wire', 'scheduled', '2024-05-10', 'WIRE-LA-001', 'Legal retainer Q2'),
      ('PAY-2024-007', 14, 'CleanSpace Janitorial', 2800.00, 'ach', 'completed', '2024-04-03', 'ACH-CS-001', 'Cleaning March'),
      ('PAY-2024-008', 1, 'Acme Corporation', 15750.00, 'bank_transfer', 'pending', NULL, NULL, 'Awaiting approval'),
      ('PAY-2024-009', 4, 'CloudHost Services', 12500.00, 'wire', 'scheduled', '2024-04-22', 'WIRE-CH-001', 'Cloud Q1'),
      ('PAY-2024-010', 11, 'Pinnacle Consulting', 52000.00, 'wire', 'processing', '2024-05-18', 'WIRE-PC-001', 'Strategy consulting'),
      ('PAY-2024-011', 6, 'DataSecure Inc', 28000.00, 'bank_transfer', 'scheduled', '2024-04-28', 'BT-REF-011', 'Security audit'),
      ('PAY-2024-012', 16, 'InsureSafe Corp', 24000.00, 'ach', 'pending', NULL, NULL, 'Insurance renewal'),
      ('PAY-2024-013', 12, 'AutoFleet Services', 6800.00, 'check', 'completed', '2024-04-12', 'CHK-5589', 'Fleet maintenance'),
      ('PAY-2024-014', 10, 'Premier Office Supplies', 4560.00, 'ach', 'processing', '2024-04-28', 'ACH-PO-001', 'Furniture order'),
      ('PAY-2024-015', 15, 'FreshFood Catering', 3750.00, 'bank_transfer', 'pending', NULL, NULL, 'Catering events')
    `);
    console.log('Payments seeded');

    // Seed Approval Workflows (15+)
    await client.query(`INSERT INTO approval_workflows (name, document_type, document_id, document_ref, amount, status, current_approver, approvers, priority) VALUES
      ('Invoice Approval - Acme', 'invoice', 1, 'INV-2024-001', 15750.00, 'pending', 'John Smith', '["John Smith","Jane Doe"]', 'normal'),
      ('Invoice Approval - CloudHost', 'invoice', 4, 'INV-2024-004', 12500.00, 'pending', 'Mike Johnson', '["Mike Johnson","CFO"]', 'high'),
      ('PO Approval - TechFlow', 'purchase_order', 2, 'PO-2024-002', 32000.00, 'pending', 'CTO', '["CTO","CFO"]', 'high'),
      ('Invoice Approval - DataSecure', 'invoice', 6, 'INV-2024-006', 28000.00, 'in_review', 'CISO', '["CISO","CFO","CEO"]', 'urgent'),
      ('PO Approval - Training', 'purchase_order', 10, 'PO-2024-010', 16800.00, 'pending', 'HR Director', '["HR Director","CFO"]', 'normal'),
      ('Invoice Approval - Marketing', 'invoice', 7, 'INV-2024-007', 18500.00, 'rejected', 'CMO', '["CMO","CFO"]', 'normal'),
      ('PO Approval - Cleaning', 'purchase_order', 15, 'PO-2024-015', 9600.00, 'pending', 'Facilities Mgr', '["Facilities Mgr","COO"]', 'low'),
      ('Payment Approval - TechFlow', 'payment', 4, 'PAY-2024-004', 45000.00, 'approved', 'CFO', '["CFO"]', 'high'),
      ('Invoice Approval - Fleet', 'invoice', 12, 'INV-2024-012', 6800.00, 'approved', 'Operations Dir', '["Operations Dir"]', 'normal'),
      ('PO Approval - Consulting', 'purchase_order', 12, 'PO-2024-012', 60000.00, 'in_review', 'CEO', '["CEO","Board"]', 'urgent'),
      ('Payment Approval - Legal', 'payment', 6, 'PAY-2024-006', 35000.00, 'pending', 'CFO', '["CFO","CEO"]', 'high'),
      ('Invoice Approval - Catering', 'invoice', 15, 'INV-2024-015', 3750.00, 'approved', 'Office Mgr', '["Office Mgr"]', 'low'),
      ('PO Approval - Solar', 'purchase_order', 8, 'PO-2024-008', 15000.00, 'approved', 'CFO', '["CFO","CEO"]', 'normal'),
      ('Payment Approval - Insurance', 'payment', 12, 'PAY-2024-012', 24000.00, 'pending', 'CFO', '["CFO"]', 'normal'),
      ('Invoice Approval - Supplies', 'invoice', 10, 'INV-2024-010', 4560.00, 'pending', 'Office Mgr', '["Office Mgr","Finance Dir"]', 'low')
    `);
    console.log('Approval Workflows seeded');

    // Seed Expense Categories (15+)
    await client.query(`INSERT INTO expense_categories (name, code, parent_category, budget_limit, current_spend, description, gl_account, is_active) VALUES
      ('Office Supplies', 'EXP-001', 'Operations', 50000.00, 20310.00, 'General office supplies and equipment', '6100', true),
      ('Software & Licenses', 'EXP-002', 'Technology', 200000.00, 77000.00, 'Software subscriptions and licenses', '6200', true),
      ('Cloud Infrastructure', 'EXP-003', 'Technology', 150000.00, 30500.00, 'Cloud hosting and compute services', '6201', true),
      ('Professional Services', 'EXP-004', 'Operations', 300000.00, 87000.00, 'Consulting, legal, and advisory', '6300', true),
      ('Marketing & Advertising', 'EXP-005', 'Sales & Marketing', 120000.00, 18500.00, 'Marketing campaigns and advertising', '6400', true),
      ('Travel & Entertainment', 'EXP-006', 'Operations', 80000.00, 12400.00, 'Business travel and entertainment', '6500', true),
      ('Utilities', 'EXP-007', 'Facilities', 60000.00, 3200.00, 'Electric, water, gas, internet', '6600', true),
      ('Shipping & Logistics', 'EXP-008', 'Operations', 40000.00, 11240.00, 'Freight, courier, and delivery', '6700', true),
      ('Insurance', 'EXP-009', 'Administration', 100000.00, 24000.00, 'Business insurance premiums', '6800', true),
      ('Training & Development', 'EXP-010', 'Human Resources', 75000.00, 9500.00, 'Employee training and certifications', '6900', true),
      ('Facilities & Maintenance', 'EXP-011', 'Facilities', 45000.00, 2800.00, 'Cleaning, repairs, and maintenance', '7000', true),
      ('Fleet & Vehicles', 'EXP-012', 'Operations', 60000.00, 6800.00, 'Vehicle lease, fuel, and maintenance', '7100', true),
      ('Food & Catering', 'EXP-013', 'Human Resources', 30000.00, 3750.00, 'Office meals and event catering', '7200', true),
      ('Security', 'EXP-014', 'Technology', 100000.00, 28000.00, 'Cybersecurity and physical security', '7300', true),
      ('Telecommunications', 'EXP-015', 'Technology', 25000.00, 8900.00, 'Phone, internet, and communication', '7400', true),
      ('Research & Development', 'EXP-016', 'Technology', 250000.00, 45000.00, 'R&D materials and services', '7500', true)
    `);
    console.log('Expense Categories seeded');

    // Seed Budgets (15+)
    await client.query(`INSERT INTO budgets (name, department, category, fiscal_year, fiscal_quarter, allocated_amount, spent_amount, remaining_amount, status, notes) VALUES
      ('IT Infrastructure Q1', 'Technology', 'Infrastructure', 2024, 'Q1', 150000.00, 42500.00, 107500.00, 'active', 'Cloud and on-prem infrastructure'),
      ('Marketing Q1', 'Marketing', 'Marketing', 2024, 'Q1', 80000.00, 18500.00, 61500.00, 'active', 'Q1 campaigns and branding'),
      ('Operations Q1', 'Operations', 'General', 2024, 'Q1', 120000.00, 45200.00, 74800.00, 'active', 'Day-to-day operations'),
      ('HR & People Q1', 'Human Resources', 'People', 2024, 'Q1', 95000.00, 13250.00, 81750.00, 'active', 'Training, catering, events'),
      ('Legal & Compliance Q1', 'Legal', 'Professional', 2024, 'Q1', 60000.00, 35000.00, 25000.00, 'warning', 'Legal retainers and compliance'),
      ('Security Annual', 'Technology', 'Security', 2024, 'Annual', 200000.00, 28000.00, 172000.00, 'active', 'Cybersecurity program'),
      ('Facilities Q1', 'Facilities', 'Operations', 2024, 'Q1', 50000.00, 6000.00, 44000.00, 'active', 'Cleaning, maintenance, utilities'),
      ('Fleet Management Q1', 'Operations', 'Fleet', 2024, 'Q1', 45000.00, 6800.00, 38200.00, 'active', 'Vehicle operations'),
      ('Software Licenses Annual', 'Technology', 'Software', 2024, 'Annual', 250000.00, 77000.00, 173000.00, 'active', 'All software subscriptions'),
      ('Executive Travel Q1', 'Executive', 'Travel', 2024, 'Q1', 40000.00, 8200.00, 31800.00, 'active', 'Executive team travel'),
      ('R&D Innovation', 'Technology', 'R&D', 2024, 'Annual', 500000.00, 45000.00, 455000.00, 'active', 'Innovation and research'),
      ('Insurance Annual', 'Finance', 'Insurance', 2024, 'Annual', 100000.00, 24000.00, 76000.00, 'active', 'All insurance policies'),
      ('Office Supplies Q1', 'Operations', 'Supplies', 2024, 'Q1', 25000.00, 20310.00, 4690.00, 'warning', 'Running low on budget'),
      ('Consulting Q2', 'Operations', 'Professional', 2024, 'Q2', 100000.00, 52000.00, 48000.00, 'active', 'Strategy and advisory'),
      ('Telecom Q1', 'Technology', 'Communications', 2024, 'Q1', 15000.00, 8900.00, 6100.00, 'active', 'Phone and internet services')
    `);
    console.log('Budgets seeded');

    // Seed Receipts (15+)
    await client.query(`INSERT INTO receipts (receipt_number, vendor_name, amount, category, receipt_date, employee, description, status) VALUES
      ('REC-001', 'Starbucks', 45.80, 'Food & Beverage', '2024-03-15', 'John Smith', 'Team coffee meeting', 'approved'),
      ('REC-002', 'Delta Airlines', 580.00, 'Travel', '2024-03-10', 'Jane Doe', 'Flight to NYC - client meeting', 'approved'),
      ('REC-003', 'Hilton Hotels', 320.00, 'Travel', '2024-03-11', 'Jane Doe', 'Hotel NYC 1 night', 'approved'),
      ('REC-004', 'Uber', 42.50, 'Transportation', '2024-03-12', 'Jane Doe', 'Airport transfer NYC', 'pending'),
      ('REC-005', 'Amazon Business', 289.99, 'Office Supplies', '2024-03-14', 'Mike Johnson', 'Webcam and headset', 'approved'),
      ('REC-006', 'Office Depot', 156.40, 'Office Supplies', '2024-03-18', 'Sarah Wilson', 'Printer paper and supplies', 'approved'),
      ('REC-007', 'Chipotle', 128.50, 'Food & Beverage', '2024-03-20', 'John Smith', 'Team lunch meeting', 'pending'),
      ('REC-008', 'WeWork', 850.00, 'Facilities', '2024-03-01', 'Operations', 'Meeting room rental', 'approved'),
      ('REC-009', 'FedEx', 67.30, 'Shipping', '2024-03-22', 'Mike Johnson', 'Overnight document delivery', 'approved'),
      ('REC-010', 'Best Buy', 1299.99, 'Technology', '2024-03-08', 'Dev Team', 'External monitor', 'approved'),
      ('REC-011', 'Southwest Airlines', 420.00, 'Travel', '2024-03-25', 'Sarah Wilson', 'Flight to Denver - conference', 'pending'),
      ('REC-012', 'Whole Foods', 210.00, 'Food & Beverage', '2024-03-28', 'HR Team', 'Office snacks monthly', 'approved'),
      ('REC-013', 'Parking Garage', 35.00, 'Transportation', '2024-03-15', 'John Smith', 'Client meeting parking', 'approved'),
      ('REC-014', 'Apple Store', 2499.00, 'Technology', '2024-03-05', 'CTO', 'MacBook Pro for new hire', 'approved'),
      ('REC-015', 'Costco Business', 445.60, 'Office Supplies', '2024-03-19', 'Office Manager', 'Kitchen and break room supplies', 'pending'),
      ('REC-016', 'Lyft', 28.75, 'Transportation', '2024-03-21', 'Jane Doe', 'Client dinner transport', 'approved')
    `);
    console.log('Receipts seeded');

    // Seed Tax Records (15+)
    await client.query(`INSERT INTO tax_records (tax_type, vendor_name, tax_id, amount, tax_amount, tax_rate, period, status, jurisdiction, notes) VALUES
      ('Sales Tax', 'Acme Corporation', 'TAX-001-ACME', 15750.00, 1417.50, 9.00, 'March 2024', 'filed', 'New York', 'Office supplies sales tax'),
      ('Sales Tax', 'Premier Office Supplies', 'TAX-004-PREM', 4560.00, 376.20, 8.25, 'March 2024', 'filed', 'Texas', 'Furniture sales tax'),
      ('W-9 Withholding', 'Pinnacle Consulting', 'TAX-014-PINN', 52000.00, 15600.00, 30.00, 'Q1 2024', 'pending', 'Federal', 'Consulting withholding'),
      ('VAT', 'TechFlow Solutions', 'TAX-002-TECH', 45000.00, 9000.00, 20.00, 'March 2024', 'filed', 'EU', 'Software license VAT'),
      ('Sales Tax', 'AutoFleet Services', 'TAX-013-AUTO', 6800.00, 476.00, 7.00, 'March 2024', 'filed', 'Michigan', 'Fleet maintenance tax'),
      ('1099 Filing', 'Legal Associates LLP', 'TAX-010-LEGA', 35000.00, 0.00, 0.00, '2024', 'draft', 'Federal', 'Legal services 1099'),
      ('1099 Filing', 'Marketing Pro Agency', 'TAX-008-MARK', 18500.00, 0.00, 0.00, '2024', 'draft', 'Federal', 'Marketing 1099'),
      ('Sales Tax', 'FreshFood Catering', 'TAX-015-FRES', 3750.00, 309.38, 8.25, 'March 2024', 'filed', 'Texas', 'Catering sales tax'),
      ('Property Tax', 'N/A', 'PROP-2024', 450000.00, 9900.00, 2.20, 'Q1 2024', 'paid', 'State', 'Office building property tax'),
      ('Payroll Tax', 'N/A', 'PAYROLL-2024-03', 850000.00, 127500.00, 15.00, 'March 2024', 'filed', 'Federal', 'Monthly payroll tax'),
      ('Use Tax', 'CloudHost Services', 'TAX-005-CLOU', 12500.00, 1062.50, 8.50, 'Q1 2024', 'pending', 'Washington', 'Cloud services use tax'),
      ('Sales Tax', 'DataSecure Inc', 'TAX-007-DATA', 28000.00, 1750.00, 6.25, 'April 2024', 'pending', 'Massachusetts', 'Security services tax'),
      ('Excise Tax', 'Green Energy Co', 'TAX-006-GREE', 3200.00, 96.00, 3.00, 'March 2024', 'filed', 'Texas', 'Energy excise tax'),
      ('W-9 Withholding', 'ProTraining Institute', 'TAX-012-PROT', 9500.00, 2850.00, 30.00, 'Q1 2024', 'filed', 'Federal', 'Training withholding'),
      ('Sales Tax', 'InsureSafe Corp', 'TAX-016-INSU', 24000.00, 0.00, 0.00, 'Annual 2024', 'exempt', 'Federal', 'Insurance is tax exempt')
    `);
    console.log('Tax Records seeded');

    // Seed Reports (15+)
    await client.query(`INSERT INTO reports (name, report_type, date_range, generated_by, summary, status) VALUES
      ('AP Aging Report March 2024', 'aging', 'March 2024', 'System', 'Total outstanding: $156,850. Current: $62,310. 30-day: $54,540. 60-day: $40,000.', 'generated'),
      ('Vendor Spend Analysis Q1', 'vendor_spend', 'Q1 2024', 'Jane Doe', 'Top 5 vendors account for 72% of total spend. TechFlow highest at $45K.', 'generated'),
      ('Cash Flow Forecast April', 'cash_flow', 'April 2024', 'CFO', 'Expected outflows: $245K. Expected inflows: $680K. Net positive: $435K.', 'generated'),
      ('Budget vs Actual Q1', 'budget_variance', 'Q1 2024', 'Finance Team', 'Overall 78% budget utilization. Office Supplies at 81% - needs monitoring.', 'generated'),
      ('Duplicate Invoice Report', 'audit', 'March 2024', 'System', '3 potential duplicates detected. 2 confirmed and resolved. 1 under review.', 'generated'),
      ('Payment Processing Summary', 'payment', 'March 2024', 'AP Team', '42 payments processed. 38 successful, 2 pending, 2 failed. Total: $312K.', 'generated'),
      ('Tax Compliance Report Q1', 'tax', 'Q1 2024', 'Tax Dept', 'All sales tax filings current. 2 pending 1099 filings for year-end.', 'generated'),
      ('Expense Category Breakdown', 'expense', 'Q1 2024', 'Controller', 'Technology: 42%, Operations: 28%, Professional Services: 18%, Other: 12%.', 'generated'),
      ('Approval Cycle Time Report', 'efficiency', 'March 2024', 'System', 'Average approval time: 2.3 days. Longest: 8 days (Legal). Fastest: 0.5 days.', 'generated'),
      ('Vendor Performance Scorecard', 'vendor_perf', 'Q1 2024', 'Procurement', '14 of 16 vendors meet SLA. 2 vendors flagged for late delivery.', 'generated'),
      ('Monthly Reconciliation Report', 'reconciliation', 'March 2024', 'Accounting', 'Bank balance matched. 3 outstanding items totaling $4,230.', 'generated'),
      ('PO Compliance Report', 'compliance', 'Q1 2024', 'Internal Audit', '92% of purchases had proper PO. 8% maverick spend identified.', 'generated'),
      ('Currency Exposure Report', 'currency', 'Q1 2024', 'Treasury', 'EUR exposure: $45K. GBP exposure: $12K. Hedging recommended for EUR.', 'generated'),
      ('Year-End Projection', 'forecast', '2024', 'CFO', 'Projected AP: $3.2M. Projected savings from automation: $480K (15%).', 'generated'),
      ('Audit Trail Summary', 'audit', 'March 2024', 'Compliance', '1,247 actions logged. 42 modifications. All changes properly documented.', 'generated')
    `);
    console.log('Reports seeded');

    // Seed Bank Reconciliations (15+)
    await client.query(`INSERT INTO bank_reconciliations (account_name, account_number, statement_date, statement_balance, book_balance, difference, matched_transactions, unmatched_transactions, status, notes) VALUES
      ('Operating Account', 'XXXX-4521', '2024-03-31', 485230.50, 489460.50, -4230.00, 142, 3, 'in_progress', 'Three outstanding checks'),
      ('Payroll Account', 'XXXX-7834', '2024-03-31', 125000.00, 125000.00, 0.00, 89, 0, 'reconciled', 'Fully matched'),
      ('Tax Escrow Account', 'XXXX-2156', '2024-03-31', 52400.00, 52400.00, 0.00, 12, 0, 'reconciled', 'Tax reserves matched'),
      ('Petty Cash Fund', 'XXXX-9012', '2024-03-31', 1850.00, 2100.00, -250.00, 28, 2, 'in_progress', 'Missing receipt for $250'),
      ('Investment Account', 'XXXX-3367', '2024-03-31', 750000.00, 750000.00, 0.00, 5, 0, 'reconciled', 'Quarterly interest posted'),
      ('AP Clearing Account', 'XXXX-5543', '2024-03-31', 0.00, 1200.00, -1200.00, 156, 1, 'in_progress', 'Pending wire transfer'),
      ('Operating Account', 'XXXX-4521', '2024-02-29', 510450.00, 510450.00, 0.00, 138, 0, 'reconciled', 'February fully reconciled'),
      ('Credit Card - Corp', 'XXXX-8877', '2024-03-31', 18450.00, 18450.00, 0.00, 67, 0, 'reconciled', 'All receipts matched'),
      ('Savings Account', 'XXXX-1199', '2024-03-31', 200000.00, 200000.00, 0.00, 2, 0, 'reconciled', 'Interest deposit matched'),
      ('Vendor Payments Account', 'XXXX-6632', '2024-03-31', 45230.00, 47800.00, -2570.00, 45, 2, 'in_progress', 'Two payments in transit'),
      ('Payroll Account', 'XXXX-7834', '2024-02-29', 118000.00, 118000.00, 0.00, 85, 0, 'reconciled', 'February payroll matched'),
      ('Operating Account', 'XXXX-4521', '2024-01-31', 498200.00, 498200.00, 0.00, 135, 0, 'reconciled', 'January fully reconciled'),
      ('Foreign Currency EUR', 'XXXX-4401', '2024-03-31', 38500.00, 39200.00, -700.00, 8, 1, 'in_progress', 'FX rate difference'),
      ('Reserve Fund', 'XXXX-2288', '2024-03-31', 500000.00, 500000.00, 0.00, 1, 0, 'reconciled', 'No activity this month'),
      ('Credit Card - Travel', 'XXXX-9944', '2024-03-31', 4580.00, 4580.00, 0.00, 23, 0, 'reconciled', 'All travel expenses matched')
    `);
    console.log('Bank Reconciliations seeded');

    // Seed Credit Notes (15+)
    await client.query(`INSERT INTO credit_notes (credit_note_number, invoice_id, vendor_name, amount, reason, status, issue_date, applied_date, notes) VALUES
      ('CN-2024-001', 1, 'Acme Corporation', 750.00, 'Damaged items returned', 'applied', '2024-03-20', '2024-03-22', '5 boxes damaged in transit'),
      ('CN-2024-002', 3, 'Global Logistics Inc', 420.00, 'Overcharge correction', 'applied', '2024-03-15', '2024-03-18', 'Duplicate freight charge'),
      ('CN-2024-003', 7, 'Marketing Pro Agency', 2500.00, 'Service not delivered', 'pending', '2024-03-25', NULL, 'PPC campaign delayed'),
      ('CN-2024-004', 8, 'FastShip Couriers', 85.00, 'Late delivery penalty', 'applied', '2024-03-10', '2024-03-12', 'SLA breach - same day'),
      ('CN-2024-005', 2, 'TechFlow Solutions', 4000.00, 'License downgrade', 'pending', '2024-04-01', NULL, '5 licenses no longer needed'),
      ('CN-2024-006', 5, 'Green Energy Co', 180.00, 'Meter reading error', 'applied', '2024-03-18', '2024-03-20', 'Corrected kWh reading'),
      ('CN-2024-007', 10, 'Premier Office Supplies', 450.00, 'Wrong item shipped', 'pending', '2024-04-02', NULL, 'Returned 1 incorrect chair'),
      ('CN-2024-008', 13, 'ProTraining Institute', 1200.00, 'Cancelled sessions', 'applied', '2024-03-05', '2024-03-08', '1 leadership session cancelled'),
      ('CN-2024-009', 14, 'CleanSpace Janitorial', 200.00, 'Missed cleaning days', 'applied', '2024-03-12', '2024-03-15', '2 days missed due to holiday'),
      ('CN-2024-010', 15, 'FreshFood Catering', 375.00, 'Reduced headcount', 'pending', '2024-03-18', NULL, 'Event had fewer attendees'),
      ('CN-2024-011', 4, 'CloudHost Services', 800.00, 'Downtime credit', 'applied', '2024-03-28', '2024-03-30', '4hr outage SLA credit'),
      ('CN-2024-012', 6, 'DataSecure Inc', 1500.00, 'Scope reduction', 'pending', '2024-04-05', NULL, 'Reduced monitoring scope'),
      ('CN-2024-013', 9, 'Legal Associates LLP', 2000.00, 'Retainer adjustment', 'pending', '2024-04-10', NULL, 'Fewer hours used than planned'),
      ('CN-2024-014', 12, 'AutoFleet Services', 350.00, 'Warranty repair', 'applied', '2024-03-20', '2024-03-22', 'Repair covered under warranty'),
      ('CN-2024-015', 11, 'Pinnacle Consulting', 5000.00, 'Deliverable revision', 'pending', '2024-04-18', NULL, 'Analysis report requires redo')
    `);
    console.log('Credit Notes seeded');

    // Seed Currency Conversions (15+)
    await client.query(`INSERT INTO currency_conversions (from_currency, to_currency, exchange_rate, amount, converted_amount, source, conversion_date, invoice_ref) VALUES
      ('EUR', 'USD', 1.0850, 41474.65, 45000.00, 'ECB', '2024-03-20', 'INV-2024-002'),
      ('GBP', 'USD', 1.2650, 7114.62, 9000.00, 'BOE', '2024-03-15', 'INV-EU-001'),
      ('JPY', 'USD', 0.0067, 1492537.31, 10000.00, 'BOJ', '2024-03-18', 'INV-JP-001'),
      ('CAD', 'USD', 0.7400, 10810.81, 8000.00, 'BOC', '2024-03-22', 'INV-CA-001'),
      ('CHF', 'USD', 1.1200, 5357.14, 6000.00, 'SNB', '2024-03-25', 'INV-CH-001'),
      ('AUD', 'USD', 0.6530, 7656.97, 5000.00, 'RBA', '2024-03-10', 'INV-AU-001'),
      ('EUR', 'USD', 1.0820, 9241.22, 10000.00, 'ECB', '2024-03-28', 'INV-EU-002'),
      ('GBP', 'USD', 1.2680, 11041.01, 14000.00, 'BOE', '2024-03-30', 'INV-EU-003'),
      ('MXN', 'USD', 0.0588, 85034.01, 5000.00, 'Banxico', '2024-04-01', 'INV-MX-001'),
      ('INR', 'USD', 0.0120, 583333.33, 7000.00, 'RBI', '2024-04-02', 'INV-IN-001'),
      ('EUR', 'USD', 1.0870, 27598.90, 30000.00, 'ECB', '2024-04-05', 'INV-EU-004'),
      ('SGD', 'USD', 0.7420, 6738.54, 5000.00, 'MAS', '2024-04-08', 'INV-SG-001'),
      ('BRL', 'USD', 0.2000, 15000.00, 3000.00, 'BCB', '2024-04-10', 'INV-BR-001'),
      ('SEK', 'USD', 0.0960, 41666.67, 4000.00, 'Riksbank', '2024-04-12', 'INV-SE-001'),
      ('NZD', 'USD', 0.6100, 3278.69, 2000.00, 'RBNZ', '2024-04-15', 'INV-NZ-001')
    `);
    console.log('Currency Conversions seeded');

    // Seed Duplicate Detections (15+)
    await client.query(`INSERT INTO duplicate_detections (invoice_id_1, invoice_id_2, invoice_ref_1, invoice_ref_2, vendor_name, amount, similarity_score, detection_method, status, resolution) VALUES
      (1, NULL, 'INV-2024-001', 'INV-2024-001-DUP', 'Acme Corporation', 15750.00, 98.50, 'exact_match', 'resolved', 'Duplicate removed - same invoice submitted twice'),
      (3, NULL, 'INV-2024-003', 'INV-2024-003-A', 'Global Logistics Inc', 8900.00, 95.20, 'fuzzy_match', 'resolved', 'Confirmed duplicate - vendor resubmission'),
      (NULL, NULL, 'INV-EXT-101', 'INV-EXT-102', 'TechFlow Solutions', 44800.00, 89.30, 'amount_vendor', 'flagged', 'Under review - similar amounts from same vendor'),
      (NULL, NULL, 'INV-EXT-201', 'INV-EXT-202', 'Marketing Pro Agency', 18500.00, 100.00, 'exact_match', 'flagged', 'Exact duplicate detected - awaiting vendor response'),
      (NULL, NULL, 'INV-EXT-301', 'INV-EXT-302', 'Premier Office Supplies', 4560.00, 92.10, 'fuzzy_match', 'resolved', 'Different line items - not a duplicate'),
      (NULL, NULL, 'INV-EXT-401', 'INV-EXT-402', 'CloudHost Services', 12500.00, 97.80, 'exact_match', 'flagged', 'Same amount and date - investigating'),
      (NULL, NULL, 'INV-EXT-501', 'INV-EXT-502', 'FastShip Couriers', 2340.00, 88.50, 'amount_vendor', 'resolved', 'Separate valid invoices for different periods'),
      (NULL, NULL, 'INV-EXT-601', 'INV-EXT-602', 'Green Energy Co', 3200.00, 100.00, 'exact_match', 'resolved', 'Duplicate removed from system'),
      (NULL, NULL, 'INV-EXT-701', 'INV-EXT-702', 'DataSecure Inc', 28000.00, 94.60, 'fuzzy_match', 'flagged', 'Similar invoices one week apart'),
      (NULL, NULL, 'INV-EXT-801', 'INV-EXT-802', 'Legal Associates LLP', 35000.00, 91.20, 'amount_vendor', 'flagged', 'Quarterly retainer - may be valid'),
      (NULL, NULL, 'INV-EXT-901', 'INV-EXT-902', 'Pinnacle Consulting', 52000.00, 96.30, 'fuzzy_match', 'flagged', 'Very similar - different PO numbers'),
      (NULL, NULL, 'INV-EXT-1001', 'INV-EXT-1002', 'AutoFleet Services', 6800.00, 87.90, 'amount_vendor', 'resolved', 'Different vehicles serviced'),
      (NULL, NULL, 'INV-EXT-1101', 'INV-EXT-1102', 'ProTraining Institute', 9500.00, 99.10, 'exact_match', 'flagged', 'Near exact duplicate - same class different dates'),
      (NULL, NULL, 'INV-EXT-1201', 'INV-EXT-1202', 'CleanSpace Janitorial', 2800.00, 100.00, 'exact_match', 'resolved', 'Exact duplicate - vendor error'),
      (NULL, NULL, 'INV-EXT-1301', 'INV-EXT-1302', 'FreshFood Catering', 3750.00, 93.40, 'fuzzy_match', 'flagged', 'Similar event catering invoices')
    `);
    console.log('Duplicate Detections seeded');

    // Seed Audit Logs (15+)
    await client.query(`INSERT INTO audit_logs (action, entity_type, entity_id, user_name, details, ip_address) VALUES
      ('CREATE', 'invoice', 1, 'admin@company.com', 'Created invoice INV-2024-001 for Acme Corporation', '192.168.1.100'),
      ('UPDATE', 'invoice', 2, 'john@company.com', 'Updated status to approved for INV-2024-002', '192.168.1.101'),
      ('APPROVE', 'invoice', 3, 'jane@company.com', 'Approved payment for INV-2024-003', '192.168.1.102'),
      ('CREATE', 'vendor', 1, 'admin@company.com', 'Added new vendor Acme Corporation', '192.168.1.100'),
      ('UPDATE', 'vendor', 5, 'john@company.com', 'Updated payment terms for CloudHost Services', '192.168.1.101'),
      ('CREATE', 'purchase_order', 1, 'john@company.com', 'Created PO-2024-001 for Acme Corporation', '192.168.1.101'),
      ('APPROVE', 'purchase_order', 1, 'jane@company.com', 'Approved PO-2024-001', '192.168.1.102'),
      ('CREATE', 'payment', 1, 'admin@company.com', 'Initiated payment PAY-2024-001 for $8,900', '192.168.1.100'),
      ('PROCESS', 'payment', 1, 'system', 'Payment PAY-2024-001 processed via bank transfer', '10.0.0.1'),
      ('DETECT', 'duplicate', 1, 'system', 'Duplicate invoice detected: INV-2024-001-DUP', '10.0.0.1'),
      ('RESOLVE', 'duplicate', 1, 'admin@company.com', 'Resolved duplicate - removed INV-2024-001-DUP', '192.168.1.100'),
      ('GENERATE', 'report', 1, 'system', 'Generated AP Aging Report for March 2024', '10.0.0.1'),
      ('UPDATE', 'budget', 13, 'jane@company.com', 'Budget warning: Office Supplies at 81% utilization', '192.168.1.102'),
      ('LOGIN', 'user', 1, 'admin@company.com', 'User logged in successfully', '192.168.1.100'),
      ('EXPORT', 'report', 2, 'jane@company.com', 'Exported Vendor Spend Analysis Q1 to PDF', '192.168.1.102'),
      ('CREATE', 'credit_note', 1, 'john@company.com', 'Created credit note CN-2024-001 for $750', '192.168.1.101')
    `);
    console.log('Audit Logs seeded');

    console.log('\n✅ All data seeded successfully!');
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
