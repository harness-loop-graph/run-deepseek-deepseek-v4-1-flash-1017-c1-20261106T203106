import { Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import * as bcrypt from 'bcryptjs';

const logger = new Logger('Seed');

interface SeedUser {
  email: string;
  nombre: string;
  apellido: string;
  roles: string[];
}

const SEED_USERS: SeedUser[] = [
  { email: 'admin@seed.local', nombre: 'Ada', apellido: 'Admin', roles: ['admin'] },
  { email: 'staff@seed.local', nombre: 'Sofía', apellido: 'Staff', roles: ['staff'] },
  { email: 'paciente1@seed.local', nombre: 'Ana', apellido: 'Pérez', roles: ['patient'] },
  { email: 'paciente2@seed.local', nombre: 'Bruno', apellido: 'Silva', roles: ['patient'] },
  { email: 'paciente3@seed.local', nombre: 'Carla', apellido: 'Rojas', roles: ['patient'] },
  {
    email: 'gomez@seed.local',
    nombre: 'Elena',
    apellido: 'Gómez',
    roles: ['professional'],
  },
  {
    email: 'lopez@seed.local',
    nombre: 'Martín',
    apellido: 'López',
    roles: ['professional'],
  },
];

const ROLE_DESCRIPTIONS: Record<string, string> = {
  patient: 'Paciente: agenda y historia clínica propias',
  professional: 'Profesional de la salud: agenda e historia de pacientes asignados',
  staff: 'Personal administrativo: datos de agenda, nunca contenido clínico',
  admin: 'Administrador del sistema: usuarios, roles, disponibilidad y auditoría',
};

function utcDateOnly(base: Date): Date {
  return new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()),
  );
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

async function seedRoles(client: PoolClient): Promise<void> {
  for (const [nombre, descripcion] of Object.entries(ROLE_DESCRIPTIONS)) {
    await client.query(
      `INSERT INTO rol (nombre, descripcion) VALUES ($1, $2)
       ON CONFLICT (nombre) DO UPDATE SET descripcion = EXCLUDED.descripcion`,
      [nombre, descripcion],
    );
  }
}

async function upsertUser(
  client: PoolClient,
  user: SeedUser,
  passwordHash: string,
): Promise<number> {
  const existing = await client.query<{ id: number }>(
    'SELECT id FROM usuario WHERE lower(email) = lower($1)',
    [user.email],
  );
  let userId: number;
  if (existing.rowCount && existing.rows[0]) {
    userId = existing.rows[0].id;
    await client.query(
      'UPDATE usuario SET activo = true WHERE id = $1',
      [userId],
    );
  } else {
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO usuario (email, password_hash, activo)
       VALUES ($1, $2, true) RETURNING id`,
      [user.email, passwordHash],
    );
    userId = inserted.rows[0].id;
  }

  for (const role of user.roles) {
    await client.query(
      `INSERT INTO usuario_rol (usuario_id, rol_id)
       SELECT $1, id FROM rol WHERE nombre = $2
       ON CONFLICT (usuario_id, rol_id) DO NOTHING`,
      [userId, role],
    );
  }
  return userId;
}

async function seedAvailability(client: PoolClient): Promise<void> {
  const professionals = await client.query<{ id: number; apellido: string }>(
    'SELECT id, apellido FROM profesional ORDER BY id',
  );

  const today = utcDateOnly(new Date());
  await client.query('DELETE FROM disponibilidad WHERE franja_inicio < $1', [
    today.toISOString(),
  ]);

  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const day = addDays(today, dayOffset);
    const weekday = day.getUTCDay();
    const isWeekday = weekday >= 1 && weekday <= 5;
    if (!isWeekday) {
      continue;
    }
    for (const professional of professionals.rows) {
      const isLopez = professional.apellido === 'López';
      if (isLopez && weekday === 5) {
        continue;
      }
      for (let slot = 0; slot < 16; slot += 1) {
        const start = new Date(day.getTime() + (8 * 60 + slot * 30) * 60 * 1000);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        await client.query(
          `INSERT INTO disponibilidad (profesional_id, franja_inicio, franja_fin)
           VALUES ($1, $2, $3)
           ON CONFLICT (profesional_id, franja_inicio) DO NOTHING`,
          [professional.id, start.toISOString(), end.toISOString()],
        );
      }
    }
  }
}

export async function runSeed(pool: Pool, seedPassword: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedRoles(client);
    const passwordHash = await bcrypt.hash(seedPassword, 10);
    let patientIndex = 0;
    for (const user of SEED_USERS) {
      const userId = await upsertUser(client, user, passwordHash);
      if (user.roles.includes('patient')) {
        patientIndex += 1;
        await client.query(
          `INSERT INTO paciente (usuario_id, nombre, apellido, fecha_nacimiento, documento)
           SELECT $1, $2, $3, $4, $5
           WHERE NOT EXISTS (SELECT 1 FROM paciente WHERE usuario_id = $1)`,
          [
            userId,
            user.nombre,
            user.apellido,
            `1990-0${patientIndex}-1${patientIndex}`,
            `DOC-000${patientIndex}`,
          ],
        );
      }
      if (user.roles.includes('professional')) {
        const specialty = user.apellido === 'Gómez' ? 'Clínica médica' : 'Cardiología';
        await client.query(
          `INSERT INTO profesional (usuario_id, nombre, apellido, especialidad)
           SELECT $1, $2, $3, $4
           WHERE NOT EXISTS (SELECT 1 FROM profesional WHERE usuario_id = $1)`,
          [userId, user.nombre, user.apellido, specialty],
        );
      }
    }
    await seedAvailability(client);
    await client.query('COMMIT');
    logger.log('Deterministic seed applied');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
