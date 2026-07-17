#!/usr/bin/env bash
set -Eeuo pipefail

DB_PATH="${DB_PATH:-/srv/helbling-rapporte/db/rapporte.db}"
UPLOADS_DIR="${UPLOADS_DIR:-/srv/helbling-rapporte/uploads}"
BACKUP_ROOT="${BACKUP_ROOT:-/srv/helbling-rapporte/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-35}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_ROOT}/${STAMP}"
TMP="${TARGET}.partial"

cleanup() { rm -rf -- "$TMP"; }
trap cleanup ERR INT TERM

install -d -m 0750 "$TMP"
sqlite3 "$DB_PATH" ".backup '${TMP}/rapporte.db'"
test "$(sqlite3 "${TMP}/rapporte.db" 'PRAGMA integrity_check;')" = "ok"

if [[ -d "$UPLOADS_DIR" ]]; then
  rsync -a --delete "$UPLOADS_DIR/" "$TMP/uploads/"
else
  install -d -m 0750 "$TMP/uploads"
fi

find "$TMP" -type f -print0 | sort -z | xargs -0 sha256sum > "${TMP}/SHA256SUMS"
mv -- "$TMP" "$TARGET"
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+${RETENTION_DAYS}" -exec rm -rf -- {} +
printf 'Backup geprüft: %s\n' "$TARGET"
