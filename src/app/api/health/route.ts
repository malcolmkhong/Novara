// ---------------------------------------------------------------------------
// Novara AI — deployment health endpoint (added 2026-11-07 for the Google
// free-tier deployment).
//
// WHY THIS EXISTS: nothing in the project could answer "is this deployment
// healthy?" without touching the database or rendering a full page. Uptime
// monitoring, the load balancer / reverse proxy health check, and the deploy
// script's post-restart verification all need one cheap, honest answer.
//
// DESIGN RULES (deliberate):
//   · No authentication and no novel data — safe to expose publicly, and it
//     must stay that way so external monitors can reach it.
//   · It reports FACTS, never optimism: the database check actually runs a
//     query, and a failure yields 503 with the real reason. This follows the
//     project's existing honesty rule (AGENTS.md law ⑤) — a health endpoint
//     that returns 200 while the database is down is worse than no endpoint.
//   · It does NOT call any model provider. A health check must never cost money
//     and must never be the reason a provider quota is consumed.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
// Diagnostics must report FACTS: use the unextended client so the count is
// never shaped by the ownership filter or by any request identity header.
import { dbRaw } from "@/lib/db";

// Cloud Run / load balancers may cache GET responses; a health probe must never
// be served from cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Build metadata: RELEASE.json (VM pipeline) + GIT_SHA (Cloud Run pipeline). */
type ReleaseInfo = {
  commit?: string | null;
  branch?: string;
  builtAt?: string;
  buildId?: string;
};

let cachedRelease: ReleaseInfo | null = null;

/**
 * The commit the running process was built from.
 *
 * GIT_SHA is injected by the CI pipeline (Dockerfile ARG/ENV, and the Cloud Run
 * `--set-env-vars`), so it is read at RUNTIME — that is the whole point:
 * /api/health must name the commit that is actually serving traffic, not one
 * baked into a file that only the (dormant) VM pipeline writes.
 *
 * It stays a plain string on purpose: no build timestamp, no build id. The
 * commit IS the answer to "which code is running". When it is absent (local
 * dev, or a manual build with no COMMIT_SHA) it is null — never the string
 * "null", and never an empty string.
 */
function readCommit(): string | null {
  const sha = (process.env.GIT_SHA ?? "").trim();
  return sha ? sha : null;
}

function readRelease(): ReleaseInfo {
  if (cachedRelease) return cachedRelease;
  let fromFile: ReleaseInfo = {};
  try {
    // Synchronous read on purpose: this file is tiny, is read at most once per
    // process, and keeping it sync avoids an await on the health path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    const raw = fs.readFileSync("RELEASE.json", "utf8");
    fromFile = JSON.parse(raw) as ReleaseInfo;
  } catch {
    // Absent file is normal in local dev — report it honestly as unknown.
    fromFile = {};
  }
  // GIT_SHA wins (the pipeline's own truth); RELEASE.json is the fallback for
  // the older VM pipeline.
  cachedRelease = { ...fromFile, commit: readCommit() ?? fromFile.commit ?? null };
  return cachedRelease;
}

export async function GET() {
  const startedAt = Date.now();

  // The only real dependency worth probing: can we reach the database?
  let database: { ok: true; novels: number } | { ok: false; error: string };
  try {
    const novels = await dbRaw.novel.count();
    database = { ok: true, novels };
  } catch (error) {
    database = {
      ok: false,
      // Message only — never leak a stack trace or a connection string.
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const ok = database.ok;
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      uptimeSeconds: Math.round(process.uptime()),
      checkedInMs: Date.now() - startedAt,
      release: readRelease(),
      runtime: {
        node: process.version,
        // Which engine is serving this: useful when a stale process is still
        // holding the port after a deploy (this exact failure was hit twice
        // during the Phase 5 work).
        pid: process.pid,
      },
      database,
    },
    { status: ok ? 200 : 503 },
  );
}
