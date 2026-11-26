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
| Google Fonts, CDNs, foreign SaaS | not used | n/a | n/a |

The running app has **no** runtime dependency on foreign services.
