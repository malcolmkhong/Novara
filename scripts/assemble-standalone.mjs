// ---------------------------------------------------------------------------
// Novara AI — standalone artifact assembler (postbuild hook).
//
// WHY THIS FILE EXISTS (2026-11-07, Google free-tier deployment):
//   The previous `build` script was:
//     next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/
//   `cp` is not available on Windows, so the build only ever worked on Linux.
//   This script does the same job with Node's fs API — identical behaviour on
//   Windows, macOS and Linux, with zero new dependencies.
//
// WHAT IT ADDS beyond the old cp commands (each verified against a real build):
//   1. prisma/schema.prisma  — Next's file tracer does NOT include it (verified:
//      absent from .next/standalone by default). The Prisma CLI needs it on the
//      host to run `prisma db push` during deploy, so schema drift between the
//      image and the database cannot be detected otherwise.
//   2. RELEASE.json          — build metadata consumed by GET /api/health, so a
//      stale process still holding the port is identifiable at a glance. This
//      exact failure was hit twice during the Phase 5 work (an old dev server
//      survived every kill attempt and kept answering 200).
//   3. Verification, not hope — after assembling, it asserts the four things a
//      runtime failure would otherwise hide until production: server.js, the
//      Prisma query engine, the agent content layer, and static assets.
//
// NOTE ON THE PRISMA ENGINE: the engine binary IS traced correctly by default
// (verified empirically — .prisma/client/query_engine-* is present without any
// outputFileTracingIncludes config). We assert it rather than force-copy it, so
// a future Prisma version that changes this fails the BUILD instead of failing
// silently in production.
// ---------------------------------------------------------------------------

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

/** Fail loudly with the reason — a partial artifact must never be published. */
function fail(message) {
  console.error(`[assemble-standalone] FAILED: ${message}`);
  process.exit(1);
}

function copy(from, to, label) {
  const src = resolve(root, from);
  if (!existsSync(src)) fail(`${label}: source not found at ${from}`);
  const dest = resolve(standalone, to);
  // A file source must be copied ONTO its destination path; a directory source
  // must be copied INTO a directory of that name. Conflating the two is what
  // produced ERR_FS_CP_NON_DIR_TO_DIR on prisma/schema.prisma.
  if (statSync(src).isDirectory()) {
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true, errorOnExist: false, force: true });
  } else {
    mkdirSync(dirname(dest), { recursive: true });
    // Remove a stale same-named DIRECTORY left over from a previous buggy run,
    // otherwise the file copy fails with ERR_FS_CP_NON_DIR_TO_DIR again.
    if (existsSync(dest) && statSync(dest).isDirectory()) rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { force: true });
  }
  console.log(`[assemble-standalone] copied ${from} -> ${to}`);
}

if (!existsSync(standalone)) {
  fail(
    `.next/standalone does not exist. next.config.ts must set output:"standalone" ` +
      `and \`next build\` must have succeeded before this hook runs.`
  );
}

// --- 1. Static assets: next build does NOT copy these into standalone -------
copy(".next/static", ".next/static", "static assets");

// --- 2. Public files -------------------------------------------------------
copy("public", "public", "public directory");

// --- 3. Agent content layer ------------------------------------------------
// Role cards (agent/system/*.md), skills, and config/budgets.yaml are read from
// DISK at runtime, never bundled. If these are missing the agent layer silently
// falls back to DEFAULT_BUDGETS and loses every tuned cap (22 leader turns, 44
// tasks, compaction/slicing switches). The tracer includes them today; assert it
// rather than assume it.
if (!existsSync(join(standalone, "agent"))) {
  copy("agent", "agent", "agent content layer");
} else {
  console.log("[assemble-standalone] agent/ already traced — skipping copy");
}

// --- 4. Prisma schema (verified NOT traced by default) ---------------------
copy("prisma/schema.prisma", "prisma/schema.prisma", "prisma schema");

// --- 5. Ops scripts (harnesses + retention sweep) --------------------------
// Small text files; worth shipping so the 11 zero-GLM verification harnesses
// and scripts/purge-usage.ts remain runnable on the host.
if (existsSync(join(root, "scripts"))) {
  copy("scripts", "scripts", "ops scripts");
}

// --- 6. Dependency manifests (needed by the ops scripts) --------------------
copy("package.json", "package.json", "package manifest");
if (existsSync(join(root, "bun.lock"))) {
  copy("bun.lock", "bun.lock", "lockfile");
}

// --- 7. Release metadata ---------------------------------------------------
const release = {
  commit: process.env.COMMIT_SHA ?? process.env.GITHUB_SHA ?? "unknown",
  branch: process.env.BRANCH_NAME ?? process.env.GITHUB_REF_NAME ?? "unknown",
  builtAt: new Date().toISOString(),
  buildId: process.env.BUILD_ID ?? "local",
};
writeFileSync(join(standalone, "RELEASE.json"), JSON.stringify(release, null, 2));
console.log(`[assemble-standalone] wrote RELEASE.json (${release.commit.slice(0, 12)} on ${release.branch})`);

// --- 8. SECURITY: strip any env file that next build copied in --------------
// `next build` copies .env* into .next/standalone. In production the database
// URL and model-gateway credentials must come from the runtime environment /
// secret store, never from a file baked into the artifact. Verified: a real
// build DID copy .env into standalone, which would have shipped the local
// DATABASE_URL to the server.
for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  const p = join(standalone, name);
  if (existsSync(p)) {
    rmSync(p);
    console.log(`[assemble-standalone] SECURITY: removed baked-in ${name} from the artifact`);
  }
}

// --- 9. Verification gate --------------------------------------------------
// Assert the things whose absence only shows up as a production 500.
const required = [
  ["server.js", "the standalone server entry point"],
  [".next/static", "static assets"],
  ["public", "public directory"],
  ["agent/config/budgets.yaml", "agent budget configuration"],
  ["agent/system", "agent role cards"],
  ["prisma/schema.prisma", "prisma schema"],
  ["RELEASE.json", "release metadata"],
];
for (const [rel, label] of required) {
  if (!existsSync(join(standalone, rel))) fail(`missing ${label} (${rel})`);
}

// The Prisma query engine is platform-specific. Enumerate the directory rather
// than guessing filenames: the real names carry a platform suffix
// (query_engine-windows.dll.node, libquery_engine-debian-openssl-3.0.x.so),
// which a fixed prefix+extension join does not match.
const prismaClientDir = join(standalone, "node_modules", ".prisma", "client");
if (!existsSync(prismaClientDir)) fail("Prisma client directory missing from the artifact");
const engineFiles = readdirSync(prismaClientDir).filter(
  (name) => name.includes("query_engine") && /\.(node|so|dylib|dll)$/i.test(name)
);
if (engineFiles.length === 0) {
  fail(
    `no Prisma query engine found in ${prismaClientDir}. ` +
      `The build host and the runtime host must share a platform, or the schema ` +
      `must declare binaryTargets for both. Build on Linux for Linux deployment.`
  );
}

// Report which platform engine was captured — a Windows-built artifact shipped
// to a Linux VM is the classic silent breakage, so make it visible.
console.log(`[assemble-standalone] prisma engine(s): ${engineFiles.join(", ")}`);
const isWindowsEngine = engineFiles.some((f) => f.toLowerCase().includes("windows") || f.endsWith(".dll.node"));
if (isWindowsEngine) {
  console.warn(
    "[assemble-standalone] WARNING: a WINDOWS Prisma engine was captured. " +
      "This artifact will NOT run on a Linux server. Build inside the Linux " +
      "container / Cloud Build, not on the Windows workstation."
  );
}

// --- 10. Size report (free-tier discipline) --------------------------------
// The artifact is shipped through Cloud Storage's 5 GB free allowance and
// downloaded over the VM's 1 GB/month free egress, so its size is a budget
// line item, not an afterthought.
let totalBytes = 0;
(function size(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) size(p);
    else if (entry.isFile()) totalBytes += statSync(p).size;
  }
})(standalone);
console.log(`[assemble-standalone] artifact size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

console.log("[assemble-standalone] OK — artifact ready at .next/standalone");
