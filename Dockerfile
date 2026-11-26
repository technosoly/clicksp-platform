# syntax=docker/dockerfile:1.7
# Multi-stage build for the Clicksp Next.js app (standalone output).
# Images are built in CI and pushed to a registry the server can reach;
# production servers never run `pnpm install` (see docs/DEPLOYMENT.md).

ARG NODE_IMAGE=node:22-alpine

# Optional build inputs for restricted networks (e.g. building inside Iran):
#   --build-arg NPM_REGISTRY=https://<reachable npm mirror>/
#   --secret id=extra_ca,src=/path/to/ca.pem   (TLS-inspecting proxy CA)
ARG NPM_REGISTRY=https://registry.npmjs.org/

# ---- base: Node.js with the pinned pnpm version ----
FROM ${NODE_IMAGE} AS base
ARG NPM_REGISTRY
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY} \
    npm_config_registry=${NPM_REGISTRY}
WORKDIR /app
COPY package.json ./
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    corepack enable && corepack install

# ---- deps: install all dependencies from the lockfile ----
FROM base AS deps
COPY package.json pnpm-lock.yaml .npmrc ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca npm_config_cafile=/run/secrets/extra_ca; fi; \
    pnpm install --frozen-lockfile

# ---- build: generate Prisma client and build Next.js ----
FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate && pnpm build

# ---- migrate: one-off job that applies migrations, then the idempotent system seed ----
FROM build AS migrate
CMD ["sh", "-c", "pnpm prisma migrate deploy && pnpm db:seed"]

# ---- runtime: minimal image, non-root ----
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
# Uploaded images (MEDIA_STORAGE_DIR); mount a volume here and back it up.
RUN mkdir -p /app/.data/media && chown -R app:app /app/.data
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
