// ---------------------------------------------------------------------------
// Novara AI — client-side API helpers. All requests go through Next.js
// route handlers; the client never touches the database directly.
// ---------------------------------------------------------------------------

import type {
  AiDraftResult,
  ChapterDTO,
  ChapterPackDTO,
  ChapterPackKind,
  CharacterDTO,
  ChapterStatus,
  ClueStatus,
  ImportReport,
  LedgerView,
  NovelBackupFile,
  NovelDetail,
  NovelStatus,
  NovelSummary,
  OutlineBeatDTO,
  PromiseStatus,
  StorylineStatus,
  VolumeDTO,
  WorldCategory,
  WorldEntryDTO,
  WorldGroupDTO,
} from "./types";
import type { ChapterReview, NovelMemoryView } from "./agent-types";

import { authFetch } from "@/lib/firebase/client";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let body: unknown = null;
    try {
      body = await res.json();
      const err = body as { error?: string };
      if (err?.error) message = err.error;
    } catch {
      // ignore JSON parse errors on error responses
    }
    // Attach status + parsed body so callers can branch on structured
    // errors (e.g. the chapter overwrite gate's 409 requiresOverwrite).
    const error = new Error(message) as Error & {
      status?: number;
      body?: unknown;
    };
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Novels
// ---------------------------------------------------------------------------

export function listNovels(): Promise<{ novels: NovelSummary[] }> {
  return request("/api/novels");
}

export interface CreateNovelInput {
  title: string;
  genre?: string;
  synopsis?: string;
  targetWords?: number;
  characters?: { name: string; role?: string; description?: string }[];
  worldEntries?: { title: string; category?: string; content?: string }[];
  outlineBeats?: { title: string; summary?: string }[];
  // Phase 9 — written at creation by the wizard (构想快照 verbatim baseline).
  conceptSnapshot?: string;
  // P5 — the wizard session id (client crypto.randomUUID) that generated
  // this foundation; persisted as a UsageProvenance link so the session's
  // ledger rows retro-tag onto the created novel. Manual creates omit it.
  wizardSessionId?: string;
}

export function createNovel(
  input: CreateNovelInput
): Promise<{ novel: NovelSummary }> {
  return request("/api/novels", { method: "POST", body: JSON.stringify(input) });
}

// ---------------------------------------------------------------------------
// AI wizard ("New with the AI team")
// ---------------------------------------------------------------------------

export type WizardSection =
  | "logline"
  | "premise"
  | "characters"
  | "world"
  | "beats"
  | "contract";

export interface WizardGenerateInput {
  section: WizardSection;
  genre?: string;
  logline?: string;
  premise?: string;
  characters?: string;
  targetWords?: number;
  // P5 — same session id on every section call of one wizard session, and
  // on the CreateNovelInput that culminates — the retro-tag thread.
  sessionId?: string;
}

export function generateWizardSection(
  input: WizardGenerateInput
): Promise<{ content: string }> {
  return request("/api/ai/wizard", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getNovel(id: string): Promise<NovelDetail> {
  return request(`/api/novels/${id}`);
}

export interface UpdateNovelInput {
  title?: string;
  genre?: string;
  synopsis?: string;
  targetWords?: number;
  status?: NovelStatus;
  /** Story contract (作品契约) — upserted 1:1 (Phase 7 P1). */
  contract?: string;
  /** Contract canon lock (Phase 9): "final" locks; editing needs reopen. */
  contractStatus?: "draft" | "final";
  contractReopen?: boolean;
  /** 构想快照 — initial creative vision snapshot (Phase 8). */
  conceptSnapshot?: string;
}

export function updateNovel(
  id: string,
  patch: UpdateNovelInput
): Promise<{ novel: NovelSummary }> {
  return request(`/api/novels/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteNovel(id: string): Promise<{ ok: true }> {
  return request(`/api/novels/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

export function addChapter(
  novelId: string,
  title?: string
): Promise<{ chapter: ChapterDTO }> {
  return request(`/api/novels/${novelId}/chapters`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export interface UpdateChapterInput {
  title?: string;
  content?: string;
  status?: ChapterStatus;
  /** Chapter brief (细纲) — author-editable writing brief (Phase 7). */
  brief?: string;
  /** Explicit confirmation required by the anti-overwrite gate (409). */
  overwrite?: boolean;
  /** Explicit confirmation required by the final-lock gate (409 requiresReopen). */
  reopen?: boolean;
}

export interface ChapterVersionRow {
  id: string;
  draftNo: number;
  wordCount: number;
  createdBy: "author" | "agent" | "restore";
  createdAt: string;
  content: string;
}

export function getChapterVersions(
  id: string
): Promise<{ chapterId: string; index: number; versions: ChapterVersionRow[] }> {
  return request(`/api/chapters/${id}/versions`, { method: "GET" });
}

export function updateChapter(
  id: string,
  patch: UpdateChapterInput
): Promise<{ chapter: ChapterDTO }> {
  return request(`/api/chapters/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

// ---------------------------------------------------------------------------
// Review & sediment (Phase 2)
// ---------------------------------------------------------------------------

export function reviewChapter(id: string): Promise<ChapterReview> {
  return request(`/api/chapters/${id}/review`, { method: "POST" });
}

export interface SedimentResult {
  digestSummary: string;
  factsCreated: number;
  factsTouched: number;
  characterStates: number;
  plantsCreated: number;
  advanced: number;
  paid: number;
}

export interface ForeshadowRow {
  id: string;
  content: string;
  plantChapter: number;
  payByChapter: number | null;
  status: "open" | "advanced" | "paid" | string;
  lastChapter: number | null;
}

export interface SedimentResponse {
  chapterId: string;
  sedimentedAt: string;
  result: SedimentResult;
  ledger: ForeshadowRow[];
}

export function sedimentChapter(id: string): Promise<SedimentResponse> {
  return request(`/api/chapters/${id}/sediment`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Memory view (Phase 4) — the story bible read back
// ---------------------------------------------------------------------------

export function getNovelMemory(id: string): Promise<NovelMemoryView> {
  return request(`/api/novels/${id}/memory`);
}

export function deleteChapter(id: string): Promise<{ ok: true }> {
  return request(`/api/chapters/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export interface CharacterInput {
  name: string;
  role?: string;
  description?: string;
  /** Comma-separated alternate names (Phase 7 P1). */
  aliases?: string;
}

export interface CharacterUpdateInput extends Partial<CharacterInput> {
  /** Canon lock (Phase 9): "final" locks; editing a locked row needs reopen. */
  status?: "draft" | "final";
  reopen?: boolean;
}

export function addCharacter(
  novelId: string,
  input: CharacterInput
): Promise<{ character: CharacterDTO }> {
  return request(`/api/novels/${novelId}/characters`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateCharacter(
  id: string,
  patch: CharacterUpdateInput
): Promise<{ character: CharacterDTO }> {
  return request(`/api/characters/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteCharacter(id: string, reopen = false): Promise<{ ok: true }> {
  return request(`/api/characters/${id}${reopen ? "?reopen=1" : ""}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// 世界书 groups (Phase 9) — second-level grouping in the world bible
// ---------------------------------------------------------------------------

export function listWorldGroups(novelId: string): Promise<{ groups: WorldGroupDTO[] }> {
  return request(`/api/novels/${novelId}/world-groups`);
}

export function addWorldGroup(
  novelId: string,
  name: string
): Promise<{ group: WorldGroupDTO }> {
  return request(`/api/novels/${novelId}/world-groups`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateWorldGroup(
  id: string,
  patch: { name?: string; moveTo?: number }
): Promise<{ group: WorldGroupDTO }> {
  return request(`/api/world-groups/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteWorldGroup(id: string): Promise<{ ok: true }> {
  return request(`/api/world-groups/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// World entries
// ---------------------------------------------------------------------------

export interface WorldEntryInput {
  title: string;
  category?: WorldCategory;
  content?: string;
}

export interface WorldEntryUpdateInput extends Partial<WorldEntryInput> {
  /** 世界书 second-level grouping (Phase 9) — null ungroups. */
  groupId?: string | null;
  /** Canon lock (Phase 9): "final" locks; editing a locked row needs reopen. */
  status?: "draft" | "final";
  reopen?: boolean;
}

export function addWorldEntry(
  novelId: string,
  input: WorldEntryInput
): Promise<{ entry: WorldEntryDTO }> {
  return request(`/api/novels/${novelId}/world-entries`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateWorldEntry(
  id: string,
  patch: WorldEntryUpdateInput
): Promise<{ entry: WorldEntryDTO }> {
  return request(`/api/world-entries/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteWorldEntry(id: string, reopen = false): Promise<{ ok: true }> {
  return request(`/api/world-entries/${id}${reopen ? "?reopen=1" : ""}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Outline beats
// ---------------------------------------------------------------------------

export interface OutlineBeatInput {
  title: string;
  summary?: string;
  /** Owning volume id (Phase 7 P1) — null unsorts the beat. */
  volumeId?: string | null;
}

export interface OutlineBeatUpdateInput extends Partial<OutlineBeatInput> {
  /** Canon lock (Phase 9): "final" locks; editing a locked beat needs reopen. */
  status?: "draft" | "final";
  reopen?: boolean;
}

export function addOutlineBeat(
  novelId: string,
  input: OutlineBeatInput
): Promise<{ beat: OutlineBeatDTO }> {
  return request(`/api/novels/${novelId}/outline-beats`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateOutlineBeat(
  id: string,
  patch: OutlineBeatUpdateInput
): Promise<{ beat: OutlineBeatDTO }> {
  return request(`/api/outline-beats/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteOutlineBeat(id: string, reopen = false): Promise<{ ok: true }> {
  return request(`/api/outline-beats/${id}${reopen ? "?reopen=1" : ""}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Volumes (Phase 7 P1) — 卷实体
// ---------------------------------------------------------------------------

export interface VolumeInput {
  title: string;
  synopsis?: string;
}

export function getVolumes(novelId: string): Promise<{ volumes: VolumeDTO[] }> {
  return request(`/api/novels/${novelId}/volumes`);
}

export function addVolume(
  novelId: string,
  input: VolumeInput
): Promise<{ volume: VolumeDTO }> {
  return request(`/api/novels/${novelId}/volumes`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateVolume(
  id: string,
  patch: Partial<VolumeInput> & {
    moveTo?: number;
    /** Canon lock (Phase 9): "final" locks; editing a locked volume needs reopen. */
    status?: "draft" | "final";
    reopen?: boolean;
  }
): Promise<{ volume: VolumeDTO }> {
  return request(`/api/volumes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteVolume(id: string, reopen = false): Promise<{ ok: true }> {
  return request(`/api/volumes/${id}${reopen ? "?reopen=1" : ""}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Ledger (Phase 7 P1 + Phase 8) — 故事线 / 时间线 / 人物弧线 / 承诺 / 线索
// ---------------------------------------------------------------------------

export function getLedger(novelId: string): Promise<LedgerView> {
  return request(`/api/novels/${novelId}/ledger`);
}

export type LedgerKind = "storyline" | "timeline" | "arc" | "promise" | "clue";

export interface LedgerInput {
  storyline: { name: string; summary?: string; status?: StorylineStatus };
  timeline: { label: string; detail?: string; chapterIndex?: number | null };
  arc: { characterName: string; note: string; chapterIndex?: number | null };
  promise: {
    content: string;
    status?: PromiseStatus;
    madeChapter?: number | null;
    dueChapter?: number | null;
  };
  clue: {
    content: string;
    status?: ClueStatus;
    plantChapter?: number | null;
    revealChapter?: number | null;
  };
}

export function addLedgerRow<K extends LedgerKind>(
  novelId: string,
  kind: K,
  data: LedgerInput[K]
): Promise<{ row: unknown }> {
  return request(`/api/novels/${novelId}/ledger`, {
    method: "POST",
    body: JSON.stringify({ kind, data }),
  });
}

/** Per-kind ledger update patch (Phase 9): storyline/promise/clue carry a
 * lifecycle `status` in LedgerInput, so their canon lock rides `lock`;
 * timeline/arc have no lifecycle status, so canon rides `status`. */
export type LedgerUpdatePatch<K extends LedgerKind> = Partial<LedgerInput[K]> &
  (K extends "storyline" | "promise" | "clue"
    ? { moveTo?: number; lock?: "draft" | "final"; reopen?: boolean }
    : { moveTo?: number; status?: "draft" | "final"; reopen?: boolean });

export function updateLedgerRow<K extends LedgerKind>(
  kind: K,
  id: string,
  patch: LedgerUpdatePatch<K>
): Promise<{ row: unknown }> {
  return request(`/api/ledger/${kind}/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ kind, data: patch }),
  });
}

export function deleteLedgerRow(
  kind: LedgerKind,
  id: string,
  reopen = false
): Promise<{ ok: true }> {
  return request(`/api/ledger/${kind}/${id}${reopen ? "?reopen=1" : ""}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Chapter packs (Phase 8) — 材料包 / 定稿准备包 (草稿区 workspace)
// ---------------------------------------------------------------------------

export function getPacks(novelId: string): Promise<{ packs: ChapterPackDTO[] }> {
  return request(`/api/novels/${novelId}/packs`);
}

export interface PackUpsertInput {
  kind: ChapterPackKind;
  chapterIndex: number;
  title?: string;
  content?: string;
}

export function upsertPack(
  novelId: string,
  input: PackUpsertInput
): Promise<{ pack: ChapterPackDTO }> {
  return request(`/api/novels/${novelId}/packs`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updatePack(
  id: string,
  patch: { title?: string; content?: string }
): Promise<{ pack: ChapterPackDTO }> {
  return request(`/api/packs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deletePack(id: string): Promise<{ ok: true }> {
  return request(`/api/packs/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Import / Export
// ---------------------------------------------------------------------------

export function exportNovelBackup(id: string): Promise<NovelBackupFile> {
  return request(`/api/novels/${id}/export`);
}

export function importNovelBackup(
  backup: unknown
): Promise<{ novel: NovelSummary; report: ImportReport }> {
  return request("/api/import", {
    method: "POST",
    body: JSON.stringify(backup),
  });
}

// ---------------------------------------------------------------------------
// AI draft (experimental) — variants > 1 returns A/B alternatives (Phase 6)
// ---------------------------------------------------------------------------

export function requestAiDraft(
  chapterId: string,
  opts: { variants?: number } = {}
): Promise<AiDraftResult> {
  return request("/api/ai/draft", {
    method: "POST",
    body: JSON.stringify({ chapterId, variants: opts.variants ?? 1 }),
  });
}

// ---------------------------------------------------------------------------
// QC evals (Phase 6) — behavioral probe console, zero AI cost
// ---------------------------------------------------------------------------

export interface QcEvalCheck {
  id: string;
  group: string;
  name: string;
  pass: boolean;
  expected: string;
  actual: string;
  ms: number;
}

export interface QcEvalReport {
  checks: QcEvalCheck[];
  passed: number;
  failed: number;
  totalMs: number;
  runAt: string;
  budgets: {
    revisionRounds: number;
    aiRetries: number;
    maxConcurrent: number;
  };
}

export function runQcEvals(): Promise<QcEvalReport> {
  return request("/api/agent/qc/evals");
}
