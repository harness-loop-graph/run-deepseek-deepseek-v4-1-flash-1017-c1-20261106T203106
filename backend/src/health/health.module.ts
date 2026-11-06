import { Controller, Get, Inject, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../config';
import { Public } from '../common/guards';

@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Public()
  @Get()
  async check(): Promise<{ status: string; database: string; timestamp: string }> {
    let database = 'ok';
    try {
      await this.pool.query('SELECT 1');
    } catch {
      database = 'unavailable';
    }
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
