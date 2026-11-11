"use client";

// ---------------------------------------------------------------------------
// Novara AI — Workbench right pane: artifact views.
//
// Content surfaces (draft editor, outline, bible, review, memory) live here
// as tabs. The pane also carries agent-linked notices:
//   - error events bound to an asset surface as an alert banner on that tab
//   - in-progress tasks bound to an asset surface as an "working on" banner
// ---------------------------------------------------------------------------

import { AlertTriangle, Info, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AgentEvent, AgentTask } from "@/lib/novara/agent-types";
import type {
  AiDraftResult,
  ChapterDTO,
  ChapterPackDTO,
  ChapterPackKind,
  ChapterStatus,
  CharacterDTO,
  NovelDetail,
  OutlineBeatDTO,
  VolumeDTO,
  WorldEntryDTO,
} from "@/lib/novara/types";
import type { ArtifactTabId } from "@/config/writer";
import { ARTIFACT_TABS } from "@/config/writer";
import { useWriterStore } from "@/hooks/use-writer-store";
import { cn } from "@/lib/utils";
import { CanonPanel } from "./canon-panel";
import { ContractPanel } from "./contract-panel";
import {
  BeatDocument,
  CharacterDocument,
  CharactersPanel,
  OutlinePanel,
  VolumeDocument,
  WorldDocument,
  WorldPanel,
} from "./bible-panels";
import { ChapterEditor } from "./chapter-editor";
import { LedgerPanel } from "./ledger-panel";
import { MemoryPanel } from "./memory-panel";
import { PacksPanel } from "./packs-panel";
import { QcPanel } from "./qc-panel";
import { ReviewPanel } from "./review-panel";

// ---------------------------------------------------------------------------
// Event → tab binding
// ---------------------------------------------------------------------------

type ArtifactScope = "chapter" | "outline_beat" | "world_entry" | "character";

function scopeForTab(tab: ArtifactTabId): ArtifactScope[] {
  switch (tab) {
    case "draft":
    case "canon":
      return ["chapter"];
    case "outline":
      return ["outline_beat"];
    case "bible":
      return ["world_entry", "character"];
    default:
      return [];
  }
}

function eventArtifact(event: AgentEvent): ArtifactScope | null {
  const raw = event.payload?.artifact;
  if (
    raw === "chapter" ||
    raw === "outline_beat" ||
    raw === "world_entry" ||
    raw === "character"
  ) {
    return raw;
  }
  return null;
}

/** Error events that should surface as an alert banner on this tab. */
function warningsForTab(events: AgentEvent[], tab: ArtifactTabId): AgentEvent[] {
  const scopes = scopeForTab(tab);
  return events.filter((e) => {
    if (e.kind !== "error") return false;
    const artifact = eventArtifact(e);
    // Unattributed errors surface on every tab — they must not be missable.
    return artifact == null || scopes.includes(artifact);
  });
}

/** In-progress tasks bound to this tab's assets (the "working on" banner). */
function workingTasksForTab(tasks: AgentTask[], tab: ArtifactTabId): AgentTask[] {
  const scopes = scopeForTab(tab);
  return tasks.filter(
    (t) =>
      t.status === "in_progress" &&
      t.artifactType != null &&
      scopes.includes(t.artifactType)
  );
}

// ---------------------------------------------------------------------------
// 章摘要 (Phase 8) — read-only digest list settled by Review → Settle.
// ---------------------------------------------------------------------------

function DigestsCard({
  digests,
  chapters,
}: {
  digests: NovelDetail["digests"];
  chapters: ChapterDTO[];
}) {
  const sorted = [...digests].sort((a, b) => a.chapterIndex - b.chapterIndex);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="font-display text-sm">章摘要 · Chapter digests</CardTitle>
        <CardDescription>
          Per-chapter recaps the AI chains continuity from (大纲/卷规划/章摘要).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No chapter digests yet — run Review → Settle to settle a chapter.
          </p>
        ) : (
          <ul className="nice-scroll max-h-72 space-y-2 overflow-y-auto pr-1">
            {sorted.map((d) => {
              const chapter = chapters.find((c) => c.id === d.chapterId);
              return (
                <li key={d.chapterId} className="border-b pb-2 last:border-0">
                  <p className="text-xs font-medium">
                    第{d.chapterIndex}章
                    {chapter ? ` · ${chapter.title}` : ""}
                  </p>
                  {d.summary && (
                    <p className="mt-0.5 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                      {d.summary}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TabNotices({
  warnings,
  working,
}: {
  warnings: AgentEvent[];
  working: AgentTask[];
}) {
  if (warnings.length === 0 && working.length === 0) return null;
  return (
    <div className="space-y-2">
      {warnings.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            {warnings.map((w) => (
              <span key={w.id} className="block">
                {w.summary}
              </span>
            ))}
          </span>
        </div>
      )}
      {working.length > 0 && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800"
        >
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            {working.map((t) => (
              <span key={t.id} className="block">
                {t.key} is working on {t.artifactLabel ?? "this asset"} — simulated
                writes land here only after you approve.
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ArtifactPane
// ---------------------------------------------------------------------------

export interface ArtifactPaneHandlers {
  // chapters
  selectedChapterId: string | null;
  onSelectChapter: (id: string) => void;
  // tree-opened asset focus (highlight + scroll into view)
  focusBeatId: string | null;
  focusCharacterId: string | null;
  focusWorldId: string | null;
  // back actions for tree-opened single-asset document windows
  onClearCharacter: () => void;
  onClearWorld: () => void;
  onClearBeat: () => void;
  onAddChapter: () => Promise<void>;
  onDeleteChapter: (chapter: ChapterDTO) => Promise<void>;
  onSaveChapter: (
    id: string,
    patch: { title?: string; content?: string; status?: ChapterStatus; brief?: string }
  ) => Promise<ChapterDTO | null>;
  onAiDraft: (chapter: ChapterDTO) => Promise<AiDraftResult | null>;
  // characters
  onAddCharacter: (input: { name: string; role?: string; description?: string }) => Promise<boolean>;
  onUpdateCharacter: (id: string, patch: Partial<{ name: string; role?: string; aliases?: string; description?: string }>) => Promise<boolean>;
  onDeleteCharacter: (character: CharacterDTO) => Promise<void>;
  // world
  onAddWorldEntry: (input: { title: string; category?: WorldEntryDTO["category"]; content?: string }) => Promise<boolean>;
  onUpdateWorldEntry: (id: string, patch: Partial<{ title: string; category?: WorldEntryDTO["category"]; content?: string }>) => Promise<boolean>;
  onDeleteWorldEntry: (entry: WorldEntryDTO) => Promise<void>;
  // outline
  onAddBeat: (input: { title: string; summary?: string }) => Promise<boolean>;
  onUpdateBeat: (id: string, patch: Partial<{ title: string; summary?: string; volumeId?: string | null }>) => Promise<boolean>;
  onDeleteBeat: (beat: OutlineBeatDTO) => Promise<void>;
  // volumes (卷, P1)
  selectedVolumeId: string | null;
  onOpenVolume: (volumeId: string) => void;
  onClearVolume: () => void;
  onUpdateVolume: (id: string, patch: { title?: string; synopsis?: string }) => Promise<boolean>;
  onDeleteVolume: (volume: VolumeDTO) => Promise<void>;
  /** Parent refetch for panel-driven volume create/delete. */
  onRefresh: () => Promise<void>;
  // ---- Phase 8: packs (草稿区 workspace) ----
  selectedPackKey: string | null;
  onSelectPack: (key: string | null) => void;
  onUpsertPack: (kind: ChapterPackKind, chapterIndex: number) => Promise<boolean>;
  onUpdatePack: (id: string, patch: { title?: string; content?: string }) => Promise<boolean>;
  onDeletePack: (pack: ChapterPackDTO) => Promise<void>;
  // ---- Phase 8: contract + concept documents ----
  onSaveContract: (content: string) => Promise<boolean>;
  onSaveConcept: (content: string) => Promise<boolean>;
  // ---- Phase 8: canon (定稿区 read-only) ----
  onOpenChapterInEditor: (chapterId: string) => void;
}

interface ArtifactPaneProps {
  detail: NovelDetail;
  events: AgentEvent[];
  tasks: AgentTask[];
  handlers: ArtifactPaneHandlers;
  className?: string;
}

export function ArtifactPane({
  detail,
  events,
  tasks,
  handlers,
  className,
}: ArtifactPaneProps) {
  const novelId = detail.novel.id;
  const tab = useWriterStore((s) => s.artifactTabByNovel[novelId] ?? "draft");
  const setTab = useWriterStore((s) => s.setArtifactTab);

  // Tree-opened assets render as single-asset document windows when present.
  const focusedCharacter =
    detail.characters.find((c) => c.id === handlers.focusCharacterId) ?? null;
  const focusedWorld =
    detail.worldEntries.find((w) => w.id === handlers.focusWorldId) ?? null;
  const focusedBeat =
    detail.outlineBeats.find((b) => b.id === handlers.focusBeatId) ?? null;
  const focusedVolume =
    detail.volumes.find((v) => v.id === handlers.selectedVolumeId) ?? null;

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)} aria-label="Artifact pane">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(novelId, v as ArtifactTabId)}
        className="flex h-full min-h-0 flex-col gap-0"
      >
        <TabsList className="nice-scroll h-auto w-full flex-nowrap justify-start overflow-x-auto rounded-none border-b bg-transparent p-0">
          {ARTIFACT_TABS.map((t) => (
            <TabsTrigger
              key={t.id}
              value={t.id}
              className="shrink-0 gap-1.5 rounded-none border-b-2 border-transparent px-2.5 py-2 text-xs data-[state=active]:border-primary"
            >
              {t.label}
              {t.phaseTag && (
                <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-normal text-muted-foreground">
                  {t.phaseTag}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="nice-scroll min-h-0 flex-1 overflow-y-auto p-3">
          <TabsContent value="draft" className="mt-0">
            <div className="space-y-3">
              <TabNotices
                warnings={warningsForTab(events, "draft")}
                working={workingTasksForTab(tasks, "draft")}
              />
              <ChapterEditor
                chapters={detail.chapters}
                selectedId={handlers.selectedChapterId}
                onSelect={handlers.onSelectChapter}
                onAdd={handlers.onAddChapter}
                onDelete={handlers.onDeleteChapter}
                onSave={handlers.onSaveChapter}
                onAiDraft={handlers.onAiDraft}
                hideList
              />
            </div>
          </TabsContent>

          <TabsContent value="outline" className="mt-0">
            <div className="space-y-3">
              <TabNotices
                warnings={warningsForTab(events, "outline")}
                working={workingTasksForTab(tasks, "outline")}
              />
              {focusedVolume ? (
                <VolumeDocument
                  volume={focusedVolume}
                  novelId={novelId}
                  onRefresh={handlers.onRefresh}
                  onUpdate={handlers.onUpdateVolume}
                  onDelete={handlers.onDeleteVolume}
                  onBack={handlers.onClearVolume}
                />
              ) : focusedBeat ? (
                <BeatDocument
                  beat={focusedBeat}
                  novelId={novelId}
                  onRefresh={handlers.onRefresh}
                  volumes={detail.volumes}
                  onUpdate={handlers.onUpdateBeat}
                  onDelete={handlers.onDeleteBeat}
                  onBack={handlers.onClearBeat}
                />
              ) : (
                <OutlinePanel
                  beats={detail.outlineBeats}
                  focusBeatId={handlers.focusBeatId}
                  volumes={detail.volumes}
                  novelId={novelId}
                  onRefresh={handlers.onRefresh}
                  onOpenVolume={handlers.onOpenVolume}
                  onAdd={handlers.onAddBeat}
                  onUpdate={handlers.onUpdateBeat}
                  onDelete={handlers.onDeleteBeat}
                />
              )}
              {/* 章摘要 (Phase 8) — chapter digests settled by the pipeline. */}
              <DigestsCard digests={detail.digests} chapters={detail.chapters} />
            </div>
          </TabsContent>

          <TabsContent value="bible" className="mt-0">
            <div className="space-y-4">
              <TabNotices
                warnings={warningsForTab(events, "bible")}
                working={workingTasksForTab(tasks, "bible")}
              />
              {focusedCharacter ? (
                <CharacterDocument
                  character={focusedCharacter}
                  novelId={novelId}
                  onRefresh={handlers.onRefresh}
                  onUpdate={handlers.onUpdateCharacter}
                  onDelete={handlers.onDeleteCharacter}
                  onBack={handlers.onClearCharacter}
                />
              ) : focusedWorld ? (
                <WorldDocument
                  entry={focusedWorld}
                  novelId={novelId}
                  onRefresh={handlers.onRefresh}
                  onUpdate={handlers.onUpdateWorldEntry}
                  onDelete={handlers.onDeleteWorldEntry}
                  onBack={handlers.onClearWorld}
                />
              ) : (
                <>
                  <CharactersPanel
                    characters={detail.characters}
                    novelId={novelId}
                    focusCharacterId={handlers.focusCharacterId}
                    onRefresh={handlers.onRefresh}
                    onAdd={handlers.onAddCharacter}
                    onUpdate={handlers.onUpdateCharacter}
                    onDelete={handlers.onDeleteCharacter}
                  />
                  <WorldPanel
                    entries={detail.worldEntries}
                    groups={detail.worldGroups}
                    novelId={novelId}
                    focusWorldId={handlers.focusWorldId}
                    onRefresh={handlers.onRefresh}
                    onAdd={handlers.onAddWorldEntry}
                    onUpdate={handlers.onUpdateWorldEntry}
                    onDelete={handlers.onDeleteWorldEntry}
                  />
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="packs" className="mt-0">
            <PacksPanel
              packs={detail.packs}
              chapters={detail.chapters}
              selectedPackKey={handlers.selectedPackKey}
              onSelectPack={handlers.onSelectPack}
              onUpsertPack={handlers.onUpsertPack}
              onUpdatePack={handlers.onUpdatePack}
              onDeletePack={handlers.onDeletePack}
            />
          </TabsContent>

          <TabsContent value="canon" className="mt-0">
            <div className="space-y-3">
              <TabNotices
                warnings={warningsForTab(events, "canon")}
                working={workingTasksForTab(tasks, "canon")}
              />
              <CanonPanel
                chapters={detail.chapters}
                selectedChapterId={handlers.selectedChapterId}
                onSelectChapter={handlers.onSelectChapter}
                onOpenChapterInEditor={handlers.onOpenChapterInEditor}
              />
            </div>
          </TabsContent>

          <TabsContent value="contract" className="mt-0">
            <ContractPanel
              novelId={novelId}
              contract={detail.contract}
              contractStatus={detail.contractStatus}
              conceptSnapshot={detail.novel.conceptSnapshot}
              genre={detail.novel.genre}
              synopsis={detail.novel.synopsis}
              onSaveContract={handlers.onSaveContract}
              onSaveConcept={handlers.onSaveConcept}
              onRefresh={handlers.onRefresh}
            />
          </TabsContent>

          <TabsContent value="ledger" className="mt-0">
            {/* STEP 65 — onRefresh is the shell's refresh(): the ledger panel
                calls it after a successful write so the RAIL's 账本 counts
                (computed from the NovelDetail snapshot) stop going stale. */}
            <LedgerPanel novelId={novelId} onRefresh={handlers.onRefresh} />
          </TabsContent>

          <TabsContent value="review" className="mt-0">
            <ReviewPanel chapters={detail.chapters} />
          </TabsContent>

          <TabsContent value="memory" className="mt-0">
            <MemoryPanel
              detail={detail}
              onOpenArtifactTab={(t) => setTab(novelId, t)}
            />
          </TabsContent>

          <TabsContent value="qc" className="mt-0">
            <QcPanel />
          </TabsContent>
        </div>
      </Tabs>

      {/* Legend for the agent notices */}
      <p className="flex items-center gap-1.5 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        <Info className="h-3 w-3 shrink-0" aria-hidden="true" />
        Agent warnings and in-progress writes appear as banners inside each tab.
      </p>
    </div>
  );
}
