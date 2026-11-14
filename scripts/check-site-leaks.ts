#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Leak checker — "is this website leaking keys or data?"
//
// Two modes:
//
//   bun scripts/check-site-leaks.ts --url https://host.example
//       Black-box scan of a DEPLOYED site:
//         1. fetches the HTML, collects every script/style/chunk it references
//         2. downloads those assets and hunts for credential material
//         3. probes a list of paths that must never be served (.env, .git, …)
//         4. discovers /api routes out of the JavaScript and probes each one
//            with an unauthenticated GET — anything that answers 200 with a
//            body is an unauthenticated data read
//         5. checks the security headers on the root response
//
//   bun scripts/check-site-leaks.ts --repo
//       Scans the git-tracked working tree AND the whole git history for
//       credential material, and reports env files that are not ignored.
//
// EXIT CODE: 0 = nothing high/critical, 1 = findings, 2 = bad usage.
//
// Nothing is written outside stdout. Only GET requests are sent, so a probe
// cannot mutate the target.
// ---------------------------------------------------------------------------

type Severity = "critical" | "high" | "medium" | "low" | "info";

type Finding = {
  severity: Severity;
  title: string;
  where: string;
  detail: string;
};

type Pattern = {
  id: string;
  title: string;
  severity: Severity;
  regex: RegExp;
  /** Values that are legitimately public in a browser bundle. */
  expectedInBrowser?: boolean;
  note?: string;
};

/** Credential shapes worth reporting. Order matters only for output. */
const PATTERNS: Pattern[] = [
  {
    id: "private-key",
    title: "Private key block",
    severity: "critical",
    regex: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g,
  },
  {
    id: "aws-access-key",
    title: "AWS access key id",
    severity: "critical",
    regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/g,
  },
  {
    id: "gcp-service-account",
    title: "GCP service account json/key",
    severity: "critical",
    regex: /"type"\s*:\s*"service_account"|private_key_id\s*[:=]|-----BEGIN PRIVATE KEY-----/g,
  },
  {
    id: "db-url-with-password",
    title: "Database URL with credentials",
    severity: "critical",
    regex: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:/@"']{1,64}:[^\s:/@"']{3,64}@[^\s"']{4,160}/g,
  },
  {
    id: "github-token",
    title: "GitHub token",
    severity: "critical",
    regex: /\bgh[pousr]_[A-Za-z0-9]{20,255}\b/g,
  },
  {
    id: "slack-token",
    title: "Slack token",
    severity: "critical",
    regex: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: "stripe-live",
    title: "Stripe live secret key",
    severity: "critical",
    regex: /\bsk_live_[A-Za-z0-9]{16,}\b/g,
  },
  {
    id: "npm-token",
    title: "npm token",
    severity: "critical",
    regex: /\bnpm_[A-Za-z0-9]{30,}\b/g,
  },
  {
    id: "openai-style",
    title: "OpenAI-style provider key",
    severity: "high",
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: "anthropic-key",
    title: "Anthropic key",
    severity: "high",
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: "google-api-key",
    title: "Google API key",
    severity: "medium",
    regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g,
    expectedInBrowser: true,
    note: "A Firebase web key is public by design; it is only a finding if it is also unrestricted on the Google console.",
  },
  {
    id: "jwt",
    title: "JSON Web Token",
    severity: "medium",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    id: "admin-uid-allowlist",
    title: "Published admin allowlist",
    severity: "medium",
    regex: /ADMIN_UIDS\s*=\s*[A-Za-z0-9]{20,}(?:\s*,\s*[A-Za-z0-9]{20,})*/g,
    note: "Firebase UIDs are not credentials, but publishing the admin allowlist tells an attacker exactly which accounts to target.",
  },
  {
    id: "generic-secret-assignment",
    title: "Hardcoded secret assignment",
    severity: "high",
    regex:
      /\b(?:api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd|private[_-]?token)\b\s*[:=]\s*["']([A-Za-z0-9+/_-]{16,})["']/gi,
  },
];

/**
 * Routes that are public BY DESIGN. An unauthenticated 200 on these is not a
 * finding, but the body is still reported so a reviewer can eyeball it.
 */
const KNOWN_PUBLIC_ROUTES = new Map<string, string>([
  ["/api/health", "liveness probe — public by design (middleware PUBLIC_PATHS)"],
]);

/** Paths that must never be served by a deployed app. */
const SENSITIVE_PATHS = [
  "/.env",
  "/.env.local",
  "/.env.production",
  "/.env.development",
  "/.git/config",
  "/.git/HEAD",
  "/.gitignore",
  "/.dockerignore",
  "/package.json",
  "/package-lock.json",
  "/yarn.lock",
  "/pnpm-lock.yaml",
  "/next.config.js",
  "/next.config.mjs",
  "/next.config.ts",
  "/tsconfig.json",
  "/Dockerfile",
  "/docker-compose.yml",
  "/prisma/schema.prisma",
  "/.workbuddy-ai/memory",
  "/RELEASE.json",
  "/.next/BUILD_ID",
  "/.next/server/app/page.js",
  "/node_modules/next/package.json",
  "/sitemap.xml",
  "/server-status",
  "/.aws/credentials",
  "/id_rsa",
  "/credentials.json",
  "/service-account.json",
];

const SECURITY_HEADERS: { header: string; severity: Severity; why: string }[] = [
  {
    header: "content-security-policy",
    severity: "medium",
    why: "no CSP — an injected script runs unrestricted (needs a nonce-based policy; do not add one blind)",
  },
  { header: "strict-transport-security", severity: "medium", why: "no HSTS — the first visit can be downgraded to http" },
  { header: "x-frame-options", severity: "medium", why: "no X-Frame-Options / frame-ancestors — the app can be framed (clickjacking)" },
  { header: "x-content-type-options", severity: "medium", why: "no X-Content-Type-Options: nosniff" },
  { header: "referrer-policy", severity: "low", why: "no Referrer-Policy" },
];

const MAX_ASSET_BYTES = 6 * 1024 * 1024;
const MAX_ASSETS = 60;

function mask(value: string): string {
  if (value.length <= 12) return value[0] + "*".repeat(Math.max(0, value.length - 1));
  return `${value.slice(0, 6)}…${value.slice(-4)} (${value.length} chars)`;
}

/**
 * Values that are documentation placeholders, not real credentials. A
 * `.env.example` with `postgresql://USER:PASSWORD@HOST...` is doing its job.
 */
const PLACEHOLDER = /^(?:USER|PASSWORD|PASS|HOST|DB|NAME|SECRET|KEY|<|\{|xxx|your|your_|your-|example|placeholder|changeme|build|test|localhost|db|password|none|null|undefined|true|false)/i;

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value.trim());
}

function findPatterns(text: string): { pattern: Pattern; value: string }[] {
  const hits: { pattern: Pattern; value: string }[] = [];
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      const value = match[0];
      // A Firebase web key assigned to `apiKey:` is the generic pattern firing
      // on a value the dedicated google-api-key pattern already reports at its
      // own (correct) severity. Reporting it twice as HIGH would be noise.
      if (pattern.id === "generic-secret-assignment" && /AIza[0-9A-Za-z_-]{30,}/.test(value)) {
        if (match.index === pattern.regex.lastIndex) pattern.regex.lastIndex += 1;
        continue;
      }
      // A connection string whose user or password is a placeholder is a
      // template, not a credential. Only the credential part is checked.
      if (pattern.id === "db-url-with-password") {
        const credentials = value.match(/:\/\/([^:@/]+):([^@/]+)@/);
        if (credentials && (isPlaceholder(credentials[1]) || isPlaceholder(credentials[2]))) {
          if (match.index === pattern.regex.lastIndex) pattern.regex.lastIndex += 1;
          continue;
        }
      }
      hits.push({ pattern, value });
      if (match.index === pattern.regex.lastIndex) pattern.regex.lastIndex += 1;
    }
  }
  return hits;
}

async function scanSite(baseUrl: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const root = baseUrl.replace(/\/+$/, "");

  let html: string;
  let rootRes: Response;
  try {
    rootRes = await fetch(root, { headers: { "user-agent": "novara-leak-check" }, redirect: "follow" });
    html = await rootRes.text();
  } catch (error) {
    findings.push({
      severity: "info",
      title: "site unreachable",
      where: root,
      detail: error instanceof Error ? error.message : String(error),
    });
    return findings;
  }

  // 1. headers -------------------------------------------------------------
  const headerNames = new Set(
    [...rootRes.headers.keys()].map((name) => name.toLowerCase()),
  );
  for (const wanted of SECURITY_HEADERS) {
    if (!headerNames.has(wanted.header)) {
      findings.push({
        severity: wanted.severity,
        title: `missing header: ${wanted.header}`,
        where: root,
        detail: wanted.why,
      });
    }
  }
  if (headerNames.has("x-powered-by")) {
    findings.push({
      severity: "info",
      title: "server banner",
      where: root,
      detail: `x-powered-by: ${rootRes.headers.get("x-powered-by")}`,
    });
  }

  // 2. the HTML itself ----------------------------------------------------
  for (const hit of findPatterns(html)) {
    findings.push({
      severity: hit.pattern.severity,
      title: hit.pattern.title,
      where: "HTML of /",
      detail: `${mask(hit.value)}${hit.pattern.note ? ` — ${hit.pattern.note}` : ""}`,
    });
  }

  // 3. every asset the page pulls in -------------------------------------
  const assets = new Set<string>();
  const assetRegex = /(?:src|href)\s*=\s*["']([^"']+\.(?:js|mjs|cjs|css|json|map)(?:\?[^"']*)?)["']/gi;
  let assetMatch: RegExpExecArray | null;
  while ((assetMatch = assetRegex.exec(html)) !== null) {
    const raw = assetMatch[1];
    if (/^https?:\/\//i.test(raw)) continue;
    assets.add(new URL(raw, root).toString());
  }
  // Next.js inlines chunk references in the RSC flight payload too.
  const chunkRegex = /"(\/_next\/static\/chunks\/[^"]+\.js)"/g;
  while ((assetMatch = chunkRegex.exec(html)) !== null) {
    assets.add(new URL(assetMatch[1], root).toString());
  }

  const apiRoutes = new Set<string>();
  const apiRegex = /["'`](\/api\/[A-Za-z0-9_\-/{}$.]+)["'`]/g;

  let scanned = 0;
  for (const asset of assets) {
    if (scanned >= MAX_ASSETS) break;
    scanned += 1;
    let body: string;
    try {
      const res = await fetch(asset, { headers: { "user-agent": "novara-leak-check" }, redirect: "follow" });
      const contentType = res.headers.get("content-type") ?? "";
      if (!/javascript|json|text|css/.test(contentType)) continue;
      const text = await res.text();
      if (text.length > MAX_ASSET_BYTES) {
        findings.push({
          severity: "info",
          title: "oversized asset not fully scanned",
          where: asset,
          detail: `${text.length} bytes`,
        });
        continue;
      }
      body = text;
    } catch {
      continue;
    }

    for (const hit of findPatterns(body)) {
      findings.push({
        severity: hit.pattern.severity,
        title: hit.pattern.title,
        where: asset.replace(root, ""),
        detail: `${mask(hit.value)}${hit.pattern.note ? ` — ${hit.pattern.note}` : ""}`,
      });
    }

    let routeMatch: RegExpExecArray | null;
    apiRegex.lastIndex = 0;
    while ((routeMatch = apiRegex.exec(body)) !== null) {
      const route = routeMatch[1];
      if (route.includes("{") || route.endsWith("/**")) continue;
      apiRoutes.add(route);
    }
  }

  // 4. paths that must not be served -------------------------------------
  for (const path of SENSITIVE_PATHS) {
    try {
      const res = await fetch(root + path, { headers: { "user-agent": "novara-leak-check" }, redirect: "manual" });
      if (res.status === 200) {
        const text = await res.text();
        findings.push({
          severity: "high",
          title: "sensitive path is served",
          where: path,
          detail: `200, ${text.length} bytes`,
        });
      }
    } catch {
      /* unreachable path — nothing to report */
    }
  }

  // 5. unauthenticated API reads ------------------------------------------
  for (const route of apiRoutes) {
    try {
      const res = await fetch(root + route, { headers: { "user-agent": "novara-leak-check" }, redirect: "manual" });
      if (res.status !== 200) continue;
      const text = await res.text();
      if (text.length === 0) continue;
      const known = KNOWN_PUBLIC_ROUTES.get(route);
      const looksLikeData = /^\s*[\[{]/.test(text);
      findings.push({
        severity: known ? "info" : looksLikeData ? "high" : "medium",
        title: known ? "public route answered (expected)" : "API route answers unauthenticated",
        where: route,
        detail: known
          ? `200, ${text.length} bytes — ${known}`
          : `200, ${text.length} bytes${looksLikeData ? " — body looks like data" : ""}`,
      });
    } catch {
      /* ignore */
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Repo mode
// ---------------------------------------------------------------------------

async function scanRepo(): Promise<Finding[]> {
  const findings: Finding[] = [];
  const { execFileSync } = await import("node:child_process");
  const { readFileSync } = await import("node:fs");

  // This file contains the credential PATTERNS themselves, so a scanner that
  // reads itself reports its own regex source as a leak. It is excluded from
  // both the working tree and the history scan — it holds no real credential,
  // only the shapes it looks for.
  const SELF = "scripts/check-site-leaks.ts";

  const run = (cmd: string, args: string[]): string => {
    try {
      return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    } catch {
      return "";
    }
  };

  const tracked = run("git", ["ls-files"]).split(/\r?\n/).filter(Boolean);
  for (const file of tracked) {
    if (file === SELF) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const hit of findPatterns(text)) {
      findings.push({
        severity: hit.pattern.severity,
        title: hit.pattern.title,
        where: file,
        detail: mask(hit.value),
      });
    }
  }

  // The scanner's own file is excluded from the history diff for the same
  // reason as above: it carries the patterns, not a credential.
  const history = run("git", ["log", "--all", "-p", "--no-color", "--", ".", `:(exclude)${SELF}`]);
  if (history) {
    const seen = new Set<string>();
    for (const hit of findPatterns(history)) {
      const key = `${hit.pattern.id}:${hit.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        severity: hit.pattern.severity,
        title: `${hit.pattern.title} (git history)`,
        where: "git history",
        detail: mask(hit.value),
      });
    }
  }

  const ignored = run("git", ["check-ignore", "-v", ".env", ".env.local"]).trim();
  if (!ignored) {
    findings.push({
      severity: "high",
      title: ".env is not gitignored",
      where: ".gitignore",
      detail: "an env file can be committed by accident",
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, info: 3, low: 4 };

function report(findings: Finding[]): number {
  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  if (findings.length === 0) {
    console.log("no findings");
    return 0;
  }
  for (const finding of findings) {
    console.log(`[${finding.severity.toUpperCase()}] ${finding.title}`);
    console.log(`    at    ${finding.where}`);
    console.log(`    what  ${finding.detail}`);
  }
  const counts = new Map<Severity, number>();
  for (const finding of findings) counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
  console.log(
    "\nsummary: " +
      [...counts.entries()].sort((a, b) => ORDER[a[0]] - ORDER[b[0]]).map(([sev, n]) => `${n} ${sev}`).join(", "),
  );
  const blocking = findings.filter((f) => f.severity === "critical" || f.severity === "high").length;
  return blocking > 0 ? 1 : 0;
}

function usage(): never {
  console.log("usage:\n  bun scripts/check-site-leaks.ts --url https://host.example\n  bun scripts/check-site-leaks.ts --repo");
  process.exit(2);
}

const args = process.argv.slice(2);
const urlIndex = args.indexOf("--url");
const repoMode = args.includes("--repo");

if (repoMode) {
  const findings = await scanRepo();
  process.exit(report(findings));
}
if (urlIndex === -1) usage();
const url = args[urlIndex + 1];
if (!url) usage();
const findings = await scanSite(url);
process.exit(report(findings));

export {};
