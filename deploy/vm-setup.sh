#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Novara AI — one-time VM bootstrap (run ON the e2-micro instance).
#
# WHAT THIS DOES: turns a bare Debian VM into a host that can run the Novara
# artifact produced by cloudbuild.yaml. Idempotent — safe to re-run.
#
# WHY A VM AND NOT CLOUD RUN (the decision this script encodes):
#   · SQLite needs a real POSIX filesystem. Cloud Run disks are ephemeral by
#     design, and the only durable option (Cloud Storage FUSE) lacks the file
#     locking semantics SQLite requires. The database IS the product — every
#     novel lives in it — so we do not gamble on it.
#   · The agent runtime is a resident process: runs last up to ~12 minutes,
#     renew a lease heartbeat every 10s, and hold SSE streams open. Keeping a
#     Cloud Run instance warm (min-instances=1 + CPU always allocated) costs
#     ~2.6M vCPU-seconds/month against a 240k free allowance — about 10x over.
#   · The always-free e2-micro gives us a resident process and a 30 GB
#     persistent disk for $0/month, forever.
#
# FREE-TIER DISCIPLINE (do not change these without re-checking the budget):
#   · machine type e2-micro, zone us-central1-a (free tier is US-region only)
#   · 30 GB standard (NOT balanced, NOT ssd) persistent disk — the free
#     allowance is for standard PD only
#   · no Ops Agent, no snapshots, no backups-by-default — all of those bill
#
# USAGE:  sudo bash deploy/vm-setup.sh
# ---------------------------------------------------------------------------
set -euo pipefail

log()  { printf '\033[1;32m[vm-setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[vm-setup]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[vm-setup] FAILED:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root: sudo bash deploy/vm-setup.sh"

NOVARA_HOME=/opt/novara
DATA_DIR=/var/lib/novara
ENV_DIR=/etc/novara
SERVICE_USER=novara

# ---------------------------------------------------------------------------
# 1. Sanity-check the machine before installing anything.
#    1 GB RAM is tight; if this is not the free-tier shape, say so loudly
#    instead of failing mysteriously halfway through a deploy.
# ---------------------------------------------------------------------------
TOTAL_MEM_KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
TOTAL_MEM_MB=$(( TOTAL_MEM_KB / 1024 ))
log "detected ${TOTAL_MEM_MB} MB RAM"
if (( TOTAL_MEM_MB < 850 )); then
  die "less than ~1 GB RAM detected. The runtime needs the free-tier e2-micro
       shape or larger; smaller instances will OOM during Prisma startup."
fi

# ---------------------------------------------------------------------------
# 2. Base packages. Node runs the standalone server; google-cloud-cli pulls the
#    artifact from Cloud Storage; sqlite3 is for ops/debugging only.
#    `unattended-upgrades` is deliberate: an unattended VM that never patches
#    is how a public repo becomes an incident.
# ---------------------------------------------------------------------------
if [[ ! -f /var/lib/apt/lists/lock ]]; then :; fi
export DEBIAN_FRONTEND=noninteractive
log "updating package index"
apt-get update -qq

log "installing base packages"
apt-get install -yqq --no-install-recommends \
  ca-certificates curl gnupg sqlite3 jq rsync tar \
  unattended-upgrades

# --- Node.js 22 LTS (Next.js 16 requires Node >= 20; 22 is the LTS line) ----
if ! command -v node >/dev/null || [[ "$(node -v | sed 's/^v//;s/\..*//')" -lt 20 ]]; then
  log "installing Node.js 22 LTS"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -yqq nodejs
else
  log "Node.js already present: $(node -v)"
fi
node -v >/dev/null || die "node install failed"

# --- Prisma CLI ------------------------------------------------------------
# The standalone artifact ships @prisma/client (runtime) but NOT the CLI — the
# file tracer only bundles what the module graph imports, and nothing imports
# the CLI. vm-deploy.sh needs it to reconcile the schema against the production
# database, so it is installed globally here. The version is pinned to the one
# the project already depends on; a mismatched CLI vs client produces confusing
# engine errors. Read it from the repo's own package.json when this script runs
# from a checkout, else fall back to the version in the committed lockfile.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PRISMA_VERSION=""
if [[ -f "$REPO_ROOT/package.json" ]]; then
  PRISMA_VERSION=$(node -e "
    const p = require('$REPO_ROOT/package.json');
    const raw = (p.dependencies && p.dependencies.prisma)
             || (p.devDependencies && p.devDependencies.prisma) || '';
    console.log(raw.replace(/[\^~>=<\s]/g, ''));
  " 2>/dev/null || echo "")
fi
# 6.19.2 is what the committed bun.lock resolves to as of 2026-11-07.
PRISMA_VERSION="${PRISMA_VERSION:-6.19.2}"
if ! command -v prisma >/dev/null; then
  log "installing Prisma CLI v${PRISMA_VERSION} globally"
  npm install -g "prisma@${PRISMA_VERSION}" >/dev/null
else
  log "prisma CLI already present: $(prisma -v 2>/dev/null | head -n1)"
fi
prisma -v >/dev/null 2>&1 || die "Prisma CLI install failed — vm-deploy.sh cannot reconcile the schema"

# --- gcloud CLI (for `gcloud storage cp` from the artifact bucket) ----------
if ! command -v gcloud >/dev/null; then
  log "installing google-cloud-cli"
  curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
    | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
    > /etc/apt/sources.list.d/google-cloud-sdk.list
  apt-get update -qq
  apt-get install -yqq google-cloud-cli
else
  log "gcloud already present"
fi

# ---------------------------------------------------------------------------
# 3. Unprivileged service user. The app must not run as root: a prompt-injection
#    or dependency-chain compromise then lands on a confined account with no
#    write access to /etc or /opt.
# ---------------------------------------------------------------------------
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  log "creating service user '$SERVICE_USER'"
  useradd --system --home-dir "$NOVARA_HOME" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# ---------------------------------------------------------------------------
# 4. Directory layout.
#      $NOVARA_HOME/releases/<id>/   immutable extracted artifacts
#      $NOVARA_HOME/current          symlink to the live release (atomic swap)
#      $NOVARA_HOME/previous         symlink kept for one-step rollback
#      $DATA_DIR                     SQLite database — OUTSIDE the release tree
#                                    so a deploy can never touch user novels
#      $ENV_DIR/novara.env           runtime config, root-owned, mode 600
#    The database living outside the artifact is the single most important line
#    in this script: deploys replace releases, never data.
# ---------------------------------------------------------------------------
log "creating directory layout"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 "$NOVARA_HOME/releases"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 "$DATA_DIR"
install -d -o root -g root -m 0750 "$ENV_DIR"

# ---------------------------------------------------------------------------
# 5. Runtime configuration. Created only if absent — a re-run of this script
#    must NEVER clobber credentials someone already configured.
#
#    DATABASE_URL uses an ABSOLUTE path. Prisma resolves a relative sqlite URL
#    against the schema file's directory (prisma/), which is how local dev ends
#    up with prisma/db/custom.db. Inside a release tree that would put the live
#    database in a directory the next deploy deletes. Absolute path removes the
#    ambiguity entirely.
# ---------------------------------------------------------------------------
ENV_FILE="$ENV_DIR/novara.env"
if [[ ! -f "$ENV_FILE" ]]; then
  log "writing $ENV_FILE (mode 600)"
  cat > "$ENV_FILE" <<'ENVEOF'
# Novara AI runtime configuration. Mode 600, root-owned.
# NEVER commit this file. It holds the model-gateway credential.

NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0

# Absolute path, deliberately outside /opt/novara/releases so no deploy can
# touch user data. This directory is on the VM's 30 GB persistent disk.
DATABASE_URL=file:/var/lib/novara/custom.db

# Disable Next.js telemetry: no reason to send usage data from a production box.
NEXT_TELEMETRY_DISABLED=1

# --- MODEL GATEWAY CREDENTIAL ------------------------------------------------
# The z-ai-web-dev-sdk reads baseUrl/apiKey from a .z-ai-config file searched at
# $PWD/.z-ai-config, $HOME/.z-ai-config, /etc/.z-ai-config (verified in
# node_modules/z-ai-web-dev-sdk/dist/index.js:7-27). We place it at
# /etc/.z-ai-config — the system-wide slot, so it survives release swaps and
# needs no per-release copy.
#
# TODO(operator): create /etc/.z-ai-config with:
#   {"baseUrl":"https://api.z.ai/api/paas/v4","apiKey":"<key>"}
# and:  chown root:novara /etc/.z-ai-config && chmod 640 /etc/.z-ai-config
# Until then every AI call fails at ZAI.create() (a pre-send failure: Policy F
# records no usage row, which is correct — the provider was never reached).
ENVEOF
  chmod 600 "$ENV_FILE"
  warn "$ENV_FILE created — review it, and create /etc/.z-ai-config before the"
  warn "first AI call. See the TODO inside the file."
else
  log "$ENV_FILE already exists — leaving it untouched"
fi

# ---------------------------------------------------------------------------
# 6. systemd unit.
#    · Restart=always is what makes the Phase 1 crash-recovery story real: if
#      the process dies, it comes back, and the run's lease goes stale after
#      240s so the author can resume it.
#    · StartLimitIntervalSec/Burst prevents a crash-loop from spinning forever.
#    · Hardening flags are cheap and reduce blast radius.
#    · TimeoutStopSec is generous: an in-flight agent turn should be allowed to
#      finish its fenced append rather than be SIGKILLed mid-write.
# ---------------------------------------------------------------------------
log "installing systemd unit"
cat > /etc/systemd/system/novara.service <<UNITEOF
[Unit]
Description=Novara AI (Next.js standalone + SQLite)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$NOVARA_HOME/current
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node $NOVARA_HOME/current/.next/standalone/server.js
Restart=always
RestartSec=5
StartLimitIntervalSec=300
StartLimitBurst=5
TimeoutStopSec=90
KillSignal=SIGTERM

# --- hardening (defence in depth; the app needs none of these) ---
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
# Write access is limited to the data directory. The release tree is read-only
# to the service, so a compromised app process cannot plant a persistent binary
# in the deployed code.
ReadWritePaths=$DATA_DIR
ReadOnlyPaths=$NOVARA_HOME

# Resource ceilings: 1 GB total, so cap the app and leave room for the OS.
MemoryMax=768M
TasksMax=256

[Install]
WantedBy=multi-user.target
UNITEOF

systemctl daemon-reload
systemctl enable novara.service >/dev/null 2>&1 || true
log "novara.service installed and enabled"

# ---------------------------------------------------------------------------
# 7. SQLite tuning for a slow shared-vCPU instance.
#    The app sets no PRAGMAs itself (verified: zero journal_mode/busy_timeout
#    hits in src/). On a 1 GB shared-vCPU box with a resident writer, the
#    defaults produce "database is locked" errors under concurrent agent runs.
#    WAL + a busy timeout is the standard remedy and is stored IN the database
#    file, so it must be applied once per database — hence here, not in code.
#
#    NOTE: WAL is safe for single-host access (which is exactly this topology).
#    It is NOT safe across network filesystems — one more reason Cloud Run's
#    FUSE mount was rejected.
# ---------------------------------------------------------------------------
DB_FILE="$DATA_DIR/custom.db"
if [[ -f "$DB_FILE" ]]; then
  log "applying SQLite WAL + busy_timeout to existing database"
  sqlite3 "$DB_FILE" "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=15000;" >/dev/null
  chown "$SERVICE_USER:$SERVICE_USER" "$DB_FILE" "$DATA_DIR" 2>/dev/null || true
else
  log "no database yet at $DB_FILE — vm-deploy.sh will create it on first deploy"
fi

# ---------------------------------------------------------------------------
# 8. Firewall: the app binds 3000 locally; only 80/443 face the internet.
#    Cloud Run/Vercel would have terminated TLS for us — on a VM we do it
#    ourselves. Caddy is used because the repo already ships a Caddyfile, and
#    Caddy issues and renews certificates automatically.
# ---------------------------------------------------------------------------
if ! command -v caddy >/dev/null; then
  log "installing Caddy (automatic HTTPS)"
  apt-get install -yqq debian-keyring debian-archive-keyring apt-transport-https
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -yqq caddy
else
  log "Caddy already present"
fi

# ---------------------------------------------------------------------------
# 9. Budget guardrail. This is the one thing that turns an unexpected spike
#    into a notification instead of a bill. It only helps if a billing budget
#    exists in the console — see DEPLOYMENT-GOOGLE.md §8.
# ---------------------------------------------------------------------------
log "installing daily disk/memory guard (novara-guard.timer)"
cat > /usr/local/bin/novara-guard.sh <<'GUARDEOF'
#!/usr/bin/env bash
# Cheap daily self-check. Writes to the journal; alerts are configured in the
# Cloud Monitoring console (free tier) against these log patterns.
set -uo pipefail
DISK_PCT=$(df -P /var/lib/novara | awk 'NR==2 {gsub("%",""); print $5}')
MEM_AVAIL_MB=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
echo "[novara-guard] disk=${DISK_PCT}% mem_avail=${MEM_AVAIL_MB}MB"
if (( DISK_PCT > 85 )); then
  echo "[novara-guard] ALERT disk usage ${DISK_PCT}% exceeds 85%"
  # The SQLite database grows with novels; the retention sweep only bounds the
  # usage ledger. Report the largest contributor rather than deleting anything.
  du -sh /var/lib/novara/* 2>/dev/null | sort -rh | head -n 5
fi
if (( MEM_AVAIL_MB < 120 )); then
  echo "[novara-guard] ALERT available memory ${MEM_AVAIL_MB}MB is critically low"
fi
GUARDEOF
chmod +x /usr/local/bin/novara-guard.sh

cat > /etc/systemd/system/novara-guard.service <<'GUARDSVC'
[Unit]
Description=Novara daily resource guard
[Service]
Type=oneshot
ExecStart=/usr/local/bin/novara-guard.sh
GUARDSVC

cat > /etc/systemd/system/novara-guard.timer <<'GUARDTIMER'
[Unit]
Description=Run the Novara resource guard daily
[Timer]
OnCalendar=daily
Persistent=true
[Install]
WantedBy=timers.target
GUARDTIMER

systemctl daemon-reload
systemctl enable --now novara-guard.timer >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 10. Install the deploy script where Cloud Build expects to find it.
#     cloudbuild.yaml's last step runs:
#       gcloud compute ssh novara-vm --command="sudo /opt/novara/vm-deploy.sh <bucket>"
#
#     GOTCHA this handles: when this file is used as a GCE startup-script
#     (--metadata-from-file=startup-script=deploy/vm-setup.sh), GCE copies it to
#     a temp path like /var/run/google.startup.tmp.XXXX/scripts/startup and runs
#     it from there — so `dirname $0` does NOT contain vm-deploy.sh. The sibling
#     copy only works when the script is run from a checkout. Hence: try the
#     sibling first, then pull from the artifact bucket (cloudbuild.yaml uploads
#     it there), and fail loudly if neither exists rather than leaving a deploy
#     that will 127 on its first run.
# ---------------------------------------------------------------------------
BUCKET_HINT="${NOVARA_BUCKET:-novara-artifacts}"
if [[ -f "$SCRIPT_DIR/vm-deploy.sh" ]]; then
  install -m 0755 "$SCRIPT_DIR/vm-deploy.sh" "$NOVARA_HOME/vm-deploy.sh"
  log "installed $NOVARA_HOME/vm-deploy.sh (from checkout)"
elif gcloud storage cp "gs://${BUCKET_HINT}/deploy/vm-deploy.sh" "$NOVARA_HOME/vm-deploy.sh" 2>/dev/null; then
  chmod 0755 "$NOVARA_HOME/vm-deploy.sh"
  log "installed $NOVARA_HOME/vm-deploy.sh (from gs://${BUCKET_HINT}/deploy/)"
else
  warn "vm-deploy.sh could not be installed automatically."
  warn "Run one of these on the VM before the first deploy:"
  warn "  gcloud storage cp gs://${BUCKET_HINT}/deploy/vm-deploy.sh /opt/novara/ && chmod +x /opt/novara/vm-deploy.sh"
  warn "  # or, from a git checkout: sudo bash deploy/vm-setup.sh"
fi

cat <<'DONE'

────────────────────────────────────────────────────────────────────────────
 VM bootstrap complete.

 Next steps (in order):
   1. Create the model-gateway credential:
        sudo tee /etc/.z-ai-config <<'JSON'
        {"baseUrl":"https://api.z.ai/api/paas/v4","apiKey":"<YOUR KEY>"}
        JSON
        sudo chown root:novara /etc/.z-ai-config && sudo chmod 640 /etc/.z-ai-config

   2. Point Caddy at your domain (or use the VM's external IP for a smoke test):
        sudo cp deploy/Caddyfile.production /etc/caddy/Caddyfile
        sudo systemctl reload caddy

   3. Deploy once by hand to prove the chain end to end:
        sudo /opt/novara/vm-deploy.sh <artifact-bucket>
        curl -s localhost:3000/api/health | jq

   4. Then wire the Cloud Build GitHub trigger (DEPLOYMENT-GOOGLE.md §5).

 Budget guards already active:
   · systemd MemoryMax=768M keeps the app inside the 1 GB instance
   · novara-guard.timer logs a daily disk/memory ALERT to the journal
   · Set a $1 budget alert in the console — the only real backstop (§8)
────────────────────────────────────────────────────────────────────────────
DONE
