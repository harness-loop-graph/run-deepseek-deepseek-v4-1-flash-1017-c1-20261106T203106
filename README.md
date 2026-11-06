# Medical Appointments & Clinical History

Outpatient appointment scheduling and clinical history registry with four roles
(`patient`, `professional`, `staff`, `admin`).

- **Backend**: NestJS 10 (TypeScript), REST API on <http://localhost:3000>
- **Database**: PostgreSQL 16, schema created only by versioned migrations
- **Frontend**: React 18 + Vite SPA served by nginx on <http://localhost:8080>
- **Tests**: Vitest (backend unit tests), Playwright (end-to-end)
- **Execution**: Docker Compose, one command to operate

## Quick start

```bash
cp .env.example .env          # optional: compose already defaults every value
docker compose up -d --build
curl -sf http://localhost:3000/health   # {"status":"ok",...}
```

On backend start the API waits for PostgreSQL, applies every migration
(idempotently) and runs the deterministic seed (RF-05). Nothing else is manual.

| Service | URL |
| --- | --- |
| Frontend (SPA) | <http://localhost:8080> |
| Backend API | <http://localhost:3000> |
| Health | <http://localhost:3000/health> |
| PostgreSQL | `localhost:5432` (`medapp`/`medapp`/`medapp`) |

## Seeded accounts

All seeded users share `SEED_PASSWORD` (default `Seed!Passw0rd`).

| Email | Role | Profile id |
| --- | --- | --- |
| `admin@seed.local` | admin | — |
| `staff@seed.local` | staff | — |
| `paciente1@seed.local` | patient | patient 1 |
| `paciente2@seed.local` | patient | patient 2 |
| `paciente3@seed.local` | patient | patient 3 |
| `gomez@seed.local` | professional | professional 1 (Gómez) |
| `lopez@seed.local` | professional | professional 2 (López) |

Availability: weekdays 08:00–16:00 UTC in 30-minute slots for the 14 days
following the seed; López has no Friday slots.

## Screens

| Id | Screen | Route |
| --- | --- | --- |
| SCR-01 | Login and authorization return | `/login`, `/auth/callback` |
| SCR-02 | Patient portal: own appointments | `/bookings` |
| SCR-03 | Availability search and booking | `/search` |
| SCR-04 | Professional agenda, day and week views | `/agenda` |
| SCR-05 | Appointment detail and encounter recording | `/appointments/:id` |
| SCR-06 | Patient clinical history | `/history`, `/history/:patientId` |
| SCR-07 | Administration: availability, users, roles | `/admin` |
| SCR-08 | Audit log query | `/audit` |

Navigation is role-driven (`nav-bookings`, `nav-search`, `nav-agenda`,
`nav-history`, `nav-admin`, `nav-audit`); unauthenticated access to any
protected route redirects to SCR-01, and the API re-checks every operation.

## Authentication (OAuth 2.0 + PKCE)

- Public client `medapp-spa`, redirect URI `http://localhost:8080/auth/callback`.
- `GET /auth/authorize` validates the request and 302-redirects to a
  backend-served HTML login form (`input[name="email"]`, `input[name="password"]`,
  submit button, authorization request in hidden fields — no consent step).
  A successful login 302-redirects to the redirect URI with `code` and `state`.
- `POST /auth/token` exchanges the code plus `code_verifier` (S256).
- Access tokens live 15 min, refresh tokens 8 h; revocation is immediate
  (`POST /auth/revoke`). The SPA keeps access tokens in memory, the refresh
  token in `sessionStorage`, refreshes proactively 60 s before expiry and on any
  401, and revokes on logout.

## Endpoint catalog

| Id | Endpoint | Caller |
| --- | --- | --- |
| EP-01 | `GET /auth/authorize` | any |
| EP-02 | `POST /auth/token` | any |
| EP-03 | `POST /auth/token/refresh` | any |
| EP-04 | `POST /auth/revoke` | any |
| EP-05 | `GET /me/appointments` | patient |
| EP-06 | `GET /availability?professionalId&from&to` | patient, staff |
| EP-07 | `POST /appointments` | patient |
| EP-08 | `DELETE /appointments/:id` | patient (own) |
| EP-09 | `GET /agenda?from&to` | professional, staff |
| EP-10 | `GET /appointments/:id` | patient (own), assigned professional |
| EP-11 | `POST /appointments/:id/encounter` | assigned professional |
| EP-12 | `GET /patients/:id/clinical-history` | patient (self), assigned professional |
| EP-13 | `POST /encounters/:id/attachments` | author professional |
| EP-14 | `GET /attachments/:id` | author professional, owning patient |
| EP-15 | `GET /admin/users?page` | admin |
| EP-16 | `POST /admin/users` | admin |
| EP-17 | `PATCH /admin/users/:id/roles` | admin |
| EP-18 | `PUT /admin/professionals/:id/availability` | admin |
| EP-19 | `GET /admin/audit?actor&action&from&to` | admin |
| EP-20 | `GET /health` | any |

Supporting read endpoints used by the screens: `GET /professionals`,
`GET /me/patients`, `GET /admin/professionals`,
`GET /admin/professionals/:id/availability`.

Every error response uses the envelope `{ "error": { "code", "message" } }`
with no stack trace, SQL or filesystem path. Undeclared request fields are
rejected with 422.

Rate limiting (RF-14): auth endpoints 5 req/min per IP, EP-07 10 req/min per
user; both answer 429 with `Retry-After`.

## Tests

```bash
# backend unit tests (authorization, booking transaction, validation, errors)
cd backend && npm test

# frontend production build
cd frontend && npm run build

# end-to-end suite against the running stack
npx playwright test
```

The unit suite covers RF-09/RF-10 authorization and isolation, the RF-13
booking race (one 201, one 409), RF-12 strict validation and the RF-16 error
envelope. The Playwright suite covers login per role, patient booking and
cancellation, professional encounter recording, patient clinical history and
the admin/audit screens, using the fixed `data-testid` contract.

## Configuration

Everything is environment driven; see `.env.example`. No credential, key or
token is committed. Attachments (PDF/JPEG/PNG, max 5 MB) are stored in a Docker
volume outside any served directory and are only reachable through EP-14 with
permission checks; filenames are sanitized server-side.
