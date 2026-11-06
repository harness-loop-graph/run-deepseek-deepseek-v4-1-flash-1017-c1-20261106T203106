import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiError, ErrorCode, ErrorEnvelope, envelopeForCode } from './errors';

interface MulterErrorLike {
  name: string;
  code?: string;
  message?: string;
}

function isMulterError(exception: unknown): exception is MulterErrorLike {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    'name' in exception &&
    (exception as { name: string }).name === 'MulterError'
  );
}

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'BAD_REQUEST',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, envelope } = this.resolve(exception);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} ${envelope.error.code}`,
        exception instanceof Error
          ? `${exception.name}: ${exception.message}`
          : 'unknown error',
      );
    }

    if (response.headersSent) {
      return;
    }
    response.status(status).json(envelope);
  }

  private resolve(exception: unknown): {
    status: number;
    envelope: ErrorEnvelope;
  } {
    if (exception instanceof ApiError) {
      return {
        status: exception.getStatus(),
        envelope: exception.toEnvelope(),
      };
    }

    if (isMulterError(exception)) {
      if (exception.code === 'LIMIT_FILE_SIZE') {
        return {
          status: HttpStatus.PAYLOAD_TOO_LARGE,
          envelope: envelopeForCode(
            'PAYLOAD_TOO_LARGE',
            'The uploaded file exceeds the allowed size',
          ),
        };
      }
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        envelope: envelopeForCode(
          'VALIDATION_ERROR',
          'The uploaded file is invalid',
        ),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = STATUS_TO_CODE[status] ?? 'INTERNAL_ERROR';
      const message = this.safeMessage(exception, code);
      return { status, envelope: { error: { code, message } } };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      envelope: envelopeForCode('INTERNAL_ERROR'),
    };
  }

  private safeMessage(exception: HttpException, code: ErrorCode): string {
    const payload = exception.getResponse();
    if (typeof payload === 'string') {
      return this.scrub(payload, code);
    }
    if (typeof payload === 'object' && payload !== null) {
      const record = payload as Record<string, unknown>;
      const rawMessage = record.message;
      if (Array.isArray(rawMessage)) {
        const joined = rawMessage
          .filter((item): item is string => typeof item === 'string')
          .join('; ');
        return this.scrub(joined, code);
      }
      if (typeof rawMessage === 'string') {
        return this.scrub(rawMessage, code);
      }
    }
    return envelopeForCode(code).error.message;
  }

  private scrub(message: string, code: ErrorCode): string {
    if (!message) {
      return envelopeForCode(code).error.message;
    }
    const leaksPath = /(?:[A-Za-z]:\\|\/(?:app|home|usr|var|tmp|opt|root)\/)/.test(
      message,
    );
    const leaksSql = /\b(select|insert|update|delete|pg_|relation)\b/i.test(
      message,
    );
    const leaksStack = /\bat\s+\S+\s+\(/.test(message) || message.includes('    at ');
    if (leaksPath || leaksSql || leaksStack) {
      return envelopeForCode(code).error.message;
    }
    return message;
  }
}
