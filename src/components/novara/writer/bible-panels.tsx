"use client";

import { useState } from "react";
import { Loader2, Pencil, Plus, ScrollText, Trash2, Users, Globe2 } from "lucide-react";
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
import { ConfirmDialog } from "./ui-bits";

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
  onAdd,
  onUpdate,
  onDelete,
}: {
  characters: CharacterDTO[];
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
        <div className="grid gap-4 sm:grid-cols-2">
          {characters.map((c) => (
        <Card key={c.id}>
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
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {c.description}
              </p>
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
// World entries
// ---------------------------------------------------------------------------

export function WorldPanel({
  entries,
  onAdd,
  onUpdate,
  onDelete,
}: {
  entries: WorldEntryDTO[];
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
        <div className="grid gap-4 sm:grid-cols-2">
          {entries.map((w) => (
        <Card key={w.id}>
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
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {w.content}
              </p>
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
// Outline beats
// ---------------------------------------------------------------------------

export function OutlinePanel({
  beats,
  onAdd,
  onUpdate,
  onDelete,
}: {
  beats: OutlineBeatDTO[];
  onAdd: (input: { title: string; summary: string }) => Promise<boolean>;
  onUpdate: (id: string, patch: { title?: string; summary?: string }) => Promise<boolean>;
  onDelete: (b: OutlineBeatDTO) => Promise<void>;
}) {
  const [editing, setEditing] = useState<OutlineBeatDTO | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<OutlineBeatDTO | null>(null);

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
        <ol className="space-y-2">
          {beats.map((b, i) => (
            <li
              key={b.id}
              className="group flex items-start gap-3 rounded-lg border bg-card p-4"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 font-display text-xs font-bold text-primary">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium">{b.title}</h3>
                {b.summary && (
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {b.summary}
                  </p>
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
