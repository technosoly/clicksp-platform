#!/usr/bin/env bash
# Backs up the Clicksp database and uploaded files from the Docker Compose stack.
#   scripts/backup.sh [backup-dir]        (default: /var/backups/clicksp)
# Writes <dir>/clicksp-<UTC time>/{database.dump,media.tar.gz,SHA256SUMS} and
# keeps the newest KEEP complete backups (default 14). With BACKUP_AGE_RECIPIENT
# set (an age public key), the two files are also written encrypted (*.age) for
# the copy that leaves the server. Run daily from cron; a non-zero exit means
# the backup failed.
set -euo pipefail

dir="${1:-/var/backups/clicksp}"
keep="${KEEP:-14}"
if ! [[ "$keep" =~ ^[1-9][0-9]*$ ]]; then echo "KEEP must be a whole number of at least 1" >&2; exit 2; fi
repo="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$dir"
dir="$(cd "$dir" && pwd)"
case "$dir/" in "$repo"/*) echo "Keep backups outside the repository ($repo)" >&2; exit 2 ;; esac

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="${dir}/clicksp-${stamp}"
work="${final}.partial"
umask 077
mkdir "$work"
trap 'rm -rf -- "$work"' EXIT

# Database: custom format (compressed, restorable table by table), including
# the pgboss job queue schema.
docker compose exec -T postgres sh -c 'pg_dump --format=custom --no-owner -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$work/database.dump"
test -s "$work/database.dump"

# Uploaded images and private import files (the media-data volume).
docker compose run --rm --no-deps -T --user root --entrypoint tar -v "$work":/backup app \
  -czf /backup/media.tar.gz -C /app/.data/media .
test -s "$work/media.tar.gz"

(cd "$work" && sha256sum database.dump media.tar.gz > SHA256SUMS)

if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  for f in database.dump media.tar.gz; do age -r "$BACKUP_AGE_RECIPIENT" -o "$work/$f.age" "$work/$f"; done
fi

mv -- "$work" "$final"
trap - EXIT
echo "backup written to $final"

# Keep the newest $keep complete backups (folders with SHA256SUMS).
find "$dir" -mindepth 1 -maxdepth 1 -type d -name 'clicksp-*' ! -name '*.partial' -print0 \
  | sort -z \
  | while IFS= read -r -d '' d; do [ -f "$d/SHA256SUMS" ] && printf '%s\0' "$d"; done \
  | head -z -n -"$keep" \
  | xargs -0r rm -rf --
