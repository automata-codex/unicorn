#!/usr/bin/env bash
# Restore the local dev database from a pg_dump custom-format file, run inside the `db` compose service.
# Drops and recreates existing objects before restoring — destructive, local dev only.
# Set DB_BACKUP_DIR to change where a bare filename (no "/") is looked up (default: infra/db/backups).
set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup-file>" >&2
  exit 1
fi

BACKUP_DIR="${DB_BACKUP_DIR:-infra/db/backups}"

FILE="$1"
if [[ "$FILE" != */* ]]; then
  FILE="$BACKUP_DIR/$FILE"
fi
if [[ ! -f "$FILE" ]]; then
  echo "Backup file not found: $FILE" >&2
  exit 1
fi

echo "This will drop and recreate all objects in the local dev database from $FILE."
read -r -p "Continue? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Aborted."
  exit 1
fi

echo "Restoring database from $FILE..."
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < "$FILE"
echo "Restore complete."
