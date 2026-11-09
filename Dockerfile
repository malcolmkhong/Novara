# ---------------------------------------------------------------------------
# Novara AI — container image (multi-stage).
#
# STATUS: NOT the primary deployment path. The primary path is
# cloudbuild.yaml + deploy/vm-*.sh (see DEPLOYMENT-GOOGLE.md §2 for why:
# Cloud Run cannot give SQLite a durable POSIX filesystem within the free
# tier, and a warm instance exceeds the free vCPU-second allowance ~10x).
#
# This Dockerfile exists for three legitimate reasons:
#   1. Local reproducibility — `docker build` proves the artifact is self-contained.
#   2. The future Postgres migration — once the DB is external, Cloud Run
#      becomes viable and this file is the deploy unit.
#   3. Any non-Google host (a plain VPS with Docker) can run it unchanged.
#
# If you use it against SQLite you MUST mount a real volume at /data and set
# DATABASE_URL to an absolute path inside it. Never point it at ephemeral
# container storage — the database would vanish on restart.
# ---------------------------------------------------------------------------

# ---- build stage -----------------------------------------------------------
FROM oven/bun:1.3 AS build
WORKDIR /app

# deps first for layer caching
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Prisma client generation must precede the Next build (it type-checks against it)
RUN bun run db:generate

ENV NEXT_TELEMETRY_DISABLED=1
RUN bunx next build

# Assemble the standalone runtime tree explicitly (next build does not copy
# static/public into standalone on its own).
RUN set -eux; \
    mkdir -p /out; \
    cp -r .next/standalone/. /out/; \
    mkdir -p /out/.next/static; \
    cp -r .next/static/. /out/.next/static/; \
    cp -r public /out/public; \
    cp -r agent /out/agent; \
    cp -r prisma /out/prisma; \
    rm -f /out/prisma/db/*.db /out/prisma/db/*.db-* || true; \
    cp -r scripts /out/scripts || true; \
    cp package.json bun.lock /out/

# ---- runtime stage ---------------------------------------------------------
FROM oven/bun:1.3-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Absolute path is deliberate: a relative sqlite URL resolves against the
# schema file's directory (prisma/), which is how the current dev layout ends
# up at prisma/db/custom.db. Absolute removes that ambiguity in a container.
ENV DATABASE_URL=file:/data/custom.db

# Non-root runtime user
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs novara \
 && mkdir -p /data \
 && chown -R novara:nodejs /data

COPY --from=build --chown=novara:nodejs /out /app
USER novara

VOLUME ["/data"]
EXPOSE 3000

# The container only serves; schema push/migrate is an explicit ops step
# (see deploy/vm-deploy.sh) so a bad migration can never ride along silently
# with a deploy.
CMD ["bun", ".next/standalone/server.js"]
