// ---------------------------------------------------------------------------
// Novara AI — Phase 4: task-specific STORY SNAPSHOT slicing for member tasks.
//
// WHY: on any real working novel the member envelope is snapshot-dominated
// (~95% tok at representative size — agent-ctx/phase4-proposal.md §1), and the
// snapshot's full weight re-shipped identically into EVERY member task. This
// module renders the snapshot as NAMED SECTIONS and ships each member only the
// sections its task shape can plausibly consume — IN-WIRE (constraint c: no
// "DB access replaces model context"), self-contained per task (a, b), one
// discrete builder at the seam Phase 2 already metered (`sections.novel`).
//
// A2 — CONSERVATIVE-BY-DEFAULT SLICING RULE (binding, user amendment):
//   The default slice is the FULL snapshot minus only sections carrying a
//   DECLARED irrelevance reason for the enumerated task shape. Aggressive
//   exclusion of the bulky analytical sections (OUTLINE / FORESHADOW / ARCS)
//   is expressed exclusively as declared per-shape entries (exclusions or
//   bounded keeps) with the reason written into the map itself — never as a
//   default. A DETERMINISTIC CHEAP GUARD runs last: if the task brief text
//   references a beat number, a foreshadow, a character name, or a chapter
//   index, the corresponding section is force-included WHOLE regardless of the
//   map. Fail-open: any task whose (assignee × artifactType) shape has no
//   declared entry receives the FULL snapshot.
//
// A4 — ROLLBACK KNOB (binding): slicing is gated on budgets.contextSlicing.
//   enabled, shipped FALSE at rest — the module is inert exactly like
//   compaction (P2): production enablement is an explicit product decision.
//   The gate is passed in by the single runtime call site; this module stays
//   pure (zero GLM, zero I/O, zero config reads).
//
// A3 — PINNED-BLOCK TREATMENT (declared): author-pinned refs are NOT an input
//   to, or output of, this module — they ride the envelope after the snapshot
//   block (runtime.ts novelParts push), leader-curated per task and already
//   task-specific by construction, so they are always shipped WHOLE and are
//   never sliced. Harness-asserted (verify-p4 §S7).
//
// BYTE-IDENTITY CONTRACT: `renderSnapshot` (snapshot.ts) is untouched; the
// section renderer below reproduces its exact per-section text, and
// scripts/verify-p4.ts §S1 asserts join-equivalence against the shipped
// renderer on floor/representative/ceiling fixtures. On the empty-novel FLOOR
// every shape's slice output is byte-identical to the full render (§S4).
// ---------------------------------------------------------------------------

import type { StorySnapshotData } from "./snapshot";

// ---------------------------------------------------------------------------
// Section keys — the named blocks renderSnapshot() emits, joined by "\n\n".
// ---------------------------------------------------------------------------

export type SnapshotSectionKey =
  | "novel"
  | "synopsis"
  | "progress"
  | "next_chapter"
  | "chapters"
  | "outline"
  | "cast"
  | "world"
  | "contract"
  | "storylines"
  | "timeline"
  | "arcs"
  | "foreshadow"
  | "memory";

export const SNAPSHOT_SECTION_KEYS: SnapshotSectionKey[] = [
  "novel",
  "synopsis",
  "progress",
  "next_chapter",
  "chapters",
  "outline",
  "cast",
  "world",
  "contract",
  "storylines",
  "timeline",
  "arcs",
  "foreshadow",
  "memory",
];

// ---------------------------------------------------------------------------
// Bounded-keep policies — a section reduced to a DECLARED deterministic core
// (the bulk beyond it is the declared irrelevance). Any guard hit on the
// section restores it WHOLE.
// ---------------------------------------------------------------------------

export type BoundedPolicy =
  /** Outline beats within [target-1 .. target+2] of the task's target chapter. */
  | "nearTargetBeats"
  /** The K most recent chapters (the writing frontier — last K indexes). */
  | "recentChapters"
  /** The K most recent timeline events (highest order). */
  | "recentTimeline"
  /** The K most recently recorded open foreshadows (ledger head). */
  | "recentForeshadows";

export interface BoundedEntry {
  policy: BoundedPolicy;
  /** Keep-window size for recent* policies (ignored by nearTargetBeats). */
  keep: number;
  /** A2: the declared reason the bulk beyond the core is irrelevant HERE. */
  reason: string;
}

export type SliceEntry = {
  /** Sections dropped entirely for this shape — each with its declared reason. */
  exclude?: Partial<Record<SnapshotSectionKey, string>>;
  /** Sections reduced to a declared core for this shape. */
  bounded?: Partial<Record<SnapshotSectionKey, BoundedEntry>>;
};

// ---------------------------------------------------------------------------
// The DECLARED SLICE MAP (A2) — keyed by `${assignee}:${artifactType ?? "*"}`
// over the dispatcher's enumerated pairs (tool-protocol.ts delegateOrderSchema:
// assignee ∈ {sage,nova,prism,forge} × artifactType ∈
// {chapter,outline_beat,world_entry,character,null} = 20 pairs).
//
// Semantics per role (agent/config/team.yaml): sage = writer (chapter writes,
// outline-beat updates), nova = researcher (read-only), prism = analyst
// (review/finalize/settle), forge = engineer (export/build, library hygiene).
//
// Conservative-by-default: shapes whose task semantics are not crystal clear
// have NO entry here and receive the FULL snapshot (12 of 20 pairs + the auto
// Task-0 impact assessment, which must survey everything). Slicing is declared
// only where the role's tool surface proves what the task consumes.
// ---------------------------------------------------------------------------

export const SLICE_MAP: Record<string, SliceEntry> = {
  // --- sage:chapter — the heavy hitter (prose write) -----------------------
  // The writer needs the whole story surface; the map trims only BULK inside
  // analytical sections to their task-critical core. Nothing is fully
  // excluded (A2 conservatism on the primary shape).
  "sage:chapter": {
    bounded: {
      outline: {
        policy: "nearTargetBeats",
        keep: 0,
        reason:
          "prose serves the target chapter's beat and its immediate successors; distant past/future beats are planning history on this wire, re-readable whole via read_outline",
      },
      foreshadow: {
        policy: "recentForeshadows",
        keep: 5,
        reason:
          "the open loops a writer most plausibly advances in the next chapter are the most recently recorded ones; the full ledger stays reachable via read_foreshadows",
      },
      chapters: {
        policy: "recentChapters",
        keep: 10,
        reason:
          "roster continuity comes from the recent chapter tail; older titles are bookkeeping for prose, and the chapter-index guard restores the full roster on any reference",
      },
      timeline: {
        policy: "recentTimeline",
        keep: 8,
        reason:
          "established-event continuity near the writing frontier; older settled events rarely bear on new prose and remain readable via read tools",
      },
    },
  },

  // --- sage:outline_beat — beat update (update_outline_beat tool) ----------
  "sage:outline_beat": {
    exclude: {
      world:
        "beat sequencing draws on plot structure (outline/storylines/timeline) and the book promise (contract); setting lore does not sequence beats",
    },
    bounded: {
      chapters: {
        policy: "recentChapters",
        keep: 10,
        reason:
          "beat planning needs the written frontier, not the full roster; the chapter-index guard restores the full roster on any reference",
      },
    },
  },

  // --- nova:chapter — read-only research on a chapter ----------------------
  "nova:chapter": {
    bounded: {
      outline: {
        policy: "nearTargetBeats",
        keep: 0,
        reason:
          "research on chapter N is judged against that chapter's beat and neighbors; distant beats are planning history",
      },
    },
  },

  // --- nova:outline_beat — outline research -------------------------------
  "nova:outline_beat": {
    exclude: {
      world: "world lore bears on setting consistency, not on beat structure the research is about",
    },
    bounded: {
      chapters: {
        policy: "recentChapters",
        keep: 10,
        reason:
          "the research anchors on the writing frontier; the full roster is bookkeeping here",
      },
    },
  },

  // --- nova:world_entry — setting/world research (read-only) --------------
  "nova:world_entry": {
    exclude: {
      outline: "beat planning is plot structure; setting work draws on world/cast/timeline, not the beat list",
      foreshadow: "the clue ledger bears on plot threads, not on setting entries this task researches",
      arcs: "character arc stages bear on character work, not on setting entries",
      chapters: "the chapter roster is bookkeeping for setting research; chapter-index references via the guard restore it",
    },
  },

  // --- nova:character — character research (read-only) --------------------
  "nova:character": {
    exclude: {
      outline: "beat planning is plot structure; character work draws on cast/arcs/storylines",
      world: "setting lore does not shape character research",
    },
    bounded: {
      chapters: {
        policy: "recentChapters",
        keep: 10,
        reason:
          "character research anchors on the recent frontier where the character last acted; the guard restores the full roster on any chapter-index reference",
      },
    },
  },

  // --- prism:chapter — review / certify (review_chapter/finalize/settle) ---
  // The reviewer audits continuity (timeline), plant/payoff (foreshadow),
  // character consistency (arcs), the promise (contract) and thread movement
  // (storylines) — all kept whole. Only the outline is trimmed to the
  // reviewed chapter's beat neighborhood.
  "prism:chapter": {
    bounded: {
      outline: {
        policy: "nearTargetBeats",
        keep: 0,
        reason:
          "the reviewed chapter is judged against ITS beat and neighbors; distant beats are planning history on this wire",
      },
    },
  },

  // --- forge:chapter — manuscript build/export (export_markdown) ----------
  // A build consumes the chapter roster and novel identity; it does not
  // reason about story analytics. The DB remains the build's source of truth.
  "forge:chapter": {
    exclude: {
      outline: "manuscript assembly does not consume beat planning; export_markdown reads the DB directly",
      foreshadow: "the clue ledger plays no part in a manuscript build",
      arcs: "character arc planning plays no part in a manuscript build",
      timeline: "established-event analysis plays no part in a manuscript build",
      world: "setting lore plays no part in a manuscript build",
      storylines: "plot-thread analysis plays no part in a manuscript build",
    },
  },

  // Every other enumerated pair (12) + Task 0 deliberately ABSENT: FULL
  // snapshot (fail-open default — A2).
};

// ---------------------------------------------------------------------------
// Guard (A2) — deterministic brief-text triggers that force the corresponding
// section WHOLE regardless of the map.
// ---------------------------------------------------------------------------

const BEAT_REF_RE = /(?:beat|节拍)\s*#?\d+|第\s*\d+\s*拍/i;
const FORESHADOW_REF_RE = /foreshadow|伏笔|伏线/i;
const CHAPTER_REF_RE = /(?:chapter|ch\.?|章)\s*#?\d+|第\s*\d+\s*章/i;

/** The sections each guard trigger restores. */
const GUARD_SECTIONS: { test: (brief: string) => boolean; sections: SnapshotSectionKey[] }[] = [
  { test: (b) => BEAT_REF_RE.test(b), sections: ["outline"] },
  { test: (b) => FORESHADOW_REF_RE.test(b), sections: ["foreshadow"] },
  { test: (b) => CHAPTER_REF_RE.test(b), sections: ["chapters"] },
];

/** Sections the slice map may NEVER drop for any shape (starvation floor). */
const NEVER_EXCLUDE: SnapshotSectionKey[] = [
  "novel",
  "synopsis",
  "progress",
  "next_chapter",
  "cast",
  "contract",
  "memory",
];

// ---------------------------------------------------------------------------
// Section renderer — byte-equal per-section text of the shipped renderSnapshot
// (join-equivalence harness-proven, verify-p4 §S1). Returns only the sections
// whose source data exists (renderSnapshot omits empty sections silently).
// ---------------------------------------------------------------------------

export interface SnapshotSection {
  key: SnapshotSectionKey;
  text: string;
}

export function renderSnapshotSections(s: StorySnapshotData): SnapshotSection[] {
  const sections: SnapshotSection[] = [];
  sections.push({
    key: "novel",
    text: `NOVEL: ${s.novel.title}${s.novel.genre ? ` (${s.novel.genre})` : ""}`,
  });
  if (s.novel.synopsis.trim()) {
    sections.push({ key: "synopsis", text: `SYNOPSIS: ${s.novel.synopsis.slice(0, 1200)}` });
  }
  sections.push({
    key: "progress",
    text: `PROGRESS: ${s.chapterCount} chapters · ${s.totalWords.toLocaleString()} words written · target ${s.novel.targetWords.toLocaleString()}`,
  });
  sections.push({
    key: "next_chapter",
    text: `NEXT CHAPTER: index ${s.nextChapterIndex} · quota ≈ ${s.nextQuota.chapterQuota} words (basis: ${s.nextQuota.basis})`,
  });

  if (s.chapters.length > 0) {
    sections.push({
      key: "chapters",
      text: `CHAPTERS:\n${s.chapters
        .map((c) => `- ch${c.index} "${c.title}" — ${c.wordCount} words (${c.status})`)
        .join("\n")}`,
    });
  } else {
    sections.push({ key: "chapters", text: "CHAPTERS: none yet" });
  }

  if (s.outline.length > 0) {
    sections.push({
      key: "outline",
      text: `OUTLINE:\n${s.outline
        .map((b) => `${b.index}. ${b.title}${b.summary ? ` — ${b.summary.slice(0, 220)}` : ""}`)
        .join("\n")}`,
    });
  }
  if (s.cast.length > 0) {
    sections.push({
      key: "cast",
      text: `CAST:\n${s.cast
        .map(
          (c) =>
            `- ${c.name}${c.role ? ` (${c.role})` : ""}${c.aliases.trim() ? ` — aka: ${c.aliases.trim()}` : ""}`
        )
        .join("\n")}`,
    });
  }
  if (s.world.length > 0) {
    sections.push({
      key: "world",
      text: `WORLD:\n${s.world
        .map((w) => `- ${w.title} (${w.category})${w.contentPreview ? ` — ${w.contentPreview}` : ""}`)
        .join("\n")}`,
    });
  }
  if (s.contract) {
    sections.push({
      key: "contract",
      text: `STORY CONTRACT (作品契约 — the promise this book made; never violate it):\n${s.contract.slice(0, 1500)}`,
    });
  }
  if (s.storylines.length > 0) {
    sections.push({
      key: "storylines",
      text: `STORYLINES (named plot threads — keep every active one moving or visibly advancing):\n${s.storylines
        .map((sl) => `- [${sl.status}] ${sl.name}${sl.summary ? ` — ${sl.summary.slice(0, 220)}` : ""}`)
        .join("\n")}`,
    });
  }
  if (s.timeline.length > 0) {
    sections.push({
      key: "timeline",
      text: `TIMELINE (established in-story events in order — do not contradict):\n${s.timeline
        .map(
          (t) =>
            `- ${t.order}. ${t.label}${t.chapterIndex != null ? ` (ch${t.chapterIndex})` : ""}${t.detail ? ` — ${t.detail.slice(0, 180)}` : ""}`
        )
        .join("\n")}`,
    });
  }
  if (s.arcs.length > 0) {
    const byCharacter = new Map<string, { order: number; note: string }[]>();
    for (const a of s.arcs) {
      const list = byCharacter.get(a.characterName) ?? [];
      list.push({ order: a.order, note: a.note });
      byCharacter.set(a.characterName, list);
    }
    sections.push({
      key: "arcs",
      text: `CHARACTER ARCS (planned arc stages — write toward the next stage, never skip backwards):\n${[...byCharacter
        .entries()]
        .map(
          ([name, stages]) =>
            `- ${name}: ${stages
              .sort((a, b) => a.order - b.order)
              .map((st) => st.note.slice(0, 120))
              .join(" → ")} `
        )
        .join("\n")}`,
    });
  }
  if (s.openForeshadows.length > 0) {
    sections.push({
      key: "foreshadow",
      text: `OPEN FORESHADOW LEDGER:\n${s.openForeshadows
        .map((f) => `- [${f.id}] (${f.status}, planted ch${f.plantChapter}) ${f.content.slice(0, 200)}`)
        .join("\n")}`,
    });
  }
  if (s.memoryBlock) {
    sections.push({ key: "memory", text: s.memoryBlock });
  } else if (s.lastDigest) {
    sections.push({
      key: "memory",
      text: `LAST CHAPTER ${s.lastDigest.chapterIndex} SUMMARY: ${s.lastDigest.summary.slice(0, 800)}`,
    });
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Task shape + guard inputs
// ---------------------------------------------------------------------------

/** Minimal task view the module needs (the runtime's AgentTask row fields). */
export interface SliceTask {
  key: string;
  title: string;
  detail: string | null;
  assignee: string;
  artifactType: string | null;
  artifactLabel: string | null;
}

const CHAPTER_TARGET_RE = /chapter\s*(\d+)/i;

function sliceMapKey(assignee: string, artifactType: string | null): string {
  return `${assignee}:${artifactType ?? "*"}`;
}

/** Brief text scanned by the A2 guard (title + detail + artifact label). */
function briefText(task: SliceTask): string {
  return `${task.title}\n${task.detail ?? ""}\n${task.artifactLabel ?? ""}`;
}

/** Target chapter index for nearTargetBeats (same pattern the runtime quota hint uses). */
function targetChapterIndex(task: SliceTask, s: StorySnapshotData): number {
  const m = briefText(task).match(CHAPTER_TARGET_RE);
  return m ? Number(m[1]) : s.nextChapterIndex;
}

function applyBounded(
  key: SnapshotSectionKey,
  entry: BoundedEntry,
  section: SnapshotSection,
  s: StorySnapshotData,
  task: SliceTask
): SnapshotSection {
  const text = section.text;
  const headerEnd = text.indexOf("\n");
  const header = headerEnd >= 0 ? text.slice(0, headerEnd + 1) : `${text}\n`;
  const lines = (headerEnd >= 0 ? text.slice(headerEnd + 1) : "").split("\n").filter(Boolean);
  const render = (kept: string[]): SnapshotSection => ({
    key,
    text: `${header}${kept.join("\n")}`,
  });

  switch (entry.policy) {
    case "nearTargetBeats": {
      const target = targetChapterIndex(task, s);
      const kept = lines.filter((l) => {
        const m = l.match(/^(\d+)\./);
        if (!m) return true; // never drop an unrecognized line (fail-safe)
        const idx = Number(m[1]);
        return idx >= target - 1 && idx <= target + 2;
      });
      return kept.length === 0 ? section : render(kept); // empty window ⇒ FULL (fail-safe)
    }
    case "recentChapters": {
      // Keep the K most recent chapters by index (robust to index gaps).
      const idxs = s.chapters.map((c) => c.index).sort((a, b) => a - b);
      const cutoff = idxs.length > entry.keep ? idxs[idxs.length - entry.keep] : Number.NEGATIVE_INFINITY;
      const kept = lines.filter((l) => {
        const m = l.match(/^-\s*ch(\d+)\s/);
        if (!m) return true; // never drop an unrecognized line (fail-safe)
        return Number(m[1]) >= cutoff;
      });
      return kept.length === 0 ? section : render(kept);
    }
    case "recentTimeline": {
      const orders = s.timeline.map((t) => t.order).sort((a, b) => a - b);
      const cutoff = orders.length > entry.keep ? orders[orders.length - entry.keep] : Number.NEGATIVE_INFINITY;
      const kept = lines.filter((l) => {
        const m = l.match(/^-\s*(\d+)\./);
        if (!m) return true; // never drop an unrecognized line (fail-safe)
        return Number(m[1]) >= cutoff;
      });
      return kept.length === 0 ? section : render(kept);
    }
    case "recentForeshadows": {
      const kept = lines.slice(0, entry.keep);
      return kept.length === 0 ? section : render(kept);
    }
  }
}

// ---------------------------------------------------------------------------
// The ONE entry point the runtime calls (executeTask → member envelope).
// ---------------------------------------------------------------------------

export interface SliceOptions {
  /** A4 gate — budgets.contextSlicing.enabled, passed in by the runtime. */
  enabled: boolean;
}

/**
 * Build the STORY SNAPSHOT text for a member task envelope.
 *
 * - Gate OFF (shipped default, A4) ⇒ FULL `renderSnapshot` bytes, always.
 * - Auto impact assessment (Task 0) ⇒ FULL (it must survey everything).
 * - Unknown shape ⇒ FULL (fail-open, A2).
 * - Declared shape ⇒ FULL minus reason-declared exclusions, bounded keeps
 *   reduced to their declared cores, then the A2 guard force-includes any
 *   section the brief text references WHOLE.
 * - Structural safety net: NEVER_EXCLUDE sections survive every map entry.
 */
export function buildMemberSnapshotSlice(
  snapshot: StorySnapshotData,
  task: SliceTask,
  options: SliceOptions
): string {
  const full = renderSnapshotSections(snapshot);
  const join = (list: SnapshotSection[]) => list.map((sec) => sec.text).join("\n\n");

  if (!options.enabled) return join(full);

  // The auto impact assessment must see everything (read-only survey).
  if (task.key === "Task 0") return join(full);

  const entry = SLICE_MAP[sliceMapKey(task.assignee, task.artifactType)];
  if (!entry) return join(full); // fail-open (A2)

  const guardHits = new Set<SnapshotSectionKey>();
  const brief = briefText(task);
  for (const g of GUARD_SECTIONS) if (g.test(brief)) g.sections.forEach((k) => guardHits.add(k));
  // Character-name trigger: any cast name/alias present in the brief restores
  // CAST and the whole ARCS section (A2: "force-include the corresponding
  // section regardless of the map" — the corresponding sections for a name).
  for (const c of snapshot.cast) {
    for (const name of [c.name, ...c.aliases.split(/[、,，;；\s]+/)]) {
      const n = name.trim();
      if (n.length >= 2 && brief.includes(n)) {
        guardHits.add("cast");
        guardHits.add("arcs");
        break;
      }
    }
  }

  const out: SnapshotSection[] = [];
  for (const sec of full) {
    if (NEVER_EXCLUDE.includes(sec.key)) {
      out.push(sec);
      continue;
    }
    // Floor furniture: the empty-roster line is novel identity, not roster
    // data — it survives every map entry so that on a small enough novel
    // (the floor) EVERY shape's slice is byte-identical to the full render.
    if (sec.key === "chapters" && sec.text === "CHAPTERS: none yet") {
      out.push(sec);
      continue;
    }
    if (guardHits.has(sec.key)) {
      out.push(sec); // A2 guard — the section comes back WHOLE
      continue;
    }
    const excluded = entry.exclude?.[sec.key];
    if (typeof excluded === "string") continue; // declared irrelevance
    const bounded = entry.bounded?.[sec.key];
    if (bounded) {
      out.push(applyBounded(sec.key, bounded, sec, snapshot, task));
      continue;
    }
    out.push(sec); // not declared → keep whole (conservative default)
  }
  return join(out);
}
