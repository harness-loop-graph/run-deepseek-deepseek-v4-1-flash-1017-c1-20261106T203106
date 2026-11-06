import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig, PG_POOL, loadConfig } from '../config';
import { createPool } from './pool';
import { runMigrationsUp } from './migrator';
import { runSeed } from './seed/index';

@Injectable()
export class DatabaseBootstrap implements OnApplicationShutdown {
  private readonly logger = new Logger('DatabaseBootstrap');

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async start(config: AppConfig): Promise<void> {
    await this.waitForDatabase();
    await runMigrationsUp(this.pool);
    await runSeed(this.pool, config.seedPassword);
    this.logger.log('Database migrated and seeded');
  }

  private async waitForDatabase(): Promise<void> {
    const attempts = 30;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.pool.query('SELECT 1');
        return;
      } catch (error) {
        if (attempt === attempts) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: loadConfig,
    },
    {
      provide: PG_POOL,
      useFactory: (config: AppConfig) => createPool(config.database),
      inject: [APP_CONFIG],
    },
    DatabaseBootstrap,
  ],
  exports: [APP_CONFIG, PG_POOL, DatabaseBootstrap],
})
export class DatabaseModule {}
