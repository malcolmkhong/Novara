#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Novara AI — fetch platform secrets from Secret Manager at service start.
# Companion to DEPLOYMENT-GOOGLE.md v2, Step 7.2.
#
# Installed as /usr/local/bin/novara-fetch-secrets.sh, invoked by
#   ExecStartPre=/usr/local/bin/novara-fetch-secrets.sh
# in /etc/systemd/system/novara.service.
#
# WHY: credentials belong to Secret Manager, not to the release artifact.
# This runs as root using the VM's ATTACHED service account (no JSON key,
# no long-lived credential file), writes two root-owned files, then exits.
# The service account needs roles/secretmanager.secretAccessor.
#
# CONTRACT:
#   · /etc/novara/novara.env  mode 600 root:root  — systemd EnvironmentFile
#     (read by systemd as root; the app runs as the unprivileged `novara` user)
#   · /etc/.z-ai-config      mode 640 root:novara — z-ai-web-dev-sdk reads
#     baseUrl/apiKey from this file; it does NOT read environment variables.
#   · NEVER log secret values. Only "ok"/"warn" status lines.
#   · A missing optional secret must NOT prevent the service from starting;
#     a missing REQUIRED secret must fail loudly (better a 5xx than a
#     silently unauthenticated or unconfigured app).
# ---------------------------------------------------------------------------
set -euo pipefail

ENV_DIR=/etc/novara
ENV_FILE="$ENV_DIR/novara.env"
ZAI_FILE=/etc/.z-ai-config
SERVICE_GROUP=novara

log()  { printf '[novara-secrets] %s\n' "$*"; }
die()  { printf '[novara-secrets] FAILED: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "must run as root (systemd ExecStartPre)"

# Project id comes from the metadata server — no hard-coded project here.
PROJECT_ID="$(curl -fsS --max-time 5 -H 'Metadata-Flavor: Google' \
  'http://metadata.google.internal/computeMetadata/v1/project/project-id')" \
  || die "cannot read project id from the metadata server"
[[ -n "$PROJECT_ID" ]] || die "empty project id"

command -v gcloud >/dev/null || die "gcloud CLI missing — run deploy/vm-setup.sh first"

access() {
  # Args: <secret-name> <required|optional>
  local name="$1" mode="$2" value
  if value="$(gcloud secrets versions access latest \
        --secret="$name" --project="$PROJECT_ID" 2>/dev/null)"; then
    printf '%s' "$value"
    return 0
  fi
  if [[ "$mode" == "required" ]]; then
    die "secret '$name' is unavailable (check the VM service account has roles/secretmanager.secretAccessor)"
  fi
  log "WARN: optional secret '$name' unavailable — leaving empty"
  return 1
}

AUTH_SECRET="$(access novara-auth-secret required)"
GOOGLE_CLIENT_ID="$(access novara-google-client-id required)"
ALLOWED_EMAILS="$(access novara-allowed-emails required)"
ZAI_CONFIG="$(access novara-zai-config required)"
PROVIDER_EXTRAS="$(access novara-provider-extras optional || true)"

[[ ${#AUTH_SECRET} -ge 32 ]] || die "novara-auth-secret is shorter than 32 bytes"
[[ -n "$ALLOWED_EMAILS" ]]  || die "novara-allowed-emails is empty — refusing to start with open sign-in"

install -d -o root -g root -m 0750 "$ENV_DIR"
umask 077

# systemd EnvironmentFile is line-oriented KEY=VALUE with no shell expansion.
# Values must not contain newlines or '#'. All five secrets satisfy that.
# Write atomically so a crashed fetch can never leave a half-written env file.
TMP="$(mktemp "$ENV_DIR/.novara.env.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
{
  printf 'NODE_ENV=production\n'
  printf 'PORT=3000\n'
  printf 'HOSTNAME=0.0.0.0\n'
  printf 'NEXT_TELEMETRY_DISABLED=1\n'
  # Absolute path: a relative sqlite URL resolves against prisma/, which is
  # inside the release tree and would be deleted by the next deploy.
  printf 'DATABASE_URL=file:/var/lib/novara/custom.db\n'
  printf 'AUTH_SECRET=%s\n' "$AUTH_SECRET"
  printf 'GOOGLE_CLIENT_ID=%s\n' "$GOOGLE_CLIENT_ID"
  printf 'ALLOWED_GOOGLE_EMAILS=%s\n' "$ALLOWED_EMAILS"
  # Placeholder only — the current code reads no provider env vars. Kept here
  # so adding a provider later does not require changing this script's shape.
  printf 'NOVARA_PROVIDER_EXTRAS_CONFIGURED=%s\n' \
    "$([[ -n "$PROVIDER_EXTRAS" ]] && printf '1' || printf '0')"
} > "$TMP"
mv -f "$TMP" "$ENV_FILE"
trap - EXIT
chmod 600 "$ENV_FILE"
chown root:root "$ENV_FILE"

# z.ai SDK searches $PWD/.z-ai-config → $HOME/.z-ai-config → /etc/.z-ai-config.
# The system-wide slot survives release swaps and needs no per-release copy.
ZAI_TMP="$(mktemp /etc/.z-ai-config.XXXXXX)"
printf '%s\n' "$ZAI_CONFIG" > "$ZAI_TMP"
chmod 640 "$ZAI_TMP"
chown root:"$SERVICE_GROUP" "$ZAI_TMP"
mv -f "$ZAI_TMP" "$ZAI_FILE"

log "ok: wrote $ENV_FILE (600) and $ZAI_FILE (640)"
