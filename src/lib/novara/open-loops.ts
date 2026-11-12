// ---------------------------------------------------------------------------
// Novara AI — open loops (STEP 70): the promise / clue ledger the AGENT can
// actually move.
//
// Two ledgers only: StoryPromise and StoryClue. The storyline / timeline /
// character-arc ledgers stay author-owned — the agent never writes them.
//
// ONE lifecycle machine, two vocabularies (mirrors the foreshadow ledger in
// sediment.ts, which is open → advanced → paid, never backwards):
//
//   promise:  open      → advanced → fulfilled   (broken = the author's call)
//   clue:    planted   → surfaced → revealed
//
// The agent speaks ONE normalized vocabulary and this module maps it onto each
// kind's native words:
//
//   open      → promise "open"      · clue "planted"
//   advanced  → promise "advanced"  · clue "surfaced"
//   paid      → promise "fulfilled" · clue "revealed"
//   resolved  → same terminal step as paid
//
// Transitions are FORWARD ONLY. A promise never goes back to open.
//
// ATTRIBUTION — the rows carry no attribution column (StoryPromise has no
// note/paidChapter field; StoryClue only has revealChapter). Nothing is
// invented: the "who and why" is archived into AssetVersion (the project's
// own audit trail: createdBy + reason + a labeled snapshot) and the agent
// event stream. The one attribution the ROW itself can carry is used too:
// StoryClue.revealChapter records the chapter that revealed the clue.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { archiveAssetVersion, buildAssetSnapshot } from "@/lib/novara/asset-gate";

/** The transaction client the ownership-extended db hands to $transaction. */
export type DbTx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

export type OpenLoopKind = "promise" | "clue";

/** The normalized vocabulary the agent uses for both kinds. */
export type OpenLoopStep = "open" | "advanced" | "paid" | "resolved";

/** Native lifecycle words, in machine order (index = step). */
const NATIVE_STEPS: Record<OpenLoopKind, string[]> = {
  promise: ["open", "advanced", "fulfilled"],
  clue: ["planted", "surfaced", "revealed"],
};

/** The native words of the steps that are still OPEN (not closed yet). */
const OPEN_NATIVE: Record<OpenLoopKind, string[]> = {
  promise: ["open", "advanced"],
  clue: ["planted", "surfaced"],
};

/** Native word for a normalized step. */
export function nativeStatusFor(kind: OpenLoopKind, step: OpenLoopStep): string {
  if (kind === "promise") {
    if (step === "open") return "open";
    if (step === "advanced") return "advanced";
    return "fulfilled"; // paid | resolved
  }
  if (step === "open") return "planted";
  if (step === "advanced") return "surfaced";
  return "revealed"; // paid | resolved
}

/** Is this step a legal forward transition target for the kind? */
export function isKnownStep(step: string): step is OpenLoopStep {
  return step === "open" || step === "advanced" || step === "paid" || step === "resolved";
}

export function isOpenNative(kind: OpenLoopKind, status: string): boolean {
  return OPEN_NATIVE[kind].includes(status);
}

export interface OpenLoopRow {
  id: string;
  kind: OpenLoopKind;
  /** The promise / clue text (these rows have no separate title column). */
  title: string;
  /** Native status word. */
  status: string;
  /** Where the loop is planned to land: promise dueChapter / clue revealChapter. */
  plannedAt: number | null;
  /** Where the loop was made / planted. */
  plantedIn: number | null;
  /** Age in chapters (latest chapter index − plantedIn); null when unknown. */
  age: number | null;
}

async function latestChapterIndex(novelId: string): Promise<number | null> {
  const last = await db.chapter.findFirst({
    where: { novelId },
    orderBy: { index: "desc" },
    select: { index: true },
  });
  return last ? last.index : null;
}

/** The open promises + open clues of a novel, newest row order preserved. */
export async function listOpenLoops(
  novelId: string,
  options: { limit?: number } = {}
): Promise<{ promises: OpenLoopRow[]; clues: OpenLoopRow[] }> {
  const limit = options.limit ?? 12;
  const latest = await latestChapterIndex(novelId);
  const [promises, clues] = await Promise.all([
    db.storyPromise.findMany({
      where: { novelId, status: { in: OPEN_NATIVE.promise } },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: {
        id: true,
        content: true,
        status: true,
        madeChapter: true,
        dueChapter: true,
      },
    }),
    db.storyClue.findMany({
      where: { novelId, status: { in: OPEN_NATIVE.clue } },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: {
        id: true,
        content: true,
        status: true,
        plantChapter: true,
        revealChapter: true,
      },
    }),
  ]);

  const age = (plantedIn: number | null): number | null =>
    plantedIn != null && latest != null ? Math.max(0, latest - plantedIn) : null;

  return {
    promises: promises.map((p) => ({
      id: p.id,
      kind: "promise" as const,
      title: p.content,
      status: p.status,
      plannedAt: p.dueChapter,
      plantedIn: p.madeChapter,
      age: age(p.madeChapter),
    })),
    clues: clues.map((c) => ({
      id: c.id,
      kind: "clue" as const,
      title: c.content,
      status: c.status,
      plannedAt: c.revealChapter,
      plantedIn: c.plantChapter,
      age: age(c.plantChapter),
    })),
  };
}

/**
 * The doctor's dangling-loop warning: a loop that was never advanced and is
 * older than `maxAge` chapters. Advanced loops are excluded — a loop that
 * moved is not dangling, it is running.
 */
export async function findDanglingLoops(
  novelId: string,
  maxAge: number
): Promise<OpenLoopRow[]> {
  const latest = await latestChapterIndex(novelId);
  if (latest == null) return [];
  const [promises, clues] = await Promise.all([
    db.storyPromise.findMany({
      where: { novelId, status: "open" },
      orderBy: { createdAt: "asc" },
      select: { id: true, content: true, status: true, madeChapter: true, dueChapter: true },
    }),
    db.storyClue.findMany({
      where: { novelId, status: "planted" },
      orderBy: { createdAt: "asc" },
      select: { id: true, content: true, status: true, plantChapter: true, revealChapter: true },
    }),
  ]);
  const age = (plantedIn: number | null): number | null =>
    plantedIn != null ? Math.max(0, latest - plantedIn) : null;
  const rows: OpenLoopRow[] = [
    ...promises.map((p) => ({
      id: p.id,
      kind: "promise" as const,
      title: p.content,
      status: p.status,
      plannedAt: p.dueChapter,
      plantedIn: p.madeChapter,
      age: age(p.madeChapter),
    })),
    ...clues.map((c) => ({
      id: c.id,
      kind: "clue" as const,
      title: c.content,
      status: c.status,
      plannedAt: c.revealChapter,
      plantedIn: c.plantChapter,
      age: age(c.plantChapter),
    })),
  ];
  return rows.filter((r) => r.age != null && r.age > maxAge);
}

export interface LoopTransitionResult {
  ok: boolean;
  /** Native status before / after (only when ok). */
  from?: string;
  to?: string;
  title?: string;
  /** Human-readable reason for a refusal. */
  error?: string;
}

/**
 * Move ONE promise or clue forward. Never backwards, never sideways.
 *
 * `tx` lets the settle projection close loops inside its own transaction
 * (the base client would need a second connection — DATABASE_URL carries
 * connection_limit=1).
 */
export async function applyLoopTransition(input: {
  novelId: string;
  kind: OpenLoopKind;
  id: string;
  step: OpenLoopStep;
  /** Why the loop moved — archived with the transition (see the header). */
  note?: string;
  /** Who moved it: "agent" (the runtime) or "author". */
  actor: string;
  /** The chapter that closed the loop, when known. */
  chapterIndex?: number | null;
  tx?: DbTx;
}): Promise<LoopTransitionResult> {
  const client = input.tx ?? db;

  if (input.kind !== "promise" && input.kind !== "clue") {
    return { ok: false, error: 'kind must be "promise" or "clue" — storylines, timeline and arcs are author-owned.' };
  }
  if (!isKnownStep(input.step)) {
    return { ok: false, error: 'status must be one of open, advanced, paid, resolved.' };
  }

  const target = nativeStatusFor(input.kind, input.step);
  const order = NATIVE_STEPS[input.kind];
  const targetIndex = order.indexOf(target);
  if (targetIndex <= 0) {
    return { ok: false, error: `"${input.step}" is not a forward step — a loop only moves forward (${order.join(" → ")}).` };
  }

  if (input.kind === "promise") {
    const row = await client.storyPromise.findUnique({
      where: { id: input.id },
      select: { id: true, novelId: true, content: true, status: true, lock: true, madeChapter: true, dueChapter: true },
    });
    if (!row || row.novelId !== input.novelId) {
      return { ok: false, error: "promise not found in this novel." };
    }
    if (row.lock === "final") {
      return { ok: false, error: "this promise is locked canon — the author must reopen it before the agent can move it." };
    }
    const currentIndex = order.indexOf(row.status);
    if (currentIndex < 0) {
      return { ok: false, error: `promise status "${row.status}" is not part of the lifecycle — the author set it; leave it alone.` };
    }
    if (targetIndex === currentIndex) {
      return { ok: false, error: `the promise is already "${row.status}" — nothing to move.` };
    }
    if (targetIndex < currentIndex) {
      return { ok: false, error: `no backwards transitions: the promise is "${row.status}" and cannot go back to "${target}".` };
    }
    // Archive the state BEFORE the move (who + why + from → to).
    await archiveAssetVersion({
      novelId: row.novelId,
      assetType: "story_promise",
      assetId: row.id,
      assetLabel: row.content.slice(0, 40),
      reason: "manual",
      snapshot: buildAssetSnapshot({
        status: row.status,
        content: row.content,
        madeChapter: row.madeChapter,
        dueChapter: row.dueChapter,
        changedBy: input.actor,
        movedTo: target,
        note: input.note ?? null,
      }),
      createdBy: input.actor,
      tx: client,
    });
    await client.storyPromise.update({ where: { id: row.id }, data: { status: target } });
    return { ok: true, from: row.status, to: target, title: row.content };
  }

  const row = await client.storyClue.findUnique({
    where: { id: input.id },
    select: { id: true, novelId: true, content: true, status: true, lock: true, plantChapter: true, revealChapter: true },
  });
  if (!row || row.novelId !== input.novelId) {
    return { ok: false, error: "clue not found in this novel." };
  }
  if (row.lock === "final") {
    return { ok: false, error: "this clue is locked canon — the author must reopen it before the agent can move it." };
  }
  const currentIndex = order.indexOf(row.status);
  if (currentIndex < 0) {
    return { ok: false, error: `clue status "${row.status}" is not part of the lifecycle — the author set it; leave it alone.` };
  }
  if (targetIndex === currentIndex) {
    return { ok: false, error: `the clue is already "${row.status}" — nothing to move.` };
  }
  if (targetIndex < currentIndex) {
    return { ok: false, error: `no backwards transitions: the clue is "${row.status}" and cannot go back to "${target}".` };
  }
  await archiveAssetVersion({
    novelId: row.novelId,
    assetType: "story_clue",
    assetId: row.id,
    assetLabel: row.content.slice(0, 40),
    reason: "manual",
    snapshot: buildAssetSnapshot({
      status: row.status,
      content: row.content,
      plantChapter: row.plantChapter,
      revealChapter: row.revealChapter,
      changedBy: input.actor,
      movedTo: target,
      note: input.note ?? null,
    }),
    createdBy: input.actor,
    tx: client,
  });
  // The clue's own attribution field: the chapter that revealed it.
  await client.storyClue.update({
    where: { id: row.id },
    data: {
      status: target,
      ...(target === "revealed" && input.chapterIndex != null
        ? { revealChapter: input.chapterIndex }
        : {}),
    },
  });
  return { ok: true, from: row.status, to: target, title: row.content };
}

/**
 * Close the loops the chapter's own sediment statement says it paid.
 * The model states the ids (never inferred by keyword matching).
 */
export async function closePaidLoops(input: {
  novelId: string;
  /** { id, evidence } pairs from the sediment records. */
  paid: { id: string; evidence?: string }[];
  actor: string;
  chapterIndex?: number | null;
  tx?: DbTx;
}): Promise<{
  closed: { kind: OpenLoopKind; id: string; from: string; to: string; title?: string }[];
  refused: string[];
}> {
  const closed: { kind: OpenLoopKind; id: string; from: string; to: string; title?: string }[] = [];
  const refused: string[] = [];
  for (const entry of input.paid) {
    const kind = await resolveLoopKind(input.novelId, entry.id, input.tx);
    if (!kind) {
      refused.push(`${entry.id}: not an open promise or clue of this novel`);
      continue;
    }
    const result = await applyLoopTransition({
      novelId: input.novelId,
      kind,
      id: entry.id,
      step: "paid",
      note: entry.evidence,
      actor: input.actor,
      chapterIndex: input.chapterIndex,
      tx: input.tx,
    });
    if (result.ok && result.from && result.to) {
      closed.push({ kind, id: entry.id, from: result.from, to: result.to, title: result.title });
    } else {
      refused.push(`${entry.id}: ${result.error ?? "refused"}`);
    }
  }
  return { closed, refused };
}

/** Which ledger does this id belong to? Promise first, then clue. */
async function resolveLoopKind(
  novelId: string,
  id: string,
  tx?: DbTx
): Promise<OpenLoopKind | null> {
  const client = tx ?? db;
  const promise = await client.storyPromise.findFirst({
    where: { id, novelId },
    select: { id: true },
  });
  if (promise) return "promise";
  const clue = await client.storyClue.findFirst({
    where: { id, novelId },
    select: { id: true },
  });
  return clue ? "clue" : null;
}
