// ---------------------------------------------------------------------------
// Novara AI — Phase 4 grounding measurement (ZERO GLM, DB reads + one pure
// in-process assembly). Approved read-only scope: measure what fraction of
// member-wire bytes the Story Snapshot actually is, from REAL Phase 1/2
// transcripts, plus one zero-GLM live assembly cross-check at the source.
//
//   bun scripts/p4-snapshot-fraction.ts
// ---------------------------------------------------------------------------

import { PrismaClient } from "@prisma/client";
import { countTokens } from "../src/lib/agent/context-meter";
import { loadStorySnapshot, renderSnapshot } from "../src/lib/agent/snapshot";

const db = new PrismaClient();

const START_MARKERS = [
  "STORY SNAPSHOT (measured at run start", // member envelopes
  "STORY SNAPSHOT (measured now)", // leader envelopes
];
/** Parts that can follow the snapshot block inside an envelope row. */
const END_MARKERS = ["\nCERTIFY PROTOCOL (hard rule", "\nLENGTH PLAN for", "\nLANGUAGE: "];

function snapshotSlice(row: string): { text: string; found: boolean; bounded: boolean } {
  let start = -1;
  for (const m of START_MARKERS) {
    const i = row.indexOf(m);
    if (i >= 0 && (start === -1 || i < start)) start = i;
  }
  if (start === -1) return { text: "", found: false, bounded: false };
  let end = row.length;
  let bounded = false;
  for (const m of END_MARKERS) {
    const i = row.indexOf(m, start + 1);
    if (i >= 0 && i < end) {
      end = i;
      bounded = true;
    }
  }
  // NOTE: an envelope whose pinnedContext (Phase 8, free text) follows the
  // snapshot has no detectable end marker — such rows measure the snapshot
  // PLUS trailing parts (upper bound). Counted separately below.
  return { text: row.slice(start, end), found: true, bounded };
}

async function main() {
  const runs = await db.agentRun.findMany({
    take: 12,
    orderBy: { createdAt: "desc" },
    select: { id: true, novelId: true, goal: true, createdAt: true, status: true },
  });

  type Row = { runId: string; conv: string; taskId: string | null; chars: number; snapChars: number; tokens: number; snapTokens: number; bounded: boolean };
  const rows: Row[] = [];
  const novelIds = new Set<string>();

  for (const run of runs) {
    novelIds.add(run.novelId);
    const envelopes = await db.agentMessage.findMany({
      where: { runId: run.id, kind: "envelope" },
      select: { conversationId: true, taskId: true, content: true },
    });
    for (const e of envelopes) {
      const slice = snapshotSlice(e.content);
      if (!slice.found) continue;
      rows.push({
        runId: run.id,
        conv: e.conversationId,
        taskId: e.taskId,
        chars: e.content.length,
        snapChars: slice.text.length,
        tokens: countTokens(e.content),
        snapTokens: countTokens(slice.text),
        bounded: slice.bounded,
      });
    }
  }

  const member = rows.filter((r) => r.taskId !== null);
  const leader = rows.filter((r) => r.taskId === null);
  const unbounded = rows.filter((r) => !r.bounded);

  const sum = (arr: Row[], k: "chars" | "snapChars" | "tokens" | "snapTokens") => arr.reduce((s, r) => s + r[k], 0);

  console.log("=== P4 grounding — snapshot fraction in REAL transcripts (rows parsed from canonical envelopes) ===");
  console.log(`runs scanned: ${runs.length} · novels touched: ${novelIds.size}`);
  console.log(
    JSON.stringify(
      {
        memberEnvelopes: member.length,
        memberCharsTotal: sum(member, "chars"),
        memberSnapshotCharsTotal: sum(member, "snapChars"),
        memberSnapshotCharShare: `${((100 * sum(member, "snapChars")) / Math.max(1, sum(member, "chars"))).toFixed(1)}%`,
        memberTokensTotal_est: sum(member, "tokens"),
        memberSnapshotTokensTotal_est: sum(member, "snapTokens"),
        memberSnapshotTokenShare_est: `${((100 * sum(member, "snapTokens")) / Math.max(1, sum(member, "tokens"))).toFixed(1)}%`,
        rowsWithoutEndMarker_upperBound: unbounded.length,
      },
      null,
      2
    )
  );

  console.log("\nper-run breakdown (member envelopes):");
  const byRun = new Map<string, Row[]>();
  for (const r of member) {
    const list = byRun.get(r.runId) ?? [];
    list.push(r);
    byRun.set(r.runId, list);
  }
  for (const [runId, list] of byRun) {
    const run = runs.find((r) => r.id === runId)!;
    console.log(
      `  ${runId.slice(0, 8)}… "${run.goal.slice(0, 40)}" — members=${list.length} ` +
        `snapShare=${((100 * sum(list, "snapChars")) / Math.max(1, sum(list, "chars"))).toFixed(1)}% chars · ` +
        `snapTokens/member≈${Math.round(sum(list, "snapTokens") / list.length)} est`
    );
  }

  if (leader.length > 0) {
    console.log(
      `\nleader envelopes: ${leader.length} — snapshot char share ${((100 * sum(leader, "snapChars")) / Math.max(1, sum(leader, "chars"))).toFixed(1)}% (context only; scope is leader→member)`
    );
  }

  // ---- zero-GLM live assembly cross-check at the SOURCE (exact boundaries) --
  console.log("\n=== live cross-check: loadStorySnapshot + renderSnapshot on a real novel (pure code, zero GLM) ===");
  let bestNovel: { id: string; title: string; chapters: number } | null = null;
  for (const novelId of novelIds) {
    const n = await db.novel.findUnique({
      where: { id: novelId },
      select: { id: true, title: true, _count: { select: { chapters: true } } },
    });
    if (n && (!bestNovel || n._count.chapters > bestNovel.chapters)) {
      bestNovel = { id: n.id, title: n.title, chapters: n._count.chapters };
    }
  }
  if (bestNovel) {
    const snap = await loadStorySnapshot(bestNovel.id);
    const rendered = renderSnapshot(snap);
    console.log(`novel "${bestNovel.title}" (chapters=${bestNovel.chapters}): renderSnapshot → ${rendered.length} chars ≈ ${countTokens(rendered)} tok (est)`);
    const sections = rendered.split("\n\n").map((s) => s.slice(0, s.indexOf(":") >= 0 ? s.indexOf(":") + 1 : 40));
    const perSection = rendered.split("\n\n").map((s) => ({ section: s.slice(0, 48), chars: s.length }));
    for (const p of perSection) console.log(`  ${String(p.chars).padStart(5)} chars — ${p.section.replace(/\n/g, " / ")}`);
    console.log(`sections: ${perSection.length} (headers above are prefixes)`);
    void sections;
  } else {
    console.log("no novel found for cross-check");
  }

  await db.$disconnect();
}

main().catch((e) => {
  console.error("p4 measurement error:", e);
  process.exit(1);
});
