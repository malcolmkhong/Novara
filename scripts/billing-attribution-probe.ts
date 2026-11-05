// ---------------------------------------------------------------------------
// Novara AI — P3-A R3 loose end: BILLING ATTRIBUTION CHECK (approved read-only
// follow-up, 2026-11-05).
//
// QUESTION: the gateway rewrites the response `model` field to "glm-4-plus"
// for BOTH requested models (P3-a R3). Does billing follow the REQUESTED
// model (our registry/ledger keying correct), or could the rewrite mean
// tokens are billed at a different tier than we record?
//
// METHOD (zero billable spend — ONE free glm-4.5-flash call, the approved
// allowance): capture the flash call's response headers and compare them with
// the glm-4.6 header set recorded in agent-ctx/phase3-stages.md §P3-A earlier
// today. If the gateway differentiates the two REQUESTED models anywhere
// observable (rate-limit budgets), request-side identity is tracked downstream
// of routing; identical budgets are consistent with a shared user quota
// (weaker but not contrary evidence). The echo field itself is never read by
// any code path (grep evidence lives in the design doc note).
//
//   bun scripts/billing-attribution-probe.ts
// ---------------------------------------------------------------------------

import ZAI from "z-ai-web-dev-sdk";

interface Captured {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

const captured: Captured[] = [];
const rawFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const res = await rawFetch(input as Parameters<typeof fetch>[0], init);
  const url = String(typeof input === "string" ? input : (input as Request).url);
  if (url.endsWith("/chat/completions")) {
    captured.push({
      url,
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body: await res.clone().text(),
    });
  }
  return res;
};

// glm-4.6 header values recorded verbatim in phase3-stages.md §P3-A
// (call-1, 2026-11-05T13:00:19Z) — the comparison baseline.
const GLM46_BASELINE: Record<string, string> = {
  "x-ratelimit-limit-daily": "300",
  "x-ratelimit-limit-qps": "2",
  "x-ratelimit-user-10min-limit": "30",
  "x-ratelimit-user-daily-remaining": "370",
};

async function main() {
  const zai = await ZAI.create();
  await zai.chat.completions.create({
    model: "glm-4.5-flash",
    thinking: { type: "disabled" as const },
    max_tokens: 16,
    messages: [
      { role: "system", content: "Echo the requested line verbatim." },
      { role: "user", content: "Echo: BILLING-CHECK" },
    ],
  });
  const cap = captured[captured.length - 1];
  console.log(`status=${cap.status}`);
  console.log(`body (verbatim): ${cap.body}`);
  console.log("\nresponse headers (verbatim):");
  console.log(JSON.stringify(cap.headers, null, 2));

  console.log("\nrate-limit comparison (requested glm-4.5-flash today vs requested glm-4.6 today):");
  for (const [k, v46] of Object.entries(GLM46_BASELINE)) {
    const vFlash = cap.headers[k] ?? "(absent)";
    console.log(`  ${k}: flash=${vFlash} | glm-4.6=${v46} | ${vFlash === v46 ? "SAME" : "DIFFERENT"}`);
  }
  const echoModel = (JSON.parse(cap.body) as { model?: string }).model;
  console.log(`\nresponse model echo for requested glm-4.5-flash: ${echoModel}`);
  console.log("billable calls spent: 0 (flash tier is free)");
}

main().catch((e) => {
  console.error("billing attribution probe error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
