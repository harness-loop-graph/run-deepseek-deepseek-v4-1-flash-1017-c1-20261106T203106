import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AvailabilityService } from '../availability/availability.service';
import { BookingService } from './booking.service';
import { EncountersService } from '../encounters/encounters.service';
import {
  AgendaQueryDto,
  AvailabilityQueryDto,
  CreateAppointmentDto,
  CreateEncounterDto,
} from '../auth/dto';
import { AuthenticatedRequest, Roles } from '../common/guards';
import { BookingRateLimitGuard } from '../common/rate-limit';
import { AuthenticatedUser } from '../common/authorization';

function actor(request: AuthenticatedRequest): AuthenticatedUser {
  return request.user as AuthenticatedUser;
}

@Controller()
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly availabilityService: AvailabilityService,
    private readonly bookingService: BookingService,
    private readonly encounters: EncountersService,
  ) {}

  @Roles('patient')
  @Get('me/appointments')
  async myAppointments(@Req() request: AuthenticatedRequest) {
    return this.appointments.listOwnAppointments(actor(request));
  }

  @Roles('patient', 'staff')
  @Get('availability')
  async availability(
    @Req() request: AuthenticatedRequest,
    @Query() query: AvailabilityQueryDto,
  ) {
    return this.availabilityService.freeSlots(actor(request), query);
  }

  @Roles('patient', 'staff')
  @Get('professionals')
  async professionals() {
    return this.availabilityService.listProfessionals();
  }

  @Roles('patient')
  @UseGuards(BookingRateLimitGuard)
  @Post('appointments')
  async create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateAppointmentDto,
  ) {
    return this.bookingService.book(actor(request), {
      professionalId: body.professionalId,
      slotStart: body.slotStart,
    });
  }

  @Roles('patient')
  @Delete('appointments/:id')
  @HttpCode(204)
  async cancel(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.appointments.cancel(actor(request), id);
  }

  @Roles('professional', 'staff')
  @Get('agenda')
  async agenda(
    @Req() request: AuthenticatedRequest,
    @Query() query: AgendaQueryDto,
  ) {
    return this.appointments.agenda(actor(request), {
      from: query.from,
      to: query.to,
      professionalId: query.professionalId,
    });
  }

  @Roles('patient', 'professional', 'staff')
  @Get('appointments/:id')
  async detail(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.appointments.getAppointmentDetail(actor(request), id);
  }

  @Roles('professional')
  @Post('appointments/:id/encounter')
  async recordEncounter(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CreateEncounterDto,
  ) {
    return this.encounters.recordEncounter(actor(request), id, {
      notes: body.notes,
      diagnosis: body.diagnosis,
    });
  }

  @Roles('patient', 'professional')
  @Get('patients/:id/clinical-history')
  async clinicalHistory(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.encounters.clinicalHistory(actor(request), id);
  }

  @Roles('professional')
  @Get('me/patients')
  async assignedPatients(@Req() request: AuthenticatedRequest) {
    return this.encounters.assignedPatients(actor(request));
  }
}
