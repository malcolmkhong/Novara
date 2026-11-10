#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Repeatable migration path for Neon free tier (no shadow database, so
// `prisma migrate dev` cannot run). Diff the LIVE database against the current
// schema, write the SQL into a new timestamped migration folder, then deploy.
//
//   bun run db:migrate:new <slug>       e.g.  bun run db:migrate:new add_userid
//
// SECURITY: the connection string is read ONLY from process.env.DIRECT_URL
// (bun loads .env automatically). It is never typed into a command line here
// and never printed — error output is scrubbed of it.
//
// `prisma generate` runs before `migrate deploy` on purpose: src/lib/db.ts
// derives its ownership rules from Prisma.dmmf, so the newly added columns
// must be visible in the generated client.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("DIRECT_URL is not set. Add it to .env (see .env.example).");
  process.exit(1);
}

const slug = (process.argv[2] ?? "migration").replace(/[^a-z0-9_]/gi, "_");
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const dir = join("prisma", "migrations", `${stamp}_${slug}`);

// The Prisma CLI is a plain JS entry point; running it with the CURRENT
// runtime (bun or node) works under both, unlike `bun x prisma` (bun-only).
const PRISMA_CLI = resolve("node_modules/prisma/build/index.js");

function prisma(args) {
  try {
    return execFileSync(process.execPath, [PRISMA_CLI, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const msg = String(err?.stderr ?? err?.message ?? err);
    console.error(msg.split(url).join("<redacted>"));
    process.exit(1);
  }
}

const sql = prisma([
  "migrate", "diff",
  "--from-url", url,
  "--to-schema-datamodel", "prisma/schema.prisma",
  "--script",
]);

if (!sql.trim()) {
  console.log("No schema changes detected — no migration created.");
  process.exit(0);
}

mkdirSync(dir, { recursive: true });
// Plain UTF-8 (no BOM, no UTF-16 null bytes) — `migrate deploy` rejects both.
writeFileSync(join(dir, "migration.sql"), sql, "utf8");
console.log(`Wrote ${join(dir, "migration.sql")} (${sql.length} bytes)`);

// Refresh the generated client / DMMF: src/lib/db.ts derives its ownership
// rules from Prisma.dmmf, so new columns must be visible there.
prisma(["generate"]);
prisma(["migrate", "deploy"]);
console.log("Migration applied. Database schema is up to date.");
