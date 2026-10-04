import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const here = path.dirname(fileURLToPath(import.meta.url));

// ── Database ────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: true } : undefined,
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 30_000
});

// ── Schema ──────────────────────────────────────────────────────────────
async function initSchema() {
  for (let i = 0; i < 3; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id          BIGSERIAL PRIMARY KEY,
          provider    TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          username    TEXT NOT NULL,
          avatar_url  TEXT,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (provider, provider_id)
        );
        CREATE TABLE IF NOT EXISTS sessions (
          id         TEXT PRIMARY KEY,
          user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          username   TEXT NOT NULL,
          avatar_url TEXT,
          provider   TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS planner_state (
          user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          state      JSONB NOT NULL DEFAULT '{}',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      console.log('Schema ready');
      return;
    } catch (err) {
      console.error(`Schema init attempt ${i+1}:`, err.message);
      if (i < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }
}
initSchema();

// ── Middleware ──────────────────────────────────────────────────────────
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '1mb', strict: true }));

// ── Session helpers (DB-backed) ─────────────────────────────────────────
const COOKIE_NAME = 'medarc_sid';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

async function createSession(userId, username, avatarUrl, provider) {
  const sid = randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO sessions (id, user_id, username, avatar_url, provider)
     VALUES ($1, $2, $3, $4, $5)`,
    [sid, userId, username, avatarUrl, provider]
  );
  return sid;
}

async function getSession(sid) {
  if (!sid) return null;
  const { rows } = await pool.query(
    `SELECT user_id, username, avatar_url, provider
     FROM sessions WHERE id = $1 AND expires_at > NOW()`,
    [sid]
  );
  return rows[0] || null;
}

async function deleteSession(sid) {
  if (sid) await pool.query('DELETE FROM sessions WHERE id = $1', [sid]);
}

function getSid(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

function setCookie(res, sid) {
  const isProduction = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${isProduction ? '; Secure' : ''}`
  );
}

function clearCookie(res) {
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  );
}

// ── Auth middleware ─────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const sid = getSid(req);
  const session = await getSession(sid).catch(() => null);
  if (!session) return res.status(401).json({ error: 'Not authenticated', loginUrl: '/login' });
  req.sessionData = session;
  next();
}

// ── Config ──────────────────────────────────────────────────────────────
const APP_URL              = process.env.APP_URL || `http://localhost:${port}`;
const GITHUB_CLIENT_ID     = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// ── DB user helper ──────────────────────────────────────────────────────
async function upsertUser(provider, providerId, username, avatarUrl) {
  const { rows } = await pool.query(`
    INSERT INTO users (provider, provider_id, username, avatar_url)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (provider, provider_id) DO UPDATE
      SET username = EXCLUDED.username, avatar_url = EXCLUDED.avatar_url
    RETURNING id
  `, [provider, providerId, username, avatarUrl]);
  const userId = rows[0].id;
  await pool.query(
    `INSERT INTO planner_state (user_id, state) VALUES ($1, '{}') ON CONFLICT DO NOTHING`,
    [userId]
  );
  return userId;
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

// ── Debug ───────────────────────────────────────────────────────────────
app.get('/debug', async (req, res) => {
  const sid = getSid(req);
  const session = await getSession(sid).catch(() => null);
  res.json({
    path: req.path,
    APP_URL,
    GITHUB_CLIENT_ID_SET: !!GITHUB_CLIENT_ID,
    GOOGLE_CLIENT_ID_SET: !!GOOGLE_CLIENT_ID,
    NODE_ENV: process.env.NODE_ENV,
    sid_present: !!sid,
    session_valid: !!session,
    session_user: session?.username || null
  });
});

// ── Auth: current user ──────────────────────────────────────────────────
app.get('/auth/me', async (req, res) => {
  const sid = getSid(req);
  const session = await getSession(sid).catch(() => null);
  if (!session) return res.json({ user: null });
  res.json({ user: {
    id:        session.user_id,
    username:  session.username,
    avatarUrl: session.avatar_url,
    provider:  session.provider
  }});
});

// ── Auth: logout ────────────────────────────────────────────────────────
app.post('/auth/logout', async (req, res) => {
  const sid = getSid(req);
  await deleteSession(sid).catch(() => {});
  clearCookie(res);
  res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════════════
// GITHUB OAUTH
// ════════════════════════════════════════════════════════════════════════
app.get('/auth/github', (req, res) => {
  if (!GITHUB_CLIENT_ID) return res.status(500).json({ error: 'GITHUB_CLIENT_ID not configured' });
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${APP_URL}/auth/github/callback`,
    scope: 'read:user',
    allow_signup: 'true'
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

app.get('/auth/github/callback', async (req, res) => {
  const { code, error } = req.query;
  console.log('GitHub callback: code=', !!code, 'error=', error);
  if (error || !code) return res.redirect('/login?auth=error');
  try {
    // Exchange code for token
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${APP_URL}/auth/github/callback`
      })
    });
    const tokenData = await tokenRes.json();
    console.log('GitHub token:', tokenData.error || (tokenData.access_token ? 'OK' : 'missing'));
    if (!tokenData.access_token) return res.redirect('/login?auth=error');

    // Get user profile
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'MED-ARC-App'
      }
    });
    const ghUser = await userRes.json();
    console.log('GitHub user:', ghUser.login || 'missing');
    if (!ghUser.id) return res.redirect('/login?auth=error');

    // Save to DB and create session
    const userId = await upsertUser('github', String(ghUser.id), ghUser.login, ghUser.avatar_url);
    const sid = await createSession(userId, ghUser.login, ghUser.avatar_url, 'github');
    setCookie(res, sid);
    console.log('GitHub session created, redirecting to /');
    res.redirect('/?auth=success');
  } catch (err) {
    console.error('GitHub OAuth error:', err.message);
    res.redirect('/login?auth=error');
  }
});

// ════════════════════════════════════════════════════════════════════════
// GOOGLE OAUTH
// ════════════════════════════════════════════════════════════════════════
app.get('/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID not configured' });
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${APP_URL}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid profile',
    access_type: 'online'
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  console.log('Google callback: code=', !!code, 'error=', error);
  if (error || !code) return res.redirect('/login?auth=error');
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${APP_URL}/auth/google/callback`,
        grant_type: 'authorization_code'
      })
    });
    const tokenData = await tokenRes.json();
    console.log('Google token:', tokenData.error || (tokenData.access_token ? 'OK' : 'missing'));
    if (!tokenData.access_token) return res.redirect('/login?auth=error');

    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const gUser = await userRes.json();
    console.log('Google user:', gUser.name || 'missing');
    if (!gUser.id) return res.redirect('/login?auth=error');

    const userId = await upsertUser('google', gUser.id, gUser.name || gUser.email, gUser.picture);
    const sid = await createSession(userId, gUser.name || gUser.email, gUser.picture, 'google');
    setCookie(res, sid);
    console.log('Google session created, redirecting to /');
    res.redirect('/?auth=success');
  } catch (err) {
    console.error('Google OAuth error:', err.message);
    res.redirect('/login?auth=error');
  }
});

// ── API: GET state ──────────────────────────────────────────────────────
app.get('/api/state', requireAuth, async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const { rows } = await pool.query(
      'SELECT state FROM planner_state WHERE user_id = $1',
      [req.sessionData.user_id]
    );
    res.json({ state: rows[0]?.state ?? {} });
  } catch (err) { next(err); }
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
      INSERT INTO planner_state (user_id, state, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (user_id) DO UPDATE SET state = EXCLUDED.state, updated_at = NOW()
    `, [req.sessionData.user_id, JSON.stringify(state)]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Static files ────────────────────────────────────────────────────────
const staticFiles = {
  '/manifest.webmanifest': { file: 'manifest.webmanifest', type: 'application/manifest+json; charset=utf-8' },
  '/med-arc-icon.svg':     { file: 'med-arc-icon.svg',     type: 'image/svg+xml' },
};
for (const [route, { file, type }] of Object.entries(staticFiles)) {
  app.get(route, (_req, res) => {
    if (process.env.NODE_ENV === 'production') res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Type', type);
    res.sendFile(path.join(here, file), err => {
      if (err) res.status(404).json({ error: 'Not found' });
    });
  });
}

app.get('/service-worker.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(here, 'service-worker.js'), err => {
    if (err) res.status(200).send('// service worker not available');
  });
});

app.get(['/', '/index.html'], (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(here, 'index.html'));
});

app.get('/login', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(here, 'login.html'));
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Planner data is too large.' });
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Request body must be valid JSON.' });
  console.error('Request failed:', error.message);
  res.status(500).json({ error: 'The planner could not complete that request.' });
});

if (!process.env.VERCEL) {
  app.listen(port, '0.0.0.0', () => console.log(`MED ARC listening on http://localhost:${port}`));
}

process.on('SIGTERM', async () => { await pool.end(); process.exit(0); });

export default app;
