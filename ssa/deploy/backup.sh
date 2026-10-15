#!/usr/bin/env bash
# SSA deployment backup: database dump + attachments archive.
#
#   ./backup.sh [output-dir]      # default: ./backups/<YYYYMMDD-HHMM>
#
# Database: PRISMA_DATABASE_URL from teable.env (works for Neon and localdb).
# Attachments: the teable-data volume (project name pinned to `ssa-teable`).
# Restore notes: see ssa/deploy/README.md § backups.
set -euo pipefail
cd "$(dirname "$0")"

OUT=${1:-backups/$(date +%Y%m%d-%H%M)}
mkdir -p "$OUT"

# 1. Database — pg_dump from a throwaway postgres image (no local client needed).
DB_URL=$(grep -E '^PRISMA_DATABASE_URL=' teable.env | head -n1 | cut -d= -f2-)
if [ -z "${DB_URL:-}" ]; then
  echo "PRISMA_DATABASE_URL not found in teable.env" >&2
  exit 1
fi
echo "Dumping database -> $OUT/db.sql"
docker run --rm postgres:15.4 pg_dump --no-owner --clean --if-exists "$DB_URL" >"$OUT/db.sql"

# 2. Attachments — the named volume (project name is pinned to `ssa-teable`).
echo "Archiving attachments -> $OUT/attachments.tgz"
docker run --rm \
  -v ssa-teable_teable-data:/data:ro \
  -v "$PWD/$OUT":/backup \
  alpine tar czf /backup/attachments.tgz -C /data .

echo "Done: $OUT"
