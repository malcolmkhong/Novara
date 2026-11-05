// ---------------------------------------------------------------------------
// Novara AI — Phase 4 grounding measurement, REAL Phase 1 anchors.
//
// The current DB (db/custom.db) holds 0 runs / 0 messages (reset), but the
// pre-Phase-2 backup db/custom.backup-20261102-061118.db contains the real
// Phase 1 transcripts. This script opens the backup STRICTLY READ-ONLY
// (bun:sqlite readonly) — no mutation, zero GLM — and measures what fraction
// of member-wire envelope bytes the Story Snapshot actually is, using the
// same boundary rules as scripts/p4-snapshot-fraction.ts.
//
// It also rebuilds ONE renderSnapshot from the backup's largest real novel
// (pure renderer, exact boundaries — the zero-GLM live assembly cross-check).
// memoryBlock is excluded there (it is a current-code addition backed by the
// live memory tables, not the backup's render) — labeled as a lower bound.
//
//   bun scripts/p4-snapshot-fraction-backup.ts
// ---------------------------------------------------------------------------

import { Database } from "bun:sqlite";
import { countTokens } from "../src/lib/agent/context-meter";
import { renderSnapshot, type StorySnapshotData } from "../src/lib/agent/snapshot";

const BACKUP = "db/custom.backup-20261102-061118.db";

const START_MARKERS = [
  "STORY SNAPSHOT (measured at run start", // member envelopes
  "STORY SNAPSHOT (measured now)", // leader envelopes
];
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
  return { text: row.slice(start, end), found: true, bounded };
}

interface Row {
  run: string;
  conv: string;
  member: boolean;
  chars: number;
  snapChars: number;
  tokens: number;
  snapTokens: number;
  bounded: boolean;
}

const sum = (arr: Row[], k: "chars" | "snapChars" | "tokens" | "snapTokens") =>
  arr.reduce((s, r) => s + r[k], 0);

async function main() {
  const bak = new Database(BACKUP, { readonly: true });
  console.log(`=== P4 grounding — REAL Phase 1 anchors from ${BACKUP} (READ-ONLY) ===`);

  const runs = bak.query("SELECT id, novelId, goal, createdAt FROM AgentRun ORDER BY createdAt ASC").all() as {
    id: string;
    novelId: string;
    goal: string;
    createdAt: string;
  }[];
  console.log(`runs in backup: ${runs.length}`);

  const envelopes = bak
    .query("SELECT runId, conversationId, taskId, content FROM AgentMessage WHERE kind = 'envelope'")
    .all() as { runId: string; conversationId: string; taskId: string | null; content: string }[];
  console.log(`envelope rows in backup: ${envelopes.length}`);

  const rows: Row[] = [];
  for (const e of envelopes) {
    const slice = snapshotSlice(e.content);
    if (!slice.found) continue;
    rows.push({
      run: e.runId,
      conv: e.conversationId,
      member: e.taskId !== null,
      chars: e.content.length,
      snapChars: slice.text.length,
      tokens: countTokens(e.content),
      snapTokens: countTokens(slice.text),
      bounded: slice.bounded,
    });
  }

  const member = rows.filter((r) => r.member);
  const leader = rows.filter((r) => !r.member);
  const unbounded = rows.filter((r) => !r.bounded);

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

  console.log("\nper-run member-envelope breakdown:");
  const byRun = new Map<string, Row[]>();
  for (const r of member) {
    const list = byRun.get(r.run) ?? [];
    list.push(r);
    byRun.set(r.run, list);
  }
  for (const [runId, list] of byRun) {
    const run = runs.find((r) => r.id === runId);
    console.log(
      `  ${runId.slice(0, 8)}… "${(run?.goal ?? "?").slice(0, 48)}" — members=${list.length} ` +
        `snapShare=${((100 * sum(list, "snapChars")) / Math.max(1, sum(list, "chars"))).toFixed(1)}% chars · ` +
        `envelope tok/member≈${Math.round(sum(list, "tokens") / list.length)} est · ` +
        `snapshot tok/member≈${Math.round(sum(list, "snapTokens") / list.length)} est`
    );
  }
  if (leader.length > 0) {
    console.log(
      `leader envelopes: ${leader.length} — snapshot char share ${((100 * sum(leader, "snapChars")) / Math.max(1, sum(leader, "chars"))).toFixed(1)}%`
    );
  }

  // ---- zero-GLM live assembly: rebuild renderSnapshot from the backup's
  // largest real novel (pure renderer, exact boundaries; memoryBlock excluded
  // — lower bound vs current code which appends a scored memory block).
  const novels = bak
    .query(
      "SELECT id, title, genre, synopsis, targetWords, status, (SELECT COUNT(*) FROM Chapter WHERE novelId = Novel.id) AS chapters FROM Novel"
    )
    .all() as { id: string; title: string; genre: string; synopsis: string; targetWords: number; status: string; chapters: number }[];
  const best = [...novels].sort((a, b) => b.chapters - a.chapters)[0];
  if (best && best.chapters > 0) {
    const chapters = bak
      .query("SELECT index, title, wordCount, status FROM Chapter WHERE novelId = ? ORDER BY index ASC")
      .all(best.id) as { index: number; title: string; wordCount: number; status: string }[];
    const outline = bak
      .query("SELECT index, title, summary FROM OutlineBeat WHERE novelId = ? ORDER BY index ASC LIMIT 40")
      .all(best.id) as { index: number; title: string; summary: string }[];
    const cast = bak
      .query("SELECT name, role, aliases FROM Character WHERE novelId = ? ORDER BY createdAt ASC LIMIT 12")
      .all(best.id) as { name: string; role: string; aliases: string }[];
    const world = bak
      .query("SELECT title, category, substr(content, 1, 200) AS contentPreview FROM WorldEntry WHERE novelId = ? ORDER BY createdAt ASC LIMIT 12")
      .all(best.id) as { title: string; category: string; contentPreview: string }[];
    const contractRow = bak.query("SELECT content FROM NovelContract WHERE novelId = ?").get(best.id) as
      | { content: string }
      | null;
    const storylines = bak
      .query("SELECT name, status, summary FROM Storyline WHERE novelId = ? AND status IN ('active','dormant') ORDER BY createdAt ASC LIMIT 12")
      .all(best.id) as { name: string; status: string; summary: string }[];
    const timeline = bak
      .query("SELECT order, label, detail, chapterIndex FROM TimelineEntry WHERE novelId = ? ORDER BY order ASC LIMIT 20")
      .all(best.id) as { order: number; label: string; detail: string; chapterIndex: number | null }[];
    const arcs = bak
      .query("SELECT characterName, order, note FROM CharacterArc WHERE novelId = ? ORDER BY characterName ASC, order ASC LIMIT 24")
      .all(best.id) as { characterName: string; order: number; note: string }[];
    const foreshadows = bak
      .query("SELECT id, status, content, plantChapter FROM Foreshadow WHERE novelId = ? AND status IN ('open','advanced') ORDER BY createdAt ASC LIMIT 30")
      .all(best.id) as { id: string; status: string; content: string; plantChapter: number }[];
    const digestRow = bak
      .query(
        "SELECT d.summary, d.chapterIndex FROM ChapterDigest d JOIN Chapter c ON c.id = d.chapterId WHERE d.novelId = ? ORDER BY d.updatedAt DESC LIMIT 1"
      )
      .get(best.id) as { summary: string; chapterIndex: number } | null;

    const totalWords = chapters.reduce((s, c) => s + c.wordCount, 0);
    const beatsAhead = outline.filter((b) => b.index >= best.chapters + 1).length;
    // quota block mirrors computeChapterQuota's shipped shape (snapshot.ts
    // only prints the RESULT); reconstruct with the same formula family —
    // for the size measurement the NEXT QUOTA line is short either way.
    const snap: StorySnapshotData = {
      novel: { id: best.id, title: best.title, genre: best.genre, synopsis: best.synopsis, targetWords: best.targetWords, status: best.status },
      totalWords,
      chapterCount: best.chapters,
      nextChapterIndex: best.chapters + 1,
      chapters,
      outline,
      cast,
      world,
      openForeshadows: foreshadows,
      lastDigest: digestRow ? { chapterIndex: digestRow.chapterIndex, summary: digestRow.summary } : null,
      memoryBlock: null, // lower bound — current code may append a scored memory block
      contract: contractRow?.content?.trim() || null,
      storylines,
      timeline,
      arcs,
      isChinese: /[\u4e00-\u9fff]/.test(`${best.title}\n${best.synopsis}`),
      nextQuota: { chapterQuota: 0, remainingWords: 0, basis: "reconstructed" },
    };
    const rendered = renderSnapshot(snap);
    console.log(
      `\n=== live cross-check: renderSnapshot rebuilt from backup novel "${best.title}" (chapters=${best.chapters}) — memoryBlock excluded (lower bound) ===`
    );
    console.log(`renderSnapshot → ${rendered.length} chars ≈ ${countTokens(rendered)} tok (est)`);
    for (const s of rendered.split("\n\n")) {
      console.log(`  ${String(s.length).padStart(5)} chars — ${s.slice(0, 56).replace(/\n/g, " / ")}`);
    }
  } else {
    console.log("\nbackup has no novel with chapters — cross-check skipped");
  }

  bak.close();
}

main().catch((e) => {
  console.error("p4 backup measurement error:", e);
  process.exit(1);
});
