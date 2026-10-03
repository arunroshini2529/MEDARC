import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const here = path.dirname(fileURLToPath(import.meta.url));
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon requires SSL — always enable for cloud connections
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: true } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '1mb', strict: true }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'unavailable', database: 'disconnected' });
  }
});

app.get('/api/state', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (token && uuidRegex.test(token)) {
      const { rows } = await pool.query('SELECT state FROM planner_state WHERE token = $1', [token]);
      return res.json({ state: rows[0]?.state ?? {}, token });
    }

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

app.put('/api/state', async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
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

const publicFiles = new Set(['/', '/index.html', '/manifest.webmanifest', '/med-arc-icon.svg', '/service-worker.js']);
app.use((req, res, next) => {
  if (req.method === 'GET' && !publicFiles.has(req.path)) return res.sendStatus(404);
  next();
});

app.use(express.static(here, {
  index: 'index.html',
  dotfiles: 'ignore',
  etag: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    if (filePath.endsWith('service-worker.js')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Planner data is too large.' });
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Request body must be valid JSON.' });
  console.error('Request failed:', error.message);
  res.status(500).json({ error: 'The planner could not complete that request.' });
});

async function start() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS planner_state (
      token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  app.listen(port, '0.0.0.0', () => console.log(`MED ARC is listening on port ${port}`));
}

// Only auto-start when run directly (not on Vercel serverless)
if (process.env.VERCEL !== '1') {
  start().catch(error => {
    console.error('Could not start MED ARC. Check DATABASE_URL and database availability.', error.message);
    process.exit(1);
  });
} else {
  // Vercel cold start: ensure schema exists (non-fatal if table already exists)
  pool.query(`
    CREATE TABLE IF NOT EXISTS planner_state (
      token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
}

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});

// Export for Vercel serverless
export default app;
