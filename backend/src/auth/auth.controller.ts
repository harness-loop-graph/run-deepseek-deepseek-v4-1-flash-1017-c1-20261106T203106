import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService, AuthorizationRequest } from './auth.service';
import {
  AuthorizeQueryDto,
  LoginFormDto,
  RefreshTokenDto,
  RevokeTokenDto,
  TokenExchangeDto,
} from './dto';
import { Public } from '../common/guards';
import {
  AuthFailureInterceptor,
  AuthRateLimitGuard,
  RateLimiter,
  clientIp,
} from '../common/rate-limit';
import { ApiError } from '../common/errors';
import { escapeHtml } from './crypto';
import { AuditService } from '../audit/audit.service';

function wantsJson(request: Request): boolean {
  const accept = request.headers.accept ?? '';
  const contentType = request.headers['content-type'] ?? '';
  return (
    accept.includes('application/json') ||
    contentType.includes('application/json')
  );
}

/**
 * The authorization request travels in the form's hidden fields: there is no
 * separate consent step (delivery contract for EP-01).
 */
function hiddenFieldsFor(authRequest: AuthorizationRequest): Record<string, string> {
  return {
    request_id: authRequest.id,
    response_type: 'code',
    client_id: authRequest.clientId,
    redirect_uri: authRequest.redirectUri,
    code_challenge: authRequest.codeChallenge,
    code_challenge_method: authRequest.codeChallengeMethod,
    state: authRequest.state,
  };
}

function renderLoginPage(
  hidden: Record<string, string>,
  errorMessage?: string,
): string {
  const errorBlock = errorMessage
    ? `<p class="error" role="alert">${escapeHtml(errorMessage)}</p>`
    : '';
  const hiddenInputs = Object.entries(hidden)
    .map(
      ([name, value]) =>
        `    <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`,
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MedApp — Sign in</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f3f6fa; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
  main { background: #fff; padding: 2rem; border-radius: 12px; box-shadow: 0 8px 30px rgba(15, 23, 42, .12); width: 22rem; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; color: #0f172a; }
  label { display: block; font-size: .85rem; margin: .75rem 0 .25rem; color: #334155; }
  input { width: 100%; box-sizing: border-box; padding: .55rem .65rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: .95rem; }
  button { margin-top: 1.25rem; width: 100%; padding: .65rem; border: 0; border-radius: 0.5rem; background: #0b5fff; color: #fff; font-size: 1rem; cursor: pointer; }
  .error { color: #b42318; background: #fef3f2; padding: .5rem .75rem; border-radius: 8px; font-size: .85rem; }
</style>
</head>
<body>
<main>
  <h1>Medical Appointments</h1>
  ${errorBlock}
  <form method="post" action="/auth/login">
${hiddenInputs}
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" required />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <button type="submit">Sign in</button>
  </form>
</main>
</body>
</html>`;
}

@Controller('auth')
@UseGuards(AuthRateLimitGuard)
@UseInterceptors(AuthFailureInterceptor)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
  ) {}

  @Public()
  @Get('authorize')
  async authorize(
    @Query() query: AuthorizeQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const authRequest = await this.authService.createAuthorizationRequest({
      responseType: query.response_type,
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
      state: query.state,
    });
    response.redirect(
      302,
      `/auth/login?request_id=${encodeURIComponent(authRequest.id)}`,
    );
  }

  @Public()
  @Get('login')
  async loginPage(
    @Query('request_id') requestId: string,
    @Res() response: Response,
  ): Promise<void> {
    if (!requestId) {
      throw new ApiError('BAD_REQUEST', 'request_id is required');
    }
    const authRequest = await this.authService.findAuthorizationRequest(requestId);
    response
      .status(200)
      .type('text/html')
      .send(renderLoginPage(hiddenFieldsFor(authRequest)));
  }

  @Public()
  @Post('login')
  async loginSubmit(
    @Body() body: LoginFormDto,
    @Res() response: Response,
    @Req() request: Request,
  ): Promise<void> {
    const jsonClient = wantsJson(request);
    const authRequest = await this.resolveAuthorizationRequest(body);
    const user = await this.authService
      .authenticate(body.email, body.password)
      .catch(() => null);
    if (!user) {
      if (jsonClient) {
        throw new ApiError('UNAUTHORIZED', 'Invalid email or password');
      }
      this.limiter.record(`auth:${clientIp(request)}`);
      response
        .status(401)
        .type('text/html')
        .send(
          renderLoginPage(
            hiddenFieldsFor(authRequest),
            'Invalid email or password',
          ),
        );
      return;
    }
    const issued = await this.authService.issueAuthorizationCode(
      authRequest.id,
      user.id,
    );
    this.limiter.reset(`auth:${clientIp(request)}`);
    await this.audit.record({
      actorId: user.id,
      action: 'auth.login',
      resourceType: 'usuario',
      resourceId: user.id,
      detail: { ip: clientIp(request) },
    });
    const target = new URL(issued.redirectUri);
    target.searchParams.set('code', issued.code);
    target.searchParams.set('state', issued.state);
    if (jsonClient) {
      response.status(200).json({ redirect_to: target.toString() });
      return;
    }
    response.redirect(302, target.toString());
  }

  private async resolveAuthorizationRequest(
    body: LoginFormDto,
  ): Promise<AuthorizationRequest> {
    if (body.request_id) {
      return this.authService.findAuthorizationRequest(body.request_id);
    }
    if (
      !body.client_id ||
      !body.redirect_uri ||
      !body.code_challenge ||
      !body.code_challenge_method ||
      !body.state
    ) {
      throw new ApiError(
        'BAD_REQUEST',
        'The authorization request fields are missing',
      );
    }
    return this.authService.createAuthorizationRequest({
      responseType: body.response_type ?? 'code',
      clientId: body.client_id,
      redirectUri: body.redirect_uri,
      codeChallenge: body.code_challenge,
      codeChallengeMethod: body.code_challenge_method,
      state: body.state,
    });
  }

  @Public()
  @Post('token')
  @HttpCode(200)
  async token(@Body() body: TokenExchangeDto) {
    return this.authService.exchangeCode({
      code: body.code,
      codeVerifier: body.code_verifier,
      clientId: body.client_id,
      redirectUri: body.redirect_uri,
    });
  }

  @Public()
  @Post('token/refresh')
  @HttpCode(200)
  async refresh(@Body() body: RefreshTokenDto) {
    return this.authService.refresh(body.refresh_token);
  }

  @Public()
  @Post('revoke')
  @HttpCode(204)
  async revoke(
    @Body() body: RevokeTokenDto,
    @Req() request: Request,
  ): Promise<void> {
    const userId = await this.authService.revoke(body.token);
    await this.audit.record({
      actorId: userId,
      action: 'auth.revoke',
      resourceType: 'usuario',
      resourceId: userId,
      detail: { ip: clientIp(request) },
    });
  }
}
