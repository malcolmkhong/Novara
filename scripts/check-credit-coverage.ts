#!/usr/bin/env bun
/**
 * Credit coverage guard (Step 57).
 *
 * The provider is reachable from many places. This script walks the STATIC
 * import graph of `src/` and fails when a file that can reach the provider
 * has NO beginCharge anywhere in its call chain — i.e. when a path to the
 * model exists that nobody pays for.
 *
 *   provider root  : a module that can perform the actual provider call
 *                    (ai/router and the adapters that fetch)
 *   call site      : a file that imports a provider root directly
 *   charger        : a file that imports beginCharge from @/lib/credits/charge
 *
 * The provider infrastructure itself (the router, the adapters, the HTTP
 * helper) sits BELOW every charge point — it is listed, but it is not a
 * failure: the spend is settled above it.
 *
 * Usage: bun run check:credits
 * Exit code 1 when at least one provider-reaching file is unwired.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const CHARGE_MODULE = resolve(SRC, "lib", "credits", "charge.ts");

/** Modules that can perform the provider call. */
const PROVIDER_ROOTS = [
  resolve(SRC, "lib", "ai", "router.ts"),
  resolve(SRC, "lib", "ai", "providers", "anthropic.ts"),
  resolve(SRC, "lib", "ai", "providers", "deepseek.ts"),
  resolve(SRC, "lib", "ai", "providers", "gemini.ts"),
  resolve(SRC, "lib", "ai", "providers", "minimax.ts"),
  resolve(SRC, "lib", "ai", "providers", "openai.ts"),
];

/** The plumbing below every charge point — listed, never a failure. */
function isInfrastructure(file: string): boolean {
  if (PROVIDER_ROOTS.includes(file)) return true;
  const providersDir = resolve(SRC, "lib", "ai", "providers") + "\\";
  const providersDirPosix = resolve(SRC, "lib", "ai", "providers") + "/";
  return file.startsWith(providersDir) || file.startsWith(providersDirPosix);
}

const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function resolveModule(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(fromFile), spec);
  else return null; // node_modules / package imports — out of scope
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    try {
      if (statSync(candidate).isFile()) return resolve(candidate);
    } catch {
      /* try the next extension */
    }
  }
  return null;
}

const IMPORT_RE = /(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+)["']/g;

const files = walk(SRC);
const imports = new Map<string, string[]>();
const chargers = new Set<string>();

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const specs = new Set<string>();
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (spec.startsWith("@/") || spec.startsWith("./") || spec.startsWith("../")) specs.add(spec);
  }
  const resolved: string[] = [];
  for (const spec of specs) {
    const target = resolveModule(spec, file);
    if (!target) continue;
    resolved.push(target);
    // A file that imports beginCharge IS a charge point.
    const escaped = spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const importLine = source.match(
      new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*["']${escaped}["']`),
    );
    if (importLine && /\bbeginCharge\b/.test(importLine[1]) && target === CHARGE_MODULE) {
      chargers.add(file);
    }
  }
  imports.set(file, resolved);
}

/** Every file reachable from `file` (including itself). */
function closure(file: string): Set<string> {
  const seen = new Set<string>();
  const queue = [file];
  while (queue.length) {
    const current = queue.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of imports.get(current) ?? []) queue.push(next);
  }
  return seen;
}

const rel = (file: string) => relative(ROOT, file).replace(/\\/g, "/");

function reachesProvider(file: string): boolean {
  for (const reached of closure(file)) {
    if (PROVIDER_ROOTS.includes(reached)) return true;
  }
  return false;
}

function chargerIn(file: string): string | null {
  for (const reached of closure(file)) {
    if (chargers.has(reached)) return rel(reached);
  }
  return null;
}

const candidates = files
  .filter((file) => file.endsWith("route.ts") || file.startsWith(join(SRC, "lib")))
  .filter((file) => !isInfrastructure(file));

const callSites = candidates
  .filter((file) => (imports.get(file) ?? []).some((target) => PROVIDER_ROOTS.includes(target)))
  .filter(reachesProvider)
  .sort();

const reaching = candidates.filter(reachesProvider).sort();
const wired: string[] = [];
const unwired: string[] = [];

console.log("=== provider call sites (import a provider root directly) ===");
for (const file of callSites) {
  const charger = chargerIn(file);
  console.log(
    charger
      ? `  WIRED    ${rel(file)}  (charge via ${charger})`
      : `  UNWIRED  ${rel(file)}`,
  );
}

console.log("");
console.log("=== provider-reaching routes and libs ===");
for (const file of reaching) {
  const charger = chargerIn(file);
  if (charger) wired.push(rel(file));
  else unwired.push(rel(file));
}

console.log("");
console.log(`provider-reaching files : ${reaching.length}`);
console.log(`wired                   : ${wired.length}`);
console.log(`UNWIRED                 : ${unwired.length}`);

if (unwired.length) {
  console.log("");
  console.log("=== STILL UNWIRED (no beginCharge in the call chain) ===");
  for (const file of unwired) console.log(`  - ${file}`);
  console.log("");
  console.log("FAIL: a provider call without a charge path exists.");
  process.exit(1);
}
console.log("");
console.log("PASS: every provider-reaching file has a beginCharge in its call chain.");
