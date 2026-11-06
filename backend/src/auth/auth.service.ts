import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { APP_CONFIG, AppConfig, PG_POOL } from '../config';
import { AuthenticatedUser, Role, isRole } from '../common/authorization';
import { ApiError } from '../common/errors';
import { query } from '../database/pool';
import {
  newId,
  randomToken,
  sha256Hex,
  verifyPkce,
} from './crypto';

export interface AuthorizationRequest {
  id: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_expires_in: number;
  user: UserProfile;
}

export interface UserProfile {
  id: number;
  email: string;
  roles: string[];
  patientId: number | null;
  professionalId: number | null;
}

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  activo: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private assertClient(clientId: string, redirectUri: string): void {
    if (clientId !== this.config.oauthClientId) {
      throw new ApiError('BAD_REQUEST', 'Unknown OAuth client');
    }
    if (redirectUri !== this.config.oauthRedirectUri) {
      throw new ApiError('BAD_REQUEST', 'Unregistered redirect_uri');
    }
  }

  async createAuthorizationRequest(input: {
    responseType: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    state: string;
  }): Promise<AuthorizationRequest> {
    if (input.responseType !== 'code') {
      throw new ApiError('BAD_REQUEST', 'Only response_type=code is supported');
    }
    this.assertClient(input.clientId, input.redirectUri);
    if (input.codeChallengeMethod !== 'S256') {
      throw new ApiError('BAD_REQUEST', 'code_challenge_method must be S256');
    }
    if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(input.codeChallenge)) {
      throw new ApiError('BAD_REQUEST', 'code_challenge is malformed');
    }
    if (input.state.length < 8 || input.state.length > 256) {
      throw new ApiError('BAD_REQUEST', 'state is malformed');
    }

    const id = newId();
    const expiresAt = new Date(
      Date.now() + this.config.authorizationRequestTtlSeconds * 1000,
    );
    await query(
      this.pool,
      `INSERT INTO auth_request
         (id, client_id, redirect_uri, code_challenge, code_challenge_method, state, expira_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        input.clientId,
        input.redirectUri,
        input.codeChallenge,
        input.codeChallengeMethod,
        input.state,
        expiresAt.toISOString(),
      ],
    );
    return {
      id,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      state: input.state,
    };
  }

  async findAuthorizationRequest(id: string): Promise<AuthorizationRequest> {
    const result = await query<{
      id: string;
      client_id: string;
      redirect_uri: string;
      code_challenge: string;
      code_challenge_method: string;
      state: string;
      expira_en: Date;
      consumido_en: Date | null;
    }>(
      this.pool,
      `SELECT id, client_id, redirect_uri, code_challenge, code_challenge_method,
              state, expira_en, consumido_en
       FROM auth_request WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError('NOT_FOUND', 'Unknown authorization request');
    }
    if (row.consumido_en !== null || row.expira_en.getTime() <= Date.now()) {
      throw new ApiError('BAD_REQUEST', 'Authorization request has expired');
    }
    return {
      id: row.id,
      clientId: row.client_id,
      redirectUri: row.redirect_uri,
      codeChallenge: row.code_challenge,
      codeChallengeMethod: row.code_challenge_method,
      state: row.state,
    };
  }

  async authenticate(email: string, password: string): Promise<UserRow> {
    const result = await query<UserRow>(
      this.pool,
      'SELECT id, email, password_hash, activo FROM usuario WHERE lower(email) = lower($1)',
      [email],
    );
    const user = result.rows[0];
    const dummyHash = '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const hash = user?.password_hash ?? dummyHash;
    const matches = await bcrypt.compare(password, hash);
    if (!user || !matches || !user.activo) {
      throw new ApiError('UNAUTHORIZED', 'Invalid email or password');
    }
    return user;
  }

  async issueAuthorizationCode(
    requestId: string,
    userId: number,
  ): Promise<{ code: string; state: string; redirectUri: string }> {
    const request = await this.findAuthorizationRequest(requestId);
    const code = randomToken(32);
    const expiresAt = new Date(
      Date.now() + this.config.authorizationCodeTtlSeconds * 1000,
    );
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const consumed = await client.query(
        `UPDATE auth_request SET consumido_en = now()
         WHERE id = $1 AND consumido_en IS NULL
         RETURNING id`,
        [request.id],
      );
      if (consumed.rowCount === 0) {
        throw new ApiError('BAD_REQUEST', 'Authorization request already used');
      }
      await client.query(
        `INSERT INTO auth_code
           (code_hash, request_id, usuario_id, redirect_uri, code_challenge, expira_en)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          sha256Hex(code),
          request.id,
          userId,
          request.redirectUri,
          request.codeChallenge,
          expiresAt.toISOString(),
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return {
      code,
      state: request.state,
      redirectUri: request.redirectUri,
    };
  }

  async exchangeCode(input: {
    code: string;
    codeVerifier: string;
    clientId: string;
    redirectUri: string;
  }): Promise<TokenPair> {
    if (input.clientId !== this.config.oauthClientId) {
      throw new ApiError('BAD_REQUEST', 'Unknown OAuth client');
    }
    const codeHash = sha256Hex(input.code);
    const result = await query<{
      id: number;
      usuario_id: number;
      redirect_uri: string;
      code_challenge: string;
      expira_en: Date;
      usado_en: Date | null;
    }>(
      this.pool,
      `SELECT id, usuario_id, redirect_uri, code_challenge, expira_en, usado_en
       FROM auth_code WHERE code_hash = $1`,
      [codeHash],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError('UNAUTHORIZED', 'Invalid authorization code');
    }
    if (row.usado_en !== null || row.expira_en.getTime() <= Date.now()) {
      throw new ApiError('UNAUTHORIZED', 'Authorization code has expired');
    }
    if (row.redirect_uri !== input.redirectUri) {
      throw new ApiError('BAD_REQUEST', 'redirect_uri does not match');
    }
    if (!verifyPkce(input.codeVerifier, row.code_challenge)) {
      throw new ApiError('BAD_REQUEST', 'Invalid code_verifier');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const consumed = await client.query(
        `UPDATE auth_code SET usado_en = now()
         WHERE id = $1 AND usado_en IS NULL RETURNING id`,
        [row.id],
      );
      if (consumed.rowCount === 0) {
        throw new ApiError('UNAUTHORIZED', 'Authorization code already used');
      }
      const pair = await this.issueTokensWith(client, row.usuario_id, newId());
      await client.query('COMMIT');
      return pair;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async issueTokensWith(
    client: { query: Pool['query'] },
    userId: number,
    sessionId: string,
  ): Promise<TokenPair> {
    const accessToken = randomToken(32);
    const refreshToken = randomToken(48);
    const now = Date.now();
    const accessExpires = new Date(now + this.config.accessTokenTtlSeconds * 1000);
    const refreshExpires = new Date(
      now + this.config.refreshTokenTtlSeconds * 1000,
    );
    await client.query(
      `INSERT INTO auth_token
         (usuario_id, sesion_id, tipo, token_hash, expira_en)
       VALUES ($1, $2, 'access', $3, $4), ($1, $2, 'refresh', $5, $6)`,
      [
        userId,
        sessionId,
        sha256Hex(accessToken),
        accessExpires.toISOString(),
        sha256Hex(refreshToken),
        refreshExpires.toISOString(),
      ],
    );
    const profile = await this.loadUser(userId);
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: this.config.accessTokenTtlSeconds,
      refresh_expires_in: this.config.refreshTokenTtlSeconds,
      user: {
        id: profile?.id ?? userId,
        email: profile?.email ?? '',
        roles: profile?.roles ?? [],
        patientId: profile?.patientId ?? null,
        professionalId: profile?.professionalId ?? null,
      },
    };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const tokenHash = sha256Hex(refreshToken);
    const result = await query<{
      id: number;
      usuario_id: number;
      sesion_id: string;
      expira_en: Date;
      revocado_en: Date | null;
    }>(
      this.pool,
      `SELECT id, usuario_id, sesion_id, expira_en, revocado_en
       FROM auth_token WHERE token_hash = $1 AND tipo = 'refresh'`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row || row.revocado_en !== null || row.expira_en.getTime() <= Date.now()) {
      throw new ApiError('UNAUTHORIZED', 'Refresh token is expired or revoked');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const revoked = await client.query(
        `UPDATE auth_token SET revocado_en = now()
         WHERE id = $1 AND revocado_en IS NULL RETURNING id`,
        [row.id],
      );
      if (revoked.rowCount === 0) {
        throw new ApiError('UNAUTHORIZED', 'Refresh token is expired or revoked');
      }
      await client.query(
        `UPDATE auth_token SET revocado_en = now()
         WHERE sesion_id = $1 AND tipo = 'access' AND revocado_en IS NULL`,
        [row.sesion_id],
      );
      const pair = await this.issueTokensWith(client, row.usuario_id, row.sesion_id);
      await client.query('COMMIT');
      return pair;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revoke(token: string): Promise<number> {
    const tokenHash = sha256Hex(token);
    const result = await query<{
      usuario_id: number;
      sesion_id: string;
      revocado_en: Date | null;
    }>(
      this.pool,
      'SELECT usuario_id, sesion_id, revocado_en FROM auth_token WHERE token_hash = $1',
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row || row.revocado_en !== null) {
      throw new ApiError('UNAUTHORIZED', 'Token is not active');
    }
    await query(
      this.pool,
      `UPDATE auth_token SET revocado_en = now()
       WHERE sesion_id = $1 AND revocado_en IS NULL`,
      [row.sesion_id],
    );
    return row.usuario_id;
  }

  async resolveAccessToken(token: string): Promise<AuthenticatedUser> {
    const tokenHash = sha256Hex(token);
    const result = await query<{
      usuario_id: number;
      expira_en: Date;
      revocado_en: Date | null;
    }>(
      this.pool,
      `SELECT usuario_id, expira_en, revocado_en
       FROM auth_token WHERE token_hash = $1 AND tipo = 'access'`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (!row || row.revocado_en !== null || row.expira_en.getTime() <= Date.now()) {
      throw new ApiError('UNAUTHORIZED', 'Access token is expired or revoked');
    }
    const user = await this.loadUser(row.usuario_id);
    if (!user) {
      throw new ApiError('UNAUTHORIZED', 'User is no longer active');
    }
    return user;
  }

  async loadUser(userId: number): Promise<AuthenticatedUser | null> {
    const userResult = await query<{ id: number; email: string; activo: boolean }>(
      this.pool,
      'SELECT id, email, activo FROM usuario WHERE id = $1',
      [userId],
    );
    const user = userResult.rows[0];
    if (!user || !user.activo) {
      return null;
    }
    const rolesResult = await query<{ nombre: string }>(
      this.pool,
      `SELECT r.nombre FROM usuario_rol ur
       JOIN rol r ON r.id = ur.rol_id
       WHERE ur.usuario_id = $1 ORDER BY r.nombre`,
      [userId],
    );
    const roles = rolesResult.rows
      .map((row) => row.nombre)
      .filter((role): role is Role => isRole(role));
    const patientResult = await query<{ id: number }>(
      this.pool,
      'SELECT id FROM paciente WHERE usuario_id = $1',
      [userId],
    );
    const professionalResult = await query<{ id: number }>(
      this.pool,
      'SELECT id FROM profesional WHERE usuario_id = $1',
      [userId],
    );
    return {
      id: user.id,
      email: user.email,
      roles,
      patientId: patientResult.rows[0]?.id ?? null,
      professionalId: professionalResult.rows[0]?.id ?? null,
    };
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }
}
