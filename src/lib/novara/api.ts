// ---------------------------------------------------------------------------
// Novara AI — client-side API helpers. All requests go through Next.js
// route handlers; the client never touches the database directly.
// ---------------------------------------------------------------------------

import type {
  AiDraftResult,
  ChapterDTO,
  CharacterDTO,
  ChapterStatus,
  ImportReport,
  LedgerView,
  NovelBackupFile,
  NovelDetail,
  NovelStatus,
  NovelSummary,
  OutlineBeatDTO,
  StorylineStatus,
  VolumeDTO,
  WorldCategory,
  WorldEntryDTO,
} from "./types";
import type { ChapterReview, NovelMemoryView } from "./agent-types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
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
}

export function createNovel(
  input: CreateNovelInput
): Promise<{ novel: NovelSummary }> {
  return request("/api/novels", { method: "POST", body: JSON.stringify(input) });
}

// ---------------------------------------------------------------------------
// AI wizard ("New with the AI team")
// ---------------------------------------------------------------------------

export type WizardSection = "logline" | "premise" | "characters" | "beats";

export interface WizardGenerateInput {
  section: WizardSection;
  genre?: string;
  logline?: string;
  premise?: string;
  characters?: string;
  targetWords?: number;
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
  patch: Partial<CharacterInput>
): Promise<{ character: CharacterDTO }> {
  return request(`/api/characters/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteCharacter(id: string): Promise<{ ok: true }> {
  return request(`/api/characters/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// World entries
// ---------------------------------------------------------------------------

export interface WorldEntryInput {
  title: string;
  category?: WorldCategory;
  content?: string;
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
  patch: Partial<WorldEntryInput>
): Promise<{ entry: WorldEntryDTO }> {
  return request(`/api/world-entries/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteWorldEntry(id: string): Promise<{ ok: true }> {
  return request(`/api/world-entries/${id}`, { method: "DELETE" });
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
  patch: Partial<OutlineBeatInput>
): Promise<{ beat: OutlineBeatDTO }> {
  return request(`/api/outline-beats/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteOutlineBeat(id: string): Promise<{ ok: true }> {
  return request(`/api/outline-beats/${id}`, { method: "DELETE" });
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
  patch: Partial<VolumeInput> & { moveTo?: number }
): Promise<{ volume: VolumeDTO }> {
  return request(`/api/volumes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteVolume(id: string): Promise<{ ok: true }> {
  return request(`/api/volumes/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Ledger (Phase 7 P1) — 故事线 / 时间线 / 人物弧线
// ---------------------------------------------------------------------------

export function getLedger(novelId: string): Promise<LedgerView> {
  return request(`/api/novels/${novelId}/ledger`);
}

export type LedgerKind = "storyline" | "timeline" | "arc";

export interface LedgerInput {
  storyline: { name: string; summary?: string; status?: StorylineStatus };
  timeline: { label: string; detail?: string; chapterIndex?: number | null };
  arc: { characterName: string; note: string; chapterIndex?: number | null };
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

export function updateLedgerRow<K extends LedgerKind>(
  kind: K,
  id: string,
  patch: Partial<LedgerInput[K]> & { moveTo?: number }
): Promise<{ row: unknown }> {
  return request(`/api/ledger/${kind}/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ kind, data: patch }),
  });
}

export function deleteLedgerRow(kind: LedgerKind, id: string): Promise<{ ok: true }> {
  return request(`/api/ledger/${kind}/${id}`, { method: "DELETE" });
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
    glmRetries: number;
    maxConcurrent: number;
  };
}

export function runQcEvals(): Promise<QcEvalReport> {
  return request("/api/agent/qc/evals");
}
