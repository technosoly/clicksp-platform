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

Object storage is not in the stack yet. The community MinIO images are no longer published on Docker Hub, so the S3-compatible service (or a managed Iranian S3 such as ArvanCloud Object Storage) is chosen with the media module in Phase 6.

## Authentication settings

- `AUTH_SECRET` (required in production, at least 32 characters): encrypts TOTP secrets and keys SMS-code hashes. Keep it in the server's secret store, back it up with the database, and do not rotate it casually: a new value makes existing two-factor enrolments unreadable (admins must enrol again).
- `SMS_PROVIDER`: `none` until a real provider adapter exists. `console` is refused in production.
- `TRUSTED_IP_HEADER` (`x-real-ip` default, or `x-forwarded-for`): the reverse proxy must **overwrite** that header with the client address (nginx: `proxy_set_header X-Real-IP $remote_addr;`). With `x-forwarded-for` the app uses the last entry, which the proxy appends. The app uses it for per-IP rate limits and security logs.
- Session cookies are `Secure` with the `__Host-` prefix in production builds, so the site must be served over HTTPS (local `http://localhost` works in Chrome and Firefox).
- First Super Admin: `docker compose --profile app run --rm migrate pnpm admin:create-super` (or `pnpm admin:create-super` on a checkout with `DATABASE_URL`). There is no web sign-up for admins.

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
| SMS provider | customer phone sign-in, once chosen | must be an Iranian provider reachable from the server | none yet: phone sign-in is off |
| Authenticator apps | admins' phones only | offline (TOTP needs no network) | any RFC 6238 app |
| Google Fonts, CDNs, foreign SaaS | not used | n/a | n/a |

The running app has **no** runtime dependency on foreign services.
