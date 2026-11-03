"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  Globe2,
  Loader2,
  PenLine,
  Pencil,
  Plus,
  ScrollText,
  Trash2,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  CharacterDTO,
  OutlineBeatDTO,
  WorldCategory,
  WorldEntryDTO,
} from "@/lib/novara/types";
import { MarkdownDocument } from "./markdown-document";
import { ConfirmDialog } from "./ui-bits";
import { cn } from "@/lib/utils";

/** Scrolls the focused card into view when opened from the asset tree. */
function useFocusScroll<T extends HTMLElement>(focusId: string | null) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!focusId || !ref.current) return;
    const el = ref.current.querySelector(`[data-asset-id="${focusId}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusId]);
  return ref;
}

const WORLD_CATEGORIES: { value: WorldCategory; label: string }[] = [
  { value: "location", label: "Location" },
  { value: "faction", label: "Faction" },
  { value: "item", label: "Item" },
  { value: "system", label: "System (magic/tech)" },
  { value: "culture", label: "Culture" },
  { value: "other", label: "Other" },
];

function categoryLabel(c: WorldCategory): string {
  return WORLD_CATEGORIES.find((x) => x.value === c)?.label ?? "Other";
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export function CharactersPanel({
  characters,
  focusCharacterId,
  onAdd,
  onUpdate,
  onDelete,
}: {
  characters: CharacterDTO[];
  /** Card highlighted + scrolled into view (opened from the asset tree). */
  focusCharacterId?: string | null;
  onAdd: (input: { name: string; role: string; description: string }) => Promise<boolean>;
  onUpdate: (id: string, patch: { name?: string; role?: string; description?: string }) => Promise<boolean>;
  onDelete: (c: CharacterDTO) => Promise<void>;
}) {
  const [editing, setEditing] = useState<CharacterDTO | "new" | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<CharacterDTO | null>(null);
  const focusRef = useFocusScroll<HTMLDivElement>(focusCharacterId ?? null);

  const openNew = () => {
    setName("");
    setRole("");
    setDescription("");
    setEditing("new");
  };
  const openEdit = (c: CharacterDTO) => {
    setName(c.name);
    setRole(c.role);
    setDescription(c.description);
    setEditing(c);
  };

  const submit = async () => {
    if (!name.trim() || !editing) return;
    setBusy(true);
    const ok =
      editing === "new"
        ? await onAdd({ name: name.trim(), role: role.trim(), description })
        : await onUpdate(editing.id, {
            name: name.trim(),
            role: role.trim(),
            description,
          });
    setBusy(false);
    if (ok) setEditing(null);
  };

  return (
    <PanelShell
      icon={<Users className="h-4 w-4" aria-hidden="true" />}
      title="Characters"
      count={characters.length}
      emptyText="No characters yet. Add your cast — motivations, flaws and arcs live here."
      onAdd={openNew}
      addLabel="Add character"
      list={
        <div ref={focusRef} className="grid gap-4 sm:grid-cols-2">
          {characters.map((c) => (
        <Card
          key={c.id}
          data-asset-id={c.id}
          className={cn(
            "scroll-mt-2 transition-shadow",
            c.id === focusCharacterId && "border-primary/50 ring-1 ring-primary/30"
          )}
        >
          <CardContent className="pt-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{c.name}</h3>
                {c.role && (
                  <Badge variant="outline" className="mt-1 text-[11px]">
                    {c.role}
                  </Badge>
                )}
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => openEdit(c)} aria-label={`Edit ${c.name}`}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleting(c)}
                  aria-label={`Delete ${c.name}`}
                  className="hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
            {c.description && (
              <MarkdownDocument
                content={c.description}
                className="mt-2 text-muted-foreground"
              />
            )}
          </CardContent>
        </Card>
          ))}
        </div>
      }
    >
      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing === "new" ? "Add character" : "Edit character"}
            </DialogTitle>
            <DialogDescription>
              Name, role in the story, and their arc or description.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="char-name">Name</Label>
              <Input id="char-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lin Xiao" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="char-role">Role</Label>
              <Input id="char-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Protagonist, mentor, rival…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="char-desc">Description</Label>
              <Textarea id="char-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Motivations, flaws, arc, relationships…" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={busy || !name.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {editing === "new" ? "Add" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Delete character?"
        description={`“${deleting?.name ?? ""}” will be removed from the story bible.`}
        onConfirm={async () => {
          if (deleting) await onDelete(deleting);
          setDeleting(null);
        }}
      />
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Character document window (single-asset view opened from the asset tree)
// ---------------------------------------------------------------------------

export function CharacterDocument({
  character,
  onUpdate,
  onDelete,
  onBack,
}: {
  character: CharacterDTO;
  onUpdate: (id: string, patch: { name?: string; role?: string; description?: string }) => Promise<boolean>;
  onDelete: (c: CharacterDTO) => Promise<void>;
  onBack: () => void;
}) {
  const [name, setName] = useState(character.name);
  const [role, setRole] = useState(character.role);
  const [description, setDescription] = useState(character.description);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<AssetDocView>(
    character.description.trim() ? "preview" : "write"
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Resync local state when a different character is opened (prop identity
  // change). Adjusting state during render is React's recommended alternative
  // to a resync effect — no cascading render is committed.
  const [syncedCharacter, setSyncedCharacter] = useState(character);
  if (syncedCharacter !== character) {
    setSyncedCharacter(character);
    setName(character.name);
    setRole(character.role);
    setDescription(character.description);
    setDirty(false);
    // Opening a file reads like opening a document — non-empty bodies land in
    // the rendered preview; empty ones go straight to writing.
    setView(character.description.trim() ? "preview" : "write");
  }

  const save = async () => {
    setSaving(true);
    const ok = await onUpdate(character.id, {
      name: name.trim() || character.name,
      role: role.trim(),
      description,
    });
    setSaving(false);
    if (ok) setDirty(false);
  };

  return (
    <div className="rounded-lg border bg-card">
      {/* Header — back + title inputs while writing, document title while reading */}
      <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2 shrink-0 self-start text-muted-foreground hover:text-foreground sm:self-auto"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          All characters
        </Button>
        {view === "write" ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
              className="min-w-0 flex-1 font-medium"
              aria-label="Character name"
            />
            <Input
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setDirty(true);
              }}
              placeholder="Role"
              className="min-w-0 sm:w-36"
              aria-label="Role"
            />
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h2 className="min-w-0 truncate font-display text-lg font-bold leading-tight">
              {name || character.name}
            </h2>
            {role.trim() && (
              <Badge variant="outline" className="shrink-0 text-[11px]">
                {role.trim()}
              </Badge>
            )}
          </div>
        )}
      </div>

      <DocToolbar
        view={view}
        onViewChange={setView}
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDelete={() => setConfirmDelete(true)}
        deleteAriaLabel="Delete character"
      />

      {/* Body — textarea while writing, document window while reading */}
      {view === "write" ? (
        <Textarea
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setDirty(true);
          }}
          placeholder="Motivations, flaws, arc, relationships…"
          className="nice-scroll min-h-[280px] resize-y rounded-none border-0 font-serif text-[15px] leading-7 shadow-none focus-visible:ring-0"
          aria-label="Description"
        />
      ) : (
        <div className="px-6 py-5" aria-label="Character document preview">
          {description.trim() ? (
            <MarkdownDocument content={description} className="mx-auto max-w-prose" />
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Nothing here yet — switch to Write.
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete character?"
        description={`“${character.name}” will be removed from the story bible.`}
        onConfirm={async () => {
          setConfirmDelete(false);
          await onDelete(character);
          onBack();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// World entries
// ---------------------------------------------------------------------------

export function WorldPanel({
  entries,
  focusWorldId,
  onAdd,
  onUpdate,
  onDelete,
}: {
  entries: WorldEntryDTO[];
  /** Card highlighted + scrolled into view (opened from the asset tree). */
  focusWorldId?: string | null;
  onAdd: (input: { title: string; category: WorldCategory; content: string }) => Promise<boolean>;
  onUpdate: (id: string, patch: { title?: string; category?: WorldCategory; content?: string }) => Promise<boolean>;
  onDelete: (w: WorldEntryDTO) => Promise<void>;
}) {
  const [editing, setEditing] = useState<WorldEntryDTO | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<WorldCategory>("other");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<WorldEntryDTO | null>(null);
  const focusRef = useFocusScroll<HTMLDivElement>(focusWorldId ?? null);

  const openNew = () => {
    setTitle("");
    setCategory("other");
    setContent("");
    setEditing("new");
  };
  const openEdit = (w: WorldEntryDTO) => {
    setTitle(w.title);
    setCategory(w.category);
    setContent(w.content);
    setEditing(w);
  };

  const submit = async () => {
    if (!title.trim() || !editing) return;
    setBusy(true);
    const ok =
      editing === "new"
        ? await onAdd({ title: title.trim(), category, content })
        : await onUpdate(editing.id, { title: title.trim(), category, content });
    setBusy(false);
    if (ok) setEditing(null);
  };

  return (
    <PanelShell
      icon={<Globe2 className="h-4 w-4" aria-hidden="true" />}
      title="Worldbuilding"
      count={entries.length}
      emptyText="No world entries yet. Places, factions, systems and lore belong here."
      onAdd={openNew}
      addLabel="Add entry"
      list={
        <div ref={focusRef} className="grid gap-4 sm:grid-cols-2">
          {entries.map((w) => (
        <Card
          key={w.id}
          data-asset-id={w.id}
          className={cn(
            "scroll-mt-2 transition-shadow",
            w.id === focusWorldId && "border-primary/50 ring-1 ring-primary/30"
          )}
        >
          <CardContent className="pt-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{w.title}</h3>
                <Badge variant="outline" className="mt-1 text-[11px]">
                  {categoryLabel(w.category)}
                </Badge>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => openEdit(w)} aria-label={`Edit ${w.title}`}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleting(w)}
                  aria-label={`Delete ${w.title}`}
                  className="hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
            {w.content && (
              <MarkdownDocument
                content={w.content}
                className="mt-2 text-muted-foreground"
              />
            )}
          </CardContent>
        </Card>
          ))}
        </div>
      }
    >
      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing === "new" ? "Add world entry" : "Edit world entry"}
            </DialogTitle>
            <DialogDescription>
              One fact per entry — the bible is easier to keep consistent that way.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="world-title">Title</Label>
              <Input id="world-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Ashen Sea" />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as WorldCategory)}>
                <SelectTrigger aria-label="Category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORLD_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="world-content">Content</Label>
              <Textarea id="world-content" value={content} onChange={(e) => setContent(e.target.value)} rows={4} placeholder="Rules, geography, history, dangers…" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={busy || !title.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {editing === "new" ? "Add" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Delete world entry?"
        description={`“${deleting?.title ?? ""}” will be removed from the world bible.`}
        onConfirm={async () => {
          if (deleting) await onDelete(deleting);
          setDeleting(null);
        }}
      />
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// World entry document window (single-asset view opened from the asset tree)
// ---------------------------------------------------------------------------

export function WorldDocument({
  entry,
  onUpdate,
  onDelete,
  onBack,
}: {
  entry: WorldEntryDTO;
  onUpdate: (id: string, patch: { title?: string; category?: WorldCategory; content?: string }) => Promise<boolean>;
  onDelete: (w: WorldEntryDTO) => Promise<void>;
  onBack: () => void;
}) {
  const [title, setTitle] = useState(entry.title);
  const [category, setCategory] = useState<WorldCategory>(entry.category);
  const [content, setContent] = useState(entry.content);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<AssetDocView>(
    entry.content.trim() ? "preview" : "write"
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Resync local state when a different world entry is opened (see
  // CharacterDocument for why this is a render-time adjustment).
  const [syncedEntry, setSyncedEntry] = useState(entry);
  if (syncedEntry !== entry) {
    setSyncedEntry(entry);
    setTitle(entry.title);
    setCategory(entry.category);
    setContent(entry.content);
    setDirty(false);
    setView(entry.content.trim() ? "preview" : "write");
  }

  const save = async () => {
    setSaving(true);
    const ok = await onUpdate(entry.id, {
      title: title.trim() || entry.title,
      category,
      content,
    });
    setSaving(false);
    if (ok) setDirty(false);
  };

  return (
    <div className="rounded-lg border bg-card">
      {/* Header — back + title inputs while writing, document title while reading */}
      <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2 shrink-0 self-start text-muted-foreground hover:text-foreground sm:self-auto"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          All entries
        </Button>
        {view === "write" ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
              className="min-w-0 flex-1 font-medium"
              aria-label="Entry title"
            />
            <Select
              value={category}
              onValueChange={(v) => {
                setCategory(v as WorldCategory);
                setDirty(true);
              }}
            >
              <SelectTrigger className="w-full sm:w-44" aria-label="Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORLD_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h2 className="min-w-0 truncate font-display text-lg font-bold leading-tight">
              {title || entry.title}
            </h2>
            <Badge variant="outline" className="shrink-0 text-[11px]">
              {categoryLabel(category)}
            </Badge>
          </div>
        )}
      </div>

      <DocToolbar
        view={view}
        onViewChange={setView}
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDelete={() => setConfirmDelete(true)}
        deleteAriaLabel="Delete world entry"
      />

      {/* Body — textarea while writing, document window while reading */}
      {view === "write" ? (
        <Textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          placeholder="Rules, geography, history, dangers…"
          className="nice-scroll min-h-[280px] resize-y rounded-none border-0 font-serif text-[15px] leading-7 shadow-none focus-visible:ring-0"
          aria-label="Content"
        />
      ) : (
        <div className="px-6 py-5" aria-label="World entry document preview">
          {content.trim() ? (
            <MarkdownDocument content={content} className="mx-auto max-w-prose" />
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Nothing here yet — switch to Write.
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete world entry?"
        description={`“${entry.title}” will be removed from the world bible.`}
        onConfirm={async () => {
          setConfirmDelete(false);
          await onDelete(entry);
          onBack();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outline beats
// ---------------------------------------------------------------------------

export function OutlinePanel({
  beats,
  focusBeatId,
  onAdd,
  onUpdate,
  onDelete,
}: {
  beats: OutlineBeatDTO[];
  /** Beat highlighted + scrolled into view (opened from the asset tree). */
  focusBeatId?: string | null;
  onAdd: (input: { title: string; summary: string }) => Promise<boolean>;
  onUpdate: (id: string, patch: { title?: string; summary?: string }) => Promise<boolean>;
  onDelete: (b: OutlineBeatDTO) => Promise<void>;
}) {
  const [editing, setEditing] = useState<OutlineBeatDTO | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<OutlineBeatDTO | null>(null);
  const focusRef = useFocusScroll<HTMLOListElement>(focusBeatId ?? null);

  const openNew = () => {
    setTitle("");
    setSummary("");
    setEditing("new");
  };
  const openEdit = (b: OutlineBeatDTO) => {
    setTitle(b.title);
    setSummary(b.summary);
    setEditing(b);
  };

  const submit = async () => {
    if (!title.trim() || !editing) return;
    setBusy(true);
    const ok =
      editing === "new"
        ? await onAdd({ title: title.trim(), summary })
        : await onUpdate(editing.id, { title: title.trim(), summary });
    setBusy(false);
    if (ok) setEditing(null);
  };

  return (
    <PanelShell
      icon={<ScrollText className="h-4 w-4" aria-hidden="true" />}
      title="Outline"
      count={beats.length}
      emptyText="No outline yet. Sketch the story arc beat by beat — the AI drafts follow this."
      onAdd={openNew}
      addLabel="Add beat"
      list={
        <ol ref={focusRef} className="space-y-2">
          {beats.map((b, i) => (
            <li
              key={b.id}
              data-asset-id={b.id}
              className={cn(
                "group flex scroll-mt-2 items-start gap-3 rounded-lg border bg-card p-4 transition-shadow",
                b.id === focusBeatId && "border-primary/50 ring-1 ring-primary/30"
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 font-display text-xs font-bold text-primary">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium">{b.title}</h3>
                {b.summary && (
                  <MarkdownDocument
                    content={b.summary}
                    className="mt-1 text-muted-foreground"
                  />
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon" onClick={() => openEdit(b)} aria-label={`Edit beat ${i + 1}`}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleting(b)}
                  aria-label={`Delete beat ${i + 1}`}
                  className="hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      }
    >
      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing === "new" ? "Add outline beat" : "Edit outline beat"}
            </DialogTitle>
            <DialogDescription>
              A story-level beat: what happens, and why it matters.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="beat-title">Title</Label>
              <Input id="beat-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The market fire" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="beat-summary">Summary</Label>
              <Textarea id="beat-summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} placeholder="What happens in this beat…" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={busy || !title.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {editing === "new" ? "Add" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Delete outline beat?"
        description={`“${deleting?.title ?? ""}” will be removed from the outline. Later beats keep their order.`}
        onConfirm={async () => {
          if (deleting) await onDelete(deleting);
          setDeleting(null);
        }}
      />
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Outline beat document window (single-asset view opened from the asset tree)
// ---------------------------------------------------------------------------

export function BeatDocument({
  beat,
  onUpdate,
  onDelete,
  onBack,
}: {
  beat: OutlineBeatDTO;
  onUpdate: (id: string, patch: { title?: string; summary?: string }) => Promise<boolean>;
  onDelete: (b: OutlineBeatDTO) => Promise<void>;
  onBack: () => void;
}) {
  const [title, setTitle] = useState(beat.title);
  const [summary, setSummary] = useState(beat.summary);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<AssetDocView>(
    beat.summary.trim() ? "preview" : "write"
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Resync local state when a different beat is opened (see
  // CharacterDocument for why this is a render-time adjustment).
  const [syncedBeat, setSyncedBeat] = useState(beat);
  if (syncedBeat !== beat) {
    setSyncedBeat(beat);
    setTitle(beat.title);
    setSummary(beat.summary);
    setDirty(false);
    setView(beat.summary.trim() ? "preview" : "write");
  }

  const save = async () => {
    setSaving(true);
    const ok = await onUpdate(beat.id, {
      title: title.trim() || beat.title,
      summary,
    });
    setSaving(false);
    if (ok) setDirty(false);
  };

  return (
    <div className="rounded-lg border bg-card">
      {/* Header — back + title inputs while writing, document title while reading */}
      <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2 shrink-0 self-start text-muted-foreground hover:text-foreground sm:self-auto"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          All beats
        </Button>
        {view === "write" ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
              className="min-w-0 flex-1 font-medium"
              aria-label="Beat title"
            />
            <span className="shrink-0 rounded border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
              Beat {beat.index}
            </span>
          </div>
        ) : (
          <h2 className="min-w-0 flex-1 truncate font-display text-lg font-bold leading-tight">
            {title || beat.title}
          </h2>
        )}
      </div>

      <DocToolbar
        view={view}
        onViewChange={setView}
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDelete={() => setConfirmDelete(true)}
        deleteAriaLabel="Delete outline beat"
      />

      {/* Body — textarea while writing, document window while reading */}
      {view === "write" ? (
        <Textarea
          value={summary}
          onChange={(e) => {
            setSummary(e.target.value);
            setDirty(true);
          }}
          placeholder="What happens in this beat…"
          className="nice-scroll min-h-[280px] resize-y rounded-none border-0 font-serif text-[15px] leading-7 shadow-none focus-visible:ring-0"
          aria-label="Summary"
        />
      ) : (
        <div className="px-6 py-5" aria-label="Outline beat document preview">
          {summary.trim() ? (
            <>
              <span className="mb-3 inline-block rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                Beat {beat.index}
              </span>
              <MarkdownDocument content={summary} className="mx-auto max-w-prose" />
            </>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Nothing here yet — switch to Write.
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete outline beat?"
        description={`“${beat.title}” will be removed from the outline. Later beats keep their order.`}
        onConfirm={async () => {
          setConfirmDelete(false);
          await onDelete(beat);
          onBack();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared panel shell
// ---------------------------------------------------------------------------

function PanelShell({
  icon,
  title,
  count,
  emptyText,
  onAdd,
  addLabel,
  list,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  emptyText: string;
  onAdd: () => void;
  addLabel: string;
  list: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold">
          <span className="text-primary">{icon}</span>
          {title}
          <span className="text-sm font-normal text-muted-foreground">
            ({count})
          </span>
        </h3>
        <Button size="sm" onClick={onAdd}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {addLabel}
        </Button>
      </div>
      {count === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        list
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared document-window chrome (single-asset views, chapter-editor parity)
// ---------------------------------------------------------------------------

/** Editor surface: raw editing vs rendered document window. */
type AssetDocView = "write" | "preview";

function DocViewToggle({
  view,
  onChange,
}: {
  view: AssetDocView;
  onChange: (v: AssetDocView) => void;
}) {
  return (
    <span
      className="flex overflow-hidden rounded-md border bg-background"
      role="group"
      aria-label="Editor view"
    >
      <button
        type="button"
        onClick={() => onChange("write")}
        aria-pressed={view === "write"}
        className={cn(
          "flex items-center gap-1 px-2.5 py-1 transition-colors",
          view === "write"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
        Write
      </button>
      <button
        type="button"
        onClick={() => onChange("preview")}
        aria-pressed={view === "preview"}
        className={cn(
          "flex items-center gap-1 px-2.5 py-1 transition-colors",
          view === "preview"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
        Preview
      </button>
    </span>
  );
}

function DocToolbar({
  view,
  onViewChange,
  dirty,
  saving,
  onSave,
  onDelete,
  deleteAriaLabel,
}: {
  view: AssetDocView;
  onViewChange: (v: AssetDocView) => void;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDelete: () => void;
  deleteAriaLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
      <DocViewToggle view={view} onChange={onViewChange} />
      {dirty && (
        <span className="flex items-center gap-1 text-amber-700">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
          Unsaved changes
        </span>
      )}
      <span className="ml-auto flex items-center gap-1">
        <Button size="sm" onClick={onSave} disabled={saving || !dirty}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDelete}
          aria-label={deleteAriaLabel}
          className="hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </span>
    </div>
  );
}
