// ====== STATE ======
const API = '';  // same origin
let token = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');
let currentPage = 'dashboard';
const pageState = {}; // tracks { page, limit } per module

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
  if (res.status === 429) {
    const msg = data.error || 'Too many AI requests. Please wait before trying again.';
    toast(msg, 'error');
    const e = new Error(msg); e.status = 429; throw e;
  }
  if (res.status === 503) {
    const msg = data.error || 'AI service unavailable - OPENROUTER_API_KEY is not set on the server.';
    const e = new Error(msg); e.status = 503; throw e;
  }
  if (!res.ok) {
    const e = new Error(data.error || 'Request failed'); e.status = res.status; throw e;
  }
  return data;
}

async function apiUpload(path, formData) {
  const res = await fetch(`${API}/api${path}`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  });
  const data = await res.json();
  if (res.status === 429) {
    const msg = data.error || 'Rate limit exceeded.';
    toast(msg, 'error');
    throw new Error(msg);
  }
  if (!res.ok) throw new Error(data.error || 'Upload failed');
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
async function renderPage(page, pageNum = 1) {
  const content = document.getElementById('page-content');
  if (page === 'dashboard') return renderDashboard(content);
  if (page === 'advanced-ai') return renderAdvancedAI(content);

  const config = pageConfigs[page];
  if (!config) { content.innerHTML = '<div class="empty-state"><p>Page not found</p></div>'; return; }

  if (!pageState[page]) pageState[page] = { page: 1, limit: 20 };
  pageState[page].page = pageNum;

  const isInvoices = page === 'invoices';

  content.innerHTML = `
    <div class="page-header">
      <h1>${config.title}</h1>
      <div class="page-header-actions">
        ${isInvoices ? '<button class="btn btn-secondary" id="ocr-upload-btn">Upload Invoice (OCR)</button>' : ''}
        <button class="btn btn-primary" id="add-new-btn">+ New ${config.singular}</button>
      </div>
    </div>
    ${isInvoices ? '<div id="ocr-section" class="hidden" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px;"></div>' : ''}
    <div class="table-container">
      <table class="data-table">
        <thead><tr>${config.columns.map(c => `<th>${c.label}</th>`).join('')}<th>Actions</th></tr></thead>
        <tbody id="table-body"><tr><td colspan="${config.columns.length + 1}" style="text-align:center;padding:40px;">Loading...</td></tr></tbody>
      </table>
    </div>
    <div id="pagination-controls" style="display:flex;align-items:center;justify-content:center;gap:16px;padding:16px 0;"></div>`;

  document.getElementById('add-new-btn').addEventListener('click', () => showCreateForm(config));

  if (isInvoices) {
    document.getElementById('ocr-upload-btn').addEventListener('click', () => {
      const sec = document.getElementById('ocr-section');
      sec.classList.toggle('hidden');
      if (!sec.classList.contains('hidden')) renderOcrSection(sec, config);
    });
  }

  try {
    const { page: pg, limit } = pageState[page];
    const result = await api(`/${page}?page=${pg}&limit=${limit}`);
    // Support both paginated response {data, pagination} and legacy array
    const items = Array.isArray(result) ? result : result.data;
    const pagination = Array.isArray(result) ? null : result.pagination;
    renderTable(items, config, page);
    if (pagination) renderPagination(pagination, page);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderPagination(pagination, page) {
  const container = document.getElementById('pagination-controls');
  if (!container || !pagination) return;
  const { page: currentPg, totalPages, total, limit } = pagination;
  const start = (currentPg - 1) * limit + 1;
  const end = Math.min(currentPg * limit, total);
  container.innerHTML = `
    <button class="btn btn-secondary btn-sm" ${currentPg <= 1 ? 'disabled' : ''} id="prev-page">Previous</button>
    <span style="color:#64748b;font-size:14px;">Page ${currentPg} of ${totalPages} &nbsp;(${start}–${end} of ${total})</span>
    <button class="btn btn-secondary btn-sm" ${currentPg >= totalPages ? 'disabled' : ''} id="next-page">Next</button>
  `;
  if (currentPg > 1) {
    document.getElementById('prev-page').addEventListener('click', () => renderPage(page, currentPg - 1));
  }
  if (currentPg < totalPages) {
    document.getElementById('next-page').addEventListener('click', () => renderPage(page, currentPg + 1));
  }
}

function renderOcrSection(container, config) {
  container.innerHTML = `
    <h3 style="margin:0 0 12px;font-size:16px;">Upload Invoice for AI Extraction (OCR)</h3>
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
      <input type="file" id="ocr-file-input" accept="image/jpeg,image/png" style="flex:1;min-width:200px;">
      <button class="btn btn-ai" id="ocr-extract-btn">Extract with AI</button>
    </div>
    <div id="ocr-result" style="margin-top:16px;"></div>
  `;

  document.getElementById('ocr-extract-btn').addEventListener('click', async () => {
    const fileInput = document.getElementById('ocr-file-input');
    if (!fileInput.files.length) { toast('Please select a file first', 'error'); return; }
    const resultDiv = document.getElementById('ocr-result');
    resultDiv.innerHTML = '<div class="ai-loading">Extracting invoice data with AI...</div>';

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
      const data = await apiUpload('/invoices/ocr-upload', formData);
      const ex = data.extracted || {};
      resultDiv.innerHTML = `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;">
          <h4 style="margin:0 0 12px;">Extracted Data ${data.invoice_id ? '<span style="color:#22c55e;font-size:13px;">(Invoice #' + data.invoice_id + ' saved)</span>' : ''}</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
            <div><strong>Vendor:</strong> ${escapeHtml(ex.vendor_name || '-')}</div>
            <div><strong>Invoice #:</strong> ${escapeHtml(ex.invoice_number || '-')}</div>
            <div><strong>Invoice Date:</strong> ${escapeHtml(ex.invoice_date || '-')}</div>
            <div><strong>Due Date:</strong> ${escapeHtml(ex.due_date || '-')}</div>
            <div><strong>Subtotal:</strong> $${Number(ex.subtotal || 0).toFixed(2)}</div>
            <div><strong>Tax:</strong> $${Number(ex.tax || 0).toFixed(2)}</div>
            <div><strong>Total:</strong> <strong style="color:#2563eb;">$${Number(ex.total_amount || 0).toFixed(2)}</strong></div>
            <div><strong>Payment Terms:</strong> ${escapeHtml(ex.payment_terms || '-')}</div>
          </div>
          ${ex.line_items && ex.line_items.length ? `
            <div><strong>Line Items:</strong>
              <table style="width:100%;margin-top:8px;font-size:13px;border-collapse:collapse;">
                <thead><tr style="background:#f1f5f9;">${['Description','Qty','Unit Price','Total'].map(h => `<th style="padding:6px 8px;text-align:left;">${h}</th>`).join('')}</tr></thead>
                <tbody>${ex.line_items.map(li => `<tr><td style="padding:4px 8px;">${escapeHtml(String(li.description || '-'))}</td><td style="padding:4px 8px;">${li.quantity || '-'}</td><td style="padding:4px 8px;">$${Number(li.unit_price || 0).toFixed(2)}</td><td style="padding:4px 8px;">$${Number(li.total || 0).toFixed(2)}</td></tr>`).join('')}</tbody>
              </table>
            </div>` : ''}
          ${data.invoice_id ? `<p style="margin:12px 0 0;color:#22c55e;font-size:14px;">Invoice automatically saved with ID #${data.invoice_id}. Refreshing list...</p>` : '<p style="margin:12px 0 0;color:#f59e0b;font-size:14px;">Invoice could not be auto-saved (missing vendor name).</p>'}
        </div>`;
      if (data.invoice_id) setTimeout(() => renderPage(currentPage), 1500);
    } catch (err) {
      resultDiv.innerHTML = `<div class="ai-error"><strong>Error:</strong> ${escapeHtml(err.message)}</div>`;
    }
  });
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
function renderTable(data, config, pageName) {
  const tbody = document.getElementById('table-body');
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="${config.columns.length + 1}"><div class="empty-state"><div class="empty-icon">📭</div><p>No ${config.title.toLowerCase()} found</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(row => `
    <tr data-id="${row.id}">
      ${config.columns.map(col => `<td>${formatCell(row[col.key], col.format)}</td>`).join('')}
      <td>
        <button class="btn btn-ai btn-sm ai-btn" data-id="${row.id}" title="AI Analysis">AI</button>
      </td>
    </tr>
  `).join('');

  // Row click -> detail view
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.ai-btn')) return;
      const id = tr.dataset.id;
      const item = data.find(d => d.id == id);
      if (item) showDetail(item, config, pageName);
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
function showDetail(item, config, pageName) {
  const fields = config.detailFields || Object.keys(item).filter(k => k !== 'id');
  const isInvoice = (pageName || currentPage) === 'invoices';

  const bodyHtml = `
    <div class="detail-grid">
      ${fields.map(key => `
        <div class="detail-item ${typeof item[key] === 'object' ? 'detail-full' : ''}">
          <div class="detail-label">${key.replace(/_/g, ' ')}</div>
          <div class="detail-value">${formatDetailValue(key, item[key])}</div>
        </div>
      `).join('')}
    </div>
    ${isInvoice ? '<div id="three-way-match-result" style="margin-top:16px;"></div>' : ''}
  `;

  const footerHtml = `
    ${isInvoice ? '<button class="btn btn-secondary" id="detail-3way-btn">3-Way Match</button>' : ''}
    <button class="btn btn-ai" id="detail-ai-btn">AI Analyze</button>
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

  if (isInvoice) {
    document.getElementById('detail-3way-btn').addEventListener('click', async () => {
      const resultDiv = document.getElementById('three-way-match-result');
      resultDiv.innerHTML = '<div class="ai-loading">Running 3-way match analysis...</div>';
      try {
        const res = await api(`/invoices/${item.id}/three-way-match`, { method: 'POST' });
        const match = res.match_result || {};
        const status = match.match_status || 'unknown';
        const statusColors = { approved: '#22c55e', discrepancy: '#ef4444', missing_docs: '#f59e0b' };
        const color = statusColors[status] || '#64748b';
        resultDiv.innerHTML = `
          <div style="border:1px solid ${color};border-radius:8px;padding:16px;background:#fff;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
              <span style="background:${color};color:#fff;padding:4px 12px;border-radius:20px;font-weight:600;font-size:14px;">${status.replace(/_/g,' ').toUpperCase()}</span>
              <span style="color:#64748b;font-size:13px;">PO: ${res.po_found ? 'Found' : 'Not Found'} | Receipt: ${res.receipt_found ? 'Found' : 'Not Found'}</span>
            </div>
            ${match.discrepancies && match.discrepancies.length ? `
              <div style="margin-bottom:8px;"><strong>Discrepancies:</strong>
                <ul style="margin:4px 0 0;padding-left:20px;">${match.discrepancies.map(d => `<li style="font-size:13px;">${escapeHtml(String(d))}</li>`).join('')}</ul>
              </div>` : ''}
            ${match.recommended_action ? `<div style="margin-bottom:8px;font-size:14px;"><strong>Action:</strong> ${escapeHtml(match.recommended_action)}</div>` : ''}
            ${match.approval_confidence !== undefined ? `<div style="font-size:13px;color:#64748b;">Confidence: ${Math.round(match.approval_confidence * 100)}%</div>` : ''}
            ${match.summary ? `<div style="margin-top:8px;font-size:13px;color:#475569;">${escapeHtml(match.summary)}</div>` : ''}
          </div>`;
      } catch (err) {
        resultDiv.innerHTML = `<div class="ai-error"><strong>Error:</strong> ${escapeHtml(err.message)}</div>`;
      }
    });
  }

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

// ====== ADVANCED AI ======
async function renderAdvancedAI(content) {
  content.innerHTML = `
    <div class="page-header">
      <h1>🤖 Advanced AI Tools</h1>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
      <button class="btn btn-secondary" data-tab="duplicate">Duplicate Detection</button>
      <button class="btn btn-secondary" data-tab="payment">Payment Term Advisor</button>
      <button class="btn btn-secondary" data-tab="budget">Budget Forecast</button>
      <button class="btn btn-secondary" data-tab="scorecard">Supplier Scorecard</button>
    </div>
    <div id="advanced-ai-tab" style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;"></div>
    <div id="advanced-ai-result" style="margin-top:16px;"></div>
  `;
  const tabContainer = content.querySelector('#advanced-ai-tab');

  const renderDuplicate = async () => {
    let invoices = [];
    try {
      const res = await api(`/invoices?page=1&limit=200`);
      invoices = Array.isArray(res) ? res : (res.data || []);
    } catch {/* ignore */}
    tabContainer.innerHTML = `
      <h3 style="margin:0 0 12px;">🔍 Duplicate Invoice Detection</h3>
      <p style="color:#64748b;margin-bottom:12px;">Detect duplicate / near-duplicate invoices for the selected invoice using vendor + amount tolerance + invoice number.</p>
      <div class="form-group">
        <label>Invoice</label>
        <select id="adv-invoice-id">
          <option value="">-- Select Invoice --</option>
          ${invoices.map(inv => `<option value="${inv.id}">#${inv.id} ${inv.invoice_number || ''} ${inv.vendor_name ? '— ' + inv.vendor_name : ''} ${inv.total_amount ? '($' + Number(inv.total_amount).toLocaleString() + ')' : ''}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-primary" id="adv-duplicate-run">Run Duplicate Detection</button>
    `;
    document.getElementById('adv-duplicate-run').addEventListener('click', async () => {
      const id = document.getElementById('adv-invoice-id').value;
      if (!id) { toast('Please select an invoice', 'error'); return; }
      await runAdvanced(`/invoices/${id}/duplicate-detection`, {});
    });
  };

  const renderPayment = async () => {
    let vendors = [];
    try {
      const res = await api(`/vendors?page=1&limit=200`);
      vendors = Array.isArray(res) ? res : (res.data || []);
    } catch {/* ignore */}
    tabContainer.innerHTML = `
      <h3 style="margin:0 0 12px;">💼 Payment Term Advisor</h3>
      <p style="color:#64748b;margin-bottom:12px;">Recommended terms days, early-pay discount target, expected annual savings, and negotiation script.</p>
      <div class="form-group">
        <label>Vendor</label>
        <select id="adv-vendor-id">
          <option value="">-- Select Vendor --</option>
          ${vendors.map(v => `<option value="${v.id}">#${v.id} ${v.name || ''} ${v.payment_terms ? '(' + v.payment_terms + ')' : ''}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-primary" id="adv-payment-run">Run Advisor</button>
    `;
    document.getElementById('adv-payment-run').addEventListener('click', async () => {
      const id = document.getElementById('adv-vendor-id').value;
      if (!id) { toast('Please select a vendor', 'error'); return; }
      await runAdvanced(`/vendors/${id}/payment-term-advisor`, {});
    });
  };

  const renderBudget = () => {
    tabContainer.innerHTML = `
      <h3 style="margin:0 0 12px;">📊 Budget Forecast</h3>
      <p style="color:#64748b;margin-bottom:12px;">Low/central/high projections by category with confidence and recommended actions.</p>
      <div class="form-group">
        <label>Forecast Horizon (months)</label>
        <input type="number" id="adv-horizon-months" value="12" min="1" max="36">
      </div>
      <div class="form-group">
        <label>Notes / Context</label>
        <textarea id="adv-budget-notes" rows="3" placeholder="Optional: business changes, hiring, seasonality"></textarea>
      </div>
      <button class="btn btn-primary" id="adv-budget-run">Run Forecast</button>
    `;
    document.getElementById('adv-budget-run').addEventListener('click', async () => {
      const horizon = Number(document.getElementById('adv-horizon-months').value || 12);
      const notes = document.getElementById('adv-budget-notes').value;
      const body = { horizon_months: horizon };
      if (notes) body.notes = notes;
      await runAdvanced('/budgets/forecast', body);
    });
  };

  const renderScorecard = async () => {
    let vendors = [];
    try {
      const res = await api(`/vendors?page=1&limit=200`);
      vendors = Array.isArray(res) ? res : (res.data || []);
    } catch {/* ignore */}
    tabContainer.innerHTML = `
      <h3 style="margin:0 0 12px;">📋 Supplier Scorecard</h3>
      <p style="color:#64748b;margin-bottom:12px;">Composite vendor score across delivery, billing, payment compliance, dispute rate, and risk.</p>
      <div class="form-group">
        <label>Vendor</label>
        <select id="adv-scorecard-vendor-id">
          <option value="">-- Select Vendor --</option>
          ${vendors.map(v => `<option value="${v.id}">#${v.id} ${v.name || ''}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-primary" id="adv-scorecard-run">Run Scorecard</button>
    `;
    document.getElementById('adv-scorecard-run').addEventListener('click', async () => {
      const id = document.getElementById('adv-scorecard-vendor-id').value;
      if (!id) { toast('Please select a vendor', 'error'); return; }
      await runAdvanced(`/vendors/${id}/scorecard`, {});
    });
  };

  const runAdvanced = async (path, body) => {
    const result = document.getElementById('advanced-ai-result');
    result.innerHTML = '<div class="empty-state"><p>AI is analyzing...</p></div>';
    try {
      const data = await api(path, { method: 'POST', body });
      result.innerHTML = `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;">
          <h3 style="margin:0 0 12px;">Result</h3>
          <pre style="background:#0f172a;color:#e2e8f0;padding:14px;border-radius:8px;overflow:auto;font-size:12px;max-height:520px;">${escapeHtml(JSON.stringify(data, null, 2))}</pre>
        </div>
      `;
    } catch (err) {
      const status = err.status || (err.response && err.response.status);
      const msg = (status === 503)
        ? 'AI service unavailable - OPENROUTER_API_KEY is not set on the server.'
        : (err.message || 'Request failed');
      result.innerHTML = `<div style="background:#fee2e2;border:1px solid #fecaca;color:#991b1b;padding:12px;border-radius:8px;">${escapeHtml(msg)}</div>`;
    }
  };

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  content.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      content.querySelectorAll('[data-tab]').forEach((b) => b.classList.remove('btn-primary'));
      content.querySelectorAll('[data-tab]').forEach((b) => b.classList.add('btn-secondary'));
      btn.classList.remove('btn-secondary');
      btn.classList.add('btn-primary');
      const tab = btn.dataset.tab;
      document.getElementById('advanced-ai-result').innerHTML = '';
      if (tab === 'duplicate') renderDuplicate();
      else if (tab === 'payment') renderPayment();
      else if (tab === 'budget') renderBudget();
      else if (tab === 'scorecard') renderScorecard();
    });
  });
  // Default to first tab
  content.querySelector('[data-tab="duplicate"]').click();
}

// ====== INIT ======
if (token && currentUser) {
  showApp();
} else {
  document.getElementById('login-page').classList.remove('hidden');
}
