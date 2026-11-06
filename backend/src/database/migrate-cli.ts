import { loadConfig } from '../config';
import { createPool } from './pool';
import { runMigrationsDown, runMigrationsUp } from './migrator';

async function main(): Promise<void> {
  const direction = process.argv[2] ?? 'up';
  const steps = Number.parseInt(process.argv[3] ?? '1', 10);
  const pool = createPool(loadConfig().database);
  try {
    if (direction === 'up') {
      await runMigrationsUp(pool);
      process.stdout.write('Migrations applied\n');
    } else if (direction === 'down') {
      const reverted = await runMigrationsDown(pool, steps);
      process.stdout.write(`Migrations reverted: ${reverted.join(', ')}\n`);
    } else {
      process.stderr.write('Usage: migrate-cli <up|down> [steps]\n');
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Migration failure: ${error instanceof Error ? error.message : 'unknown'}\n`,
  );
  process.exitCode = 1;
});
