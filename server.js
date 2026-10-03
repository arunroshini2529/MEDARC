import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const here = path.dirname(fileURLToPath(import.meta.url));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: true } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

// Ensure schema exists (runs on every cold start — safe due to IF NOT EXISTS)
pool.query(`
  CREATE TABLE IF NOT EXISTS planner_state (
    token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch(err => console.error('Schema init error:', err.message));

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '1mb', strict: true }));

// ── Health ─────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'unavailable', database: 'disconnected' });
  }
});

// ── API: GET state ─────────────────────────────────────────────────────
app.get('/api/state', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const authHeader = req.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (token && uuidRegex.test(token)) {
      const { rows } = await pool.query('SELECT state FROM planner_state WHERE token = $1', [token]);
      return res.json({ state: rows[0]?.state ?? {}, token });
    }

    // No valid token — generate one
    const { rows: uuidRows } = await pool.query('SELECT gen_random_uuid() AS token');
    const newToken = uuidRows[0].token;
    await pool.query(
      'INSERT INTO planner_state (token, state) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [newToken, '{}']
    );
    res.setHeader('X-Auth-Token', newToken);
    res.json({ state: {}, token: newToken });
  } catch (error) {
    next(error);
  }
});

// ── API: PUT state ─────────────────────────────────────────────────────
app.put('/api/state', async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!token || !uuidRegex.test(token)) {
    return res.status(401).json({ error: 'Invalid or missing token' });
  }

  const state = req.body?.state;
  const arrays = ['subjects', 'tasks', 'checklist', 'sessions', 'notes'];
  if (!state || typeof state !== 'object' || Array.isArray(state) || arrays.some(key => !Array.isArray(state[key]))) {
    return res.status(400).json({ error: 'Planner data is incomplete or invalid.' });
  }
  if (state.subjects.length > 100 || state.tasks.length > 5000 || state.notes.length > 2000 || state.sessions.length > 10000) {
    return res.status(413).json({ error: 'Planner data exceeds the allowed size.' });
  }
  try {
    await pool.query(
      `INSERT INTO planner_state (token, state, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (token) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()`,
      [token, JSON.stringify(state)]
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, token });
  } catch (error) {
    next(error);
  }
});

// ── Static files ────────────────────────────────────────────────────────
// Serve individual known static files explicitly (works on Vercel + local)
const staticFiles = {
  '/manifest.webmanifest': { file: 'manifest.webmanifest', type: 'application/manifest+json; charset=utf-8' },
  '/med-arc-icon.svg':     { file: 'med-arc-icon.svg',     type: 'image/svg+xml' },
  '/service-worker.js':    { file: 'service-worker.js',    type: 'application/javascript', noCache: true },
};

for (const [route, { file, type, noCache }] of Object.entries(staticFiles)) {
  app.get(route, (_req, res) => {
    if (noCache) res.setHeader('Cache-Control', 'no-cache');
    else if (process.env.NODE_ENV === 'production') res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Type', type);
    res.sendFile(path.join(here, file));
  });
}

// ── Serve index.html for / and /index.html ──────────────────────────────
app.get(['/', '/index.html'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(here, 'index.html'));
});

// ── 404 for everything else ─────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ───────────────────────────────────────────────────────
app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Planner data is too large.' });
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Request body must be valid JSON.' });
  console.error('Request failed:', error.message);
  res.status(500).json({ error: 'The planner could not complete that request.' });
});

// ── Start (local only — Vercel uses export default) ─────────────────────
if (!process.env.VERCEL) {
  app.listen(port, '0.0.0.0', () => console.log(`MED ARC is listening on port ${port}`));
}

process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });

export default app;
