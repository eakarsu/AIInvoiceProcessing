// Tenant-scoped AP workbench. All generated DOM that contains API data uses textContent.
let governedSelectedId = null;
let governedPreviewUrl = null;

async function governedApi(path, method = 'GET', body, extraHeaders = {}) {
  const response = await fetch(`/api/governed-invoices${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data.validation?.errors || data.exceptions;
    const error = new Error(data.error || (Array.isArray(details) && details.length
      ? details.map(item => typeof item === 'string' ? item : item.code).join('; ')
      : 'Governed AP request failed'));
    error.details = data;
    throw error;
  }
  return data;
}

async function governedUpload(path, form, extraHeaders = {}) {
  const response = await fetch(`/api/governed-invoices${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, ...extraHeaders },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Original invoice upload failed');
  return data;
}

function governedElement(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function governedNotice(container, message, error = false) {
  const line = governedElement('p', message);
  line.style.color = error ? '#b91c1c' : '#166534';
  line.setAttribute('role', error ? 'alert' : 'status');
  container.prepend(line);
}

async function renderGovernedAP(content) {
  content.innerHTML = `
    <div class="page-header"><h1>Governed accounts payable</h1></div>
    <p>Invoice documents, extracted candidates, matching, approvals, posting requests and reconciliation are tenant scoped. Stored text and local PDF/image recognition candidates require AP review. Posting is unavailable until an ERP sandbox and verified receipts are configured.</p>
    <div id="governed-status"></div>
    <section class="card" style="padding:20px;margin:16px 0;">
      <h2>Upload original invoice</h2>
      <p>Store the original PDF, JPEG, PNG, or UTF-8 text invoice in the tenant-scoped AP database (20 MB maximum). The server computes SHA-256 from the uploaded bytes. For PDF/images, an AP analyst can generate a separate, immutable local recognition candidate for up to five pages.</p>
      <form id="governed-upload-form">
        <label>Source <input name="source" value="staff_upload" required></label>
        <label>Original invoice file <input name="file" type="file" accept="application/pdf,image/jpeg,image/png,text/plain,.txt" required></label>
        <button class="btn btn-primary" type="submit">Upload and create invoice case</button>
      </form>
      <details style="margin-top:18px;"><summary>Advanced: register external document metadata only</summary>
      <p>This records a key and claimed checksum without storing bytes. The case cannot pass governed extraction or AP review until the exact original is attached.</p>
      <form id="governed-ingest-form">
        <label>Source <input name="source" value="staff_intake" required></label>
        <label>Local file for SHA-256 metadata <input id="governed-file" type="file"></label>
        <label>Immutable storage object key <input name="storageObjectKey" required></label>
        <label>SHA-256 content digest <input name="contentDigest" minlength="64" maxlength="64" required></label>
        <label>Media type <input name="mediaType" required></label>
        <label>Byte size <input name="byteSize" type="number" min="1" required></label>
        <button class="btn btn-primary" type="submit">Register invoice case</button>
      </form></details>
    </section>
    <section class="card" style="padding:20px;margin:16px 0;">
      <h2>Invoice cases</h2><button id="governed-refresh" class="btn btn-secondary">Refresh</button>
      <div id="governed-list"></div>
    </section>
    <section id="governed-detail" class="card" style="padding:20px;margin:16px 0;"></section>`;
  const status = content.querySelector('#governed-status');
  const list = content.querySelector('#governed-list');
  const detail = content.querySelector('#governed-detail');

  async function loadList() {
    try {
      const rows = await governedApi('/');
      list.replaceChildren();
      if (!Array.isArray(rows) || rows.length === 0) list.append(governedElement('p', 'No governed invoices for this account.'));
      else rows.forEach(item => {
        const button = governedElement('button',
          `Case #${item.id} · ${item.invoice_number || 'unextracted'} · ${item.status} · ${item.amount ?? '—'} ${item.currency || ''}`,
          'btn btn-secondary');
        button.style.margin = '6px';
        button.addEventListener('click', () => loadDetail(item.id));
        list.append(button);
      });
      if (governedSelectedId) await loadDetail(governedSelectedId);
    } catch (error) { governedNotice(status, error.message, true); }
  }
  async function write(path, body, options = {}) {
    try {
      const result = await governedApi(path, 'POST', body, options);
      governedNotice(status, 'Governed evidence or decision recorded.');
      await loadList();
      return result;
    } catch (error) {
      governedNotice(status, error.message, true);
      await loadList();
      return null;
    }
  }
  async function uploadWrite(path, form, options = {}) {
    try {
      const result = await governedUpload(path, form, options);
      governedNotice(status, 'Immutable invoice original stored.');
      await loadList();
      return result;
    } catch (error) {
      governedNotice(status, error.message, true);
      return null;
    }
  }
  async function loadDetail(id) {
    try {
      governedSelectedId = id;
      const record = await governedApi(`/${id}`);
      const item = record.invoiceCase;
      if (governedPreviewUrl) { URL.revokeObjectURL(governedPreviewUrl); governedPreviewUrl = null; }
      detail.replaceChildren();
      detail.append(governedElement('h2', `Case #${id} · ${item.status}`));
      detail.append(governedElement('p', `Revision ${item.revision}; vendor ${item.vendor_id || 'pending'}; invoice ${item.invoice_number || 'pending'}; total ${item.amount ?? 'pending'} ${item.currency || ''}.`));
      const documentList = governedElement('ul');
      (record.documents || []).forEach(doc => {
        const row = governedElement('li',
          `Document ${doc.id}: ${doc.source} · ${doc.media_type} · SHA-256 ${doc.content_digest} · ${doc.original_stored ? 'original stored' : 'metadata only'}`);
        if (doc.original_stored) {
          const view = governedElement('button', 'View stored original', 'btn btn-secondary');
          view.type = 'button';
          view.addEventListener('click', async () => {
            try {
              const response = await fetch(`/api/governed-invoices/${id}/documents/${doc.id}/content`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
              });
              if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Original retrieval failed'); }
              const blob = await response.blob();
              if (governedPreviewUrl) URL.revokeObjectURL(governedPreviewUrl);
              governedPreviewUrl = URL.createObjectURL(blob);
              const preview = governedElement('div');
              preview.style.cssText = 'margin:12px 0;padding:12px;border:1px solid #cbd5e1;max-height:520px;overflow:auto;';
              if (doc.media_type === 'text/plain') {
                const text = governedElement('pre', await blob.text());
                text.style.whiteSpace = 'pre-wrap';
                preview.append(text);
              } else if (doc.media_type.startsWith('image/')) {
                const image = governedElement('img');
                image.src = governedPreviewUrl;
                image.alt = `Stored original invoice document ${doc.id}`;
                image.style.cssText = 'max-width:100%;height:auto;';
                preview.append(image);
              } else {
                const embed = governedElement('embed');
                embed.src = governedPreviewUrl;
                embed.type = 'application/pdf';
                embed.style.cssText = 'width:100%;height:480px;';
                preview.append(embed);
              }
              const download = governedElement('a', 'Download original');
              download.href = governedPreviewUrl;
              download.download = `invoice-original-${doc.id}.${{ 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'text/plain': 'txt' }[doc.media_type] || 'bin'}`;
              download.style.display = 'block';
              preview.append(download);
              detail.querySelector('#governed-source-preview')?.remove();
              preview.id = 'governed-source-preview';
              row.append(preview);
            } catch (error) { governedNotice(status, error.message, true); }
          });
          row.append(' ', view);
          if (doc.media_type !== 'text/plain') {
            const recognize = governedElement('button', 'Recognize stored original', 'btn btn-secondary');
            recognize.type = 'button';
            recognize.addEventListener('click', async () => {
              const result = await write(`/${id}/documents/${doc.id}/recognize`, {});
              if (result) await loadDetail(id);
            });
            row.append(' ', recognize);
            if (doc.media_type === 'application/pdf') {
              const force = governedElement('button', 'Re-run as scanned PDF', 'btn btn-secondary');
              force.type = 'button';
              force.addEventListener('click', async () => {
                const result = await write(`/${id}/documents/${doc.id}/recognize`, { force: true, mode: 'ocr' });
                if (result) await loadDetail(id);
              });
              row.append(' ', force);
            }
          }
        } else {
          const form = governedElement('form');
          form.innerHTML = '<label>Attach exact registered original <input name="file" type="file" accept="application/pdf,image/jpeg,image/png,text/plain,.txt" required></label><button class="btn btn-secondary" type="submit">Attach original</button>';
          form.addEventListener('submit', async event => {
            event.preventDefault();
            const result = await uploadWrite(`/${id}/documents/${doc.id}/upload`, new FormData(form));
            if (result) await loadDetail(id);
          });
          row.append(form);
        }
        documentList.append(row);
      });
      detail.append(governedElement('h3', 'Document evidence'), documentList);
      const exceptions = governedElement('ul');
      (record.exceptions || []).forEach(exception => exceptions.append(governedElement('li',
        `${exception.code} · ${exception.status} · ${JSON.stringify(exception.detail)}`)));
      detail.append(governedElement('h3', 'Exceptions'), exceptions);
      if (['ingested', 'extracted', 'exception'].includes(item.status)) {
        const extract = governedElement('section');
        extract.innerHTML = `
          <h3>Review an extraction candidate</h3>
          <p>Hints come from stored UTF-8 text or immutable local recognition of the stored PDF/image. Check the original file, recognized text, every quoted page/line/character span and any OCR uncertainty before recording a candidate.</p>
          <button id="governed-hints" class="btn btn-secondary">Read hints from stored original</button>
          <div id="governed-hint-results"></div>
          <label>Candidate JSON <textarea id="governed-candidate" rows="11" style="width:100%;" placeholder='{"vendorId":"vendor-1","invoiceNumber":"INV-1","invoiceDate":"2026-10-04","currency":"USD","lines":[{"description":"Service","quantity":1,"unitPrice":100,"taxRate":0,"net":100}],"subtotal":100,"tax":0,"total":100}'></textarea></label>
          <label>Verified source spans JSON <textarea id="governed-source-evidence" rows="10" style="width:100%;" placeholder="Load hints, then verify and edit the exact source spans"></textarea></label>
          <button id="governed-save-candidate" class="btn btn-primary">Validate and record candidate</button>`;
        detail.append(extract);
        let hintedSource = null;
        extract.querySelector('#governed-hints').addEventListener('click', async () => {
          try {
            const source = (record.documents || []).find(doc => doc.original_stored);
            if (!source) throw new Error('A stored original is required for source-grounded hints.');
            const data = await governedApi(`/${id}/documents/${source.id}/source-hints`);
            hintedSource = data;
            extract.querySelector('#governed-source-evidence').value = JSON.stringify(data.sourceEvidenceTemplate, null, 2);
            const out = extract.querySelector('#governed-hint-results');
            out.replaceChildren();
            if (data.recognition) {
              out.append(governedElement('p', `Recognition: ${data.recognition.method} · ${data.recognition.pages} page(s) · mean OCR confidence ${data.recognition.meanConfidence ?? 'text layer'}. Review the original against this recognized text.`));
              const recognized = governedElement('pre', data.recognizedText || '');
              recognized.style.cssText = 'white-space:pre-wrap;max-height:320px;overflow:auto;border:1px solid #cbd5e1;padding:10px;';
              out.append(recognized);
            }
            Object.entries(data.extraction || {}).filter(([, value]) => value && typeof value === 'object' && 'confidence' in value)
              .forEach(([name, value]) => out.append(governedElement('p',
                `${name}: ${value.value ?? 'manual review'} · pattern confidence ${value.confidence}${value.recognitionConfidence == null ? '' : ` · OCR line confidence ${value.recognitionConfidence}`} · source “${value.evidence || 'none'}” · ${value.sourcePosition ? `page ${value.sourcePosition.page}, line ${value.sourcePosition.line}${value.sourcePosition.box ? `, box ${value.sourcePosition.box.left},${value.sourcePosition.box.top} ${value.sourcePosition.box.width}×${value.sourcePosition.box.height}` : ''}` : 'position unavailable'}`)));
            (data.extraction?.lineCandidates || []).forEach((line, index) => out.append(governedElement('p',
              `Line ${index + 1}: ${line.description} · ${line.quantity} × ${line.unitPrice} = ${line.net} · pattern confidence ${line.confidence}${line.recognitionConfidence == null ? '' : ` · OCR line confidence ${line.recognitionConfidence}`} · page ${line.sourcePosition?.page || '?'}, line ${line.sourcePosition?.line || '?'}${line.sourcePosition?.box ? `, box ${line.sourcePosition.box.left},${line.sourcePosition.box.top} ${line.sourcePosition.box.width}×${line.sourcePosition.box.height}` : ''}${line.reviewRequired ? ' · arithmetic mismatch: AP review required' : ''}`)));
            if (data.extraction?.lineReviewRequired) out.append(governedElement('p',
              'Invoice lines are missing or inconsistent. An AP analyst must review the source before validation.'));
            if (data.extraction?.needsManualEntry?.length) out.append(governedElement('p',
              `Manual entry required: ${data.extraction.needsManualEntry.join(', ')}`));
          } catch (error) { governedNotice(status, error.message, true); }
        });
        extract.querySelector('#governed-save-candidate').addEventListener('click', async () => {
          let candidate;
          try { candidate = JSON.parse(extract.querySelector('#governed-candidate').value); }
          catch { governedNotice(status, 'Candidate must be valid JSON.', true); return; }
          if (!hintedSource) { governedNotice(status, 'Load hints from the stored original first.', true); return; }
          let sourceEvidence;
          try { sourceEvidence = JSON.parse(extract.querySelector('#governed-source-evidence').value); }
          catch { governedNotice(status, 'Source spans must be valid JSON.', true); return; }
          await write(`/${id}/extractions`, {
            candidate, extractionVersion: `review-${Date.now()}`,
            sourceDocumentId: hintedSource.sourceDocumentId,
            sourceTextId: hintedSource.sourceTextId,
            sourceContentDigest: hintedSource.sourceContentDigest,
            sourceTextDigest: hintedSource.sourceTextDigest,
            sourceEvidence,
          });
        });
      }
      if (item.status === 'validated') {
        const match = governedElement('section');
        match.innerHTML = `<h3>Three-way match</h3>
          <p>Use versioned purchase order and receipt data from an approved source.</p>
          <label>Purchase order JSON <textarea id="governed-po" rows="5" style="width:100%;"></textarea></label>
          <label>Receipt JSON <textarea id="governed-receipt" rows="5" style="width:100%;"></textarea></label>
          <button id="governed-match" class="btn btn-primary">Check PO and receipt</button>`;
        detail.append(match);
        match.querySelector('#governed-match').addEventListener('click', async () => {
          try {
            const purchaseOrder = JSON.parse(match.querySelector('#governed-po').value);
            const receipt = JSON.parse(match.querySelector('#governed-receipt').value);
            await write(`/${id}/matches`, { purchaseOrder, receipt, amountTolerance: 0.01, quantityTolerance: 0 });
          } catch (error) { governedNotice(status, error.message, true); }
        });
      }
      if (item.status === 'approval_pending') {
        const approval = governedElement('section');
        approval.innerHTML = `<h3>Independent AP approval</h3>
          <select id="governed-decision"><option value="approve">Approve</option><option value="reject">Reject</option></select>
          <input id="governed-attestation" placeholder="Specific attestation">
          <button id="governed-approve" class="btn btn-primary">Record review</button>`;
        detail.append(approval);
        approval.querySelector('#governed-approve').addEventListener('click', () => write(`/${id}/approvals`, {
          decision: approval.querySelector('#governed-decision').value,
          attestation: approval.querySelector('#governed-attestation').value,
        }));
      }
      const transitions = {
        ingested: ['rejected'], extracted: ['validated', 'exception', 'rejected'],
        validated: ['exception', 'rejected'], matched: ['approval_pending', 'exception'],
        exception: ['validated', 'rejected'], approval_pending: ['approved', 'rejected'],
        approved: ['posting_pending', 'rejected'],
      }[item.status] || [];
      if (transitions.length) {
        const controls = governedElement('section');
        controls.innerHTML = `<h3>State transition</h3>
          <select id="governed-next">${transitions.map(value => `<option value="${value}">${value}</option>`).join('')}</select>
          <input id="governed-posting-key" placeholder="ERP posting idempotency key (only for posting)">
          <button id="governed-transition" class="btn btn-secondary">Request transition</button>`;
        detail.append(controls);
        controls.querySelector('#governed-transition').addEventListener('click', () => write(`/${id}/transition`, {
          nextStatus: controls.querySelector('#governed-next').value,
          postingIdempotencyKey: controls.querySelector('#governed-posting-key').value || undefined,
        }, { 'If-Match': String(item.revision) }));
      }
      const timeline = governedElement('ul');
      (record.events || []).forEach(event => timeline.append(governedElement('li',
        `${event.occurred_at} · ${event.event_type} · ${event.from_status || 'start'} → ${event.to_status || item.status}`)));
      detail.append(governedElement('h3', 'Workflow history'), timeline);
    } catch (error) { detail.replaceChildren(governedElement('p', error.message)); }
  }
  content.querySelector('#governed-refresh').addEventListener('click', loadList);
  content.querySelector('#governed-upload-form').addEventListener('submit', async event => {
    event.preventDefault();
    const result = await uploadWrite('/ingest-upload', new FormData(event.target), { 'Idempotency-Key': crypto.randomUUID() });
    if (result?.invoiceCase?.id) { governedSelectedId = result.invoiceCase.id; await loadList(); }
  });
  content.querySelector('#governed-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hex = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const form = content.querySelector('#governed-ingest-form');
    form.elements.contentDigest.value = hex;
    form.elements.mediaType.value = file.type || 'application/octet-stream';
    form.elements.byteSize.value = file.size;
  });
  content.querySelector('#governed-ingest-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const body = Object.fromEntries(new FormData(form).entries());
    delete body.file;
    const result = await write('/ingest', body, { 'Idempotency-Key': crypto.randomUUID() });
    if (result?.invoiceCase?.id) { governedSelectedId = result.invoiceCase.id; await loadList(); }
  });
  await loadList();
}
