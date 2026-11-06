export interface Migration {
  id: string;
  name: string;
  up: string[];
  down: string[];
}

export const migrations: Migration[] = [
  {
    id: '001',
    name: 'identity_and_roles',
    up: [
      `CREATE TABLE rol (
         id serial PRIMARY KEY,
         nombre text NOT NULL UNIQUE,
         descripcion text NOT NULL,
         CONSTRAINT rol_nombre_check CHECK (nombre IN ('patient', 'professional', 'staff', 'admin'))
       )`,
      `CREATE TABLE usuario (
         id serial PRIMARY KEY,
         email text NOT NULL,
         password_hash text NOT NULL,
         activo boolean NOT NULL DEFAULT true,
         creado_en timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE UNIQUE INDEX usuario_email_unique ON usuario (lower(email))`,
      `CREATE TABLE usuario_rol (
         usuario_id integer NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
         rol_id integer NOT NULL REFERENCES rol(id) ON DELETE RESTRICT,
         PRIMARY KEY (usuario_id, rol_id)
       )`,
      `CREATE INDEX usuario_rol_rol_idx ON usuario_rol (rol_id)`,
      `CREATE TABLE paciente (
         id serial PRIMARY KEY,
         usuario_id integer NOT NULL UNIQUE REFERENCES usuario(id) ON DELETE RESTRICT,
         nombre text NOT NULL,
         apellido text NOT NULL,
         fecha_nacimiento date,
         documento text
       )`,
      `CREATE INDEX paciente_usuario_idx ON paciente (usuario_id)`,
      `CREATE TABLE profesional (
         id serial PRIMARY KEY,
         usuario_id integer NOT NULL UNIQUE REFERENCES usuario(id) ON DELETE RESTRICT,
         nombre text NOT NULL,
         apellido text NOT NULL,
         especialidad text NOT NULL
       )`,
      `CREATE INDEX profesional_usuario_idx ON profesional (usuario_id)`,
    ],
    down: [
      `DROP TABLE IF EXISTS profesional`,
      `DROP TABLE IF EXISTS paciente`,
      `DROP TABLE IF EXISTS usuario_rol`,
      `DROP TABLE IF EXISTS usuario`,
      `DROP TABLE IF EXISTS rol`,
    ],
  },
  {
    id: '002',
    name: 'scheduling',
    up: [
      `CREATE TABLE disponibilidad (
         id serial PRIMARY KEY,
         profesional_id integer NOT NULL REFERENCES profesional(id) ON DELETE RESTRICT,
         franja_inicio timestamptz NOT NULL,
         franja_fin timestamptz NOT NULL,
         creado_en timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT disponibilidad_rango_check CHECK (franja_fin > franja_inicio)
       )`,
      `CREATE UNIQUE INDEX disponibilidad_slot_unique ON disponibilidad (profesional_id, franja_inicio)`,
      `CREATE INDEX disponibilidad_profesional_inicio_idx ON disponibilidad (profesional_id, franja_inicio)`,
      `CREATE INDEX disponibilidad_inicio_idx ON disponibilidad (franja_inicio)`,
      `CREATE TABLE cita (
         id serial PRIMARY KEY,
         paciente_id integer NOT NULL REFERENCES paciente(id) ON DELETE RESTRICT,
         profesional_id integer NOT NULL REFERENCES profesional(id) ON DELETE RESTRICT,
         franja_inicio timestamptz NOT NULL,
         franja_fin timestamptz NOT NULL,
         estado text NOT NULL DEFAULT 'scheduled',
         creado_en timestamptz NOT NULL DEFAULT now(),
         actualizado_en timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT cita_estado_check CHECK (estado IN ('scheduled', 'attended', 'cancelled', 'no_show')),
         CONSTRAINT cita_rango_check CHECK (franja_fin > franja_inicio)
       )`,
      `CREATE UNIQUE INDEX cita_active_slot_unique ON cita (profesional_id, franja_inicio) WHERE estado <> 'cancelled'`,
      `CREATE INDEX cita_paciente_inicio_idx ON cita (paciente_id, franja_inicio)`,
      `CREATE INDEX cita_profesional_inicio_idx ON cita (profesional_id, franja_inicio)`,
      `CREATE INDEX cita_estado_idx ON cita (estado)`,
      `CREATE INDEX cita_inicio_idx ON cita (franja_inicio)`,
    ],
    down: [
      `DROP TABLE IF EXISTS cita`,
      `DROP TABLE IF EXISTS disponibilidad`,
    ],
  },
  {
    id: '003',
    name: 'clinical_history',
    up: [
      `CREATE TABLE encuentro (
         id serial PRIMARY KEY,
         cita_id integer NOT NULL REFERENCES cita(id) ON DELETE RESTRICT,
         autor_profesional_id integer NOT NULL REFERENCES profesional(id) ON DELETE RESTRICT,
         notas text NOT NULL,
         diagnostico text NOT NULL,
         version integer NOT NULL,
         reemplaza_a integer REFERENCES encuentro(id) ON DELETE RESTRICT,
         creado_en timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT encuentro_version_check CHECK (version > 0),
         CONSTRAINT encuentro_cita_version_unique UNIQUE (cita_id, version)
       )`,
      `CREATE INDEX encuentro_cita_idx ON encuentro (cita_id)`,
      `CREATE INDEX encuentro_autor_idx ON encuentro (autor_profesional_id)`,
      `CREATE INDEX encuentro_creado_idx ON encuentro (creado_en)`,
      `CREATE TABLE adjunto (
         id serial PRIMARY KEY,
         encuentro_id integer NOT NULL REFERENCES encuentro(id) ON DELETE RESTRICT,
         nombre_original text NOT NULL,
         nombre_almacenado text NOT NULL UNIQUE,
         tipo_mime text NOT NULL,
         tamano_bytes integer NOT NULL,
         creado_en timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT adjunto_tamano_check CHECK (tamano_bytes > 0),
         CONSTRAINT adjunto_tipo_check CHECK (tipo_mime IN ('application/pdf', 'image/jpeg', 'image/png'))
       )`,
      `CREATE INDEX adjunto_encuentro_idx ON adjunto (encuentro_id)`,
    ],
    down: [
      `DROP TABLE IF EXISTS adjunto`,
      `DROP TABLE IF EXISTS encuentro`,
    ],
  },
  {
    id: '004',
    name: 'audit_log',
    up: [
      `CREATE TABLE auditoria (
         id serial PRIMARY KEY,
         usuario_id integer NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
         accion text NOT NULL,
         recurso_tipo text NOT NULL,
         recurso_id integer,
         detalle jsonb,
         creado_en timestamptz NOT NULL DEFAULT now()
       )`,
      `CREATE INDEX auditoria_usuario_idx ON auditoria (usuario_id)`,
      `CREATE INDEX auditoria_accion_idx ON auditoria (accion)`,
      `CREATE INDEX auditoria_creado_idx ON auditoria (creado_en)`,
      `CREATE INDEX auditoria_recurso_idx ON auditoria (recurso_tipo, recurso_id)`,
    ],
    down: [`DROP TABLE IF EXISTS auditoria`],
  },
  {
    id: '005',
    name: 'oauth_state',
    up: [
      `CREATE TABLE auth_request (
         id text PRIMARY KEY,
         client_id text NOT NULL,
         redirect_uri text NOT NULL,
         code_challenge text NOT NULL,
         code_challenge_method text NOT NULL,
         state text NOT NULL,
         creado_en timestamptz NOT NULL DEFAULT now(),
         expira_en timestamptz NOT NULL,
         consumido_en timestamptz,
         CONSTRAINT auth_request_method_check CHECK (code_challenge_method = 'S256')
       )`,
      `CREATE INDEX auth_request_expira_idx ON auth_request (expira_en)`,
      `CREATE TABLE auth_code (
         id serial PRIMARY KEY,
         code_hash text NOT NULL UNIQUE,
         request_id text NOT NULL REFERENCES auth_request(id) ON DELETE RESTRICT,
         usuario_id integer NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
         redirect_uri text NOT NULL,
         code_challenge text NOT NULL,
         creado_en timestamptz NOT NULL DEFAULT now(),
         expira_en timestamptz NOT NULL,
         usado_en timestamptz
       )`,
      `CREATE INDEX auth_code_expira_idx ON auth_code (expira_en)`,
      `CREATE TABLE auth_token (
         id serial PRIMARY KEY,
         usuario_id integer NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
         sesion_id text NOT NULL,
         tipo text NOT NULL,
         token_hash text NOT NULL UNIQUE,
         creado_en timestamptz NOT NULL DEFAULT now(),
         expira_en timestamptz NOT NULL,
         revocado_en timestamptz,
         CONSTRAINT auth_token_tipo_check CHECK (tipo IN ('access', 'refresh'))
       )`,
      `CREATE INDEX auth_token_usuario_idx ON auth_token (usuario_id)`,
      `CREATE INDEX auth_token_sesion_idx ON auth_token (sesion_id)`,
      `CREATE INDEX auth_token_expira_idx ON auth_token (expira_en)`,
    ],
    down: [
      `DROP TABLE IF EXISTS auth_token`,
      `DROP TABLE IF EXISTS auth_code`,
      `DROP TABLE IF EXISTS auth_request`,
    ],
  },
  {
    id: '006',
    name: 'append_only_guards',
    up: [
      `CREATE OR REPLACE FUNCTION rechazar_mutacion_append_only() RETURNS trigger AS $$
       BEGIN
         RAISE EXCEPTION 'append-only table % rejects %', TG_TABLE_NAME, TG_OP;
       END;
       $$ LANGUAGE plpgsql`,
      `CREATE TRIGGER encuentro_append_only
         BEFORE UPDATE OR DELETE ON encuentro
         FOR EACH ROW EXECUTE FUNCTION rechazar_mutacion_append_only()`,
      `CREATE TRIGGER auditoria_append_only
         BEFORE UPDATE OR DELETE ON auditoria
         FOR EACH ROW EXECUTE FUNCTION rechazar_mutacion_append_only()`,
    ],
    down: [
      `DROP TRIGGER IF EXISTS auditoria_append_only ON auditoria`,
      `DROP TRIGGER IF EXISTS encuentro_append_only ON encuentro`,
      `DROP FUNCTION IF EXISTS rechazar_mutacion_append_only()`,
    ],
  },
];
