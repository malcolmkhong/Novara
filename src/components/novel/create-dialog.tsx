"use client";

import * as React from "react";
import { BookPlus, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { postJSON } from "./api";
import { NOVEL_GENRES } from "@/lib/novel/types";

const CHAPTER_OPTIONS = [12, 24, 36, 48, 96] as const;
const VOLUME_OPTIONS = [2, 3, 4, 5, 6] as const;

/** Rotating stage hints shown while AI designs the book skeleton. */
const STAGE_HINTS = [
  "Distilling the story core (logline & central conflict)…",
  "Designing the world, power system & golden finger…",
  "Casting characters and their mirror-image villain…",
  "Partitioning the master outline into volumes…",
] as const;

interface CreateDialogProps {
  onCreated: (id: string) => void;
}

export function CreateDialog({ onCreated }: CreateDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [genre, setGenre] = React.useState<string>("玄幻");
  const [idea, setIdea] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [platform, setPlatform] = React.useState("");
  const [targetChapters, setTargetChapters] = React.useState<number>(24);
  const [volumeCount, setVolumeCount] = React.useState<number>(3);
  const [submitting, setSubmitting] = React.useState(false);
  const [stage, setStage] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!submitting) return;
    const timer = setInterval(() => {
      setStage((s) => Math.min(s + 1, STAGE_HINTS.length - 1));
    }, 7000);
    return () => clearInterval(timer);
  }, [submitting]);

  const reset = () => {
    setIdea("");
    setTitle("");
    setPlatform("");
    setGenre("玄幻");
    setTargetChapters(24);
    setVolumeCount(3);
    setStage(0);
    setError(null);
  };

  const submit = async () => {
    if (idea.trim().length < 5) {
      setError("Describe your idea in at least 5 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setStage(0);
    try {
      const result = await postJSON<{ id: string }>("/api/novel", {
        genre,
        idea: idea.trim(),
        title: title.trim() || undefined,
        platform: platform.trim() || undefined,
        targetChapters,
        volumeCount,
      });
      reset();
      setOpen(false);
      onCreated(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the novel.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-2">
          <BookPlus aria-hidden="true" />
          New Novel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-amber-500" aria-hidden="true" />
            Start a new novel
          </DialogTitle>
          <DialogDescription>
            AI designs the story bible (world, power system, golden finger,
            cast) and partitions the master outline into volumes — the
            webnovel-writer init step.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="novel-genre">Genre</Label>
              <Select value={genre} onValueChange={setGenre}>
                <SelectTrigger id="novel-genre" aria-label="Genre">
                  <SelectValue placeholder="Pick a genre" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {NOVEL_GENRES.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="novel-title">Title (optional)</Label>
              <Input
                id="novel-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Leave empty and AI names it"
                maxLength={60}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="novel-idea">Story idea / inspiration *</Label>
            <Textarea
              id="novel-idea"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="e.g. 便利店夜班店员发现每件商品都能兑换寿命，而他自己的寿命只剩 30 天——直到有人开始用伪币结算。"
              rows={4}
              maxLength={2000}
            />
            <p className="text-xs text-muted-foreground">
              {idea.length}/2000 · Chinese or English, the pipeline writes in
              Chinese webnovel style
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="novel-chapters">Chapters</Label>
              <Select
                value={String(targetChapters)}
                onValueChange={(v) => setTargetChapters(Number(v))}
              >
                <SelectTrigger id="novel-chapters" aria-label="Target chapters">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHAPTER_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} chapters
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="novel-volumes">Volumes</Label>
              <Select
                value={String(volumeCount)}
                onValueChange={(v) => setVolumeCount(Number(v))}
              >
                <SelectTrigger id="novel-volumes" aria-label="Volume count">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOLUME_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} volumes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="novel-platform">Platform</Label>
              <Input
                id="novel-platform"
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                placeholder="起点 / 番茄 …"
                maxLength={80}
              />
            </div>
          </div>

          {submitting && (
            <div
              className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
              <span>{STAGE_HINTS[stage]}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                up to a minute
              </span>
            </div>
          )}

          {error && (
            <p className="text-sm font-medium text-red-600" role="alert">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting} className="gap-2">
            {submitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles aria-hidden="true" />
            )}
            {submitting ? "Designing…" : "Generate with AI"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
