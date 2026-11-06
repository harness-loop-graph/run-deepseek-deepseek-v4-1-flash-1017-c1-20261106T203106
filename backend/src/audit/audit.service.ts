import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../config';
import { DbClient, query } from '../database/pool';

export interface AuditEntry {
  actorId: number;
  action: string;
  resourceType: string;
  resourceId?: number | null;
  detail?: Record<string, unknown> | null;
}

@Injectable()
export class AuditService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Appends an audit row. Pass the transactional client when the audited write
   * must be atomic with its audit entry.
   */
  async record(entry: AuditEntry, client?: DbClient): Promise<void> {
    const executor = client ?? this.pool;
    await query(
      executor,
      `INSERT INTO auditoria (usuario_id, accion, recurso_tipo, recurso_id, detalle)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        entry.actorId,
        entry.action,
        entry.resourceType,
        entry.resourceId ?? null,
        entry.detail ? JSON.stringify(entry.detail) : null,
      ],
    );
  }

  async list(filters: {
    actor?: number;
    action?: string;
    from?: string;
    to?: string;
    page: number;
    pageSize: number;
  }): Promise<{
    items: Array<{
      id: number;
      usuario_id: number;
      accion: string;
      recurso_tipo: string;
      recurso_id: number | null;
      creado_en: string;
    }>;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.actor !== undefined) {
      params.push(filters.actor);
      conditions.push(`usuario_id = $${params.length}`);
    }
    if (filters.action) {
      params.push(filters.action);
      conditions.push(`accion = $${params.length}`);
    }
    if (filters.from) {
      params.push(`${filters.from}T00:00:00.000Z`);
      conditions.push(`creado_en >= $${params.length}`);
    }
    if (filters.to) {
      params.push(`${filters.to}T23:59:59.999Z`);
      conditions.push(`creado_en <= $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countResult = await query<{ total: string }>(
      this.pool,
      `SELECT count(*)::text AS total FROM auditoria ${where}`,
      params,
    );
    const offset = (filters.page - 1) * filters.pageSize;
    const listParams = [...params, filters.pageSize, offset];
    const rows = await query<{
      id: number;
      usuario_id: number;
      accion: string;
      recurso_tipo: string;
      recurso_id: number | null;
      creado_en: Date;
    }>(
      this.pool,
      `SELECT id, usuario_id, accion, recurso_tipo, recurso_id, creado_en
       FROM auditoria ${where}
       ORDER BY creado_en DESC, id DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams,
    );
    return {
      items: rows.rows.map((row) => ({
        id: row.id,
        usuario_id: row.usuario_id,
        accion: row.accion,
        recurso_tipo: row.recurso_tipo,
        recurso_id: row.recurso_id,
        creado_en: row.creado_en.toISOString(),
      })),
      page: filters.page,
      pageSize: filters.pageSize,
      total: Number.parseInt(countResult.rows[0]?.total ?? '0', 10),
    };
  }
}
