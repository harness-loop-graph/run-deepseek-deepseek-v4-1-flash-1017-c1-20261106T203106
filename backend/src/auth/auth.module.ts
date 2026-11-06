import {
  CanActivate,
  ExecutionContext,
  Global,
  Injectable,
  Module,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import {
  AuthenticatedRequest,
  AuthGuard,
  PUBLIC_KEY,
  RolesGuard,
} from '../common/guards';
import {
  AuthRateLimitGuard,
  AuthFailureInterceptor,
  BookingRateLimitGuard,
  RateLimiter,
} from '../common/rate-limit';
import { ApiError } from '../common/errors';

@Injectable()
export class BearerTokenGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return true;
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const token = header.slice('Bearer '.length).trim();
    try {
      if (token.length === 0) {
        throw new ApiError('UNAUTHORIZED', 'Bearer token is empty');
      }
      request.user = await this.authService.resolveAccessToken(token);
    } catch (error) {
      if (!isPublic) {
        throw error;
      }
    }
    return true;
  }
}

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    RateLimiter,
    AuthRateLimitGuard,
  AuthFailureInterceptor,
    BookingRateLimitGuard,
    BearerTokenGuard,
    AuthGuard,
    RolesGuard,
  ],
  exports: [
    AuthService,
    RateLimiter,
    AuthRateLimitGuard,
  AuthFailureInterceptor,
    BookingRateLimitGuard,
    BearerTokenGuard,
    AuthGuard,
    RolesGuard,
  ],
})
export class AuthModule {}
