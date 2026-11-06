import { HttpException } from '@nestjs/common';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'The request payload is invalid',
  UNAUTHORIZED: 'Authentication is required',
  FORBIDDEN: 'You are not allowed to perform this operation',
  NOT_FOUND: 'The requested resource does not exist',
  CONFLICT: 'The request conflicts with the current state',
  PAYLOAD_TOO_LARGE: 'The uploaded file exceeds the allowed size',
  UNSUPPORTED_MEDIA_TYPE: 'The uploaded file type is not allowed',
  RATE_LIMITED: 'Too many requests',
  BAD_REQUEST: 'The request could not be processed',
  INTERNAL_ERROR: 'An unexpected error occurred',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable',
};

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  BAD_REQUEST: 400,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
  };
}

export class ApiError extends HttpException {
  public readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string, status?: number) {
    const resolvedMessage = message ?? DEFAULT_MESSAGES[code];
    super(
      { error: { code, message: resolvedMessage } },
      status ?? STATUS_BY_CODE[code],
    );
    this.code = code;
  }

  toEnvelope(): ErrorEnvelope {
    return { error: { code: this.code, message: this.getMessage() } };
  }

  private getMessage(): string {
    const response = this.getResponse();
    if (
      typeof response === 'object' &&
      response !== null &&
      'error' in response
    ) {
      const envelope = response as ErrorEnvelope;
      return envelope.error.message;
    }
    return DEFAULT_MESSAGES[this.code];
  }
}

export function envelopeForCode(
  code: ErrorCode,
  message?: string,
): ErrorEnvelope {
  return { error: { code, message: message ?? DEFAULT_MESSAGES[code] } };
}
