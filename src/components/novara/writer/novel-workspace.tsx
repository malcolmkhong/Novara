"use client";

import { useState } from "react";
import {
  Loader2,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useWriterStore } from "@/hooks/use-writer-store";
import { WRITER_TABS, type WriterTabId } from "@/config/writer";
import {
  addChapter,
  addCharacter,
  addOutlineBeat,
  addWorldEntry,
  deleteChapter,
  deleteCharacter,
  deleteOutlineBeat,
  deleteWorldEntry,
  requestAiDraft,
  updateChapter,
  updateCharacter,
  updateNovel,
  updateOutlineBeat,
  updateWorldEntry,
} from "@/lib/novara/api";
import type {
  AiDraftResult,
  ChapterDTO,
  ChapterStatus,
  CharacterDTO,
  NovelDetail,
  OutlineBeatDTO,
  WorldCategory,
  WorldEntryDTO,
} from "@/lib/novara/types";
import { formatWordCount } from "@/lib/novara/words";
import { AiTeamPanel } from "./ai-team-panel";
import { AgentConsole } from "./agent-console";
import { CharactersPanel, OutlinePanel, WorldPanel } from "./bible-panels";
import { ChapterEditor } from "./chapter-editor";
import { ExportDialog } from "./import-export";
import { MemoryPanel } from "./memory-panel";
import { ReviewPanel } from "./review-panel";
import { ConfirmDialog } from "./ui-bits";

interface NovelWorkspaceProps {
  detail: NovelDetail;
  onBack: () => void;
  onDelete: (id: string) => Promise<void>;
  onPatchChapter: (next: ChapterDTO) => void;
  refresh: () => Promise<void>;
}

export function NovelWorkspace({
  detail,
  onBack,
  onDelete,
  onPatchChapter,
  refresh,
}: NovelWorkspaceProps) {
  const { toast } = useToast();
  const { novel } = detail;
  const activeTab = useWriterStore((s) => s.activeTabByNovel[novel.id] ?? "chapters");
  const setActiveTab = useWriterStore((s) => s.setActiveTab);

  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(
    detail.chapters[0]?.id ?? null
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // edit-details form state
  const [formTitle, setFormTitle] = useState(novel.title);
  const [formGenre, setFormGenre] = useState(novel.genre);
  const [formSynopsis, setFormSynopsis] = useState(novel.synopsis);
  const [formTarget, setFormTarget] = useState(String(novel.targetWords));

  const totalWords = detail.chapters.reduce((s, c) => s + c.wordCount, 0);
  const pct = novel.targetWords
    ? Math.min(100, Math.round((totalWords / novel.targetWords) * 100))
    : 0;

  // ---- chapter handlers ----
  const handleAddChapter = async () => {
    try {
      const { chapter } = await addChapter(novel.id);
      await refresh();
      setSelectedChapterId(chapter.id);
      toast({ title: `“${chapter.title}” added` });
    } catch (e) {
      toast({
        title: "Could not add chapter",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleDeleteChapter = async (chapter: ChapterDTO) => {
    try {
      await deleteChapter(chapter.id);
      if (selectedChapterId === chapter.id) setSelectedChapterId(null);
      await refresh();
      toast({ title: `“${chapter.title}” deleted` });
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleSaveChapter = async (
    id: string,
    patch: { title?: string; content?: string; status?: ChapterStatus }
  ): Promise<ChapterDTO | null> => {
    try {
      const { chapter } = await updateChapter(id, patch);
      onPatchChapter(chapter);
      toast({ title: "Chapter saved" });
      return chapter;
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      return null;
    }
  };

  const handleAiDraft = async (chapter: ChapterDTO): Promise<AiDraftResult | null> => {
    try {
      return await requestAiDraft(chapter.id);
    } catch (e) {
      toast({
        title: "AI draft failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      return null;
    }
  };

  // ---- bible handlers (all end with a full refresh) ----
  const wrap = async (fn: () => Promise<unknown>, successTitle?: string): Promise<boolean> => {
    try {
      await fn();
      await refresh();
      if (successTitle) toast({ title: successTitle });
      return true;
    } catch (e) {
      toast({
        title: "Operation failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      return false;
    }
  };

  const saveMeta = async (): Promise<boolean> => {
    if (!formTitle.trim()) return false;
    const parsedTarget = Number.parseInt(formTarget, 10);
    return wrap(
      () =>
        updateNovel(novel.id, {
          title: formTitle.trim(),
          genre: formGenre.trim(),
          synopsis: formSynopsis,
          targetWords: Number.isFinite(parsedTarget)
            ? Math.min(Math.max(parsedTarget, 1000), 5000000)
            : undefined,
        }),
      "Novel details saved"
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold leading-tight sm:text-3xl">
              {novel.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {novel.genre && (
                <Badge variant="outline">{novel.genre}</Badge>
              )}
              <Badge variant="outline" className="text-muted-foreground">
                {novel.status}
              </Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Details
            </Button>
            <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
              <Upload className="h-4 w-4 rotate-180" aria-hidden="true" />
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Words
            </p>
            <p className="font-display text-xl font-bold">
              {formatWordCount(totalWords)}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                / {formatWordCount(novel.targetWords)}
              </span>
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Chapters
            </p>
            <p className="font-display text-xl font-bold">
              {detail.chapters.length}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Story bible
            </p>
            <p className="font-display text-xl font-bold">
              {detail.characters.length + detail.worldEntries.length}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                entries
              </span>
            </p>
          </div>
        </div>
        <Progress value={pct} className="mt-4 h-1.5" aria-label={`${pct}% of target length`} />
        <p className="mt-1 text-xs text-muted-foreground">{pct}% of target length</p>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(novel.id, v as WriterTabId)}
      >
        <TabsList className="flex-wrap">
          {WRITER_TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5">
              {tab.label}
              {tab.phaseTag && (
                <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-normal text-muted-foreground">
                  {tab.phaseTag}
                </span>
              )}
              {tab.id === "characters" && detail.characters.length > 0
                ? ` (${detail.characters.length})`
                : null}
              {tab.id === "world" && detail.worldEntries.length > 0
                ? ` (${detail.worldEntries.length})`
                : null}
              {tab.id === "outline" && detail.outlineBeats.length > 0
                ? ` (${detail.outlineBeats.length})`
                : null}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="chapters" className="mt-4">
          <ChapterEditor
            chapters={detail.chapters}
            selectedId={selectedChapterId}
            onSelect={setSelectedChapterId}
            onAdd={handleAddChapter}
            onDelete={handleDeleteChapter}
            onSave={handleSaveChapter}
            onAiDraft={handleAiDraft}
          />
        </TabsContent>

        <TabsContent value="characters" className="mt-4">
          <CharactersPanel
            characters={detail.characters}
            novelId={novel.id}
            onRefresh={refresh}
            onAdd={(input) =>
              wrap(() => addCharacter(novel.id, input), "Character added")
            }
            onUpdate={(id, patch) =>
              wrap(() => updateCharacter(id, patch), "Character saved")
            }
            onDelete={(c: CharacterDTO) =>
              wrap(() => deleteCharacter(c.id)).then(() => undefined)
            }
          />
        </TabsContent>

        <TabsContent value="world" className="mt-4">
          <WorldPanel
            entries={detail.worldEntries}
            groups={detail.worldGroups}
            novelId={novel.id}
            onRefresh={refresh}
            onAdd={(input) =>
              wrap(() => addWorldEntry(novel.id, input), "World entry added")
            }
            onUpdate={(id, patch) =>
              wrap(() => updateWorldEntry(id, patch), "World entry saved")
            }
            onDelete={(w: WorldEntryDTO) =>
              wrap(() => deleteWorldEntry(w.id)).then(() => undefined)
            }
          />
        </TabsContent>

        <TabsContent value="outline" className="mt-4">
          <OutlinePanel
            beats={detail.outlineBeats}
            onAdd={(input) =>
              wrap(() => addOutlineBeat(novel.id, input), "Beat added")
            }
            onUpdate={(id, patch) =>
              wrap(() => updateOutlineBeat(id, patch), "Beat saved")
            }
            onDelete={(b: OutlineBeatDTO) =>
              wrap(() => deleteOutlineBeat(b.id)).then(() => undefined)
            }
          />
        </TabsContent>

        <TabsContent value="team" className="mt-4 space-y-6">
          <AgentConsole novel={detail.novel} chapterCount={detail.chapters.length} />
          <div>
            <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Team roster
            </h3>
            <AiTeamPanel />
          </div>
        </TabsContent>

        <TabsContent value="review" className="mt-4">
          <ReviewPanel chapters={detail.chapters} />
        </TabsContent>

        <TabsContent value="memory" className="mt-4">
          <MemoryPanel
            detail={detail}
            onOpenArtifactTab={(t) => setActiveTab(novel.id, t)}
          />
        </TabsContent>
      </Tabs>

      {/* Export */}
      {exportOpen && (
        <ExportDialog novel={novel} onClose={() => setExportOpen(false)} />
      )}

      {/* Edit details */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novel details</DialogTitle>
            <DialogDescription>
              Title, genre, synopsis and target length.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="meta-title">Title</Label>
              <Input id="meta-title" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="meta-genre">Genre</Label>
                <Input id="meta-genre" value={formGenre} onChange={(e) => setFormGenre(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="meta-target">Target words</Label>
                <Input
                  id="meta-target"
                  type="number"
                  min={1000}
                  max={5000000}
                  value={formTarget}
                  onChange={(e) => setFormTarget(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meta-synopsis">Synopsis</Label>
              <Textarea
                id="meta-synopsis"
                value={formSynopsis}
                onChange={(e) => setFormSynopsis(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={async () => {
                setBusy(true);
                const ok = await saveMeta();
                setBusy(false);
                if (ok) setEditOpen(false);
              }}
              disabled={busy || !formTitle.trim()}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Save details
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete novel */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this novel?"
        description={`“${novel.title}” and all of its content will be permanently deleted. Export a backup first if you might want it back.`}
        onConfirm={async () => {
          setDeleteOpen(false);
          await onDelete(novel.id);
        }}
      />
    </div>
  );
}
