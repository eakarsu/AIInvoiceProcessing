// === Batch 05 Gaps & Frontend Mounts ===
// Route: /api/gap-vendor-risk-monitor
// Feature: Vendor Risk Monitor
// Description: (continuous risk scoring beyond on-demand scorecard)
const express = require('express');
const router = express.Router();

// Lazy table init guard (avoids duplicate creation across mounts)
let _gapTableReady = false;
async function ensureGapTable(db) {
  if (_gapTableReady || !db) return;
  try {
    if (typeof db.query === 'function') {
      await db.query(`CREATE TABLE IF NOT EXISTS gap_features (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(255),
        input TEXT,
        output TEXT,
        meta JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
    } else if (typeof db.run === 'function') {
      db.run(`CREATE TABLE IF NOT EXISTS gap_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT, input TEXT, output TEXT, meta TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
    }
    _gapTableReady = true;
  } catch (e) {
    // table init best-effort; do not crash route
  }
}

async function callOpenRouter(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { stub: true, message: 'No OPENROUTER_API_KEY configured', echo: prompt.slice(0, 200) };
  }
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an expert assistant for: Vendor Risk Monitor. (continuous risk scoring beyond on-demand scorecard)' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 800,
      }),
    });
    if (!r.ok) {
      const txt = await r.text();
      return { error: true, status: r.status, body: txt.slice(0, 500) };
    }
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content || JSON.stringify(data);
    return { output: content, model: data?.model };
  } catch (e) {
    return { error: true, message: (e && e.message) || String(e) };
  }
}

router.post('/', async (req, res) => {
  try {
    const { input, context } = req.body || {};
    if (!input || typeof input !== 'string') {
      return res.status(400).json({ error: 'input (string) is required' });
    }
    const db = req.app && (req.app.get ? req.app.get('db') : null);
    await ensureGapTable(db);
    const prompt = `Feature: Vendor Risk Monitor\nDescription: (continuous risk scoring beyond on-demand scorecard)\nInput: ${input}\nContext: ${JSON.stringify(context || {})}`;
    const result = await callOpenRouter(prompt);
    // Best-effort persistence
    try {
      if (db && typeof db.query === 'function') {
        await db.query('INSERT INTO gap_features (slug, input, output, meta) VALUES ($1, $2, $3, $4)',
          ['vendor-risk-monitor', input, JSON.stringify(result), JSON.stringify(context || {})]);
      } else if (db && typeof db.run === 'function') {
        db.run('INSERT INTO gap_features (slug, input, output, meta) VALUES (?, ?, ?, ?)',
          ['vendor-risk-monitor', input, JSON.stringify(result), JSON.stringify(context || {})]);
      }
    } catch (_) { /* ignore persistence errors */ }
    return res.json({ feature: 'vendor-risk-monitor', title: 'Vendor Risk Monitor', result, generatedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || 'Server error' });
  }
});

router.get('/history', async (req, res) => {
  try {
    const db = req.app && (req.app.get ? req.app.get('db') : null);
    if (!db) return res.json({ slug: 'vendor-risk-monitor', items: [] });
    if (typeof db.query === 'function') {
      const r = await db.query('SELECT id, input, output, created_at FROM gap_features WHERE slug = $1 ORDER BY id DESC LIMIT 20', ['vendor-risk-monitor']);
      return res.json({ slug: 'vendor-risk-monitor', items: r.rows || [] });
    }
    return res.json({ slug: 'vendor-risk-monitor', items: [] });
  } catch (e) {
    return res.json({ slug: 'vendor-risk-monitor', items: [], error: (e && e.message) || 'Server error' });
  }
});

module.exports = router;
