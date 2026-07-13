#!/usr/bin/env bash
# Back up the local dev database via pg_dump, run inside the `db` compose service.
set -euo pipefail

cd "$(dirname "$0")/../.."

OUT_DIR="infra/db/backups"
mkdir -p "$OUT_DIR"

OUT_FILE="${1:-$OUT_DIR/backup_$(date +%Y%m%d%H%M%S).dump}"

echo "Backing up database to $OUT_FILE..."
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$OUT_FILE"
echo "Backup complete: $OUT_FILE"
