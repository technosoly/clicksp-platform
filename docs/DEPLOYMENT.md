# Deployment

Phase 2 covers local development and the container build. Staging and production procedures, TLS, backups and restore drills are written and tested in Phase 10.

## Containers

| Service | Image | Notes |
|---|---|---|
| `app` | built from `Dockerfile` (target `runtime`) | Next.js standalone server as non-root user `app`, port 3000, Docker `HEALTHCHECK` on `/api/health` |
| `migrate` | built from `Dockerfile` (target `migrate`) | One-off `prisma migrate deploy`; the app starts only after it succeeds |
| `postgres` | `postgres:17-alpine` | Data in volume `postgres-data` |
| `redis` | `redis:7-alpine` | Password required, AOF persistence |
| `meilisearch` | `getmeili/meilisearch:v1.58.0` | Master key required, analytics off |

All ports bind to `127.0.0.1` only. A reverse proxy (Caddy or nginx) will terminate TLS in production (Phase 10).

**Uploaded images** (Phase 6) are stored on the server's disk in `MEDIA_STORAGE_DIR` (Docker: the `media-data` volume at `/app/.data/media`; with `pnpm start`, set an absolute path, because the standalone server runs from `.next/standalone`). Back this folder up together with the database: the database lists the files, the folder holds them. The app serves them itself at `/media/...` with year-long immutable caching, so a CDN or the reverse proxy can cache them. Image processing uses `sharp` (prebuilt libvips binaries, no build step). An S3-compatible adapter (MinIO is no longer published on Docker Hub; a managed Iranian S3 such as ArvanCloud Object Storage is an option) plugs in behind the same storage interface once the owner picks a provider; the `S3_*` variables are not read yet.

Upload limits and caching to set at the reverse proxy (Phase 10):
- Server Actions accept bodies up to 11 MB (`next.config.ts`) so admins can upload photos; Next.js applies that limit to every Server Action. Cap request bodies at the proxy at 1 MB everywhere except `/fa/admin/*` and `/en/admin/*` (nginx `client_max_body_size`), so anonymous requests can't send large bodies.
- `/media/*` responses are `immutable` for a year. A removed image stops being served by the app at once, but copies already in browsers or a proxy cache stay until they expire; purge the proxy cache when an image must disappear immediately.

## Authentication settings

- `AUTH_SECRET` (required in production, at least 32 characters): encrypts TOTP secrets and keys SMS-code hashes. Keep it in the server's secret store, back it up with the database, and do not rotate it casually: a new value makes existing two-factor enrolments unreadable (admins must enrol again).
- `SMS_PROVIDER`: `none` until a real provider adapter exists. `console` is refused in production.
- `TRUSTED_IP_HEADER` (`x-real-ip` default, or `x-forwarded-for`): the reverse proxy must **overwrite** that header with the client address (nginx: `proxy_set_header X-Real-IP $remote_addr;`). With `x-forwarded-for` the app uses the last entry, which the proxy appends. The app uses it for per-IP rate limits and security logs.
- Session cookies are `Secure` with the `__Host-` prefix in production builds, so the site must be served over HTTPS (local `http://localhost` works in Chrome and Firefox).
- First Super Admin: `docker compose --profile app run --rm migrate pnpm admin:create-super` (or `pnpm admin:create-super` on a checkout with `DATABASE_URL`). There is no web sign-up for admins; further admins are invited from the panel.
- Account recovery: `docker compose --profile app run --rm migrate pnpm admin:reset-link --username <name> [--reset-mfa]` prints a one-time link built from `APP_URL`, so set `APP_URL` to the public address. It signs the account out everywhere and is recorded in the audit log.
- `APP_URL` is also used for the password links shown in the admin panel.
- Content-Security-Policy is sent by the app (`proxy.ts`); a reverse proxy must not add a second, conflicting CSP header.

## Endpoints for monitoring
- `GET /api/health`: 200 while the process serves requests.
- `GET /api/ready`: 200 when the database is reachable, 503 otherwise.

## Building in restricted networks
Production servers never run `pnpm install`; images are built in CI and pushed to a registry the server can reach. If an image must be built where npm is blocked or behind a TLS-inspecting proxy:

```bash
docker build \
  --build-arg NPM_REGISTRY=https://<reachable-npm-mirror>/ \
  --secret id=extra_ca,src=/path/to/proxy-ca.pem \
  --target runtime -t clicksp-app .
```

## External network dependencies

| Dependency | Needed when | Reachability from Iranian hosting | Alternative |
|---|---|---|---|
| npm registry | build only | may be blocked or throttled | build in CI, or an npm mirror via `NPM_REGISTRY` |
| Docker Hub (`node`, `postgres`, `redis`, `getmeili/meilisearch`) | build / first pull | often blocked or rate-limited | mirror images to a reachable registry (ArvanCloud Container Registry or self-hosted) |
| GitHub (source, Actions) | development and CI | can be restricted | keep a mirror of the repository |
| Fonts | never at runtime | n/a | Vazirmatn is bundled in the build |
| Payment gateway (Zarinpal, Zibal, ...) | online payment, once connected | Iranian gateways, reachable from Iranian hosting; the customer's browser goes to the bank page and back to `/api/webhooks/payments/<provider>` | none yet: orders stay awaiting payment. `PAYMENT_PROVIDERS` lists the adapters; credentials are `<PREFIX>_*` server variables. `fake` is for development and tests only and is refused in production |
| SMS provider | customer phone sign-in, once chosen | must be an Iranian provider reachable from the server | none yet: phone sign-in is off |
| Authenticator apps | admins' phones only | offline (TOTP needs no network) | any RFC 6238 app |
| Google Fonts, CDNs, foreign SaaS | not used | n/a | n/a |

The running app has **no** runtime dependency on foreign services.
