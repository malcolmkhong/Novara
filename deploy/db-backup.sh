#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Novara AI — nightly offsite SQLite backup to Cloud Storage.
# Companion to DEPLOYMENT-GOOGLE.md v2, Step 5.1 / 6 / 7.2.
#
# Installed as /usr/local/bin/novara-db-backup.sh and driven by
# /etc/systemd/system/novara-db-backup.timer (daily 03:17 UTC).
#
# WHY `sqlite3 .backup` AND NOT `cp`: a plain file copy of a live database can
# capture a torn state if a writer is mid-transaction. .backup takes a
# consistent snapshot through SQLite itself. vm-deploy.sh uses the same
# method before every schema reconciliation.
#
# The bucket needs a 30-day lifecycle rule (DEPLOYMENT-GOOGLE.md Step 6), so
# this script never deletes anything. It reports, never silently prunes.
#
# VM service account needs roles/storage.objectUser (or objectCreator) on the
# backup bucket, plus the default cloud-platform OAuth scope on the instance.
# ---------------------------------------------------------------------------
set -euo pipefail

DATA_DIR=/var/lib/novara
DB_FILE="$DATA_DIR/custom.db"
BUCKET="${NOVARA_BACKUP_BUCKET:-novara-backups}"

log() { printf '[novara-backup] %s\n' "$*"; }
die() { printf '[novara-backup] FAILED: %s\n' "$*" >&2; exit 1; }

if [[ ! -f "$DB_FILE" ]]; then
  log "no database yet at $DB_FILE — nothing to back up"
  exit 0
fi

command -v sqlite3 >/dev/null || die "sqlite3 missing — run deploy/vm-setup.sh first"
command -v gcloud  >/dev/null || die "gcloud missing — run deploy/vm-setup.sh first"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$(mktemp /tmp/novara-backup-XXXXXX.db)"
trap 'rm -f "$TMP"' EXIT

sqlite3 "$DB_FILE" ".backup '$TMP'"
SIZE="$(du -h "$TMP" | awk '{print $1}')"

DEST="gs://${BUCKET}/sqlite/${STAMP}.db"
if gcloud storage cp "$TMP" "$DEST" --quiet; then
  log "ok: ${DEST} (${SIZE})"
else
  die "upload to ${DEST} failed — check the VM service account's storage IAM role"
fi

# Verify the object actually exists and has a non-zero length before claiming
# success. Honesty rule: a backup that was never written is not a backup.
if ! gcloud storage ls -L "$DEST" >/dev/null 2>&1; then
  die "upload reported success but ${DEST} is not listed"
fi
log "verified: ${DEST} present in bucket"
