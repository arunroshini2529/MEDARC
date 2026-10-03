import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
const { rows } = await pool.query(`SELECT token, updated_at, jsonb_array_length(state->'tasks') AS task_count FROM planner_state ORDER BY updated_at DESC LIMIT 5`);
console.log('Rows in Neon:', rows.length);
rows.forEach(r => console.log(' token:', r.token, '| updated:', r.updated_at, '| tasks:', r.task_count));
await pool.end();
