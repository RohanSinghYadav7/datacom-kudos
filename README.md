# Kudos

A standalone internal-app demo for peer recognition. It uses React, Vite, TypeScript, Express, Prisma, and SQLite. The approved [KUDOS_SPEC.md](./KUDOS_SPEC.md) remains the product and technical source of truth.

## Requirements

- Node.js 20.19+ (or a current supported LTS release)
- npm 10+

## Setup

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set `KUDOS_SESSION_SECRET` to at least 32 random characters. The default SQLite database URL uses `apps/api/prisma/dev.db`.

```powershell
npm install
npm run db:generate
npm run db:migrate
```

Create the first administrator through the one-time bootstrap command. It requires explicit credentials in the process environment and has no built-in/default password:

```powershell
$env:KUDOS_ADMIN_EMAIL = "admin@example.test"
$env:KUDOS_ADMIN_NAME = "Kudos Admin"
$env:KUDOS_ADMIN_PASSWORD = "use-a-unique-long-password"
npm run db:seed:admin
Remove-Item Env:KUDOS_ADMIN_EMAIL, Env:KUDOS_ADMIN_NAME, Env:KUDOS_ADMIN_PASSWORD
```

Admin bootstrap promotes only the explicitly supplied account. Do not run it with credentials from an untrusted source.

## Development

```powershell
npm run dev
```

The Vite client is available at `http://localhost:5173`; `/api` requests are proxied to Express on port 3001. Users can create ordinary accounts from the sign-in screen. Registration is open in this standalone demo; configure network access accordingly if deploying internally.

## Database

- Prisma schema: `apps/api/prisma/schema.prisma`
- Migrations: `apps/api/prisma/migrations/` (initial schema, persistence invariants, and data-preserving snake_case column mapping)
- Local SQLite file: `apps/api/prisma/dev.db` (ignored by Git)
- To apply future migrations: `npm run db:migrate`

The local demo defaults to one tenant (no tenant column); there is no cross-tenant data path. Kudos are visible by default, hidden by an administrator with moderation metadata, or permanently deleted only by an administrator. Permanent-delete events are retained in the moderation audit table.

## Authentication and moderation

Passwords are hashed with Node's `scrypt`; session bearer values are random, stored only as SHA-256 digests, and sent in HttpOnly/SameSite cookies. Mutating authenticated requests require a session-bound CSRF token. The first admin is provisioned by the CLI command above; users created through registration receive the ordinary-user role. Moderation is checked server-side for every admin endpoint.

Submission rate limiting defaults to 10 kudos per user per hour. Repeated recognitions are allowed by policy; the UI sends an idempotency key for network retries. Hide can be reversed by an admin; permanent delete is enabled and audited in the default demo. No automated AI or text classification is used: inappropriate content can be hidden/deleted by an administrator.

## API

All endpoints return JSON errors in the `{ error: { code, message, field? }, requestId }` shape where applicable.

| Method and path | Access | Purpose |
|---|---|---|
| `POST /api/auth/register` | Public, same-origin | Create an ordinary account and sign in |
| `POST /api/auth/login` | Public, same-origin, IP rate-limited | Start a session |
| `GET /api/auth/me` | Authenticated | Return the current user and session CSRF token |
| `POST /api/auth/logout` | Authenticated + CSRF | End the current session |
| `GET /api/v1/users/search?q=...&limit=...` | Authenticated | Search active colleagues by name; never returns email |
| `POST /api/v1/kudos` | Authenticated + CSRF | Create kudos; optional `Idempotency-Key` makes retries safe |
| `GET /api/v1/kudos?limit=...&cursor=...` | Authenticated | Read the visible feed using signed keyset cursors |
| `GET /api/v1/admin/kudos?limit=...&cursor=...` | Admin | List visible and hidden kudos for moderation |
| `POST /api/v1/admin/kudos/:id/moderation` | Admin + CSRF | Hide or restore a kudos item with a reason |
| `DELETE /api/v1/admin/kudos/:id` | Admin + CSRF | Permanently delete with an audit record |

Mutating requests require the `X-CSRF-Token` returned at sign-in/registration or by `/api/auth/me`. Every unsafe method also requires a same-origin `Origin` or `Referer`.

## Testing and checks

```powershell
npm test
npm run typecheck
npm run build
```

API tests use a separate SQLite test database that is recreated by the test setup. Frontend tests use Vitest and Testing Library.

## Production notes

This application is a self-contained internal demo, not a substitute for an organization's SSO, employee directory, formal abuse-response process, or privacy/retention review. Use HTTPS, set `NODE_ENV=production`, use a unique secret, restrict registration and database/file access according to your environment, back up SQLite data, and place the service behind an appropriate reverse proxy. No credentials or production secrets are committed.
