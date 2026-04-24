// ====== STATE ======
const API = '';  // same origin
let token = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');
let currentPage = 'dashboard';

// ====== API HELPER ======
async function api(path, options = {}) {
  const res = await fetch(`${API}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ====== TOAST ======
function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ====== MODAL ======
function openModal(title, bodyHtml, footerHtml = '') {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-footer').innerHTML = footerHtml;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// ====== AI PANEL ======
function openAiPanel() {
  document.getElementById('ai-panel').classList.remove('hidden');
  document.getElementById('ai-panel-body').innerHTML = '<div class="ai-loading">Analyzing with AI...</div>';
}

function closeAiPanel() {
  document.getElementById('ai-panel').classList.add('hidden');
}

document.getElementById('ai-panel-close').addEventListener('click', closeAiPanel);

function renderAiResponse(result) {
  const body = document.getElementById('ai-panel-body');
  if (!result.success) {
    body.innerHTML = `<div class="ai-error"><strong>Error:</strong> ${escapeHtml(result.error || 'Unknown error')}</div>`;
    return;
  }

  // Parse the AI content into sections
  const content = result.content;
  const sections = parseAiContent(content);

  let html = '<div class="ai-content">';

  if (sections.length > 0) {
    sections.forEach(section => {
      html += `<div class="ai-section">
        <div class="ai-section-title">${escapeHtml(section.title)}</div>
        <div class="ai-section-content">${formatAiText(section.content)}</div>
      </div>`;
    });
  } else {
    html += `<div class="ai-section">
      <div class="ai-section-content">${formatAiText(content)}</div>
    </div>`;
  }

  // Meta info
  html += `<div class="ai-meta">`;
  if (result.model) html += `<div class="ai-meta-item">Model: <strong>${escapeHtml(result.model)}</strong></div>`;
  if (result.usage) {
    html += `<div class="ai-meta-item">Tokens: ${result.usage.prompt_tokens || 0} in / ${result.usage.completion_tokens || 0} out</div>`;
  }
  html += `</div></div>`;

  body.innerHTML = html;
}

function parseAiContent(text) {
  const sections = [];
  // Split by numbered sections like "1." or "**1."
  const lines = text.split('\n');
  let currentSection = null;

  for (const line of lines) {
    const sectionMatch = line.match(/^\s*\*{0,2}\s*(\d+)\.\s*\*{0,2}\s*(.+?)[:：]?\s*\*{0,2}\s*$/);
    const headerMatch = line.match(/^#+\s+(.+)/);
    const boldSectionMatch = line.match(/^\s*\*\*(.+?)\*\*\s*$/);

    if (sectionMatch) {
      if (currentSection) sections.push(currentSection);
      currentSection = { title: sectionMatch[2].replace(/\*\*/g, '').trim(), content: '' };
    } else if (headerMatch && !currentSection) {
      if (currentSection) sections.push(currentSection);
      currentSection = { title: headerMatch[1].replace(/\*\*/g, '').trim(), content: '' };
    } else if (boldSectionMatch && (!currentSection || currentSection.content.trim() === '')) {
      if (currentSection && currentSection.content.trim()) sections.push(currentSection);
      currentSection = { title: boldSectionMatch[1].trim(), content: '' };
    } else if (currentSection) {
      currentSection.content += line + '\n';
    } else {
      // Content before any section
      if (!currentSection) currentSection = { title: 'Analysis', content: '' };
      currentSection.content += line + '\n';
    }
  }
  if (currentSection && currentSection.content.trim()) sections.push(currentSection);
  return sections;
}

function formatAiText(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^[\s]*[-•]\s+(.+)/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/<\/ul>\s*<ul>/g, '')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>')
    .trim();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ====== AUTH ======
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  try {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(currentUser));
    showApp();
    toast('Welcome back, ' + currentUser.name + '!');
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.getElementById('demo-login-btn').addEventListener('click', () => {
  document.getElementById('login-email').value = 'admin@company.com';
  document.getElementById('login-password').value = 'admin123';
});

document.getElementById('logout-btn').addEventListener('click', () => {
  token = null;
  currentUser = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  document.getElementById('login-page').classList.remove('hidden');
  document.getElementById('main-app').classList.add('hidden');
});

function showApp() {
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');
  document.getElementById('user-name').textContent = currentUser.name;
  document.getElementById('user-avatar').textContent = currentUser.name.charAt(0);
  navigateTo('dashboard');
}

// ====== NAVIGATION ======
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    navigateTo(item.dataset.page);
  });
});

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  renderPage(page);
}

// ====== PAGE RENDERER ======
async function renderPage(page) {
  const content = document.getElementById('page-content');
  if (page === 'dashboard') return renderDashboard(content);

  const config = pageConfigs[page];
  if (!config) { content.innerHTML = '<div class="empty-state"><p>Page not found</p></div>'; return; }

  content.innerHTML = `
    <div class="page-header">
      <h1>${config.title}</h1>
      <div class="page-header-actions">
        <button class="btn btn-primary" id="add-new-btn">+ New ${config.singular}</button>
      </div>
    </div>
    <div class="table-container">
      <table class="data-table">
        <thead><tr>${config.columns.map(c => `<th>${c.label}</th>`).join('')}<th>Actions</th></tr></thead>
        <tbody id="table-body"><tr><td colspan="${config.columns.length + 1}" style="text-align:center;padding:40px;">Loading...</td></tr></tbody>
      </table>
    </div>`;

  document.getElementById('add-new-btn').addEventListener('click', () => showCreateForm(config));

  try {
    const data = await api(`/${page}`);
    renderTable(data, config);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ====== PAGE CONFIGS ======
const pageConfigs = {
  invoices: {
    title: 'Invoices',
    singular: 'Invoice',
    endpoint: '/invoices',
    columns: [
      { key: 'invoice_number', label: 'Invoice #' },
      { key: 'vendor_name', label: 'Vendor' },
      { key: 'amount', label: 'Amount', format: 'money' },
      { key: 'status', label: 'Status', format: 'badge' },
      { key: 'due_date', label: 'Due Date', format: 'date' },
    ],
    fields: [
      { key: 'invoice_number', label: 'Invoice Number', type: 'text', required: true },
      { key: 'vendor_name', label: 'Vendor Name', type: 'text', required: true },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'currency', label: 'Currency', type: 'select', options: ['USD','EUR','GBP','CAD','AUD','JPY'] },
      { key: 'status', label: 'Status', type: 'select', options: ['pending','approved','paid','rejected'] },
      { key: 'due_date', label: 'Due Date', type: 'date' },
      { key: 'issue_date', label: 'Issue Date', type: 'date' },
      { key: 'description', label: 'Description', type: 'textarea' },
    ],
    detailFields: ['invoice_number','vendor_name','amount','currency','status','due_date','issue_date','description','line_items','ai_extracted_data','ai_confidence_score'],
  },
  vendors: {
    title: 'Vendors',
    singular: 'Vendor',
    endpoint: '/vendors',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'category', label: 'Category' },
      { key: 'rating', label: 'Rating' },
      { key: 'total_spent', label: 'Total Spent', format: 'money' },
      { key: 'status', label: 'Status', format: 'badge' },
    ],
    fields: [
      { key: 'name', label: 'Vendor Name', type: 'text', required: true },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone', type: 'text' },
      { key: 'address', label: 'Address', type: 'textarea' },
      { key: 'tax_id', label: 'Tax ID', type: 'text' },
      { key: 'payment_terms', label: 'Payment Terms (days)', type: 'number' },
      { key: 'category', label: 'Category', type: 'select', options: ['Supplies','Technology','Logistics','Office Supplies','Cloud Services','Utilities','Security','Marketing','Shipping','Legal','Facilities','Training','Fleet','Consulting','Catering','Insurance'] },
      { key: 'status', label: 'Status', type: 'select', options: ['active','inactive','suspended'] },
    ],
    detailFields: ['name','email','phone','address','tax_id','payment_terms','category','rating','total_invoices','total_spent','status'],
  },
  'purchase-orders': {
    title: 'Purchase Orders',
    singular: 'Purchase Order',
    endpoint: '/purchase-orders',
    columns: [
      { key: 'po_number', label: 'PO #' },
      { key: 'vendor_name', label: 'Vendor' },
      { key: 'amount', label: 'Amount', format: 'money' },
      { key: 'status', label: 'Status', format: 'badge' },
      { key: 'delivery_date', label: 'Delivery Date', format: 'date' },
    ],
    fields: [
      { key: 'po_number', label: 'PO Number', type: 'text', required: true },
      { key: 'vendor_name', label: 'Vendor Name', type: 'text', required: true },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'status', label: 'Status', type: 'select', options: ['draft','pending','approved','sent','received','cancelled'] },
      { key: 'requested_by', label: 'Requested By', type: 'text' },
      { key: 'approved_by', label: 'Approved By', type: 'text' },
      { key: 'delivery_date', label: 'Delivery Date', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    detailFields: ['po_number','vendor_name','amount','status','items','requested_by','approved_by','delivery_date','notes'],
  },
  payments: {
    title: 'Payments',
    singular: 'Payment',
    endpoint: '/payments',
    columns: [
      { key: 'payment_number', label: 'Payment #' },
      { key: 'vendor_name', label: 'Vendor' },
      { key: 'amount', label: 'Amount', format: 'money' },
      { key: 'method', label: 'Method' },
      { key: 'status', label: 'Status', format: 'badge' },
    ],
    fields: [
      { key: 'payment_number', label: 'Payment Number', type: 'text', required: true },
      { key: 'vendor_name', label: 'Vendor Name', type: 'text', required: true },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'method', label: 'Method', type: 'select', options: ['bank_transfer','wire','ach','check','credit_card'] },
      { key: 'status', label: 'Status', type: 'select', options: ['pending','processing','scheduled','completed','failed'] },
      { key: 'payment_date', label: 'Payment Date', type: 'date' },
      { key: 'reference', label: 'Reference', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    detailFields: ['payment_number','vendor_name','amount','method','status','payment_date','reference','notes'],
  },
  approvals: {
    title: 'Approval Workflows',
    singular: 'Approval',
    endpoint: '/approvals',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'document_type', label: 'Type' },
      { key: 'amount', label: 'Amount', format: 'money' },
      { key: 'status', label: 'Status', format: 'badge' },
      { key: 'priority', label: 'Priority', format: 'badge' },
    ],
    fields: [
      { key: 'name', label: 'Workflow Name', type: 'text', required: true },
      { key: 'document_type', label: 'Document Type', type: 'select', options: ['invoice','purchase_order','payment','expense'] },
      { key: 'document_ref', label: 'Document Ref', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', options: ['pending','in_review','approved','rejected'] },
      { key: 'current_approver', label: 'Current Approver', type: 'text' },
      { key: 'priority', label: 'Priority', type: 'select', options: ['low','normal','high','urgent'] },
    ],
    detailFields: ['name','document_type','document_id','document_ref','amount','status','current_approver','approvers','approval_history','priority'],
  },
  'expense-categories': {
    title: 'Expense Categories',
    singular: 'Category',
    endpoint: '/expense-categories',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'code', label: 'Code' },
      { key: 'parent_category', label: 'Parent' },
      { key: 'budget_limit', label: 'Budget Limit', format: 'money' },
      { key: 'current_spend', label: 'Current Spend', format: 'money' },
    ],
    fields: [
      { key: 'name', label: 'Category Name', type: 'text', required: true },
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'parent_category', label: 'Parent Category', type: 'text' },
      { key: 'budget_limit', label: 'Budget Limit', type: 'number' },
      { key: 'current_spend', label: 'Current Spend', type: 'number' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'gl_account', label: 'GL Account', type: 'text' },
      { key: 'is_active', label: 'Active', type: 'select', options: ['true','false'] },
    ],
    detailFields: ['name','code','parent_category','budget_limit','current_spend','description','gl_account','is_active'],
  },
  budgets: {
    title: 'Budgets',
    singular: 'Budget',
    endpoint: '/budgets',
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'department', label: 'Department' },
      { key: 'allocated_amount', label: 'Allocated', format: 'money' },
      { key: 'spent_amount', label: 'Spent', format: 'money' },
      { key: 'status', label: 'Status', format: 'badge' },
    ],
    fields: [
      { key: 'name', label: 'Budget Name', type: 'text', required: true },
      { key: 'department', label: 'Department', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'fiscal_year', label: 'Fiscal Year', type: 'number' },
      { key: 'fiscal_quarter', label: 'Quarter', type: 'select', options: ['Q1','Q2','Q3','Q4','Annual'] },
      { key: 'allocated_amount', label: 'Allocated Amount', type: 'number', required: true },
      { key: 'spent_amount', label: 'Spent Amount', type: 'number' },
      { key: 'remaining_amount', label: 'Remaining Amount', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', options: ['active','warning','exceeded','closed'] },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    detailFields: ['name','department','category','fiscal_year','fiscal_quarter','allocated_amount','spent_amount','remaining_amount','status','notes'],
  },
  receipts: {
    title: 'Receipts',
    singular: 'Receipt',
    endpoint: '/receipts',
    columns: [
      { key: 'receipt_number', label: 'Receipt #' },
      { key: 'vendor_name', label: 'Vendor' },
      { key: 'amount', label: 'Amount', format: 'money' },
      { key: 'category', label: 'Category' },
      { key: 'status', label: 'Status', format: 'badge' },
    ],
    fields: [
      { key: 'receipt_number', label: 'Receipt Number', type: 'text' },
      { key: 'vendor_name', label: 'Vendor', type: 'text', required: true },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'category', label: 'Category', type: 'select', options: ['Food & Beverage','Travel','Transportation','Office Supplies','Technology','Facilities','Shipping'] },
      { key: 'receipt_date', label: 'Receipt Date', type: 'date' },
      { key: 'employee', label: 'Employee', type: 'text' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'status', label: 'Status', type: 'select', options: ['pending','approved','rejected'] },
    ],
    detailFields: ['receipt_number','vendor_name','amount','category','receipt_date','employee','description','ai_extracted_data','status'],
  },
  'tax-records': {
    title: 'Tax Records',
    singular: 'Tax Record',
    endpoint: '/tax-records',
    columns: [
      { key: 'tax_type', label: 'Tax Type' },
      { key: 'vendor_name', label: 'Vendor' },
      { key: 'amount', label: 'Amount', format: 'money' },
      { key: 'tax_amount', label: 'Tax Amount', format: 'money' },
      { key: 'status', label: 'Status', format: 'badge' },
    ],
    fields: [
      { key: 'tax_type', label: 'Tax Type', type: 'select', options: ['Sales Tax','VAT','W-9 Withholding','1099 Filing','Property Tax','Payroll Tax','Use Tax','Excise Tax'], required: true },
      { key: 'vendor_name', label: 'Vendor Name', type: 'text' },
      { key: 'tax_id', label: 'Tax ID', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'tax_amount', label: 'Tax Amount', type: 'number' },
      { key: 'tax_rate', label: 'Tax Rate (%)', type: 'number' },
      { key: 'period', label: 'Period', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: ['pending','filed','paid','draft','exempt'] },
      { key: 'jurisdiction', label: 'Jurisdiction', type: 'text' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    detailFields: ['tax_type','vendor_name','tax_id','amount','tax_amount','tax_rate','period','status','jurisdiction','notes'],
  },
  reports: {
    title: 'Reports & Analytics',
    singular: 'Report',
    endpoint: '/reports',
    columns: [
      { key: 'name', label: 'Report Name' },
      { key: 'report_type', label: 'Type' },
      { key: 'date_range', label: 'Period' },
      { key: 'generated_by', label: 'Generated By' },
      { key: 'status', label: 'Status', format: 'badge' },
    ],
    fields: [
      { key: 'name', label: 'Report Name', type: 'text', required: true },
      { key: 'report_type', label: 'Report Type', type: 'select', options: ['aging','vendor_spend','cash_flow','budget_variance','audit','payment','tax','expense','efficiency','vendor_perf','reconciliation','compliance','currency','forecast'] },
      { key: 'date_range', label: 'Date Range', type: 'text' },
      { key: 'generated_by', label: 'Generated By', type: 'text' },
      { key: 'summary', label: 'Summary', type: 'textarea' },
      { key: 'status', label: 'Status', type: 'select', options: ['generated','draft','archived'] },
    ],
    detailFields: ['name','report_type','date_range','generated_by','summary','data','status'],
  },
  'bank-reconciliations': {
    title: 'Bank Reconciliation',
    singular: 'Reconciliation',
    endpoint: '/bank-reconciliations',
    columns: [
      { key: 'account_name', label: 'Account' },
      { key: 'statement_date', label: 'Statement Date', format: 'date' },
      { key: 'statement_balance', label: 'Statement Bal.', format: 'money' },
      { key: 'difference', label: 'Difference', format: 'money' },
      { key: 'status', label: 'Status', format: 'badge' },
    ],
    fields: [
      { key: 'account_name', label: 'Account Name', type: 'text', required: true },
      { key: 'account_number', label: 'Account Number', type: 'text' },
      { key: 'statement_date', label: 'Statement Date', type: 'date' },
      { key: 'statement_balance', label: 'Statement Balance', type: 'number' },
      { key: 'book_balance', label: 'Book Balance', type: 'number' },
      { key: 'difference', label: 'Difference', type: 'number' },
      { key: 'matched_transactions', label: 'Matched Transactions', type: 'number' },
      { key: 'unmatched_transactions', label: 'Unmatched Transactions', type: 'number' },
      { key: 'status', label: 'Status', type: 'select', options: ['in_progress','reconciled','discrepancy'] },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    detailFields: ['account_name','account_number','statement_date','statement_balance','book_balance','difference','matched_transactions','unmatched_transactions','status','notes'],
  },
  'credit-notes': {
    title: 'Credit Notes',
    singular: 'Credit Note',
    endpoint: '/credit-notes',
    columns: [
      { key: 'credit_note_number', label: 'CN #' },
      { key: 'vendor_name', label: 'Vendor' },
      { key: 'amount', label: 'Amount', format: 'money' },
      { key: 'reason', label: 'Reason' },
      { key: 'status', label: 'Status', format: 'badge' },
    ],
    fields: [
      { key: 'credit_note_number', label: 'Credit Note Number', type: 'text', required: true },
      { key: 'vendor_name', label: 'Vendor Name', type: 'text', required: true },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'reason', label: 'Reason', type: 'textarea' },
      { key: 'status', label: 'Status', type: 'select', options: ['pending','applied','rejected'] },
      { key: 'issue_date', label: 'Issue Date', type: 'date' },
      { key: 'applied_date', label: 'Applied Date', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    detailFields: ['credit_note_number','vendor_name','amount','reason','status','issue_date','applied_date','notes'],
  },
  'currency-conversions': {
    title: 'Currency Conversions',
    singular: 'Conversion',
    endpoint: '/currency-conversions',
    columns: [
      { key: 'from_currency', label: 'From' },
      { key: 'to_currency', label: 'To' },
      { key: 'amount', label: 'Amount', format: 'money' },
      { key: 'converted_amount', label: 'Converted', format: 'money' },
      { key: 'exchange_rate', label: 'Rate' },
    ],
    fields: [
      { key: 'from_currency', label: 'From Currency', type: 'select', options: ['USD','EUR','GBP','JPY','CAD','AUD','CHF','MXN','INR','SGD','BRL','SEK','NZD'], required: true },
      { key: 'to_currency', label: 'To Currency', type: 'select', options: ['USD','EUR','GBP','JPY','CAD','AUD','CHF'], required: true },
      { key: 'exchange_rate', label: 'Exchange Rate', type: 'number', required: true },
      { key: 'amount', label: 'Amount', type: 'number', required: true },
      { key: 'converted_amount', label: 'Converted Amount', type: 'number', required: true },
      { key: 'source', label: 'Source', type: 'text' },
      { key: 'conversion_date', label: 'Conversion Date', type: 'date' },
      { key: 'invoice_ref', label: 'Invoice Reference', type: 'text' },
    ],
    detailFields: ['from_currency','to_currency','exchange_rate','amount','converted_amount','source','conversion_date','invoice_ref'],
  },
  'duplicate-detections': {
    title: 'Duplicate Detection',
    singular: 'Detection',
    endpoint: '/duplicate-detections',
    columns: [
      { key: 'invoice_ref_1', label: 'Invoice 1' },
      { key: 'invoice_ref_2', label: 'Invoice 2' },
      { key: 'vendor_name', label: 'Vendor' },
      { key: 'similarity_score', label: 'Similarity %' },
      { key: 'status', label: 'Status', format: 'badge' },
    ],
    fields: [
      { key: 'invoice_ref_1', label: 'Invoice Ref 1', type: 'text', required: true },
      { key: 'invoice_ref_2', label: 'Invoice Ref 2', type: 'text', required: true },
      { key: 'vendor_name', label: 'Vendor Name', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'number' },
      { key: 'similarity_score', label: 'Similarity Score', type: 'number' },
      { key: 'detection_method', label: 'Detection Method', type: 'select', options: ['exact_match','fuzzy_match','amount_vendor','ai_detection'] },
      { key: 'status', label: 'Status', type: 'select', options: ['flagged','resolved','dismissed'] },
      { key: 'resolution', label: 'Resolution', type: 'textarea' },
    ],
    detailFields: ['invoice_ref_1','invoice_ref_2','vendor_name','amount','similarity_score','detection_method','status','resolution'],
  },
  'audit-logs': {
    title: 'Audit Logs',
    singular: 'Log Entry',
    endpoint: '/audit-logs',
    columns: [
      { key: 'action', label: 'Action' },
      { key: 'entity_type', label: 'Entity' },
      { key: 'user_name', label: 'User' },
      { key: 'details', label: 'Details' },
      { key: 'created_at', label: 'Time', format: 'datetime' },
    ],
    fields: [
      { key: 'action', label: 'Action', type: 'text', required: true },
      { key: 'entity_type', label: 'Entity Type', type: 'text' },
      { key: 'entity_id', label: 'Entity ID', type: 'number' },
      { key: 'user_name', label: 'User', type: 'text' },
      { key: 'details', label: 'Details', type: 'textarea' },
      { key: 'ip_address', label: 'IP Address', type: 'text' },
    ],
    detailFields: ['action','entity_type','entity_id','user_name','details','ip_address','changes','created_at'],
  },
};

// ====== TABLE RENDERER ======
function renderTable(data, config) {
  const tbody = document.getElementById('table-body');
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="${config.columns.length + 1}"><div class="empty-state"><div class="empty-icon">📭</div><p>No ${config.title.toLowerCase()} found</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(row => `
    <tr data-id="${row.id}">
      ${config.columns.map(col => `<td>${formatCell(row[col.key], col.format)}</td>`).join('')}
      <td>
        <button class="btn btn-ai btn-sm ai-btn" data-id="${row.id}" title="AI Analysis">🤖 AI</button>
      </td>
    </tr>
  `).join('');

  // Row click -> detail view
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.ai-btn')) return;
      const id = tr.dataset.id;
      const item = data.find(d => d.id == id);
      if (item) showDetail(item, config);
    });
  });

  // AI buttons
  tbody.querySelectorAll('.ai-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      openAiPanel();
      try {
        const result = await api(`/${currentPage}/${id}/analyze`, { method: 'POST' });
        renderAiResponse(result);
      } catch (err) {
        renderAiResponse({ success: false, error: err.message });
      }
    });
  });
}

// ====== FORMAT HELPERS ======
function formatCell(value, format) {
  if (value === null || value === undefined) return '-';
  switch (format) {
    case 'money': return `<span class="money">$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
    case 'badge': return `<span class="badge badge-${String(value).toLowerCase().replace(/\s/g, '_')}">${value}</span>`;
    case 'date': return value ? new Date(value).toLocaleDateString() : '-';
    case 'datetime': return value ? new Date(value).toLocaleString() : '-';
    default: return escapeHtml(String(value));
  }
}

function formatDetailValue(key, value) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'object') {
    return `<pre style="background:#f8fafc;padding:12px;border-radius:8px;font-size:13px;overflow-x:auto;white-space:pre-wrap;">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
  }
  if (key.includes('amount') || key.includes('spent') || key.includes('balance') || key.includes('total') || key === 'amount') {
    return `<span class="money">$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>`;
  }
  if (key.includes('date') || key === 'created_at') return value ? new Date(value).toLocaleString() : '-';
  if (key === 'status' || key === 'priority') return `<span class="badge badge-${String(value).toLowerCase().replace(/\s/g, '_')}">${value}</span>`;
  return escapeHtml(String(value));
}

// ====== DETAIL VIEW ======
function showDetail(item, config) {
  const fields = config.detailFields || Object.keys(item).filter(k => k !== 'id');
  const bodyHtml = `
    <div class="detail-grid">
      ${fields.map(key => `
        <div class="detail-item ${typeof item[key] === 'object' ? 'detail-full' : ''}">
          <div class="detail-label">${key.replace(/_/g, ' ')}</div>
          <div class="detail-value">${formatDetailValue(key, item[key])}</div>
        </div>
      `).join('')}
    </div>
  `;

  const footerHtml = `
    <button class="btn btn-ai" id="detail-ai-btn">🤖 AI Analyze</button>
    <button class="btn btn-warning" id="detail-edit-btn">Edit</button>
    <button class="btn btn-danger" id="detail-delete-btn">Delete</button>
    <button class="btn btn-secondary" id="detail-close-btn">Close</button>
  `;

  openModal(`${config.singular} Details`, bodyHtml, footerHtml);

  document.getElementById('detail-close-btn').addEventListener('click', closeModal);

  document.getElementById('detail-ai-btn').addEventListener('click', async () => {
    openAiPanel();
    try {
      const result = await api(`/${currentPage}/${item.id}/analyze`, { method: 'POST' });
      renderAiResponse(result);
    } catch (err) {
      renderAiResponse({ success: false, error: err.message });
    }
  });

  document.getElementById('detail-edit-btn').addEventListener('click', () => {
    closeModal();
    showEditForm(item, config);
  });

  document.getElementById('detail-delete-btn').addEventListener('click', async () => {
    if (!confirm(`Delete this ${config.singular.toLowerCase()}?`)) return;
    try {
      await api(`/${currentPage}/${item.id}`, { method: 'DELETE' });
      toast(`${config.singular} deleted successfully`);
      closeModal();
      renderPage(currentPage);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ====== CREATE FORM ======
function showCreateForm(config) {
  const bodyHtml = `<form id="create-form">${renderFormFields(config.fields)}</form>`;
  const footerHtml = `
    <button class="btn btn-primary" id="create-save-btn">Create ${config.singular}</button>
    <button class="btn btn-secondary" id="create-cancel-btn">Cancel</button>
  `;

  openModal(`New ${config.singular}`, bodyHtml, footerHtml);

  document.getElementById('create-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('create-save-btn').addEventListener('click', async () => {
    const formData = getFormData(config.fields);
    try {
      await api(`/${currentPage}`, { method: 'POST', body: formData });
      toast(`${config.singular} created successfully`);
      closeModal();
      renderPage(currentPage);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ====== EDIT FORM ======
function showEditForm(item, config) {
  const bodyHtml = `<form id="edit-form">${renderFormFields(config.fields, item)}</form>`;
  const footerHtml = `
    <button class="btn btn-primary" id="edit-save-btn">Save Changes</button>
    <button class="btn btn-secondary" id="edit-cancel-btn">Cancel</button>
  `;

  openModal(`Edit ${config.singular}`, bodyHtml, footerHtml);

  document.getElementById('edit-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('edit-save-btn').addEventListener('click', async () => {
    const formData = getFormData(config.fields);
    try {
      await api(`/${currentPage}/${item.id}`, { method: 'PUT', body: formData });
      toast(`${config.singular} updated successfully`);
      closeModal();
      renderPage(currentPage);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ====== FORM HELPERS ======
function renderFormFields(fields, values = {}) {
  return fields.map(f => {
    const val = values[f.key] !== undefined ? values[f.key] : '';
    if (f.type === 'textarea') {
      return `<div class="form-group"><label>${f.label}</label><textarea id="field-${f.key}" rows="3" ${f.required ? 'required' : ''}>${escapeHtml(String(val))}</textarea></div>`;
    }
    if (f.type === 'select') {
      return `<div class="form-group"><label>${f.label}</label><select id="field-${f.key}">${f.options.map(o => `<option value="${o}" ${val == o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
    }
    return `<div class="form-group"><label>${f.label}</label><input type="${f.type}" id="field-${f.key}" value="${escapeHtml(String(val))}" ${f.required ? 'required' : ''} step="${f.type === 'number' ? 'any' : ''}"></div>`;
  }).join('');
}

function getFormData(fields) {
  const data = {};
  fields.forEach(f => {
    const el = document.getElementById(`field-${f.key}`);
    if (el) {
      let val = el.value;
      if (f.type === 'number' && val) val = parseFloat(val);
      if (val !== '' && val !== undefined) data[f.key] = val;
    }
  });
  return data;
}

// ====== DASHBOARD ======
async function renderDashboard(content) {
  content.innerHTML = `
    <div class="page-header"><h1>Dashboard</h1></div>
    <div class="stats-grid" id="stats-grid">
      <div class="stat-card primary"><div class="stat-label">Loading...</div><div class="stat-value">-</div></div>
    </div>
    <div class="page-header" style="margin-top:16px"><h1>Features</h1></div>
    <div class="features-grid" id="features-grid"></div>
  `;

  // Load stats
  try {
    const stats = await api('/dashboard');
    document.getElementById('stats-grid').innerHTML = `
      <div class="stat-card primary">
        <div class="stat-label">Total Invoices</div>
        <div class="stat-value">${stats.totalInvoices}</div>
        <div class="stat-sub">$${Number(stats.totalInvoiceAmount).toLocaleString()} total value</div>
      </div>
      <div class="stat-card warning">
        <div class="stat-label">Pending Invoices</div>
        <div class="stat-value">${stats.pendingInvoices}</div>
        <div class="stat-sub">Awaiting review</div>
      </div>
      <div class="stat-card success">
        <div class="stat-label">Active Vendors</div>
        <div class="stat-value">${stats.activeVendors}</div>
        <div class="stat-sub">Registered partners</div>
      </div>
      <div class="stat-card secondary">
        <div class="stat-label">Total Paid</div>
        <div class="stat-value">$${Number(stats.totalPaid).toLocaleString()}</div>
        <div class="stat-sub">${stats.completedPayments} completed payments</div>
      </div>
      <div class="stat-card danger">
        <div class="stat-label">Pending Approvals</div>
        <div class="stat-value">${stats.pendingApprovals}</div>
        <div class="stat-sub">Require attention</div>
      </div>
      <div class="stat-card primary">
        <div class="stat-label">Budget Utilization</div>
        <div class="stat-value">${stats.budgetAllocated ? Math.round((stats.budgetSpent / stats.budgetAllocated) * 100) : 0}%</div>
        <div class="stat-sub">$${Number(stats.budgetSpent).toLocaleString()} of $${Number(stats.budgetAllocated).toLocaleString()}</div>
      </div>
    `;
  } catch (err) {
    console.error('Dashboard stats error:', err);
  }

  // Feature cards
  const features = [
    { page: 'invoices', icon: '📄', title: 'Invoice Processing', desc: 'AI-powered invoice extraction, validation, and processing with smart categorization.' },
    { page: 'vendors', icon: '🏢', title: 'Vendor Management', desc: 'Track vendor relationships, performance ratings, and spending analytics.' },
    { page: 'purchase-orders', icon: '📋', title: 'Purchase Orders', desc: 'Create, track, and manage purchase orders with automated matching.' },
    { page: 'payments', icon: '💳', title: 'Payment Processing', desc: 'Manage payments across multiple methods with scheduling and tracking.' },
    { page: 'approvals', icon: '✅', title: 'Approval Workflows', desc: 'Multi-level approval routing with priority-based escalation.' },
    { page: 'expense-categories', icon: '📁', title: 'Expense Categories', desc: 'Organize expenses with hierarchical categories and GL mapping.' },
    { page: 'budgets', icon: '💰', title: 'Budget Tracking', desc: 'Monitor budgets in real-time with alerts and forecasting.' },
    { page: 'receipts', icon: '🧾', title: 'Receipt Management', desc: 'AI receipt scanning, categorization, and expense policy compliance.' },
    { page: 'tax-records', icon: '📑', title: 'Tax Compliance', desc: 'Automated tax calculation, filing tracking, and jurisdiction management.' },
    { page: 'reports', icon: '📈', title: 'Reports & Analytics', desc: 'Comprehensive reporting with AI-generated executive insights.' },
    { page: 'bank-reconciliations', icon: '🏦', title: 'Bank Reconciliation', desc: 'Automated bank statement matching with discrepancy detection.' },
    { page: 'credit-notes', icon: '📝', title: 'Credit Notes', desc: 'Track and manage vendor credit notes and adjustments.' },
    { page: 'currency-conversions', icon: '💱', title: 'Currency Management', desc: 'Multi-currency support with real-time conversion tracking.' },
    { page: 'duplicate-detections', icon: '🔍', title: 'Duplicate Detection', desc: 'AI-powered duplicate invoice detection with similarity scoring.' },
    { page: 'audit-logs', icon: '📜', title: 'Audit Trail', desc: 'Complete audit logging for compliance and security monitoring.' },
  ];

  document.getElementById('features-grid').innerHTML = features.map(f => `
    <div class="feature-card" data-page="${f.page}">
      <div class="feature-icon">${f.icon}</div>
      <div class="feature-title">${f.title}</div>
      <div class="feature-desc">${f.desc}</div>
      <div class="feature-count">View ${f.title}</div>
    </div>
  `).join('');

  document.querySelectorAll('.feature-card').forEach(card => {
    card.addEventListener('click', () => navigateTo(card.dataset.page));
  });
}

// ====== INIT ======
if (token && currentUser) {
  showApp();
} else {
  document.getElementById('login-page').classList.remove('hidden');
}
