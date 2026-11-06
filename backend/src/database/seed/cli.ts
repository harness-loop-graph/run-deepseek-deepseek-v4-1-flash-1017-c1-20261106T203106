import { loadConfig } from '../../config';
import { createPool } from '../pool';
import { runSeed } from './index';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.database);
  try {
    await runSeed(pool, config.seedPassword);
    process.stdout.write('Seed applied\n');
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Seed failure: ${error instanceof Error ? error.message : 'unknown'}\n`,
  );
  process.exitCode = 1;
});
