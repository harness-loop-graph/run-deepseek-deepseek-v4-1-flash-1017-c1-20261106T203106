import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AvailabilityService } from '../availability/availability.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, AvailabilityService],
})
export class AdminModule {}
