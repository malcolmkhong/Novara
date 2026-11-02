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
  NovelBackupFile,
  NovelDetail,
  NovelStatus,
  NovelSummary,
  OutlineBeatDTO,
  WorldCategory,
  WorldEntryDTO,
} from "./types";

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
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore JSON parse errors on error responses
    }
    throw new Error(message);
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
}

export function createNovel(
  input: CreateNovelInput
): Promise<{ novel: NovelSummary }> {
  return request("/api/novels", { method: "POST", body: JSON.stringify(input) });
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
// AI draft (experimental)
// ---------------------------------------------------------------------------

export function requestAiDraft(chapterId: string): Promise<AiDraftResult> {
  return request("/api/ai/draft", {
    method: "POST",
    body: JSON.stringify({ chapterId }),
  });
}
