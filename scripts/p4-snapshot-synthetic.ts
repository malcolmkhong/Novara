// ---------------------------------------------------------------------------
// Novara AI — Phase 4 grounding measurement TIER 2 (reconstructed-exact).
//
// NO real Phase 1/2 transcripts survive (current DB: 0 runs/0 messages; the
// Nov 2 backup predates the agent schema). Real-attested anchors that DO
// survive (artifact table): member wires max ~1.5K tok (runtime.ts P2-c
// evidence #4) and leader turn-6 wire 8,726 tok billed (close-out #3).
//
// This script measures the snapshot's EXACT byte size through the real
// renderer (renderSnapshot, pure, zero GLM) on data whose every dimension is
// bounded by the SHIPPED budget constants — one REPRESENTATIVE mid-size case
// and one CEILING case (every section at its cap). Plus the real FLOOR case:
// loadStorySnapshot on the only novel that exists today (the empty "abc").
// All three are labeled; nothing here is presented as a real-run measurement.
//
//   bun scripts/p4-snapshot-synthetic.ts
// ---------------------------------------------------------------------------

import { PrismaClient } from "@prisma/client";
import { countTokens } from "../src/lib/agent/context-meter";
import { loadStorySnapshot, renderSnapshot, type StorySnapshotData } from "../src/lib/agent/snapshot";

const filler = (n: number, tag: string) => (tag + " ").repeat(Math.ceil(n / (tag.length + 1))).slice(0, n);

function makeSnapshot(kind: "representative" | "ceiling"): StorySnapshotData {
  const rep = kind === "representative";
  const chaptersN = rep ? 12 : 60;
  return {
    novel: {
      id: "synthetic",
      title: rep ? "长夜灯船" : "The Lantern Ship of the Long Night",
      genre: rep ? "奇幻" : "fantasy",
      synopsis: filler(rep ? 600 : 1200, "synopsis"),
      targetWords: rep ? 200_000 : 600_000,
      status: "writing",
    },
    totalWords: chaptersN * 2400,
    chapterCount: chaptersN,
    nextChapterIndex: chaptersN + 1,
    chapters: Array.from({ length: chaptersN }, (_, i) => ({
      index: i + 1,
      title: rep ? `第${i + 1}章 灯下的信` : `Chapter ${i + 1}: The Letter Beneath the Lamp`,
      wordCount: 2400,
      status: i === chaptersN - 1 ? "draft" : "final",
    })),
    outline: Array.from({ length: 40 }, (_, i) => ({
      index: i + 1,
      title: rep ? `节拍${i + 1}` : `Beat ${i + 1}`,
      summary: filler(rep ? 120 : 220, "beat"),
    })),
    cast: Array.from({ length: 12 }, (_, i) => ({
      name: rep ? `角色${i + 1}` : `Character ${i + 1}`,
      role: filler(rep ? 12 : 20, "role").trim(),
      aliases: filler(rep ? 10 : 16, "aka").trim(),
    })),
    world: Array.from({ length: 12 }, (_, i) => ({
      title: rep ? `设定${i + 1}` : `World Entry ${i + 1}`,
      category: "place",
      contentPreview: filler(200, "world"),
    })),
    openForeshadows: Array.from({ length: 30 }, (_, i) => ({
      id: `f${i + 1}`,
      status: "open",
      content: filler(rep ? 120 : 200, "foreshadow"),
      plantChapter: (i % chaptersN) + 1,
    })),
    lastDigest: { chapterIndex: chaptersN, summary: filler(rep ? 500 : 800, "digest") },
    memoryBlock: filler(rep ? 2000 : 2600, "memory"),
    contract: filler(rep ? 800 : 1500, "contract"),
    storylines: Array.from({ length: 12 }, (_, i) => ({
      name: rep ? `主线${i + 1}` : `Storyline ${i + 1}`,
      status: i % 3 === 0 ? "active" : "dormant",
      summary: filler(rep ? 120 : 220, "thread"),
    })),
    timeline: Array.from({ length: 20 }, (_, i) => ({
      order: i + 1,
      label: rep ? `事件${i + 1}` : `Event ${i + 1}`,
      detail: filler(rep ? 120 : 180, "timeline"),
      chapterIndex: (i % chaptersN) + 1,
    })),
    arcs: Array.from({ length: 24 }, (_, i) => ({
      characterName: rep ? `角色${(i % 12) + 1}` : `Character ${(i % 12) + 1}`,
      order: i,
      note: filler(rep ? 80 : 120, "arc"),
    })),
    isChinese: rep,
    nextQuota: { chapterQuota: 2400, remainingWords: 100_000, basis: "synthetic" },
  };
}

/** Member envelope EXACTLY as executeTask builds it (runtime.ts 2344-2384). */
function memberEnvelope(snapText: string): string {
  const convParts = [
    `TASK ENVELOPE — execute exactly this task, then stop.`,
    `T-C${1} — write chapter ${1}`,
    filler(1200, "brief"), // within taskBriefCapChars 1800
    "",
    "MISSION LOCK: you are the assigned member for this brief; actions beyond it are failures. If it is impossible, make your final line start with BLOCKED: plus the reason.",
  ];
  const novelParts = [
    "",
    "STORY SNAPSHOT (measured at run start; use read tools for fresher data):",
    snapText,
    "",
    "LANGUAGE: write all chapter prose in Chinese (中文), matching the novel.",
  ];
  return [...convParts, ...novelParts].join("\n");
}

async function main() {
  for (const kind of ["representative", "ceiling"] as const) {
    const snap = makeSnapshot(kind);
    const snapText = renderSnapshot(snap);
    const env = memberEnvelope(snapText);
    const snapTok = countTokens(snapText);
    const envTok = countTokens(env);
    console.log(
      `${kind.toUpperCase()}: snapshot ${snapText.length} chars ≈ ${snapTok} tok (est) · ` +
        `member envelope ${env.length} chars ≈ ${envTok} tok (est) · ` +
        `snapshot share = ${(100 * snapTok / envTok).toFixed(1)}% tok / ${(100 * snapText.length / env.length).toFixed(1)}% chars`
    );
    console.log(`  per-section (${kind}):`);
    for (const s of snapText.split("\n\n")) {
      console.log(`    ${String(countTokens(s)).padStart(5)} tok (est) — ${s.slice(0, 52).replace(/\n/g, " / ")}`);
    }
  }

  // REAL floor: the only novel that exists today (empty "abc"), real loader.
  const db = new PrismaClient();
  const abc = await db.novel.findFirst({ select: { id: true } });
  if (abc) {
    const snap = await loadStorySnapshot(abc.id);
    const text = renderSnapshot(snap);
    const env = memberEnvelope(text);
    console.log(
      `FLOOR (real novel "abc", empty): snapshot ${text.length} chars ≈ ${countTokens(text)} tok · ` +
        `share of reconstructed envelope ≈ ${(100 * countTokens(text) / countTokens(env)).toFixed(1)}% tok`
    );
  }
  await db.$disconnect();

  // Attested-denominator derivation (real anchor, labeled): member wires max
  // ~1.5K tok (runtime.ts P2-c evidence #4, live runs). Snapshot share of a
  // max-size real member wire at representative/ceiling snapshot size:
  console.log("\nATTESTED-DENOMINATOR derivation (real anchor: member wire ≤ ~1.5K tok):");
  for (const kind of ["representative", "ceiling"] as const) {
    const snapTok = countTokens(renderSnapshot(makeSnapshot(kind)));
    console.log(`  ${kind}: snapshot ≈ ${snapTok} tok ⇒ ${(100 * snapTok / 1500).toFixed(0)}% of a max-size real member wire`);
  }
}

main().catch((e) => {
  console.error("p4 synthetic measurement error:", e);
  process.exit(1);
});
