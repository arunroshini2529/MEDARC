import 'dotenv/config';
import express from 'express';
import cookieSession from 'cookie-session';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const here = path.dirname(fileURLToPath(import.meta.url));

// ── Database ────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: true } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

// Ensure schema on every cold start
pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    github_id    BIGINT PRIMARY KEY,
    username     TEXT NOT NULL,
    avatar_url   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS planner_state (
    github_id    BIGINT PRIMARY KEY REFERENCES users(github_id) ON DELETE CASCADE,
    state        JSONB NOT NULL DEFAULT '{}',
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).catch(err => console.error('Schema init error:', err.message));

// ── Middleware ──────────────────────────────────────────────────────────
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '1mb', strict: true }));
app.use(cookieSession({
  name: 'medarc_session',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  httpOnly: true
}));

// ── GitHub OAuth config ─────────────────────────────────────────────────
const GITHUB_CLIENT_ID     = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const APP_URL = process.env.APP_URL || `http://localhost:${port}`;

// ── Auth middleware ─────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session?.githubId) {
    return res.status(401).json({ error: 'Not authenticated', loginUrl: '/auth/login' });
  }
  next();
}

// ── Health ──────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch {
    res.status(503).json({ status: 'unavailable', database: 'disconnected' });
  }
});

// ── Auth: start GitHub OAuth flow ───────────────────────────────────────
app.get('/auth/login', (req, res) => {
  if (!GITHUB_CLIENT_ID) {
    return res.status(500).json({ error: 'GITHUB_CLIENT_ID not configured' });
  }
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${APP_URL}/auth/callback`,
    scope: 'read:user',
    allow_signup: 'true'
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// ── Auth: GitHub OAuth callback ─────────────────────────────────────────
app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect('/?auth=error');
  }
  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${APP_URL}/auth/callback`
      })
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error || !tokenData.access_token) {
      console.error('Token exchange failed:', tokenData);
      return res.redirect('/?auth=error');
    }

    // Get GitHub user profile
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'MED-ARC-App'
      }
    });
    const ghUser = await userRes.json();
    if (!ghUser.id) {
      return res.redirect('/?auth=error');
    }

    // Upsert user in database
    await pool.query(`
      INSERT INTO users (github_id, username, avatar_url)
      VALUES ($1, $2, $3)
      ON CONFLICT (github_id) DO UPDATE
        SET username = EXCLUDED.username,
            avatar_url = EXCLUDED.avatar_url
    `, [ghUser.id, ghUser.login, ghUser.avatar_url]);

    // Ensure planner_state row exists for this user
    await pool.query(`
      INSERT INTO planner_state (github_id, state)
      VALUES ($1, '{}')
      ON CONFLICT DO NOTHING
    `, [ghUser.id]);

    // Set session
    req.session.githubId  = ghUser.id;
    req.session.username  = ghUser.login;
    req.session.avatarUrl = ghUser.avatar_url;

    res.redirect('/?auth=success');
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.redirect('/?auth=error');
  }
});

// ── Auth: logout ────────────────────────────────────────────────────────
app.post('/auth/logout', (req, res) => {
  req.session = null;
  res.json({ success: true });
});

// ── Auth: current user ──────────────────────────────────────────────────
app.get('/auth/me', (req, res) => {
  if (!req.session?.githubId) {
    return res.json({ user: null });
  }
  res.json({
    user: {
      id:        req.session.githubId,
      username:  req.session.username,
      avatarUrl: req.session.avatarUrl
    }
  });
});

// ── API: GET state ──────────────────────────────────────────────────────
app.get('/api/state', requireAuth, async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const { rows } = await pool.query(
      'SELECT state FROM planner_state WHERE github_id = $1',
      [req.session.githubId]
    );
    res.json({ state: rows[0]?.state ?? {} });
  } catch (err) {
    next(err);
  }
});

// ── API: PUT state ──────────────────────────────────────────────────────
app.put('/api/state', requireAuth, async (req, res, next) => {
  const state = req.body?.state;
  const arrays = ['subjects', 'tasks', 'checklist', 'sessions', 'notes'];
  if (!state || typeof state !== 'object' || Array.isArray(state) || arrays.some(k => !Array.isArray(state[k]))) {
    return res.status(400).json({ error: 'Planner data is incomplete or invalid.' });
  }
  if (state.subjects.length > 100 || state.tasks.length > 5000 || state.notes.length > 2000 || state.sessions.length > 10000) {
    return res.status(413).json({ error: 'Planner data exceeds the allowed size.' });
  }
  try {
    await pool.query(`
      INSERT INTO planner_state (github_id, state, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (github_id) DO UPDATE
        SET state = EXCLUDED.state, updated_at = NOW()
    `, [req.session.githubId, JSON.stringify(state)]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── Static files ────────────────────────────────────────────────────────
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

app.get(['/', '/index.html'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(here, 'index.html'));
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ───────────────────────────────────────────────────────
app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Planner data is too large.' });
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Request body must be valid JSON.' });
  console.error('Request failed:', error.message);
  res.status(500).json({ error: 'The planner could not complete that request.' });
});

// ── Start locally ───────────────────────────────────────────────────────
if (!process.env.VERCEL) {
  app.listen(port, '0.0.0.0', () => console.log(`MED ARC listening on http://localhost:${port}`));
}

process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });

export default app;
