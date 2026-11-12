"use client";

// ---------------------------------------------------------------------------
// Novara AI — Packs tab (Phase 8 草稿区 workspace).
//
// Chapter packs are scratch documents that feed drafting, one per kind per
// chapter (focus key `${kind}:${chapterIndex}`):
//   - 材料包 (material) — background evidence assembled before drafting.
//   - 定稿准备 (prep)   — atomic prep assembled before finalizing.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ClipboardCheck,
  Loader2,
  PackageOpen,
  Plus,
  Save,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  ChapterDTO,
  ChapterPackDTO,
  ChapterPackKind,
} from "@/lib/novara/types";
import { ConfirmDialog, PinButton } from "./ui-bits";

const PACK_KIND_META: Record<
  ChapterPackKind,
  { label: string; icon: LucideIcon; description: string; empty: string }
> = {
  material: {
    label: "Materials",
    icon: PackageOpen,
    description: "Background, evidence and timeline anchors assembled before drafting (Drafts/Materials)",
    empty: "No material packs yet — assemble background evidence before drafting.",
  },
  prep: {
    label: "Final prep",
    icon: ClipboardCheck,
    description: "Atomic prep before finalizing: review conclusions and repair notes (Drafts/Final prep)",
    empty: "No finalize-prep packs yet.",
  },
};

/** `第{chapterIndex}章 · {title}` — 未起草 when no chapter exists yet. */
function chapterLabel(chapterIndex: number, chapters: ChapterDTO[]): string {
  const title = chapters.find((c) => c.index === chapterIndex)?.title;
  return `Chapter ${chapterIndex} · ${title ?? "Not drafted"}`;
}

/** Resolves the focused pack from a `${kind}:${chapterIndex}` key. */
function packFromKey(
  key: string | null,
  packs: ChapterPackDTO[]
): ChapterPackDTO | null {
  if (!key) return null;
  const sep = key.indexOf(":");
  if (sep <= 0) return null;
  const kind = key.slice(0, sep);
  if (kind !== "material" && kind !== "prep") return null;
  const chapterIndex = Number(key.slice(sep + 1));
  if (!Number.isInteger(chapterIndex) || chapterIndex < 1) return null;
  return packs.find((p) => p.kind === kind && p.chapterIndex === chapterIndex) ?? null;
}

export function PacksPanel({
  packs,
  chapters,
  selectedPackKey,
  onSelectPack,
  onUpsertPack,
  onUpdatePack,
  onDeletePack,
}: {
  packs: ChapterPackDTO[];
  chapters: ChapterDTO[];
  selectedPackKey: string | null;
  onSelectPack: (key: string | null) => void;
  onUpsertPack: (kind: ChapterPackKind, chapterIndex: number) => Promise<boolean>;
  onUpdatePack: (id: string, patch: { title?: string; content?: string }) => Promise<boolean>;
  onDeletePack: (pack: ChapterPackDTO) => Promise<void>;
}) {
  const focusedPack = useMemo(
    () => packFromKey(selectedPackKey, packs),
    [selectedPackKey, packs]
  );

  if (focusedPack) {
    return (
      <PackDocument
        pack={focusedPack}
        chapters={chapters}
        onUpdate={onUpdatePack}
        onDelete={onDeletePack}
        onBack={() => onSelectPack(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PackSection
        kind="material"
        packs={packs}
        chapters={chapters}
        onSelectPack={onSelectPack}
        onUpsertPack={onUpsertPack}
      />
      <PackSection
        kind="prep"
        packs={packs}
        chapters={chapters}
        onSelectPack={onSelectPack}
        onUpsertPack={onUpsertPack}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Focused pack document
// ---------------------------------------------------------------------------

function PackDocument({
  pack,
  chapters,
  onUpdate,
  onDelete,
  onBack,
}: {
  pack: ChapterPackDTO;
  chapters: ChapterDTO[];
  onUpdate: (id: string, patch: { title?: string; content?: string }) => Promise<boolean>;
  onDelete: (pack: ChapterPackDTO) => Promise<void>;
  onBack: () => void;
}) {
  const meta = PACK_KIND_META[pack.kind];
  const [title, setTitle] = useState(pack.title);
  const [content, setContent] = useState(pack.content);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Resync local state when a different pack is opened (prop identity
  // change) — render-time sync, same pattern as CharacterDocument.
  const [syncedPack, setSyncedPack] = useState(pack);
  if (syncedPack !== pack) {
    setSyncedPack(pack);
    setTitle(pack.title);
    setContent(pack.content);
    setDirty(false);
  }

  const save = async () => {
    setSaving(true);
    const ok = await onUpdate(pack.id, {
      title: title.trim() || pack.title,
      content,
    });
    setSaving(false);
    if (ok) setDirty(false);
  };

  return (
    <div className="rounded-lg border bg-card">
      {/* Header — back + kind badge + chapter label */}
      <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2 shrink-0 self-start text-muted-foreground hover:text-foreground sm:self-auto"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          All packs
        </Button>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Badge variant="outline" className="shrink-0 text-[11px]">
            {meta.label}
          </Badge>
          <span className="shrink-0 rounded border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
            {chapterLabel(pack.chapterIndex, chapters)}
          </span>
          <PinButton
            novelId={pack.novelId}
            target={{
              type: "pack",
              id: pack.id,
              label: `${meta.label} · Chapter ${pack.chapterIndex} ${pack.title}`,
            }}
            className="ml-auto"
          />
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          Updated {new Date(pack.updatedAt).toLocaleDateString()}
        </span>
      </div>

      {/* Title + markdown body */}
      <div className="space-y-2 px-4 pt-3">
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
          placeholder={`${meta.label} title — Chapter ${pack.chapterIndex}`}
          aria-label="Pack title"
          className="font-medium"
        />
        <Textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          placeholder="Markdown — background evidence, timeline anchors, review conclusions…"
          aria-label="Pack content"
          className="nice-scroll min-h-[360px] resize-y rounded-none border-0 px-0 font-mono text-[13px] leading-6 shadow-none focus-visible:ring-0"
        />
      </div>

      {/* Footer — delete + save */}
      <div className="flex items-center justify-between gap-2 border-t p-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-1.5 text-muted-foreground hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
          aria-label="Delete pack"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete
        </Button>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-[11px] text-muted-foreground">Unsaved changes</span>
          )}
          <Button
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => void save()}
            disabled={saving || !dirty}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            Save
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete pack?"
        description={`“${title || meta.label}” (${chapterLabel(pack.chapterIndex, chapters)}) will be deleted. The chapter itself is not touched.`}
        onConfirm={async () => {
          setConfirmDelete(false);
          await onDelete(pack);
          onBack();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unfocused: one card per kind (list + create row)
// ---------------------------------------------------------------------------

function PackSection({
  kind,
  packs,
  chapters,
  onSelectPack,
  onUpsertPack,
}: {
  kind: ChapterPackKind;
  packs: ChapterPackDTO[];
  chapters: ChapterDTO[];
  onSelectPack: (key: string | null) => void;
  onUpsertPack: (kind: ChapterPackKind, chapterIndex: number) => Promise<boolean>;
}) {
  const meta = PACK_KIND_META[kind];
  const Icon = meta.icon;
  const [chapterInput, setChapterInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New packs default to the next chapter slot (chapters.length + 1).
  const defaultChapter = chapters.length + 1;
  const raw = chapterInput.trim();
  const chapter =
    raw === ""
      ? defaultChapter
      : Number.isInteger(Number(raw)) && Number(raw) >= 1
        ? Number(raw)
        : null;

  const mine = useMemo(
    () =>
      packs
        .filter((p) => p.kind === kind)
        .sort((a, b) => a.chapterIndex - b.chapterIndex),
    [packs, kind]
  );

  const create = async () => {
    if (chapter == null || creating) return;
    setCreating(true);
    setError(null);
    const ok = await onUpsertPack(kind, chapter);
    setCreating(false);
    if (ok) setChapterInput("");
    else setError("Could not create the pack — try again.");
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="font-display text-base">{meta.label}</CardTitle>
        </div>
        <CardDescription>{meta.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {mine.length > 0 ? (
          <ul
            className="nice-scroll max-h-64 overflow-y-auto pr-1"
            aria-label={meta.label}
          >
            {mine.map((p) => (
              <li key={p.id} className="border-b last:border-0">
                <button
                  type="button"
                  onClick={() => onSelectPack(`${p.kind}:${p.chapterIndex}`)}
                  aria-label={`Open ${PACK_KIND_META[p.kind].label} for Chapter ${p.chapterIndex}`}
                  className="flex min-h-[40px] w-full items-center gap-2 py-2 text-left transition-colors hover:bg-secondary/60"
                >
                  <span className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                    Chapter {p.chapterIndex}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {p.title || `Untitled ${meta.label}`}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            {meta.empty}
          </p>
        )}

        {/* Add row — chapterIndex defaults to chapters.length + 1 */}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Input
            type="number"
            min={1}
            step={1}
            value={chapterInput}
            onChange={(e) => setChapterInput(e.target.value)}
            placeholder={String(defaultChapter)}
            aria-label={`Chapter number for the new ${meta.label}`}
            className="h-10 w-24 shrink-0 text-sm"
          />
          <Button type="submit" className="h-10 gap-1.5" disabled={creating || chapter == null}>
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
            Create
          </Button>
          {chapter == null && (
            <p className="text-[11px] text-rose-600">
              Chapter must be a whole number ≥ 1.
            </p>
          )}
          {error && <p className="text-[11px] text-rose-600">{error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
