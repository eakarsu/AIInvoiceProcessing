// Auto-generated feature route: email-ingest-agent
// Domain: AP automation specialist — Capability: extracting invoice data from email attachments and returning confidence score
// Mounted under: /api/email-ingest
const express = require('express');
const https = require('https');
const router = express.Router();



async function callLLM(systemPrompt, userPrompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'OPENROUTER_API_KEY not configured. TODO: configure credentials.' };
  }
  return new Promise((resolve) => {
    const data = JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3-5-sonnet-20241022',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 1500,
      temperature: 0.4
    });
    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Invoice Processing'
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) return resolve({ success: false, error: parsed.error.message || 'AI error' });
          const content = parsed.choices?.[0]?.message?.content || '';
          resolve({ success: true, content, usage: parsed.usage });
        } catch (e) {
          resolve({ success: false, error: 'Failed to parse AI response' });
        }
      });
    });
    req.on('error', (e) => resolve({ success: false, error: e.message }));
    req.write(data);
    req.end();
  });
}


// In-memory store (v0 scaffold). TODO: replace with persistent storage.
const store = [];

// POST /api/email-ingest/run — execute the feature
router.post('/run', async (req, res) => {
  try {
    const payload = req.body || {};
    const systemPrompt = 'You are a AP automation specialist. Your task is extracting invoice data from email attachments and returning confidence score. Respond with concise JSON: { "summary": string, "recommendations": string[], "next_actions": string[], "confidence": number }.';
    const userPrompt = `Context payload: ${JSON.stringify(payload).slice(0, 4000)}`;
    const result = await callLLM(systemPrompt, userPrompt);
    if (!result.success) return res.status(503).json({ error: result.error });
    let parsed = null;
    try {
      const stripped = (result.content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      parsed = JSON.parse(stripped);
    } catch (e) {
      parsed = { raw: result.content };
    }
    const record = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      slug: 'email-ingest-agent',
      input: payload,
      output: parsed,
      created_at: new Date().toISOString(),
      user_id: req.user?.id || req.user?.userId || null,
    };
    store.push(record);
    if (store.length > 200) store.shift();
    res.json({ ok: true, result: parsed, id: record.id, usage: result.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/email-ingest/history — recent runs
router.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
  res.json({ items: store.slice(-limit).reverse() });
});

// GET /api/email-ingest/:id — fetch one
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = store.find((r) => r.id === id);
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json(item);
});

// DELETE /api/email-ingest/:id — discard a run
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const idx = store.findIndex((r) => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  store.splice(idx, 1);
  res.json({ ok: true });
});

module.exports = router;
