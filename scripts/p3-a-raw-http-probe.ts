// ---------------------------------------------------------------------------
// Novara AI — P3-a raw-HTTP probe (approved scope, 2026-11-05).
//
// QUESTIONS (user-approved):
//   Q1. Does the provider return cache-usage fields (e.g.
//       usage.prompt_tokens_details.cached_tokens) on a >=500-token identical
//       prefix across two sequential calls?
//   Q2. Is any gateway between us and the provider STRIPPING those fields —
//       i.e. does raw HTTP (same endpoint/credentials the SDK uses) reveal
//       fields the SDK view lacks?
//
// METHOD (zero wire-format change; capture-only observation):
//   - Config is read from the SDK INSTANCE ITSELF (zai.config) — the exact
//     baseUrl/credentials the SDK uses. Secrets are printed MASKED only.
//   - SDK pathway is observed through a CAPTURE-ONLY fetch wrapper (clones the
//     response before the SDK parses it; the SDK receives the untouched body).
//     Per SDK source (dist/index.js createChatCompletion) the SDK returns
//     `await response.json()` VERBATIM — the wrapper lets us PROVE that, not
//     assume it.
//   - Raw pathway replicates the SDK request byte-faithfully: same URL
//     `${baseUrl}/chat/completions`, same header set (Authorization, X-Z-AI-From,
//     X-Chat-Id, X-User-Id, X-Token), same body normalization (thinking forced
//     disabled).
//   - Dress rehearsal on glm-4.5-flash (FREE tier): 2 free calls prove the
//     mechanics before any billable spend.
//   - THE ONE paid experiment (glm-4.6, 2 billable calls — approved cap <=3):
//     identical ~1.3K-token system prefix at position 0 (same corpus as the
//     F3 proposal probe for comparability), different tiny echo question,
//     4s apart (docs: cache population is asynchronous).
//
// DISCLOSED GLM BUDGET: 2 billable calls on glm-4.6 (~1.3K input + ~16 output
// tokens each, ≈ $0.002 total). Flash-tier calls are free. No sweep.
//
//   bun scripts/p3-a-raw-http-probe.ts
// ---------------------------------------------------------------------------

import ZAI from "z-ai-web-dev-sdk";
import { createHash } from "node:crypto";

// --- stable prefix (SAME corpus as scripts/p3-usage-probe.ts — comparability)
const SYSTEM = [
  "You are a documentation echo assistant. Repeat the requested line verbatim.",
  "Reference corpus (stable):",
  ...Array.from(
    { length: 30 },
    (_, i) =>
      `Section ${i + 1}: The quick brown fox jumps over the lazy dog while the calm river flows beneath the old stone bridge where lanterns flicker at dusk and the market bells ring twice before the trains depart on time.`
  ),
].join("\n");

const mask = (s: unknown) =>
  s === undefined || s === null
    ? "(absent)"
    : `${String(s).slice(0, 4)}…(len ${String(s).length})`;

interface Captured {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  ms: number;
}

const captured: Captured[] = [];

// --- capture-only fetch wrapper (observation; never alters request/response)
const rawFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const t0 = Date.now();
  const res = await rawFetch(input as Parameters<typeof fetch>[0], init);
  const url = String(typeof input === "string" ? input : (input as Request).url);
  if (url.endsWith("/chat/completions")) {
    const clone = res.clone();
    let body = "";
    try {
      body = await clone.text();
    } catch {
      body = "<clone read failed>";
    }
    captured.push({
      url,
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body,
      ms: Date.now() - t0,
    });
  }
  return res;
};

type ChatMessage = { role: "system" | "user"; content: string };

function sdkHeaders(cfg: Record<string, string | undefined>): Record<string, string> {
  // Byte-faithful replication of dist/index.js createChatCompletion headers.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey ?? ""}`,
    "X-Z-AI-From": "Z",
  };
  if (cfg.chatId) headers["X-Chat-Id"] = cfg.chatId;
  if (cfg.userId) headers["X-User-Id"] = cfg.userId;
  if (cfg.token) headers["X-Token"] = cfg.token;
  return headers;
}

async function rawCall(
  cfg: Record<string, string | undefined>,
  model: string,
  messages: ChatMessage[]
): Promise<{
  status: number;
  json: unknown;
  text: string;
  ms: number;
  headers: Record<string, string>;
}> {
  const t0 = Date.now();
  const res = await rawFetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: sdkHeaders(cfg),
    body: JSON.stringify({ model, thinking: { type: "disabled" }, max_tokens: 16, messages }),
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body — kept as text */
  }
  return {
    status: res.status,
    json,
    text,
    ms,
    headers: Object.fromEntries(res.headers.entries()),
  };
}

function deepKeys(obj: unknown, prefix = "", out: string[] = []): string[] {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out.push(prefix ? `${prefix}.${k}` : k);
      deepKeys(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

const CACHE_RE = /cach/i;

async function main() {
  const zai = await ZAI.create();
  const cfg = (zai as unknown as { config: Record<string, string | undefined> }).config;
  console.log("=== P3-a raw-HTTP probe — pathway facts ===");
  console.log(
    JSON.stringify(
      {
        baseUrl: cfg.baseUrl,
        apiKey: mask(cfg.apiKey),
        chatId: mask(cfg.chatId),
        userId: mask(cfg.userId),
        token: mask(cfg.token),
        sdkExtraHeaders: ["X-Z-AI-From: Z"],
      },
      null,
      2
    )
  );
  console.log(
    JSON.stringify(
      {
        prefixChars: SYSTEM.length,
        prefixSha256: createHash("sha256").update(SYSTEM).digest("hex").slice(0, 16),
        prefixRolePosition: "messages[0].role=system (position 0 — the cache-eligible head)",
      },
      null,
      2
    )
  );

  // ------------------------------------------------------- flash rehearsal --
  // FREE tier: prove capture + raw replication mechanics, and run the strip
  // test (SDK view vs raw view) at zero cost.
  console.log("\n=== DRESS REHEARSAL (glm-4.5-flash — FREE tier) ===");
  const flashQ1: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: "Echo: ALPHA-FLASH" },
  ];
  const beforeFlash = captured.length;
  const sdkFlash = (await zai.chat.completions.create({
    model: "glm-4.5-flash",
    thinking: { type: "disabled" as const },
    max_tokens: 16,
    messages: flashQ1,
  })) as { usage?: unknown };
  const capFlash = captured[captured.length - 1];
  console.log(`sdk-flash status=${capFlash.status} latency=${capFlash.ms}ms`);
  console.log(`sdk-flash RAW BODY (verbatim):\n${capFlash.body}`);
  console.log(
    `sdk-flash PASSTHROUGH (raw body deep-equals SDK object): ${
      JSON.stringify(JSON.parse(capFlash.body)) === JSON.stringify(sdkFlash)
    }`
  );
  const flashRaw = await rawCall(cfg, "glm-4.5-flash", [
    { role: "system", content: SYSTEM },
    { role: "user", content: "Echo: BRAVO-FLASH" },
  ]);
  console.log(`raw-flash status=${flashRaw.status} latency=${flashRaw.ms}ms`);
  console.log(`raw-flash BODY (verbatim):\n${flashRaw.text}`);
  if (flashRaw.status !== 200) {
    console.error("P3-A: raw replication FAILED on free tier — stopping before any billable call.");
    process.exit(1);
  }
  const flashSdkUsage = (JSON.parse(capFlash.body) as { usage?: Record<string, unknown> }).usage ?? {};
  const flashRawUsage = (flashRaw.json as { usage?: Record<string, unknown> } | null)?.usage ?? {};
  const flashSdkKeys = deepKeys(flashSdkUsage);
  const flashRawKeys = deepKeys(flashRawUsage);
  console.log(
    `STRIP TEST flash tier: usage keys SDK-path=${JSON.stringify(flashSdkKeys)} raw-path=${JSON.stringify(flashRawKeys)}`
  );
  console.log(
    `STRIP TEST flash tier verdict: ${
      JSON.stringify({
        onlyInSdkView: flashSdkKeys.filter((k) => !flashRawKeys.includes(k)),
        onlyInRawView: flashRawKeys.filter((k) => !flashSdkKeys.includes(k)),
      })
    }`
  );
  void beforeFlash;

  // --------------------------------------------------- THE paid experiment --
  console.log("\n=== THE ONE PAID EXPERIMENT (glm-4.6 — 2 billable calls) ===");
  const q1: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: "Echo: ALPHA" },
  ];
  const sdkA = (await zai.chat.completions.create({
    model: "glm-4.6",
    thinking: { type: "disabled" as const },
    max_tokens: 16,
    messages: q1,
  })) as { usage?: unknown };
  const capA = captured[captured.length - 1];
  console.log(`call-1 (SDK pathway, captured) status=${capA.status} latency=${capA.ms}ms`);
  console.log(`call-1 RAW BODY (verbatim):\n${capA.body}`);

  await new Promise((r) => setTimeout(r, 4000)); // docs: async cache population

  const q2: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: "Echo: BRAVO" },
  ];
  const rawB = await rawCall(cfg, "glm-4.6", q2);
  console.log(`call-2 (raw HTTP) status=${rawB.status} latency=${rawB.ms}ms`);
  console.log(`call-2 BODY (verbatim):\n${rawB.text}`);

  // -------------------------------------------------------------- analysis --
  console.log("\n=== ANALYSIS ===");
  const parse = (t: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const jA = parse(capA.body);
  const jB = parse(rawB.text);
  const usageA = (jA?.usage ?? null) as Record<string, unknown> | null;
  const usageB = (jB?.usage ?? null) as Record<string, unknown> | null;

  const sdkIsPassThrough = !!jA && JSON.stringify(jA) === JSON.stringify(sdkA);
  console.log(`SDK_PASSTHROUGH (raw body deep-equals SDK-returned object): ${sdkIsPassThrough}`);
  console.log(
    `SDK_USAGE_AS_RETURNED (verbatim): ${JSON.stringify((sdkA as { usage?: unknown }).usage ?? null)}`
  );

  const keysA = usageA ? deepKeys(usageA) : [];
  const keysB = usageB ? deepKeys(usageB) : [];
  const cacheKeys = [...new Set([...keysA, ...keysB])].filter((k) => CACHE_RE.test(k));
  console.log(`usage keys call-1 (SDK path): ${JSON.stringify(keysA)}`);
  console.log(`usage keys call-2 (raw path): ${JSON.stringify(keysB)}`);
  console.log(
    `usage diff (keys only in one call): ${JSON.stringify({
      onlyCall1: keysA.filter((k) => !keysB.includes(k)),
      onlyCall2: keysB.filter((k) => !keysA.includes(k)),
    })}`
  );
  console.log(
    `CACHE_FIELDS_PRESENT (any /cach/i key in either usage): ${cacheKeys.length > 0} ${JSON.stringify(cacheKeys)}`
  );

  // Response header evidence (gateway characterization; request ids are safe).
  console.log(`response headers call-1: ${JSON.stringify(capA.headers)}`);
  console.log(`response headers call-2: ${JSON.stringify(rawB.headers)}`);

  console.log(
    JSON.stringify(
      {
        VERDICT_Q1_cache_fields: cacheKeys.length > 0 ? "PRESENT" : "ABSENT",
        VERDICT_Q2_pathway: sdkIsPassThrough
          ? "SDK is a verbatim pass-through — any stripping happens at/behind the gateway, not in SDK code"
          : "SDK ALTERS the response — investigate",
        billableCallsSpent: 2,
        freeCallsSpent: 2,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error("P3-A probe error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
