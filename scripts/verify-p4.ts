// ---------------------------------------------------------------------------
// Novara AI — P4 verification (Phase 4, member snapshot slicing — O1+A1..A4).
//
// ZERO GLM calls. The regression quartet becomes a QUINTET. Sections:
//   S1. Section-renderer join-equivalence: renderSnapshotSections joined by
//       "\n\n" is BYTE-IDENTICAL to the shipped renderSnapshot on the real
//       floor novel, representative/ceiling/edge synthetic fixtures — the
//       duplicated rendering is pinned, drift fails loudly.
//   S2. Declared slice-map integrity (A2): every key ∈ the 20 enumerated
//       dispatcher pairs; every exclusion/bounded entry carries a declared
//       reason; the starvation floor (NEVER_EXCLUDE semantics) is honored;
//       each declared slice ⊇ its documented required-set; every enumerated
//       pair RESOLVES (declared slice or full) without throwing.
//   S3. Fail-open: unknown shapes and the auto Task-0 impact assessment get
//       the FULL snapshot byte-identical to renderSnapshot.
//   S4. Floor byte-identity: on the empty real novel, EVERY enumerated shape
//       with slicing ENABLED produces byte-identical output to the full
//       render (nothing to slice away — the shipped-at-rest and enabled
//       outputs coincide at the floor).
//   S5. Gate (A4) + physical absence: enabled=false ⇒ byte-identical FULL for
//       every shape on a rich fixture; enabled=true ⇒ excluded/bounded bulk
//       is PHYSICALLY ABSENT from the slice text (line-count + unique-marker
//       assertions), kept sections present.
//   S6. Deterministic guard (A2): brief references to beat numbers,
//       foreshadows, character names, chapter indexes force the corresponding
//       sections back WHOLE regardless of the map (cross-map test on
//       nova:world_entry whose map excludes them).
//   S7. Pinned-block treatment (A3) + leader byte-identity (static source
//       assertions): exactly ONE buildMemberSnapshotSlice call site (the
//       member envelope); the pinned push is unconditional and downstream of
//       it; the leader envelope + read_novel still use the full renderSnapshot;
//       the slice module never references pinned context.
//   S8. Config at rest (A4 knob, state per P5-e ruling R-1 of 2026-11-06):
//       budgets.yaml + schema carry contextSlicing.enabled=true (slicing ON;
//       rollback = one flip to false) and compaction still false.
//
//   MEAS. Zero-GLM savings table (representative fixture, estimator basis —
//   countTokens, the meter's own estimator; CJK billed truth runs ~1.4×).
// ---------------------------------------------------------------------------

import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { loadStorySnapshot, renderSnapshot } from "../src/lib/agent/snapshot";
import {
  SNAPSHOT_SECTION_KEYS,
  SLICE_MAP,
  buildMemberSnapshotSlice,
  renderSnapshotSections,
  type SliceTask,
  type SnapshotSectionKey,
  type StorySnapshotData,
} from "../src/lib/agent/snapshot-slice";
import { countTokens } from "../src/lib/agent/context-meter";
import { getBudgets } from "../src/lib/novara/content";

const db = new PrismaClient();

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = "") {
  checks += 1;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`P4: [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const fill = (n: number, tag: string) => (tag + " ").repeat(Math.ceil(n / (tag.length + 1))).slice(0, n);

// --- fixtures (the P4 measurement fixtures, real-renderer shapes) -------------

function makeSnapshot(kind: "representative" | "ceiling"): StorySnapshotData {
  const rep = kind === "representative";
  const chaptersN = rep ? 12 : 60;
  return {
    novel: {
      id: "synthetic",
      title: rep ? "长夜灯船" : "The Lantern Ship of the Long Night",
      genre: rep ? "奇幻" : "fantasy",
      synopsis: fill(rep ? 600 : 1200, "synopsis"),
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
      summary: fill(rep ? 120 : 220, "beat"),
    })),
    cast: Array.from({ length: 12 }, (_, i) => ({
      name: rep ? `角色${i + 1}` : `Character ${i + 1}`,
      role: fill(rep ? 12 : 20, "role").trim(),
      aliases: fill(rep ? 10 : 16, "aka").trim(),
    })),
    world: Array.from({ length: 12 }, (_, i) => ({
      title: rep ? `设定${i + 1}` : `World Entry ${i + 1}`,
      category: "place",
      contentPreview: fill(200, "world"),
    })),
    openForeshadows: Array.from({ length: 30 }, (_, i) => ({
      id: `f${i + 1}`,
      status: "open",
      content: `${fill(rep ? 120 : 200, "foreshadow")} UNIQ-F${i + 1}`,
      plantChapter: (i % chaptersN) + 1,
    })),
    lastDigest: { chapterIndex: chaptersN, summary: fill(rep ? 500 : 800, "digest") },
    memoryBlock: fill(rep ? 2000 : 2600, "memory"),
    contract: fill(rep ? 800 : 1500, "contract"),
    storylines: Array.from({ length: 12 }, (_, i) => ({
      name: rep ? `主线${i + 1}` : `Storyline ${i + 1}`,
      status: i % 3 === 0 ? "active" : "dormant",
      summary: fill(rep ? 120 : 220, "thread"),
    })),
    timeline: Array.from({ length: 20 }, (_, i) => ({
      order: i + 1,
      label: rep ? `事件${i + 1}` : `Event ${i + 1}`,
      detail: fill(rep ? 120 : 180, "timeline"),
      chapterIndex: (i % chaptersN) + 1,
    })),
    arcs: Array.from({ length: 24 }, (_, i) => ({
      characterName: rep ? `角色${(i % 12) + 1}` : `Character ${(i % 12) + 1}`,
      order: i,
      note: fill(rep ? 80 : 120, "arc"),
    })),
    isChinese: rep,
    nextQuota: { chapterQuota: 2400, remainingWords: 100_000, basis: "synthetic" },
  };
}

function edgeSnapshot(): StorySnapshotData {
  return {
    novel: { id: "edge", title: "T", genre: "", synopsis: "   ", targetWords: 50_000, status: "writing" },
    totalWords: 0,
    chapterCount: 0,
    nextChapterIndex: 1,
    chapters: [],
    outline: [],
    cast: [],
    world: [],
    openForeshadows: [],
    lastDigest: null,
    memoryBlock: null,
    contract: null,
    storylines: [],
    timeline: [],
    arcs: [],
    isChinese: false,
    nextQuota: { chapterQuota: 500, remainingWords: 50_000, basis: "edge" },
  };
}

const REP = makeSnapshot("representative");
const CEIL = makeSnapshot("ceiling");
const EDGE = edgeSnapshot();

const REP_FULL = renderSnapshot(REP);
const CEIL_FULL = renderSnapshot(CEIL);

/** The dispatcher's 20 enumerated (assignee × artifactType) pairs. */
const ASSIGNEES = ["sage", "nova", "prism", "forge"] as const;
const ARTIFACTS = ["chapter", "outline_beat", "world_entry", "character", null] as const;
const ENUMERATED_PAIRS: [string, string | null][] = ASSIGNEES.flatMap((a) =>
  ARTIFACTS.map((t) => [a, t] as [string, string | null])
);

const mkTask = (over: Partial<SliceTask>): SliceTask => ({
  key: "Task 3",
  title: "generic task",
  detail: "plain brief with no guard triggers anywhere in it",
  assignee: "sage",
  artifactType: null,
  artifactLabel: null,
  ...over,
});

/** Documented required-sets (A2/§4.3): sections that must SURVIVE (any form). */
const REQUIRED_SETS: Record<string, SnapshotSectionKey[]> = {
  "sage:chapter": [...SNAPSHOT_SECTION_KEYS],
  "sage:outline_beat": SNAPSHOT_SECTION_KEYS.filter((k) => k !== "world"),
  "nova:chapter": [...SNAPSHOT_SECTION_KEYS],
  "nova:outline_beat": SNAPSHOT_SECTION_KEYS.filter((k) => k !== "world"),
  "nova:world_entry": ["novel", "synopsis", "progress", "next_chapter", "cast", "contract", "storylines", "memory", "world", "timeline"],
  "nova:character": ["novel", "synopsis", "progress", "next_chapter", "cast", "contract", "storylines", "memory", "arcs", "timeline", "foreshadow", "chapters"],
  "prism:chapter": [...SNAPSHOT_SECTION_KEYS],
  "forge:chapter": ["novel", "synopsis", "progress", "next_chapter", "cast", "contract", "memory", "chapters"],
};

const sectionOf = (text: string, headerPrefix: string): string | null => {
  const start = text.indexOf(headerPrefix);
  if (start < 0) return null;
  let end = text.length;
  const headers = [
    "NOVEL:", "SYNOPSIS:", "PROGRESS:", "NEXT CHAPTER:", "CHAPTERS:", "OUTLINE:", "CAST:",
    "WORLD:", "STORY CONTRACT", "STORYLINES", "TIMELINE", "CHARACTER ARCS", "OPEN FORESHADOW",
    "STORY MEMORY", "STORY SO FAR", "LAST CHAPTER",
  ];
  for (const h of headers) {
    const i = text.indexOf(h, start + headerPrefix.length);
    if (i >= 0 && i < end) end = i;
  }
  return text.slice(start, end);
};

const countLines = (text: string, headerPrefix: string, re: RegExp): number => {
  const sec = sectionOf(text, headerPrefix);
  if (sec === null) return 0;
  return (sec.match(re) ?? []).length;
};

// --- main ---------------------------------------------------------------------

async function main() {
  // S1 — join-equivalence with the shipped renderer --------------------------
  const floorSnap = await loadStorySnapshot((await db.novel.findFirst({ select: { id: true } }))!.id);
  const fixtures: [string, StorySnapshotData][] = [
    ["floor (real novel, empty)", floorSnap],
    ["representative", REP],
    ["ceiling", CEIL],
    ["edge (all empty)", EDGE],
  ];
  for (const [name, snap] of fixtures) {
    const joined = renderSnapshotSections(snap)
      .map((sec) => sec.text)
      .join("\n\n");
    check(`S1 ${name}: section join BYTE-IDENTICAL to shipped renderSnapshot`, joined === renderSnapshot(snap), `${joined.length} chars`);
  }
  const repSecs = renderSnapshotSections(REP);
  check(
    "S1 representative: section keys in canonical order",
    repSecs.map((s) => s.key).join(",") ===
      "novel,synopsis,progress,next_chapter,chapters,outline,cast,world,contract,storylines,timeline,arcs,foreshadow,memory",
    repSecs.map((s) => s.key).join(",")
  );

  // S2 — declared slice-map integrity ----------------------------------------
  const mapKeys = Object.keys(SLICE_MAP);
  check(
    "S2 every map key is an enumerated dispatcher pair",
    mapKeys.every((k) => ENUMERATED_PAIRS.some(([a, t]) => `${a}:${t ?? "*"}` === k)),
    mapKeys.join(", ")
  );
  let reasonsOk = true;
  let floorOk = true;
  const NEVER = ["novel", "synopsis", "progress", "next_chapter", "cast", "contract", "memory"];
  for (const [shape, entry] of Object.entries(SLICE_MAP)) {
    for (const [sec, reason] of Object.entries(entry.exclude ?? {})) {
      if (typeof reason !== "string" || reason.trim().length < 20) reasonsOk = false;
      if (NEVER.includes(sec)) floorOk = false;
    }
    for (const [sec, b] of Object.entries(entry.bounded ?? {})) {
      if (!b || typeof b.reason !== "string" || b.reason.trim().length < 20) reasonsOk = false;
      if (!["nearTargetBeats", "recentChapters", "recentTimeline", "recentForeshadows"].includes(b.policy)) reasonsOk = false;
      if (b.policy !== "nearTargetBeats" && b.keep < 1) reasonsOk = false;
      if (NEVER.includes(sec)) floorOk = false;
    }
  }
  check("S2 every exclusion/bounded entry carries a declared reason (≥20 chars)", reasonsOk);
  check("S2 starvation floor honored — no map entry drops novel/synopsis/progress/next_chapter/cast/contract/memory", floorOk);
  let requiredOk = true;
  const reqDetail: string[] = [];
  for (const [shape, required] of Object.entries(REQUIRED_SETS)) {
    const [assignee, artifact] = shape.split(":");
    const out = buildMemberSnapshotSlice(REP, mkTask({ assignee, artifactType: artifact === "*" ? null : artifact }), { enabled: true });
    const headersFor = (k: SnapshotSectionKey): string[] =>
      ({
        novel: ["NOVEL:"], synopsis: ["SYNOPSIS:"], progress: ["PROGRESS:"], next_chapter: ["NEXT CHAPTER:"],
        chapters: ["CHAPTERS:"], outline: ["OUTLINE:"], cast: ["CAST:"], world: ["WORLD:"],
        contract: ["STORY CONTRACT"], storylines: ["STORYLINES"], timeline: ["TIMELINE"], arcs: ["CHARACTER ARCS"],
        foreshadow: ["OPEN FORESHADOW"], memory: ["STORY MEMORY", "STORY SO FAR", "LAST CHAPTER", "memory"],
      })[k];
    const missing = required.filter((k) => !headersFor(k).some((h) => out.includes(h)));
    if (missing.length > 0) {
      requiredOk = false;
      reqDetail.push(`${shape} missing ${missing.join(",")}`);
    }
  }
  check("S2 every declared slice ⊇ its documented required-set (representative fixture)", requiredOk, reqDetail.join(" | ") || "all 8 shapes");
  let resolvesOk = true;
  for (const [a, t] of ENUMERATED_PAIRS) {
    const out = buildMemberSnapshotSlice(REP, mkTask({ assignee: a, artifactType: t }), { enabled: true });
    if (!out || out.length === 0) resolvesOk = false;
  }
  check("S2 all 20 enumerated pairs resolve (declared slice or full) without throwing", resolvesOk);

  // S3 — fail-open ------------------------------------------------------------
  const unknownOut = buildMemberSnapshotSlice(
    REP,
    mkTask({ assignee: "sage", artifactType: "scene_list" }),
    { enabled: true }
  );
  check("S3 unknown shape ⇒ FULL snapshot byte-identical (fail-open, A2)", unknownOut === REP_FULL);
  const task0Out = buildMemberSnapshotSlice(REP, mkTask({ key: "Task 0", assignee: "sage", artifactType: "chapter" }), { enabled: true });
  check("S3 Task 0 (auto impact assessment) ⇒ FULL snapshot byte-identical", task0Out === REP_FULL);

  // S4 — floor byte-identity (real empty novel, slicing ENABLED) --------------
  let floorIdentical = true;
  for (const [a, t] of ENUMERATED_PAIRS) {
    const out = buildMemberSnapshotSlice(floorSnap, mkTask({ assignee: a, artifactType: t }), { enabled: true });
    if (out !== renderSnapshot(floorSnap)) floorIdentical = false;
  }
  check(
    "S4 floor: ALL 20 shapes × slicing ENABLED byte-identical to full render (real empty novel)",
    floorIdentical,
    `${renderSnapshot(floorSnap).length} chars`
  );

  // S5 — gate + physical absence ---------------------------------------------
  const gateOff = buildMemberSnapshotSlice(
    REP,
    mkTask({ assignee: "sage", artifactType: "chapter", title: "Write chapter 13", detail: "write the next chapter" }),
    { enabled: false }
  );
  check("S5 gate OFF (shipped default): slice output BYTE-IDENTICAL to full render", gateOff === REP_FULL);
  let gateOffAll = true;
  for (const [a, t] of ENUMERATED_PAIRS) {
    if (buildMemberSnapshotSlice(REP, mkTask({ assignee: a, artifactType: t }), { enabled: false }) !== REP_FULL) gateOffAll = false;
  }
  check("S5 gate OFF: all 20 shapes byte-identical on the representative fixture", gateOffAll);

  // sage:chapter, slicing ON, NO guard triggers in the brief:
  const sliced = buildMemberSnapshotSlice(
    REP,
    mkTask({ assignee: "sage", artifactType: "chapter", title: "continue the story", detail: "write the next chapter following the plan" }),
    { enabled: true }
  );
  check("S5 sage:chapter slice is strictly smaller than full (representative)", sliced.length < REP_FULL.length, `${sliced.length} < ${REP_FULL.length} chars`);
  check("S5 outline bulk physically absent — ≤4 beat lines in window (40 seeded)", countLines(sliced, "OUTLINE:", /^\d+\./gm) <= 4, `${countLines(sliced, "OUTLINE:", /^\d+\./gm)} beat lines`);
  check("S5 foreshadow bulk physically absent — ≤5 ledger entries (30 seeded)", countLines(sliced, "OPEN FORESHADOW", /^-\s*\[f/gm) <= 5, `${countLines(sliced, "OPEN FORESHADOW", /^-\s*\[f/gm)} entries`);
  check("S5 chapters bulk physically absent — ≤10 roster lines (12 seeded)", countLines(sliced, "CHAPTERS:", /^-\s*ch/gm) <= 10, `${countLines(sliced, "CHAPTERS:", /^-\s*ch/gm)} lines`);
  check("S5 timeline bulk physically absent — ≤8 event lines (20 seeded)", countLines(sliced, "TIMELINE", /^-\s*\d+\./gm) <= 8, `${countLines(sliced, "TIMELINE", /^-\s*\d+\./gm)} lines`);
  check("S5 unique marker UNIQ-F30 (seeded far past the window) ABSENT", !sliced.includes("UNIQ-F30"));
  const keptHeaders = ["NOVEL:", "SYNOPSIS:", "PROGRESS:", "NEXT CHAPTER:", "CAST:", "WORLD:", "STORY CONTRACT", "STORYLINES", "CHARACTER ARCS", "memory"];
  const missingKept = keptHeaders.filter((h) => !sliced.includes(h));
  check("S5 kept sections all present (novel…arcs + memory)", missingKept.length === 0, missingKept.length ? `missing: ${missingKept.join(", ")}` : `all ${keptHeaders.length} present`);

  // S6 — deterministic guard (cross-map: nova:world_entry excludes 4) --------
  const worldTask = (detail: string): SliceTask =>
    mkTask({ assignee: "nova", artifactType: "world_entry", title: "world research", detail });
  const base = buildMemberSnapshotSlice(REP, worldTask("draft the setting note"), { enabled: true });
  check("S6 base nova:world_entry: outline absent (40 beats excluded)", countLines(base, "OUTLINE:", /^\d+\./gm) === 0);
  check("S6 base nova:world_entry: foreshadow ledger absent", countLines(base, "OPEN FORESHADOW", /^-\s*\[f/gm) === 0);
  check("S6 base nova:world_entry: arcs absent", !base.includes("CHARACTER ARCS"));
  check("S6 base nova:world_entry: chapters absent", countLines(base, "CHAPTERS:", /^-\s*ch/gm) === 0);
  const g1 = buildMemberSnapshotSlice(REP, worldTask("check beat 7 and the plan around it"), { enabled: true });
  check("S6 guard: beat-number reference restores OUTLINE WHOLE (40 lines)", countLines(g1, "OUTLINE:", /^\d+\./gm) === 40, `${countLines(g1, "OUTLINE:", /^\d+\./gm)} lines`);
  const g2 = buildMemberSnapshotSlice(REP, worldTask("the foreshadow about the fire seal"), { enabled: true });
  check("S6 guard: foreshadow reference restores the FULL ledger (30 entries)", countLines(g2, "OPEN FORESHADOW", /^-\s*\[f/gm) === 30, `${countLines(g2, "OPEN FORESHADOW", /^-\s*\[f/gm)} entries`);
  const g3 = buildMemberSnapshotSlice(REP, worldTask("cross-check with chapter 4"), { enabled: true });
  check("S6 guard: chapter-index reference restores the FULL roster (12 lines)", countLines(g3, "CHAPTERS:", /^-\s*ch/gm) === 12, `${countLines(g3, "CHAPTERS:", /^-\s*ch/gm)} lines`);
  const g4 = buildMemberSnapshotSlice(REP, worldTask("tie the setting to 角色3"), { enabled: true });
  check("S6 guard: character-name reference restores CAST + ARCS", g4.includes("CAST:") && g4.includes("CHARACTER ARCS"));

  // S7 — pinned treatment (A3) + leader byte-identity (static source) --------
  const runtimeSrc = readFileSync("src/lib/agent/runtime.ts", "utf8");
  const sliceModuleSrc = readFileSync("src/lib/agent/snapshot-slice.ts", "utf8");
  const callSites = (runtimeSrc.match(/buildMemberSnapshotSlice\(/g) ?? []).length;
  check("S7 exactly ONE buildMemberSnapshotSlice call site (member envelope only)", callSites === 1, `call sites=${callSites}`);
  const sliceCallAt = runtimeSrc.indexOf("buildMemberSnapshotSlice(snapshot, task");
  const pinnedPushAt = runtimeSrc.indexOf('novelParts.push("", params.pinnedContext)');
  check(
    "S7 pinned push is UNCONDITIONAL and DOWNSTREAM of the slice call (A3: always shipped whole, never sliced)",
    sliceCallAt >= 0 && pinnedPushAt > sliceCallAt && runtimeSrc.includes("if (params.pinnedContext) {"),
    `slice@${sliceCallAt} < pinned@${pinnedPushAt}`
  );
  check("S7 leader envelope still renders the FULL snapshot (renderSnapshot at leader)", /STORY SNAPSHOT \(measured now\):", renderSnapshot\(snapshot\)/.test(runtimeSrc));
  check("S7 read_novel tool still returns the FULL fresh snapshot", /read_novel → ok\\n\$\{renderSnapshot\(fresh\)\}/.test(runtimeSrc));
  const codeOnly = sliceModuleSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  check("S7 slice module never touches pinned context in CODE (A3 doc comment may declare it)", !codeOnly.includes("pinned"));

  // S8 — config at rest (A4 knob; state updated by P5-e ruling R-1) ------------
  const yaml = readFileSync("agent/config/budgets.yaml", "utf8");
  const budgets = getBudgets();
  const slicingYaml = yaml.slice(yaml.indexOf("contextSlicing:"));
  check(
    "S8 budgets.yaml at rest: contextSlicing section present with enabled=true (P5-e ruling R-1; rollback = one flip to false)",
    slicingYaml.startsWith("contextSlicing:") && /^  enabled: true/m.test(slicingYaml.slice(0, slicingYaml.indexOf("\n\n")))
  );
  check("S8 parsed budgets: contextSlicing.enabled === true (P5-e ruling R-1)", budgets.contextSlicing.enabled === true);
  check("S8 parsed budgets: contextCompaction.enabled === false (untouched by P4)", budgets.contextCompaction.enabled === false);

  // MEAS — zero-GLM savings table (estimator basis) ---------------------------
  console.log("P4: ---- MEAS: per-shape savings on the representative fixture (countTokens est; CJK billed truth ~1.4×) ----");
  const fullTok = countTokens(REP_FULL);
  const sliceOf = (shape: string, detail = "plain brief with no guard triggers anywhere in it"): number => {
    const [assignee, artifact] = shape.split(":");
    return countTokens(
      buildMemberSnapshotSlice(REP, mkTask({ assignee, artifactType: artifact === "*" ? null : artifact, detail }), { enabled: true })
    );
  };
  for (const shape of Object.keys(SLICE_MAP)) {
    const t = sliceOf(shape);
    console.log(`P4:   ${shape.padEnd(20)} full≈${fullTok} sliced≈${t} saved≈${fullTok - t} tok (${(((fullTok - t) / fullTok) * 100).toFixed(1)}%)`);
  }
  const ceilSage = countTokens(
    buildMemberSnapshotSlice(CEIL, mkTask({ assignee: "sage", artifactType: "chapter", title: "continue the story" }), { enabled: true })
  );
  const ceilFull = countTokens(CEIL_FULL);
  console.log(`P4:   ceiling sage:chapter   full≈${ceilFull} sliced≈${ceilSage} saved≈${ceilFull - ceilSage} tok (${(((ceilFull - ceilSage) / ceilFull) * 100).toFixed(1)}%)`);

  await db.$disconnect();
  console.log(`P4: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`} (${checks} checks)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("P4 harness error:", e);
  process.exit(1);
});
