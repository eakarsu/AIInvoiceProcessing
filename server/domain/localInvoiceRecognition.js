'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { sourceError } = require('./invoiceSource');

const exec = promisify(execFile);
const MAX_PAGES = 5;
const MAX_TEXT = 300000;

async function run(program, args, timeout = 25000) {
  try {
    const result = await exec(program, args, { timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' });
    return result.stdout;
  } catch (error) {
    if (error.code === 'ENOENT') throw sourceError('RECOGNIZER_UNAVAILABLE', 'Local PDF/OCR tools are not installed on this host.', 503);
    if (error.killed || error.code === 'ETIMEDOUT') throw sourceError('RECOGNIZER_TIMEOUT', 'Local PDF/OCR recognition timed out.', 503);
    throw sourceError('RECOGNIZER_FAILED', 'The local PDF/OCR tool could not read this invoice.', 422);
  }
}

function parseTsv(tsv, page) {
  const rows = tsv.trim().split(/\r?\n/);
  if (!rows.length || rows[0].split('\t')[0] !== 'level') throw sourceError('OCR_INVALID', 'OCR did not return word-level evidence.', 422);
  const header = rows.shift().split('\t');
  const index = Object.fromEntries(header.map((key, i) => [key, i]));
  const lines = new Map();
  for (const row of rows) {
    const values = row.split('\t');
    if (values[index.level] !== '5') continue;
    const word = values.slice(index.text).join('\t').trim();
    const confidence = Number(values[index.conf]);
    if (!word || !Number.isFinite(confidence) || confidence < 0) continue;
    const key = [values[index.block_num], values[index.par_num], values[index.line_num]].join(':');
    const left = Number(values[index.left]); const top = Number(values[index.top]);
    const width = Number(values[index.width]); const height = Number(values[index.height]);
    if (![left, top, width, height].every(Number.isFinite)) continue;
    if (!lines.has(key)) lines.set(key, { page, words: [], confidenceTotal: 0,
      left, top, right: left + width, bottom: top + height });
    const line = lines.get(key);
    line.words.push(word); line.confidenceTotal += confidence;
    line.left = Math.min(line.left, left); line.top = Math.min(line.top, top);
    line.right = Math.max(line.right, left + width); line.bottom = Math.max(line.bottom, top + height);
  }
  return [...lines.values()].map((line, index) => ({
    page, line: index + 1, text: line.words.join(' '),
    confidence: Number((line.confidenceTotal / line.words.length / 100).toFixed(3)),
    box: { left: line.left, top: line.top, width: line.right - line.left, height: line.bottom - line.top },
  }));
}

async function recognizeImage(file, page, language) {
  const tsv = await run(process.env.INVOICE_TESSERACT_PATH || 'tesseract', [file, 'stdout', '-l', language, 'tsv']);
  const lines = parseTsv(tsv, page);
  return { text: lines.map(line => line.text).join('\n'), lines };
}

async function recognizeOriginal(bytes, mediaType, { forceOcr = false } = {}) {
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(mediaType)) {
    throw sourceError('OCR_TYPE', 'Only stored PDF, JPEG, and PNG originals can be recognized.', 422);
  }
  const language = String(process.env.INVOICE_OCR_LANGUAGE || 'eng');
  if (!/^[A-Za-z0-9_+]{1,64}$/.test(language)) throw sourceError('OCR_LANGUAGE', 'OCR language setting is invalid.', 503);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'invoice-recognition-'));
  try {
    const ext = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[mediaType];
    const source = path.join(directory, `original.${ext}`);
    await fs.writeFile(source, bytes, { mode: 0o600 });
    let text; let lines = []; let method; let pages = 1;
    if (mediaType === 'application/pdf') {
      const info = await run(process.env.INVOICE_PDFINFO_PATH || 'pdfinfo', [source], 15000);
      const match = /^Pages:\s*(\d+)\s*$/m.exec(info);
      pages = Number(match?.[1]);
      if (!Number.isInteger(pages) || pages < 1 || pages > MAX_PAGES) {
        throw sourceError('OCR_PAGE_LIMIT', `PDF invoices must have 1 to ${MAX_PAGES} pages for local recognition.`, 422);
      }
      const selectable = forceOcr ? '' : (await run(process.env.INVOICE_PDFTOTEXT_PATH || 'pdftotext',
        ['-f', '1', '-l', String(pages), '-layout', source, '-'], 20000)).replace(/\r\n?/g, '\n').trim();
      if (selectable.length >= 20) {
        text = selectable; method = 'pdf_text_layer';
      } else {
        const parts = [];
        for (let page = 1; page <= pages; page += 1) {
          const stem = path.join(directory, `page-${page}`);
          await run(process.env.INVOICE_PDFTOPPM_PATH || 'pdftoppm',
            ['-f', String(page), '-l', String(page), '-singlefile', '-scale-to', '1800', '-png', source, stem], 30000);
          const recognized = await recognizeImage(`${stem}.png`, page, language);
          parts.push(recognized.text); lines.push(...recognized.lines);
        }
        text = parts.join('\f'); method = 'tesseract_pdf_pages';
      }
    } else {
      const recognized = await recognizeImage(source, 1, language);
      text = recognized.text; lines = recognized.lines; method = 'tesseract_image';
    }
    if (!text.trim() || text.length > MAX_TEXT) throw sourceError('OCR_EMPTY', 'Recognition returned no usable invoice text within the size limit.', 422);
    const meanConfidence = lines.length ? Number((lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length).toFixed(3)) : null;
    return { text, recognition: { method, language: method === 'pdf_text_layer' ? null : language,
      pages, meanConfidence, lineBoxes: lines } };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

module.exports = { recognizeOriginal, parseTsv };
