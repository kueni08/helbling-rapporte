#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_DIR="${1:?Aufruf: verify-backup.sh /pfad/zum/backup}"
test -f "${BACKUP_DIR}/rapporte.db"
test -f "${BACKUP_DIR}/SHA256SUMS"
(cd "$BACKUP_DIR" && sha256sum --check SHA256SUMS)
test "$(sqlite3 "${BACKUP_DIR}/rapporte.db" 'PRAGMA integrity_check;')" = "ok"
printf 'Backup vollständig und SQLite-integr: %s\n' "$BACKUP_DIR"
