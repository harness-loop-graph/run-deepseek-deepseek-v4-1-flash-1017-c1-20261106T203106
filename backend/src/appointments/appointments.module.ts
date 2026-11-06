import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AvailabilityService } from '../availability/availability.service';
import { BookingService } from './booking.service';
import { BookingStore, PgBookingStore } from './booking.store';
import { EncountersModule } from '../encounters/encounters.module';

@Module({
  imports: [EncountersModule],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsService,
    AvailabilityService,
    BookingService,
    { provide: BookingStore, useClass: PgBookingStore },
  ],
  exports: [AppointmentsService, AvailabilityService, BookingService],
})
export class AppointmentsModule {}
