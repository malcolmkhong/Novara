"use client";

import { useState } from "react";
import { BookOpen, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { CreateNovelInput } from "@/lib/novara/api";
import type { NovelSummary } from "@/lib/novara/types";
import { formatWordCount } from "@/lib/novara/words";
import { ImportDialog } from "./import-export";
import { CreateWizard } from "./create-wizard";
import { ConfirmDialog, ListSkeleton } from "./ui-bits";
import { Spinner } from "@/components/novara/primitives";
import { cn } from "@/lib/utils";
import { TEXT_META, TEXT_CAPTION } from "@/components/novara/styles";

interface NovelDashboardProps {
  novels: NovelSummary[];
  loading: boolean;
  onOpen: (id: string) => void;
  onCreate: (input: CreateNovelInput) => Promise<boolean>;
  onImported: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}

export function NovelDashboard({
  novels,
  loading,
  onOpen,
  onCreate,
  onImported,
  onDelete,
}: NovelDashboardProps) {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleting, setDeleting] = useState<NovelSummary | null>(null);

  // create form
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [targetWords, setTargetWords] = useState("100000");
  const [busy, setBusy] = useState(false);

  const submitCreate = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const parsedTarget = Number.parseInt(targetWords, 10);
    const ok = await onCreate({
      title: title.trim(),
      genre: genre.trim(),
      synopsis,
      targetWords: Number.isFinite(parsedTarget)
        ? Math.min(Math.max(parsedTarget, 1000), 5000000)
        : undefined,
    });
    setBusy(false);
    if (ok) {
      setCreateOpen(false);
      setTitle("");
      setGenre("");
      setSynopsis("");
      setTargetWords("100000");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold sm:text-3xl">
            Your novels
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {novels.length === 0
              ? "Every long novel starts with a single concept."
              : `${novels.length} project${novels.length === 1 ? "" : "s"} — pick up where you left off.`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="size-4" aria-hidden="true" />
            Import backup
          </Button>
          <Button variant="outline" onClick={() => setWizardOpen(true)}>
            <Sparkles className="size-4" aria-hidden="true" />
            New with AI team
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            New novel
          </Button>
        </div>
      </div>

      {loading ? (
        <ListSkeleton rows={3} />
      ) : novels.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed p-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-amber-100 text-primary">
            <BookOpen className="size-6" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold">
              Start your first novel
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Create a project, build the story bible, and draft chapters with
              the AI team — or import an existing backup.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New novel
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" aria-hidden="true" />
              Import backup
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {novels.map((novel) => {
            const pct = novel.targetWords
              ? Math.min(100, Math.round((novel.totalWords / novel.targetWords) * 100))
              : 0;
            return (
              <Card
                key={novel.id}
                className="group cursor-pointer transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md"
                onClick={() => onOpen(novel.id)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display text-lg font-bold leading-tight">
                      {novel.title}
                    </h3>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Delete ${novel.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleting(novel);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          setDeleting(novel);
                        }
                      }}
                      className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {novel.genre && (
                      <Badge variant="outline" className="text-caption">
                        {novel.genre}
                      </Badge>
                    )}
                    <Badge variant="outline" className={TEXT_CAPTION}>
                      {novel.status}
                    </Badge>
                  </div>
                  {novel.synopsis && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {novel.synopsis}
                    </p>
                  )}
                </CardHeader>
                <CardContent className="pb-3">
                  <div className={cn("flex items-center justify-between", TEXT_META)}>
                    <span>
                      {novel.chapterCount} chapter
                      {novel.chapterCount === 1 ? "" : "s"}
                    </span>
                    <span>{formatWordCount(novel.totalWords)} words</span>
                  </div>
                  <Progress value={pct} className="mt-2 h-1.5" aria-label={`${pct}% of target length`} />
                  <p className={cn("mt-1", TEXT_CAPTION)}>
                    {pct}% of {formatWordCount(novel.targetWords)}-word target
                  </p>
                </CardContent>
                <CardFooter className={TEXT_META}>
                  Updated{" "}
                  {new Date(novel.updatedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New novel</DialogTitle>
            <DialogDescription>
              A title is all you need to start — you can grow the story bible
              as you go.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="novel-title">Title</Label>
              <Input
                id="novel-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. The Convenience Store of Lifespans"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="novel-genre">Genre</Label>
                <Input
                  id="novel-genre"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="e.g. Urban Fantasy"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="novel-target">Target words</Label>
                <Input
                  id="novel-target"
                  type="number"
                  min={1000}
                  max={5000000}
                  value={targetWords}
                  onChange={(e) => setTargetWords(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="novel-synopsis">Synopsis</Label>
              <Textarea
                id="novel-synopsis"
                value={synopsis}
                onChange={(e) => setSynopsis(e.target.value)}
                rows={4}
                placeholder="One paragraph about what your story is about…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submitCreate} disabled={busy || !title.trim()}>
              {busy && <Spinner size="lg" />}
              Create novel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import dialog */}
      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onImported={(id) => {
            setImportOpen(false);
            onImported(id);
          }}
        />
      )}

      {/* AI team creation wizard */}
      <CreateWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onFinish={onCreate}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Delete this novel?"
        description={`“${deleting?.title ?? ""}” and all of its chapters, characters, worldbuilding and outline will be permanently deleted. Consider exporting a backup first.`}
        onConfirm={async () => {
          const target = deleting;
          setDeleting(null);
          if (target) {
            await onDelete(target.id);
            toast({ title: `“${target.title}” deleted` });
          }
        }}
      />
    </div>
  );
}
