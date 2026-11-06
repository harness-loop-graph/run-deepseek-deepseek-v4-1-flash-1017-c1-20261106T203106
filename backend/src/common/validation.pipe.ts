import {
  ArgumentMetadata,
  Injectable,
  PipeTransform,
  ValidationPipe,
} from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { ApiError } from './errors';

function collectMessages(errors: ValidationError[], parent = ''): string[] {
  const messages: string[] = [];
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      for (const constraint of Object.values(error.constraints)) {
        messages.push(`${path}: ${constraint}`);
      }
    }
    if (error.children && error.children.length > 0) {
      messages.push(...collectMessages(error.children, path));
    }
  }
  return messages;
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    forbidUnknownValues: false,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors: ValidationError[]) => {
      const messages = collectMessages(errors);
      return new ApiError(
        'VALIDATION_ERROR',
        messages.length > 0
          ? `Invalid request payload: ${messages.join('; ')}`
          : 'Invalid request payload',
      );
    },
  });
}

/**
 * Validates a multipart request body against a DTO class with the same
 * strictness as the global pipe, for endpoints where Nest skips class-validator
 * because the request is consumed by a file interceptor.
 */
@Injectable()
export class MultipartBodyPipe implements PipeTransform {
  async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    if (metadata.type !== 'body' || metadata.metatype === undefined) {
      return value;
    }
    return createValidationPipe().transform(value, metadata);
  }
}
