import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

try {
  const res = await pool.query('SELECT version()');
  console.log('✅ Connected to Neon!');
  console.log('   PostgreSQL:', res.rows[0].version.split(' ').slice(0, 2).join(' '));

  // Create table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS planner_state (
      token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('✅ Table planner_state ready');

  // Quick insert/read test
  const { rows } = await pool.query('SELECT gen_random_uuid() AS token');
  const testToken = rows[0].token;
  await pool.query(
    'INSERT INTO planner_state (token, state) VALUES ($1, $2::jsonb)',
    [testToken, JSON.stringify({ test: true, tasks: [], subjects: [], checklist: [], sessions: [], notes: [] })]
  );
  console.log('✅ Test insert OK, token:', testToken);

  const { rows: readRows } = await pool.query('SELECT state FROM planner_state WHERE token = $1', [testToken]);
  console.log('✅ Test read OK, state.test =', readRows[0].state.test);

  // Clean up test row
  await pool.query('DELETE FROM planner_state WHERE token = $1', [testToken]);
  console.log('✅ Test cleanup done');

  await pool.end();
  console.log('\n🎉 Neon database is fully operational!');
} catch (err) {
  console.error('❌ Error:', err.message);
  process.exit(1);
}
