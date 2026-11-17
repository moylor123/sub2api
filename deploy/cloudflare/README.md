# Cloudflare Containers deployment

Runs the existing Go application and its embedded Vue frontend as a single
Cloudflare Container. Uses external PostgreSQL (for example Neon) and Redis
(for example Upstash's TCP/TLS endpoint). D1, KV, and Redis REST URLs are not
drop-in replacements for these dependencies.

## Configuration

`wrangler.containers.jsonc` targets the existing `api` Worker and
`https://api.codex666.net`. It uses a `basic` instance and at most one instance.
All incoming requests use the same named Durable Object. The container serves
HTML and API routes together, preserving the backend's setup checks and public
configuration injection. Model streaming responses are forwarded without body
buffering or automatic POST retries.

Before activating this configuration, create a dedicated database and Redis
instance, then set the following **runtime Worker secrets**, not frontend build
variables:

```
DATABASE_HOST
DATABASE_USER
DATABASE_PASSWORD
DATABASE_DBNAME
REDIS_HOST
REDIS_PASSWORD
ADMIN_EMAIL
ADMIN_PASSWORD
JWT_SECRET
TOTP_ENCRYPTION_KEY
```

Use a direct Neon endpoint for migrations and a pre-created database. Use
Upstash's Redis TLS hostname/port rather than the HTTPS REST URL. The default
ports are 5432 and 6379; change the non-secret vars in Wrangler if needed.
The PostgreSQL role must be able to create tables, indexes, and migrations in
its own database. Do not reuse an existing application's database.

Generate a unique admin password of at least 16 characters and two independent
32-byte hexadecimal values for JWT_SECRET and TOTP_ENCRYPTION_KEY. Keep these
secrets stable across deployments. Never commit credentials or include them in
build output. Missing secrets prevent the container from starting and expose
only a 503 response, not an unconfigured public setup wizard.

## Deployment

Workers Builds can build the repository Dockerfile without installing Docker
on the developer's computer. Configure the repository root `/` and use:

```
Build command:  (empty; the Dockerfile builds frontend and backend)
Deploy command: node deploy/cloudflare/deploy.mjs
```

For this initial deployment, save a JSON object containing the ten required
secrets as the encrypted Workers Builds secret `SUB2API_RUNTIME_SECRETS`.
`deploy.mjs` validates it and uses Wrangler's `--secrets-file` to attach runtime
secrets to the deployed version. The temporary file is outside the Docker build
context and removed after deployment. The values are never written to source
files, passed as CLI arguments, or printed by the wrapper. Runtime credentials
can subsequently be managed directly through Cloudflare Worker Secrets.

The wrapper checks Containers access before building or deploying. Workers Paid
must already be active. Wrangler can activate the Worker before container
provisioning finishes, so a failed container release can temporarily return 503.
After the Durable Object namespace exists, an old static-only Worker cannot be
rolled back directly unless it preserves the live Durable Object export. Do not
delete the namespace as a rollback shortcut.

For temporary frontend recovery while Containers is unavailable, build the
frontend with pnpm 9 and deploy `wrangler.frontend-recovery.jsonc`. This preserves
the Durable Object export, serves the compiled frontend, and returns explicit
503 JSON for backend routes. It does not make login or model calls functional.
Restore `node deploy/cloudflare/deploy.mjs` after Workers Paid is active.

Cloudflare may require a build token with Containers/registry and Durable
Object permissions in addition to the original static Worker deploy token.
Do not widen a token until the required permissions have been reviewed.

Local checks:

```
node --test deploy/cloudflare/runtime.test.mjs
npx --yes wrangler@4.163.0 deploy --config wrangler.containers.jsonc --dry-run --containers-rollout=none
```

The second command validates/bundles the Worker but does **not** build or test
the Docker image. A full local dry run requires a Docker-compatible engine.

## Operating behavior and verification

- PostgreSQL holds application data. Redis holds cache and coordination state.
  The container filesystem is ephemeral; do not rely on local uploaded plugin
  files, database backups, or generated image files surviving a restart.
- AUTO_SETUP reconstructs local configuration on each fresh boot and skips
  admin creation if the database already has an administrator.
- The default idle timeout is one hour. Background jobs pause while the
  container is asleep. Continuous background operation needs a separate
  availability and cost decision.
- The first request can wait up to 180 seconds for initial migrations. Failed
  startup returns 503 with Retry-After. Logs never intentionally include the
  startup environment or request authorization headers.
- After deploying, verify `/health`, `/api/v1/settings/public`, `/setup/status`,
  admin login, and a real configured upstream request including SSE. Verify
  database state and login remain valid after a controlled container restart.
- The existing application is not modified to trust arbitrary proxy headers.
  Verify observed client IP behavior before enabling IP-based restrictions.

## Current preparation status

Worker helper tests (4), Wrangler Worker-only dry run, the full Docker image
build, and PostgreSQL/Redis TLS connection checks passed on 2026-11-17.
First deployment stopped at the Containers API because Workers Paid was not
active. First boot, admin login, and model requests remain unverified until
that platform requirement is resolved.

References (checked 2026-11-17):

- https://developers.cloudflare.com/containers/guides/deploy/
- https://developers.cloudflare.com/containers/faq/
- https://developers.cloudflare.com/containers/platform/pricing/
