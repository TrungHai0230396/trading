#!/bin/sh
# Nightly MySQL backup loop for the backup sidecar.
#
# Dumps the whole database to /backups/tranding-YYYYMMDD-HHMMSS.sql.gz once
# a day, then prunes dumps older than DB_BACKUP_KEEP_DAYS. Self-contained
# in docker-compose — no host cron needed. Runs an initial dump ~60s after
# start so a fresh deploy has a snapshot immediately.
#
# NOTE: this is a LOCAL copy on the same host. For real safety, also copy
# /backups offsite (rclone to S3/Backblaze, or scp) — a disk failure that
# kills mysql-data can kill /backups too if they share the disk.

set -eu

: "${MYSQL_HOST:=mysql}"
: "${MYSQL_DATABASE:=tranding}"
: "${MYSQL_USER:=root}"
: "${MYSQL_PASSWORD:?MYSQL_PASSWORD required}"
: "${DB_BACKUP_KEEP_DAYS:=7}"
BACKUP_DIR=/backups
INTERVAL=$((24 * 60 * 60))

mkdir -p "$BACKUP_DIR"
sleep 60 # let mysql finish booting on first run

while true; do
  ts=$(date +%Y%m%d-%H%M%S)
  out="$BACKUP_DIR/tranding-$ts.sql.gz"
  echo "[backup] dumping $MYSQL_DATABASE -> $out"
  if mysqldump \
      -h "$MYSQL_HOST" \
      -u "$MYSQL_USER" \
      -p"$MYSQL_PASSWORD" \
      --single-transaction --quick --routines --triggers \
      "$MYSQL_DATABASE" 2>/tmp/dump.err | gzip > "$out"; then
    echo "[backup] ok: $(du -h "$out" | cut -f1)"
  else
    echo "[backup] FAILED:"; cat /tmp/dump.err
    rm -f "$out"
  fi
  # Prune old dumps.
  find "$BACKUP_DIR" -name 'tranding-*.sql.gz' -type f \
    -mtime "+$DB_BACKUP_KEEP_DAYS" -delete 2>/dev/null || true
  sleep "$INTERVAL"
done
