import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { APP_CONFIG, AppConfig, PG_POOL } from '../config';
import { ApiError } from '../common/errors';
import {
  AuthenticatedUser,
  canReadAttachment,
  hasAnyRole,
} from '../common/authorization';
import { AuditService } from '../audit/audit.service';
import { AttachmentDto } from '../appointments/appointment.types';

const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

interface EncounterContext {
  encounter_id: number;
  cita_id: number;
  autor_profesional_id: number;
  paciente_id: number;
}

export function sanitizeFilename(original: string, fallbackExtension: string): string {
  const base = path.basename(original.replace(/\\/g, '/'));
  const cleaned = base
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  if (cleaned.length === 0) {
    return `adjunto${fallbackExtension}`;
  }
  return cleaned;
}

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger('AttachmentsService');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  private async encounterContext(encounterId: number): Promise<EncounterContext | null> {
    const result = await this.pool.query<EncounterContext>(
      `SELECT e.id AS encounter_id, e.cita_id, e.autor_profesional_id, c.paciente_id
       FROM encuentro e JOIN cita c ON c.id = e.cita_id
       WHERE e.id = $1`,
      [encounterId],
    );
    return result.rows[0] ?? null;
  }

  async upload(
    user: AuthenticatedUser,
    encounterId: number,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
  ): Promise<AttachmentDto> {
    const context = await this.encounterContext(encounterId);
    if (!context) {
      throw new ApiError('NOT_FOUND', 'Encounter not found');
    }
    if (
      !hasAnyRole(user, ['professional']) ||
      user.professionalId !== context.autor_profesional_id
    ) {
      throw new ApiError('FORBIDDEN', 'Only the author professional can attach files');
    }
    if (!file) {
      throw new ApiError('VALIDATION_ERROR', 'A file is required');
    }
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      throw new ApiError(
        'UNSUPPORTED_MEDIA_TYPE',
        'Only PDF, JPEG and PNG files are allowed',
      );
    }
    if (file.size <= 0) {
      throw new ApiError('VALIDATION_ERROR', 'The uploaded file is empty');
    }
    if (file.size > this.config.maxUploadBytes) {
      throw new ApiError('PAYLOAD_TOO_LARGE');
    }

    const extension = EXTENSIONS[file.mimetype] ?? '.bin';
    const safeName = sanitizeFilename(file.originalname, extension);
    const storedName = `${randomUUID()}${extension}`;
    const targetDir = path.resolve(this.config.uploadDir);
    await fs.mkdir(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, storedName);
    await fs.writeFile(targetPath, file.buffer, { mode: 0o600 });

    try {
      const inserted = await this.pool.query<{
        id: number;
        creado_en: Date;
      }>(
        `INSERT INTO adjunto
           (encuentro_id, nombre_original, nombre_almacenado, tipo_mime, tamano_bytes)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, creado_en`,
        [encounterId, safeName, storedName, file.mimetype, file.size],
      );
      const row = inserted.rows[0];
      await this.audit.record({
        actorId: user.id,
        action: 'adjunto.create',
        resourceType: 'adjunto',
        resourceId: row.id,
        detail: { encounterId, contentType: file.mimetype, sizeBytes: file.size },
      });
      return {
        id: row.id,
        encounterId,
        filename: safeName,
        contentType: file.mimetype,
        sizeBytes: file.size,
        createdAt: row.creado_en.toISOString(),
      };
    } catch (error) {
      await fs.unlink(targetPath).catch(() => undefined);
      throw error;
    }
  }

  async download(
    user: AuthenticatedUser,
    attachmentId: number,
  ): Promise<{
    filename: string;
    contentType: string;
    sizeBytes: number;
    stream: Buffer;
  }> {
    const result = await this.pool.query<{
      id: number;
      nombre_original: string;
      nombre_almacenado: string;
      tipo_mime: string;
      tamano_bytes: number;
      paciente_id: number;
      autor_profesional_id: number;
    }>(
      `SELECT a.id, a.nombre_original, a.nombre_almacenado, a.tipo_mime,
              a.tamano_bytes, c.paciente_id, e.autor_profesional_id
       FROM adjunto a
       JOIN encuentro e ON e.id = a.encuentro_id
       JOIN cita c ON c.id = e.cita_id
       WHERE a.id = $1`,
      [attachmentId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new ApiError('NOT_FOUND', 'Attachment not found');
    }
    if (
      !canReadAttachment(user, {
        patientId: row.paciente_id,
        authorProfessionalId: row.autor_profesional_id,
      })
    ) {
      throw new ApiError('FORBIDDEN');
    }
    const targetDir = path.resolve(this.config.uploadDir);
    const filePath = path.join(targetDir, path.basename(row.nombre_almacenado));
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch {
      this.logger.warn(`Attachment ${row.id} is missing from storage`);
      throw new ApiError('NOT_FOUND', 'Attachment file is not available');
    }
    await this.audit.record({
      actorId: user.id,
      action: 'adjunto.read',
      resourceType: 'adjunto',
      resourceId: row.id,
    });
    return {
      filename: row.nombre_original,
      contentType: row.tipo_mime,
      sizeBytes: row.tamano_bytes,
      stream: buffer,
    };
  }
}
