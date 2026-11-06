import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsDateOnly } from '../common/is-date-only';

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9\-._~]{43,128}$/;

export class AuthorizeQueryDto {
  @IsIn(['code'])
  response_type!: string;

  @IsString()
  @IsNotEmpty()
  client_id!: string;

  @IsString()
  @IsNotEmpty()
  redirect_uri!: string;

  @IsString()
  @Matches(PKCE_CHALLENGE)
  code_challenge!: string;

  @IsIn(['S256'])
  code_challenge_method!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  state!: string;
}

export class LoginFormDto {
  @IsOptional()
  @IsString()
  request_id?: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsIn(['code'])
  response_type?: string;

  @IsOptional()
  @IsString()
  client_id?: string;

  @IsOptional()
  @IsString()
  redirect_uri?: string;

  @IsOptional()
  @IsString()
  @Matches(PKCE_CHALLENGE)
  code_challenge?: string;

  @IsOptional()
  @IsIn(['S256'])
  code_challenge_method?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  state?: string;
}

export class TokenExchangeDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  code_verifier!: string;

  @IsString()
  @IsNotEmpty()
  client_id!: string;

  @IsString()
  @IsNotEmpty()
  redirect_uri!: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refresh_token!: string;
}

export class RevokeTokenDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class AvailabilityQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  professionalId!: number;

  @IsDateOnly()
  from!: string;

  @IsDateOnly()
  to!: string;
}

export class AgendaQueryDto {
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @IsOptional()
  @IsDateOnly()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  professionalId?: number;
}

export class CreateAppointmentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  professionalId!: number;

  @IsString()
  @Matches(ISO_TIMESTAMP)
  slotStart!: string;
}

export class CreateEncounterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(10_000)
  notes!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2_000)
  diagnosis!: string;
}

export class CreateUserDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsIn(['patient', 'professional', 'staff', 'admin'], { each: true })
  roles!: string[];
}

export class UpdateRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(['patient', 'professional', 'staff', 'admin'], { each: true })
  roles!: string[];
}

export class AvailabilitySlotDto {
  @IsString()
  @Matches(ISO_TIMESTAMP)
  start!: string;

  @IsString()
  @Matches(ISO_TIMESTAMP)
  end!: string;
}

export class ReplaceAvailabilityDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  slots!: AvailabilitySlotDto[];
}

export class AuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  actor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @IsOptional()
  @IsDateOnly()
  from?: string;

  @IsOptional()
  @IsDateOnly()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
