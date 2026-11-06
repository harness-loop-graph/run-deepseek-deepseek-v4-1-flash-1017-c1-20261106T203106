# Architecture

## Runtime topology

```
browser (SPA, :8080)
   │  OAuth 2.0 code + PKCE (S256), Bearer access tokens
   ▼
NestJS API (:3000) ── migrations + seed on boot ──▶ PostgreSQL 16 (:5432)
   │
   └── attachment volume (uploads/, outside the web root)
```

`docker compose up -d --build` starts `db`, then `backend` (waits for the
database health check, migrates, seeds, listens on 3000), then `frontend`
(static nginx build). The backend container health check uses `GET /health`.

## Backend modules

| Module | Responsibility |
| --- | --- |
| `database` | pool provider, versioned migrations, deterministic seed, bootstrap |
| `auth` | EP-01..EP-04, PKCE verification, token issue/refresh/revoke, bearer resolution |
| `appointments` | EP-05, EP-07, EP-08, EP-09, EP-10, EP-11, EP-12; transactional booking store |
| `availability` | EP-06 slot computation, professional listing, EP-18 replacement |
| `attachments` | EP-13, EP-14, type/size checks, sanitized storage |
| `admin` | EP-15..EP-19 |
| `audit` | append-only audit writer and query (EP-19) |
| `health` | EP-20 |
| `common` | error envelope filter, validation pipe, guards, rate limiting, authorization predicates |

Cross-cutting providers are global: `BearerTokenGuard` resolves the access
token, `AuthGuard` enforces authentication on non-public routes, `RolesGuard`
enforces the declared roles, `AuthRateLimitGuard` + `AuthFailureInterceptor`
apply the auth rate limit, and `AllExceptionsFilter` renders the error envelope.

### Authorization model

- Route level: `@Roles(...)` on every controller handler.
- Resource level: pure predicates in `common/authorization.ts`
  (`canReadAppointmentScheduling`, `canReadClinicalContent`,
  `canRecordEncounter`, `canReadClinicalHistory`, `canReadAttachment`), applied
  inside services after loading the resource.
- Query level: patient listings filter by `paciente_id`; professional history
  access requires a `cita` row linking the patient and the professional.

| Role | Scheduling data | Clinical content |
| --- | --- | --- |
| patient | own appointments only | own history only |
| professional | own agenda | patients with an assigned appointment |
| staff | agenda and availability search | never |
| admin | users, roles, availability, audit | never |

EP-10 is limited to the owning patient and the assigned professional because its
payload includes the clinical summary; staff reads scheduling data through EP-09.

## Data model

```
rol(id, nombre, descripcion)
usuario(id, email, password_hash, activo, creado_en)
usuario_rol(usuario_id → usuario, rol_id → rol)
paciente(id, usuario_id → usuario, nombre, apellido, fecha_nacimiento, documento)
profesional(id, usuario_id → usuario, nombre, apellido, especialidad)
disponibilidad(id, profesional_id → profesional, franja_inicio, franja_fin)
cita(id, paciente_id → paciente, profesional_id → profesional,
     franja_inicio, franja_fin, estado, creado_en, actualizado_en)
encuentro(id, cita_id → cita, autor_profesional_id → profesional,
          notas, diagnostico, version, reemplaza_a → encuentro, creado_en)
adjunto(id, encuentro_id → encuentro, nombre_original, nombre_almacenado,
        tipo_mime, tamano_bytes, creado_en)
auditoria(id, usuario_id → usuario, accion, recurso_tipo, recurso_id,
          detalle, creado_en)
auth_request(id, client_id, redirect_uri, code_challenge, code_challenge_method,
             state, creado_en, expira_en, consumido_en)
auth_code(id, code_hash, request_id → auth_request, usuario_id → usuario,
          redirect_uri, code_challenge, creado_en, expira_en, usado_en)
auth_token(id, usuario_id → usuario, sesion_id, tipo, token_hash,
           creado_en, expira_en, revocado_en)
```

### Integrity (RF-03)

- Foreign keys on every relationship; NOT NULL on every required column.
- Partial unique index `cita_active_slot_unique` on
  `(profesional_id, franja_inicio) WHERE estado <> 'cancelled'`.
- `cita_estado_check`: `estado IN ('scheduled','attended','cancelled','no_show')`.
- `encuentro_version_check`: `version > 0`.
- `encuentro` and `auditoria` reject UPDATE and DELETE through the
  `rechazar_mutacion_append_only` trigger (RF-06); corrections insert a new
  `encuentro` with `version = previous + 1` and `reemplaza_a` pointing at the
  replaced row.

### Indexes (RF-04)

`cita (paciente_id, franja_inicio)`, `cita (profesional_id, franja_inicio)`,
`cita (estado)`, `cita (franja_inicio)`, `disponibilidad (profesional_id,
franja_inicio)`, `disponibilidad (franja_inicio)`, `encuentro (cita_id)`,
`encuentro (creado_en)`, `adjunto (encuentro_id)`, `auditoria (usuario_id)`,
`auditoria (accion)`, `auditoria (creado_en)`, token/code expiry indexes, and a
case-insensitive unique index on `usuario.email`.

### Migrations

`backend/src/database/migrations/index.ts` holds six ordered, reversible
migrations (`001_identity_and_roles` … `006_append_only_guards`); each has `up`
and `down` statements. `schema_migrations` records what ran.
`npm run migrate:down` reverts the last one, `npm run migrate:up` re-applies.
No ORM synchronization exists anywhere in the system.

## Booking transaction (RF-13)

`PgBookingStore.run` opens a transaction, locks the availability row
(`SELECT … FOR UPDATE`) and then, inside the lock, checks for an active booking
and inserts. The partial unique index is the second line of defence: a racing
insert that still reaches the database fails with SQLSTATE 23505 and is mapped
to 409. The audit row is written in the same transaction.

## Tokens

Only SHA-256 hashes of authorization codes and tokens are stored. Access
tokens: 15 min. Refresh tokens: 8 h, rotated on use, and revoking a refresh
token revokes the session's access tokens (immediate revocation, RF-08).
Authorization codes are single-use and expire after 2 min.

## Error envelope

`AllExceptionsFilter` maps `ApiError`, `HttpException`, Multer errors and
unexpected exceptions to `{ error: { code, message } }`. Unexpected exceptions
become `INTERNAL_ERROR`; messages are scrubbed of paths, SQL keywords and stack
frames. Rate limiting responds 429 with `Retry-After`.

## Rate limiting (RF-14)

`RateLimiter` is a fixed-window counter keyed per IP (auth endpoints, 5/min) or
per user id (EP-07, 10/min). Auth windows count *rejected* attempts and are
cleared by a successful sign-in, so the limit blocks credential brute force
without throttling legitimate logins; a valid login while a window is exhausted
still gets 429 until it resets. Booking windows count every attempt. Every 429
carries `Retry-After` in seconds and the standard error envelope.

## Endpoint-to-screen map

| Screen | Endpoints |
| --- | --- |
| SCR-01 Login / callback | EP-01, EP-02 (SPA posts credentials to the login form, exchanges the code) |
| SCR-02 Patient portal | EP-05, EP-08, EP-10 |
| SCR-03 Availability search and booking | EP-06, EP-07, EP-10, `GET /professionals` |
| SCR-04 Agenda | EP-09, EP-10, `GET /professionals` (staff filter) |
| SCR-05 Appointment detail / encounter | EP-10, EP-11, EP-13, EP-14 |
| SCR-06 Clinical history | EP-12, EP-14, `GET /me/patients` |
| SCR-07 Administration | EP-15, EP-16, EP-17, EP-18, `GET /admin/professionals` |
| SCR-08 Audit log | EP-19 |

## Frontend structure

```
src/api/          fetch client, error envelope parsing, downloads/uploads
src/auth/         PKCE helpers, token policy, AuthProvider (session + refresh)
src/components/   AppLayout (role navigation), loading/error/empty states
src/screens/      SCR01Login.tsx .. SCR08Audit.tsx (one file per screen)
src/routes/       App.tsx: protected routing, role gates, home redirect
```

Clinical notes are rendered as text nodes (`white-space: pre-wrap`), never via
`dangerouslySetInnerHTML` (RF-22). Every API-consuming view has explicit
loading, error and empty states (RF-24).
