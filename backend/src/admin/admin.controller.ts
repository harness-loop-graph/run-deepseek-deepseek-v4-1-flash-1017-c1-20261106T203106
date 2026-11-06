import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AvailabilityService } from '../availability/availability.service';
import { AuditService } from '../audit/audit.service';
import {
  AuditQueryDto,
  CreateUserDto,
  PageQueryDto,
  ReplaceAvailabilityDto,
  UpdateRolesDto,
} from '../auth/dto';
import { AuthenticatedRequest, Roles } from '../common/guards';
import { AuthenticatedUser } from '../common/authorization';
import { ApiError } from '../common/errors';

@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly availabilityService: AvailabilityService,
    private readonly audit: AuditService,
  ) {}

  @Get('users')
  async listUsers(@Query() query: PageQueryDto) {
    return this.adminService.listUsers(query.page ?? 1);
  }

  @Post('users')
  async createUser(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateUserDto,
  ) {
    return this.adminService.createUser(request.user as AuthenticatedUser, {
      email: body.email,
      roles: body.roles,
    });
  }

  @Patch('users/:id/roles')
  async updateRoles(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateRolesDto,
  ) {
    return this.adminService.updateRoles(
      request.user as AuthenticatedUser,
      id,
      body.roles,
    );
  }

  @Put('professionals/:id/availability')
  async replaceAvailability(
    @Req() request: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ReplaceAvailabilityDto,
  ) {
    const slots = await this.availabilityService.replaceAvailability(id, body.slots);
    await this.audit.record({
      actorId: (request.user as AuthenticatedUser).id,
      action: 'disponibilidad.replace',
      resourceType: 'disponibilidad',
      resourceId: id,
      detail: { slots: slots.length },
    });
    return { professionalId: id, slots };
  }

  @Get('professionals/:id/availability')
  async getAvailability(@Param('id', ParseIntPipe) id: number) {
    return {
      professionalId: id,
      slots: await this.availabilityService.availabilityOf(id),
    };
  }

  @Get('professionals')
  async professionals() {
    return this.availabilityService.listProfessionals();
  }

  @Get('audit')
  async listAudit(@Query() query: AuditQueryDto) {
    if (query.from && query.to && query.from > query.to) {
      throw new ApiError('VALIDATION_ERROR', 'from must be before or equal to to');
    }
    return this.audit.list({
      actor: query.actor,
      action: query.action,
      from: query.from,
      to: query.to,
      page: query.page ?? 1,
      pageSize: 50,
    });
  }
}
