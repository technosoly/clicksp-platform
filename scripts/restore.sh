#!/usr/bin/env bash
# Restores a backup made by scripts/backup.sh into the Docker Compose stack.
#   scripts/restore.sh <backup-folder> --yes
# It REPLACES the current database and uploaded files. Stop the app first:
#   docker compose --profile app stop app
set -euo pipefail

src="${1:?usage: scripts/restore.sh <backup-folder> --yes}"
if [ "${2:-}" != "--yes" ]; then
  echo "This replaces the database and uploaded files with $src. Run again with --yes to continue." >&2
  exit 2
fi
src="$(cd "$src" && pwd)"
(cd "$src" && sha256sum --check --quiet SHA256SUMS)
if [ -n "$(docker compose --profile app ps --status running -q app)" ]; then
  echo "The app is running; stop it first: docker compose --profile app stop app" >&2
  exit 2
fi

docker compose exec -T postgres sh -c 'dropdb --force -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T postgres sh -c 'pg_restore --no-owner --exit-on-error --single-transaction -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$src/database.dump"

docker compose run --rm --no-deps -T --user root --entrypoint sh -v "$src":/backup:ro app \
  -c 'find /app/.data/media -mindepth 1 -delete && tar -xzf /backup/media.tar.gz -C /app/.data/media'

echo "restored from $src; start the app: docker compose --profile app up -d app"
