// PostgreSQL access and migrations.
import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createDb(url) {
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL || 10) });
  const db = {
    pool,
    query: (text, params) => pool.query(text, params),
    one: async (text, params) => (await pool.query(text, params)).rows[0] || null,
    all: async (text, params) => (await pool.query(text, params)).rows,
    // Run fn(client) in a transaction.
    async tx(fn) {
      const c = await pool.connect();
      try { await c.query('BEGIN'); const r = await fn({ query: (t, p) => c.query(t, p), one: async (t, p) => (await c.query(t, p)).rows[0] || null }); await c.query('COMMIT'); return r; }
      catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
      finally { c.release(); }
    },
    close: () => pool.end(),
  };
  return db;
}

export async function migrate(db) {
  // One connection for the whole run: the advisory lock (only one server migrates at a time) belongs to it.
  const c = await db.pool.connect();
  try {
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    await c.query('SELECT pg_advisory_lock(84848)');
    try {
      const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
      const dir = path.join(here, '..', 'migrations');
      for (const f of (await fs.readdir(dir)).filter((x) => x.endsWith('.sql')).sort()) {
        if (done.has(f)) continue;
        const sql = await fs.readFile(path.join(dir, f), 'utf8');
        try {
          await c.query('BEGIN'); await c.query(sql); await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]); await c.query('COMMIT');
        } catch (e) { await c.query('ROLLBACK'); throw e; }
        console.log(`migrated ${f}`);
      }
    } finally { await c.query('SELECT pg_advisory_unlock(84848)'); }
  } finally { c.release(); }
}
