/**
 * PostgreSQL connection pool
 * Singleton pattern — reuses the connection pool across hot-reloads in dev
 */
import { Pool, PoolClient } from 'pg';

declare global {
  // Prevent multiple pool instances in Next.js dev hot-reload
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

function createPool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,               // max connections in pool
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

const pool: Pool = global._pgPool ?? createPool();

if (process.env.NODE_ENV !== 'production') {
  global._pgPool = pool;
}

export default pool;

// ─── Typed query helper ────────────────────────────────────────────────────────

export async function query<T = Record<string, unknown>>(
  sql: string,
  values?: unknown[],
): Promise<T[]> {
  const result = await pool.query(sql, values);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  values?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(sql, values);
  return rows[0] ?? null;
}

// ─── Transaction helper ────────────────────────────────────────────────────────

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
