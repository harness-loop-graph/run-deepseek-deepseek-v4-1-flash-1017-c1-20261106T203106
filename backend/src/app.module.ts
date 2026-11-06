import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { AdminModule } from './admin/admin.module';
import { HealthModule } from './health/health.module';
import { BearerTokenGuard } from './auth/auth.module';
import { AuthGuard, RolesGuard } from './common/guards';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    AuthModule,
    AppointmentsModule,
    AttachmentsModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: BearerTokenGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
