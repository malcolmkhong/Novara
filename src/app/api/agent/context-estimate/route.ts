// ---------------------------------------------------------------------------
// GET /api/agent/context-estimate?novelId=…&modelId=…
//
// P2 Context Usage — PRE-RUN estimate. Assembles exactly what the leader's
// first turn would send (Atlas system card + tool protocol + skills + story
// snapshot) and counts it with the same hybrid tokenizer the runtime meters
// use, so the composer's panel has honest numbers before any run has ever
// executed. No AI call is made.
//
// Response: { estimate: ContextUsage } (actor: "estimate").
// ---------------------------------------------------------------------------

import { buildSystemPrompt } from "@/lib/novara/content";
import { getModelDefinition, resolveModelSelection } from "@/lib/novara/models";
import { loadStorySnapshot, renderSnapshot } from "@/lib/agent/snapshot";
import { countTokens } from "@/lib/agent/context-meter";
import type { ContextUsage } from "@/lib/novara/agent-types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const novelId = url.searchParams.get("novelId");
  if (!novelId) {
    return Response.json({ error: "novelId query parameter is required" }, { status: 400 });
  }

  // The window comes from the SELECTED model; the measured sections are
  // model-independent (same prompt bytes). An unknown id falls back to the
  // registry default rather than erroring — this is an estimate.
  let contextWindow: number;
  let modelId: string;
  try {
    const resolved = resolveModelSelection(
      url.searchParams.get("modelId"),
      url.searchParams.get("thinkingLevel")
    );
    contextWindow = resolved.contextWindow;
    modelId = resolved.selection.modelId;
  } catch {
    const def = getModelDefinition(undefined);
    contextWindow = def.contextWindow;
    modelId = def.id;
  }

  try {
    const [snapshot, prompt] = await Promise.all([
      loadStorySnapshot(novelId),
      Promise.resolve(buildSystemPrompt("atlas")),
    ]);
    const snapshotText = renderSnapshot(snapshot);

    const sections = {
      system: countTokens(prompt.parts.system),
      tools: countTokens(prompt.parts.tools),
      skills: countTokens(prompt.parts.skills.map((s) => s.body).join("\n\n")),
      novel: countTokens(snapshotText),
      // No goal yet — the loop instruction boilerplate is the only
      // conversation content the first turn would carry beyond the snapshot.
      conversation: countTokens(
        [
          "AUTHOR GOAL: (your goal goes here)",
          "",
          "LEAD THE TEAM: read what you need, then dispatch work with ```team-delegate",
          "blocks (JSON array of orders). Each executed order's VERIFIED outcome comes",
          "back to you as a tool result — decide the next step from those, never from",
          "the member's narration alone. Finish with a tool-free reply.",
        ].join("\n")
      ),
      mcp: 0,
    };
    const used = Object.values(sections).reduce((a, b) => a + b, 0);

    const estimate: ContextUsage = {
      modelId,
      contextWindow,
      used,
      actor: "estimate",
      sections,
      updatedAt: new Date().toISOString(),
    };
    return Response.json({ estimate });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Estimate failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
