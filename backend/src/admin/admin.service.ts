import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig, PG_POOL } from '../config';
import { ApiError } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { AuthenticatedUser } from '../common/authorization';

export interface AdminUserDto {
  id: number;
  email: string;
  roles: string[];
  active: boolean;
  createdAt: string;
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly authService: AuthService,
  ) {}

  async listUsers(page: number): Promise<{
    items: AdminUserDto[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const pageSize = 20;
    const count = await this.pool.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM usuario',
    );
    const result = await this.pool.query<{
      id: number;
      email: string;
      activo: boolean;
      creado_en: Date;
      roles: string[] | null;
    }>(
      `SELECT u.id, u.email, u.activo, u.creado_en,
              array_remove(array_agg(r.nombre ORDER BY r.nombre), NULL) AS roles
       FROM usuario u
       LEFT JOIN usuario_rol ur ON ur.usuario_id = u.id
       LEFT JOIN rol r ON r.id = ur.rol_id
       GROUP BY u.id, u.email, u.activo, u.creado_en
       ORDER BY u.id DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize],
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        email: row.email,
        roles: row.roles ?? [],
        active: row.activo,
        createdAt: row.creado_en.toISOString(),
      })),
      page,
      pageSize,
      total: Number.parseInt(count.rows[0]?.total ?? '0', 10),
    };
  }

  async createUser(
    actor: AuthenticatedUser,
    input: { email: string; roles: string[] },
  ): Promise<AdminUserDto> {
    const existing = await this.pool.query(
      'SELECT 1 FROM usuario WHERE lower(email) = lower($1)',
      [input.email],
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new ApiError('CONFLICT', 'A user with that email already exists');
    }
    const passwordHash = await this.authService.hashPassword(
      this.config.seedPassword,
    );
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{
        id: number;
        email: string;
        activo: boolean;
        creado_en: Date;
      }>(
        `INSERT INTO usuario (email, password_hash, activo)
         VALUES ($1, $2, true) RETURNING id, email, activo, creado_en`,
        [input.email, passwordHash],
      );
      const user = inserted.rows[0];
      const roles = [...new Set(input.roles)];
      for (const role of roles) {
        await client.query(
          `INSERT INTO usuario_rol (usuario_id, rol_id)
           SELECT $1, id FROM rol WHERE nombre = $2`,
          [user.id, role],
        );
      }
      if (roles.includes('patient')) {
        const parts = user.email.split('@')[0].split(/[._-]/);
        await client.query(
          `INSERT INTO paciente (usuario_id, nombre, apellido)
           VALUES ($1, $2, $3)`,
          [user.id, parts[0] || 'Paciente', parts[1] || 'Nuevo'],
        );
      }
      if (roles.includes('professional')) {
        const parts = user.email.split('@')[0].split(/[._-]/);
        await client.query(
          `INSERT INTO profesional (usuario_id, nombre, apellido, especialidad)
           VALUES ($1, $2, $3, $4)`,
          [user.id, parts[0] || 'Profesional', parts[1] || 'Nuevo', 'General'],
        );
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'usuario.create',
          resourceType: 'usuario',
          resourceId: user.id,
          detail: { roles },
        },
        client,
      );
      await client.query('COMMIT');
      return {
        id: user.id,
        email: user.email,
        roles,
        active: user.activo,
        createdAt: user.creado_en.toISOString(),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateRoles(
    actor: AuthenticatedUser,
    userId: number,
    roles: string[],
  ): Promise<AdminUserDto> {
    const user = await this.pool.query<{
      id: number;
      email: string;
      activo: boolean;
      creado_en: Date;
    }>('SELECT id, email, activo, creado_en FROM usuario WHERE id = $1', [userId]);
    const row = user.rows[0];
    if (!row) {
      throw new ApiError('NOT_FOUND', 'User not found');
    }
    const unique = [...new Set(roles)];
    const known = await this.pool.query<{ nombre: string }>(
      'SELECT nombre FROM rol WHERE nombre = ANY($1::text[])',
      [unique],
    );
    if (known.rowCount !== unique.length) {
      throw new ApiError('VALIDATION_ERROR', 'Unknown role in payload');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM usuario_rol WHERE usuario_id = $1', [userId]);
      for (const role of unique) {
        await client.query(
          `INSERT INTO usuario_rol (usuario_id, rol_id)
           SELECT $1, id FROM rol WHERE nombre = $2`,
          [userId, role],
        );
      }
      if (unique.includes('patient')) {
        await client.query(
          `INSERT INTO paciente (usuario_id, nombre, apellido)
           SELECT $1, split_part(u.email, '@', 1), 'Paciente'
           FROM usuario u
           WHERE u.id = $1
             AND NOT EXISTS (SELECT 1 FROM paciente p WHERE p.usuario_id = $1)`,
          [userId],
        );
      }
      if (unique.includes('professional')) {
        await client.query(
          `INSERT INTO profesional (usuario_id, nombre, apellido, especialidad)
           SELECT $1, split_part(u.email, '@', 1), 'Profesional', 'General'
           FROM usuario u
           WHERE u.id = $1
             AND NOT EXISTS (SELECT 1 FROM profesional p WHERE p.usuario_id = $1)`,
          [userId],
        );
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'usuario.roles.update',
          resourceType: 'usuario',
          resourceId: userId,
          detail: { roles: unique },
        },
        client,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return {
      id: row.id,
      email: row.email,
      roles: unique,
      active: row.activo,
      createdAt: row.creado_en.toISOString(),
    };
  }
}
