#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE_ID="${1:?Release-ID fehlt}"
ARCHIVE="${2:?Archivpfad fehlt}"
DATABASE="${3:?Datenbankpfad fehlt}"
APP_DOMAIN="${4:?Testdomain fehlt}"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl caddy sqlite3 rsync ufw openssl xz-utils

if ! command -v node >/dev/null || [[ "$(node --version)" != v22.* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v google-chrome-stable >/dev/null; then
  curl -fsSLo /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y /tmp/google-chrome.deb
  rm -f /tmp/google-chrome.deb
fi

id helbling-rapporte >/dev/null 2>&1 || useradd --system --user-group --home /nonexistent --shell /usr/sbin/nologin helbling-rapporte
install -d -o root -g root -m 0755 /opt/helbling-rapporte/releases
install -d -o helbling-rapporte -g helbling-rapporte -m 0750 \
  /srv/helbling-rapporte/db /srv/helbling-rapporte/uploads /srv/helbling-rapporte/backups
install -d -o root -g helbling-rapporte -m 0750 /etc/helbling-rapporte

RELEASE_DIR="/opt/helbling-rapporte/releases/${RELEASE_ID}"
rm -rf -- "$RELEASE_DIR"
install -d -o root -g root -m 0755 "$RELEASE_DIR"
tar -xzf "$ARCHIVE" -C "$RELEASE_DIR"
cd "$RELEASE_DIR"
npm ci --omit=dev

if [[ -f /srv/helbling-rapporte/db/rapporte.db ]]; then
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  sqlite3 /srv/helbling-rapporte/db/rapporte.db ".backup '/srv/helbling-rapporte/backups/predeploy-${STAMP}.db'"
fi
install -o helbling-rapporte -g helbling-rapporte -m 0640 "$DATABASE" /srv/helbling-rapporte/db/rapporte.db
ln -sfn "$RELEASE_DIR" /opt/helbling-rapporte/current

if [[ ! -f /etc/helbling-rapporte/app.env ]]; then
  umask 0027
  cat > /etc/helbling-rapporte/app.env <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DB_PATH=/srv/helbling-rapporte/db/rapporte.db
SESSIONS_DB_DIR=/srv/helbling-rapporte/db
SESSIONS_DB_NAME=sessions.db
CUSTOMER_PORTAL_SESSIONS_DB_NAME=customer-portal-sessions.db
UPLOADS_DIR=/srv/helbling-rapporte/uploads
SESSION_SECRET=$(openssl rand -hex 32)
CUSTOMER_PORTAL_SESSION_SECRET=$(openssl rand -hex 32)
CHROMIUM_PATH=/usr/bin/google-chrome-stable
DISABLE_WATCHERS=1
EOF
  chown root:helbling-rapporte /etc/helbling-rapporte/app.env
  chmod 0640 /etc/helbling-rapporte/app.env
fi

install -o root -g root -m 0644 deploy/infomaniak/helbling-rapporte.service /etc/systemd/system/helbling-rapporte.service
install -o root -g helbling-rapporte -m 0750 deploy/infomaniak/backup-local.sh /usr/local/sbin/helbling-rapporte-backup
install -o root -g helbling-rapporte -m 0750 deploy/infomaniak/verify-backup.sh /usr/local/sbin/helbling-rapporte-verify-backup
install -o root -g root -m 0644 deploy/infomaniak/helbling-rapporte-backup.service /etc/systemd/system/helbling-rapporte-backup.service
install -o root -g root -m 0644 deploy/infomaniak/helbling-rapporte-backup.timer /etc/systemd/system/helbling-rapporte-backup.timer

sed -e '1,3d' -e 's/{$APP_DOMAIN:rapporte\.helbling\.net}/'"${APP_DOMAIN}"'/' deploy/infomaniak/Caddyfile > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl daemon-reload
systemctl enable --now helbling-rapporte.service
systemctl enable --now helbling-rapporte-backup.timer
systemctl enable --now caddy
systemctl restart caddy

for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error http://127.0.0.1:3000/healthz; then
    break
  fi
  if [[ "$attempt" -eq 30 ]]; then
    journalctl -u helbling-rapporte.service -n 80 --no-pager
    exit 1
  fi
  sleep 1
done
/usr/local/sbin/helbling-rapporte-backup
LATEST_BACKUP="$(find /srv/helbling-rapporte/backups -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1)"
/usr/local/sbin/helbling-rapporte-verify-backup "$LATEST_BACKUP"

printf 'Bereitgestellt: %s auf %s\n' "$RELEASE_ID" "$APP_DOMAIN"
