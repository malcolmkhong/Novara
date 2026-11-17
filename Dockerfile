# ---------------------------------------------------------------------------
# Novara AI — container image (multi-stage).
#
# STATUS: THIS IS the live deploy unit. cloudbuild.run.yaml (push to main)
# builds this image and deploys it to Cloud Run `novara` (asia-southeast1).
# The database is EXTERNAL (Neon Postgres); DATABASE_URL/DIRECT_URL are
# injected at runtime from Secret Manager. See README2.md §10 / README.md §9.
# (DEPLOYMENT-GOOGLE.md is an ARCHIVED 2026-11-07 VM+SQLite proposal that was
# never the production path — do not follow it.)
#
# Also usable for local reproducibility (`docker build`) and any non-Google
# Docker host. The legacy VM pipeline (cloudbuild.yaml + deploy/vm-*.sh) is
# unmaintained SQLite-era leftovers.
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

# Build-time placeholders only. The real DATABASE_URL is injected at runtime
# from Secret Manager and overrides this ENV. NEXT_PUBLIC_* is inlined into
# the client bundle at build time, so the allowlist must be present here.
ARG NEXT_PUBLIC_AI_PROVIDERS_ENABLED=gemini
ENV NEXT_PUBLIC_AI_PROVIDERS_ENABLED=$NEXT_PUBLIC_AI_PROVIDERS_ENABLED
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV DATABASE_URL=$DATABASE_URL

# Firebase public config (inlined into the client bundle at build time).
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=novara-514009.firebaseapp.com
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID=novara-514009
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=novara-514009.firebasestorage.app
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=9073132203
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ARG NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ENV NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID
ENV NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ENV NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID
ENV NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=$NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID

# Commit identity. Cloud Build injects it: --build-arg=GIT_SHA=$COMMIT_SHA.
# It is NOT a NEXT_PUBLIC_* var, so it is never inlined into the client
# bundle — it is read at runtime by /api/health, which reports the commit
# that is actually running.
ARG GIT_SHA
ENV GIT_SHA=$GIT_SHA

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

# The live database is EXTERNAL (Neon Postgres). Cloud Run injects the real
# DATABASE_URL/DIRECT_URL from Secret Manager at deploy time; no database URL
# is baked into the image. (The old SQLite default `file:/data/custom.db` was
# a pre-Postgres leftover and has been removed.)

# The commit this image was built from. Cloud Run also injects GIT_SHA via
# `--set-env-vars` (that value wins over the image ENV); re-declaring the ARG
# here keeps a plain `docker build` / `docker run` honest too.
ARG GIT_SHA
ENV GIT_SHA=$GIT_SHA

# Non-root runtime user
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs novara

COPY --from=build --chown=novara:nodejs /out /app
USER novara

EXPOSE 3000

# The container only serves; schema push/migrate is an explicit ops step
# (bun run db:push / db:migrate:deploy against the external Neon database)
# so a bad migration can never ride along silently with a deploy.
CMD ["bun", "server.js"]
