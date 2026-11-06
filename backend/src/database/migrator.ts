import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { migrations } from './migrations';

const logger = new Logger('Migrations');

async function ensureMigrationTable(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id text PRIMARY KEY,
       name text NOT NULL,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
}

export async function runMigrationsUp(pool: Pool): Promise<void> {
  await ensureMigrationTable(pool);
  const applied = await pool.query<{ id: string }>(
    'SELECT id FROM schema_migrations',
  );
  const appliedIds = new Set(applied.rows.map((row) => row.id));

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) {
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const statement of migration.up) {
        await client.query(statement);
      }
      await client.query(
        'INSERT INTO schema_migrations (id, name) VALUES ($1, $2)',
        [migration.id, migration.name],
      );
      await client.query('COMMIT');
      logger.log(`Applied migration ${migration.id}_${migration.name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function runMigrationsDown(
  pool: Pool,
  steps = 1,
): Promise<string[]> {
  await ensureMigrationTable(pool);
  const applied = await pool.query<{ id: string; name: string }>(
    'SELECT id, name FROM schema_migrations ORDER BY id DESC LIMIT $1',
    [steps],
  );
  const reverted: string[] = [];
  for (const row of applied.rows) {
    const migration = migrations.find((item) => item.id === row.id);
    if (!migration) {
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const statement of migration.down) {
        await client.query(statement);
      }
      await client.query('DELETE FROM schema_migrations WHERE id = $1', [
        migration.id,
      ]);
      await client.query('COMMIT');
      reverted.push(`${migration.id}_${migration.name}`);
      logger.log(`Reverted migration ${migration.id}_${migration.name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return reverted;
}
