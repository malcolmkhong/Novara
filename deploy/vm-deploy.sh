#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Novara AI — atomic release deploy (runs ON the VM, invoked by Cloud Build).
#
# USAGE: sudo /opt/novara/vm-deploy.sh <artifact-bucket> [release-tarball-name]
#        (no second arg ⇒ deploys gs://<bucket>/latest.tar.gz)
#
# CONTRACT — three properties this script must never lose:
#
#  1. ATOMIC SWAP. `current` is a symlink; we build the new release in a
#     sibling directory and `ln -sfn` it into place. A reader either sees the
#     old release or the new one, never a half-written tree.
#
#  2. DATA IS NEVER TOUCHED. The SQLite database lives in /var/lib/novara,
#     outside the release tree. This script has no `rm` path that can reach it.
#     (Verified by the guard in step 2 below — if DATA_DIR ever resolved inside
#     a release directory, the script refuses to run.)
#
#  3. HEALTH-GATED PROMOTION. The new release is verified on a staging port
#     BEFORE `current` is repointed. If it fails, the live release keeps serving
#     and the deploy exits non-zero — so Cloud Build reports failure and nothing
#     was lost. This is what makes "GitHub push ⇒ deploy" safe to leave on.
#
# ROLLBACK: /opt/novara/previous always points at the release before the current
# one, so `sudo /opt/novara/vm-deploy.sh --rollback` restores it in seconds.
# ---------------------------------------------------------------------------
set -euo pipefail

log()  { printf '\033[1;32m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[deploy] FAILED:\033[0m %s\n' "$*" >&2; exit 1; }

NOVARA_HOME=/opt/novara
DATA_DIR=/var/lib/novara
ENV_FILE=/etc/novara/novara.env
SERVICE=novara.service
LIVE_PORT=3000
STAGE_PORT=3100
HEALTH_RETRIES=30        # 30 × 2s = up to 60s for the server to become ready
DB_FILE="$DATA_DIR/custom.db"

[[ $EUID -eq 0 ]] || die "run as root (Cloud Build's ssh step uses sudo)"

# ---------------------------------------------------------------------------
# 0. Rollback path — handled first because it must work even if the bucket,
#    the network, or the artifact are all broken.
# ---------------------------------------------------------------------------
if [[ "${1:-}" == "--rollback" ]]; then
  [[ -L "$NOVARA_HOME/previous" ]] || die "no previous release to roll back to"
  PREV=$(readlink -f "$NOVARA_HOME/previous")
  [[ -d "$PREV" ]] || die "previous release directory is gone: $PREV"
  log "ROLLING BACK to $PREV"
  ln -sfn "$PREV" "$NOVARA_HOME/current"
  systemctl restart "$SERVICE"
  sleep 3
  systemctl is-active --quiet "$SERVICE" \
    && log "rollback OK — service active on $PREV" \
    || die "rollback left the service inactive; investigate: journalctl -u $SERVICE -n 100"
  exit 0
fi

BUCKET="${1:-}"
[[ -n "$BUCKET" ]] || die "usage: vm-deploy.sh <artifact-bucket> [release-name]"
ARTIFACT="${2:-latest.tar.gz}"
GCS_URI="gs://${BUCKET}/${ARTIFACT}"
[[ "$ARTIFACT" == *.tar.gz ]] || GCS_URI="gs://${BUCKET}/releases/${ARTIFACT}"

# ---------------------------------------------------------------------------
# 1. Guard: the data directory must NOT live inside the release tree.
#    If someone ever edits NOVARA_HOME or DATA_DIR such that a deploy could
#    delete user novels, stop here rather than discovering it in production.
# ---------------------------------------------------------------------------
case "$(readlink -f "$DATA_DIR")" in
  "$(readlink -f "$NOVARA_HOME")"/*)
    die "REFUSING TO RUN: DATA_DIR ($DATA_DIR) resolves inside NOVARA_HOME.
         Deploys replace the release tree; the database must live outside it."
    ;;
esac
[[ -f "$ENV_FILE" ]] || die "missing $ENV_FILE — run deploy/vm-setup.sh first"
[[ -f "$NOVARA_HOME/vm-deploy.sh" ]] || warn "running from a non-standard path"

# ---------------------------------------------------------------------------
# 2. Fetch the artifact into a fresh release directory.
# ---------------------------------------------------------------------------
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
SHORT_SHA="${COMMIT_SHA:-${GITHUB_SHA:-manual}}"
RELEASE_ID="${STAMP}-${SHORT_SHA:0:12}"
RELEASE_DIR="$NOVARA_HOME/releases/$RELEASE_ID"

log "fetching $GCS_URI"
install -d -m 0755 "$RELEASE_DIR"

# `gcloud storage cp` is the current command; `gsutil` is still present in the
# image but is on a deprecation path. Try the modern one, fall back.
if ! gcloud storage cp "$GCS_URI" "$RELEASE_DIR/release.tar.gz" 2>/dev/null; then
  warn "gcloud storage cp failed — falling back to gsutil"
  gsutil -q cp "$GCS_URI" "$RELEASE_DIR/release.tar.gz" \
    || die "could not download $GCS_URI"
fi

log "extracting"
tar -xzf "$RELEASE_DIR/release.tar.gz" -C "$RELEASE_DIR"
rm -f "$RELEASE_DIR/release.tar.gz"

# The artifact must contain the server entry point and the release metadata.
[[ -f "$RELEASE_DIR/server.js" ]] \
  || die "artifact is malformed: no server.js at its root (did the build run assemble-standalone?)"

# ---------------------------------------------------------------------------
# 3. Platform check: a Windows-built Prisma engine cannot run here.
#    This is the single most likely silent failure when someone builds on a
#    workstation and uploads by hand, so check it explicitly instead of letting
#    the server die with "Query engine library not found".
# ---------------------------------------------------------------------------
ENGINE_DIR="$RELEASE_DIR/node_modules/.prisma/client"
[[ -d "$ENGINE_DIR" ]] || die "no Prisma client in the artifact: $ENGINE_DIR"
if compgen -G "$ENGINE_DIR/*windows*" > /dev/null; then
  die "the artifact contains a WINDOWS Prisma engine — it cannot run on this
       Linux VM. Build inside Cloud Build (Linux), not on a workstation."
fi
if ! compgen -G "$ENGINE_DIR/*query_engine*.so" > /dev/null \
   && ! compgen -G "$ENGINE_DIR/libquery_engine*" > /dev/null; then
  warn "no Linux Prisma query engine matched the expected names; listing what is there:"
  ls -1 "$ENGINE_DIR" | sed 's/^/         /'
fi

# ---------------------------------------------------------------------------
# 4. Database: create on first deploy, then reconcile the schema.
#
#    `prisma db push` WITHOUT --accept-data-loss is deliberate. package.json
#    originally shipped `db:push: --accept-data-loss`, which on a production
#    database means a schema mismatch silently destroys columns — i.e. user
#    novels. Here the flag is absent, so a destructive change FAILS the deploy
#    and a human decides. `db:push:dev` keeps the old behaviour for local work.
#
#    A backup is taken first regardless: on a 1 GB VM a copy of the SQLite file
#    is cheap, and it is the only thing standing between a bad migration and
#    permanent loss.
# ---------------------------------------------------------------------------
if [[ ! -f "$DB_FILE" ]]; then
  log "first deploy — creating the database at $DB_FILE"
  install -d -o novara -g novara -m 0755 "$DATA_DIR"
fi

if [[ -f "$DB_FILE" ]]; then
  BACKUP="$DATA_DIR/backups/custom-$(date -u +%Y%m%dT%H%M%SZ).db"
  install -d -o novara -g novara -m 0750 "$DATA_DIR/backups"
  log "backing up the database to $BACKUP"
  # sqlite3 .backup is the safe way to copy a live database (a plain file copy
  # can capture a torn state if a writer is mid-transaction).
  sqlite3 "$DB_FILE" ".backup '$BACKUP'"
  chown novara:novara "$BACKUP"
  # Keep the 5 most recent backups; the database grows with every novel, and
  # the disk is 30 GB with a 1 GB/month egress budget.
  ls -1t "$DATA_DIR"/backups/*.db 2>/dev/null | tail -n +6 | xargs -r rm -f
fi

log "reconciling the schema (non-destructive)"
# The standalone artifact contains @prisma/client (the runtime) but NOT the
# prisma CLI — verified empirically: .next/standalone/node_modules has no
# `prisma` package and no `.bin`. So we call the CLI that vm-setup.sh installs
# globally, and point it explicitly at the schema inside this release. That
# pairing is what makes schema drift between artifact and database detectable.
#
# NOTE: --accept-data-loss is deliberately ABSENT. package.json originally
# shipped it on `db:push`, which on a production database means a schema
# mismatch silently destroys columns — i.e. user novels. Without the flag a
# destructive change fails the deploy and a human decides. `db:push:dev` keeps
# the old behaviour for local work.
set -a; . "$ENV_FILE"; set +a
if ! prisma db push \
      --schema "$RELEASE_DIR/prisma/schema.prisma" \
      --skip-generate 2>&1 | tee /tmp/novara-dbpush.log; then
  die "prisma db push failed. The deploy is aborted BEFORE promotion, so the live
       release is unaffected. If the change is destructive and intended, apply it
       manually — this script will never pass --accept-data-loss in production."
fi

# SQLite tuning is stored in the database file, so it must be applied per
# database. WAL + a busy timeout are what stop "database is locked" errors when
# several agent runs write concurrently on a single-vCPU box.
log "applying SQLite WAL + busy_timeout"
sqlite3 "$DB_FILE" "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=15000;" > /dev/null
chown -R novara:novara "$DATA_DIR"

# ---------------------------------------------------------------------------
# 5. Start the candidate release on a STAGING port and health-check it.
#    Nothing about the live service is touched yet.
# ---------------------------------------------------------------------------
log "starting the candidate release on port $STAGE_PORT"
set -a; . "$ENV_FILE"; set +a
STAGE_LOG=/tmp/novara-stage-$RELEASE_ID.log
(
  cd "$RELEASE_DIR"
  PORT=$STAGE_PORT HOSTNAME=127.0.0.1 NODE_ENV=production \
    su -s /bin/bash novara -c "exec node $RELEASE_DIR/server.js" \
    > "$STAGE_LOG" 2>&1
) &
STAGE_PID=$!

cleanup_stage() {
  if kill -0 "$STAGE_PID" 2>/dev/null; then
    kill "$STAGE_PID" 2>/dev/null || true
    wait "$STAGE_PID" 2>/dev/null || true
  fi
}
trap cleanup_stage EXIT

HEALTH_OK=0
for i in $(seq 1 "$HEALTH_RETRIES"); do
  sleep 2
  # /api/health actually queries the database and returns 503 if it cannot, so
  # a 200 here means "server up AND database reachable" — not just "port open".
  if curl -fsS --max-time 5 "http://127.0.0.1:$STAGE_PORT/api/health" > /tmp/novara-health.json 2>/dev/null; then
    HEALTH_OK=1
    break
  fi
  if ! kill -0 "$STAGE_PID" 2>/dev/null; then
    warn "candidate process exited early; log tail:"
    tail -n 40 "$STAGE_LOG" | sed 's/^/         /'
    break
  fi
  (( i % 5 == 0 )) && log "waiting for the candidate to become ready ($i/$HEALTH_RETRIES)"
done

if (( HEALTH_OK != 1 )); then
  warn "candidate health log:"
  tail -n 60 "$STAGE_LOG" | sed 's/^/         /'
  rm -rf "$RELEASE_DIR"
  die "health gate failed — the live release was NOT replaced. Nothing is lost."
fi

log "health gate passed: $(jq -c '{status,release:.release.commit,database:.database.ok}' /tmp/novara-health.json 2>/dev/null || cat /tmp/novara-health.json)"
cleanup_stage
trap - EXIT

# ---------------------------------------------------------------------------
# 6. Promote: repoint `previous` and `current`, then restart the service.
# ---------------------------------------------------------------------------
if [[ -L "$NOVARA_HOME/current" ]]; then
  OLD=$(readlink -f "$NOVARA_HOME/current")
  ln -sfn "$OLD" "$NOVARA_HOME/previous"
  log "previous release -> $OLD"
fi

ln -sfn "$RELEASE_DIR" "$NOVARA_HOME/current"
chown -R novara:novara "$RELEASE_DIR"
log "promoted $RELEASE_ID"

log "restarting $SERVICE"
systemctl restart "$SERVICE"

# Verify the LIVE service, not just the candidate.
for i in $(seq 1 "$HEALTH_RETRIES"); do
  sleep 2
  if curl -fsS --max-time 5 "http://127.0.0.1:$LIVE_PORT/api/health" > /tmp/novara-live-health.json 2>/dev/null; then
    log "live health OK: $(jq -c '{status,uptime:.uptimeSeconds,pid:.runtime.pid,db:.database.ok,novels:.database.novels}' /tmp/novara-live-health.json 2>/dev/null || true)"
    break
  fi
  if (( i == HEALTH_RETRIES )); then
    warn "the live service did not become healthy after promotion — rolling back"
    "$0" --rollback || true
    die "deploy failed post-promotion; rolled back to the previous release"
  fi
done

# ---------------------------------------------------------------------------
# 7. Prune old releases. Keep 3 (current + previous + one more) so a rollback
#    is always possible and the 30 GB disk does not fill. The artifact is
#    ~124 MB uncompressed, so 3 releases ≈ 370 MB.
# ---------------------------------------------------------------------------
log "pruning old releases (keeping 3)"
ls -1dt "$NOVARA_HOME"/releases/*/ 2>/dev/null | tail -n +4 | while read -r old; do
  old="${old%/}"
  # Never delete the release `current` or `previous` points at.
  if [[ "$old" == "$(readlink -f "$NOVARA_HOME/current")" ]] \
     || [[ "$old" == "$(readlink -f "$NOVARA_HOME/previous" 2>/dev/null || echo /nonexistent)" ]]; then
    continue
  fi
  log "removing $old"
  rm -rf "$old"
done

log "deploy complete: $RELEASE_ID"
systemctl --no-pager --lines=5 status "$SERVICE" | sed 's/^/         /' || true
