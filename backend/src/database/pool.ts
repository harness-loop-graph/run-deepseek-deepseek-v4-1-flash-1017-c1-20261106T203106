import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseConfig } from '../config';

export function createPool(config: DatabaseConfig): Pool {
  return new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.name,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'medapp-backend',
  });
}

export type DbClient = Pick<PoolClient, 'query'>;

export async function query<T extends QueryResultRow>(
  client: DbClient,
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return client.query<T>(text, params);
}

export async function withTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // rollback failure is reported by the original error
    }
    throw error;
  } finally {
    client.release();
  }
}
