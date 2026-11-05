// ---------------------------------------------------------------------------
// Novara AI — Phase 3 capability probe: what does the provider ACTUALLY return
// in `usage` on OUR SDK pathway, and does prefix stability produce cache hits?
//
// TWO minimal live calls (disclosed GLM budget: ~1.4K input + ~20 output
// tokens on glm-4.6, ≈ $0.001). Call 1 sends a ~700-token system prefix
// (above the documented ~500-token hit threshold) + a tiny question; call 2
// repeats the IDENTICAL prefix with a different tiny question. The raw usage
// objects are printed verbatim — the Phase 3 proposal cites exactly these
// fields, no guessing.
//
//   bun scripts/p3-usage-probe.ts
// ---------------------------------------------------------------------------

import ZAI from "z-ai-web-dev-sdk";

const SYSTEM = [
  "You are a documentation echo assistant. Repeat the requested line verbatim.",
  "Reference corpus (stable):",
  ...Array.from(
    { length: 30 },
    (_, i) =>
      `Section ${i + 1}: The quick brown fox jumps over the lazy dog while the calm river flows beneath the old stone bridge where lanterns flicker at dusk and the market bells ring twice before the trains depart on time.`
  ),
].join("\n");

async function main() {
  const zai = await ZAI.create();
  const questions = ["Echo: ALPHA", "Echo: BRAVO"];
  const usages: unknown[] = [];
  for (const q of questions) {
    const completion = await zai.chat.completions.create({
      model: "glm-4.6",
      thinking: { type: "disabled" as const },
      max_tokens: 16,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: q },
      ],
    });
    console.log(`\n=== call "${q}" — raw usage object ===`);
    console.log(JSON.stringify((completion as { usage?: unknown }).usage, null, 2));
    usages.push((completion as { usage?: unknown }).usage ?? null);
    await new Promise((r) => setTimeout(r, 3000)); // cache is async — docs advise waiting
  }
  console.log("\nprobe done — 2 calls, identical system prefix, glm-4.6");
}

main().catch((e) => {
  console.error("probe error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
