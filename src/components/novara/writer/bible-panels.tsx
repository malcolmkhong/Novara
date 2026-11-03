"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronLeft,
  FolderOpen,
  Globe2,
  Loader2,
  Lock,
  LockOpen,
  PenLine,
  Pencil,
  Plus,
  ScrollText,
  Trash2,
  Users,
  X,
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
import { useToast } from "@/hooks/use-toast";
import {
  addVolume,
  addWorldGroup,
  deleteCharacter,
  deleteOutlineBeat,
  deleteVolume,
  deleteWorldEntry,
  deleteWorldGroup,
  updateCharacter,
  updateOutlineBeat,
  updateVolume,
  updateWorldEntry,
  updateWorldGroup,
} from "@/lib/novara/api";
import type {
  CharacterDTO,
  OutlineBeatDTO,
  VolumeDTO,
  WorldCategory,
  WorldEntryDTO,
  WorldGroupDTO,
} from "@/lib/novara/types";
import { MarkdownDocument } from "./markdown-document";
import { ConfirmDialog } from "./ui-bits";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Canon lock (定稿锁, Phase 9) — shared controls.
//
// A `final` asset is Immutable Canon: the server refuses edits/deletes with
// 409 unless the request carries `reopen: true`. Reopen archives the final
// state into AssetVersion then downgrades back to draft. The UI therefore
// renders locked documents read-only and routes every transition through a
// confirmation.
// ---------------------------------------------------------------------------

const REOPEN_ARCHIVE_NOTE =
  "原版将自动存档到版本史，然后降回草稿，可再次编辑。";

/** Amber “已定稿” badge shown beside document titles while canon-locked. */
export function CanonFinalBadge() {
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-amber-300 bg-amber-50 text-[11px] text-amber-700"
    >
      已定稿
    </Badge>
  );
}

/**
 * Canon lock toggle for one asset. Unlocked assets get a 定稿 action (confirm
 * once → caller persists `{ status: "final" }` / `{ lock: "final" }`); locked
 * assets get a 解除定稿 action whose confirm carries the archive explanation.
 */
export function CanonLockButton({
  locked,
  busy = false,
  onFinalize,
  onReopen,
}: {
  locked: boolean;
  busy?: boolean;
  onFinalize: () => void;
  onReopen: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (locked) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setConfirming(true)}
          className="h-8 gap-1.5 border-amber-300 bg-amber-50 px-2 text-xs text-amber-700 hover:bg-amber-100 hover:text-amber-800"
          aria-label="解除定稿"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <LockOpen className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          解除定稿
        </Button>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="解除定稿？"
          description={REOPEN_ARCHIVE_NOTE}
          confirmLabel="解除定稿"
          busy={busy}
          onConfirm={() => {
            setConfirming(false);
            onReopen();
          }}
        />
      </>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => setConfirming(true)}
        className="h-8 gap-1.5 border-emerald-300 bg-emerald-50 px-2 text-xs text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
        aria-label="定稿"
      >
        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
        定稿
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="定稿？"
        description={
          "定稿后成为 Immutable Canon：编辑或删除将被拒绝，如需修改须先解除定稿。"
        }
        confirmLabel="定稿"
        busy={busy}
        onConfirm={() => {
          setConfirming(false);
          onFinalize();
        }}
      />
    </>
  );
}

/** Shared failure toast for canon/group mutations in the bible panels. */
function useCanonAction() {
  const { toast } = useToast();
  return (e: unknown) =>
    toast({
      title: "操作失败",
      description: e instanceof Error ? e.message : "未知错误",
      variant: "destructive",
    });
}

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

/** Tiny amber lock glyph for list rows/cards whose asset is final. */
function CanonLockGlyph() {
  return (
    <span
      className="inline-flex shrink-0 items-center text-amber-600"
      title="已定稿（Immutable Canon）"
      aria-label="已定稿"
    >
      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export function CharactersPanel({
  characters,
  novelId,
  focusCharacterId,
  onRefresh,
  onAdd,
  onUpdate,
  onDelete,
}: {
  characters: CharacterDTO[];
  /** Novel id — needed to delete canon-locked characters with reopen. */
  novelId: string;
  /** Card highlighted + scrolled into view (opened from the asset tree). */
  focusCharacterId?: string | null;
  /** Parent refetch, called after a panel-driven canon-locked delete. */
  onRefresh: () => Promise<void>;
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
  const onCanonActionError = useCanonAction();

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
                <h3 className="flex items-center gap-1.5 font-semibold">
                  <span className="min-w-0 truncate">{c.name}</span>
                  {c.status === "final" && <CanonLockGlyph />}
                </h3>
                {c.role && (
                  <Badge variant="outline" className="mt-1 text-[11px]">
                    {c.role}
                  </Badge>
                )}
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openEdit(c)}
                  disabled={c.status === "final"}
                  title={c.status === "final" ? "已定稿 — 解除定稿后可编辑" : undefined}
                  aria-label={`Edit ${c.name}`}
                >
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
        description={
          deleting?.status === "final"
            ? `“${deleting?.name ?? ""}” 已定稿：删除前原版将自动存档到版本史。`
            : `“${deleting?.name ?? ""}” will be removed from the story bible.`
        }
        onConfirm={async () => {
          if (!deleting) return;
          const target = deleting;
          if (target.status === "final") {
            // Immutable Canon: the server only allows the delete with reopen.
            try {
              await deleteCharacter(target.id, true);
              await onRefresh();
            } catch (e) {
              onCanonActionError(e);
            }
          } else {
            await onDelete(target);
          }
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
  novelId,
  onRefresh,
  onUpdate,
  onDelete,
  onBack,
}: {
  character: CharacterDTO;
  /** Novel id — required by the canon lock API calls. */
  novelId: string;
  /** Parent refetch, called after a canon finalize/reopen. */
  onRefresh: () => Promise<void>;
  onUpdate: (id: string, patch: { name?: string; role?: string; aliases?: string; description?: string }) => Promise<boolean>;
  onDelete: (c: CharacterDTO) => Promise<void>;
  onBack: () => void;
}) {
  const locked = character.status === "final";
  const [name, setName] = useState(character.name);
  const [role, setRole] = useState(character.role);
  const [aliases, setAliases] = useState(character.aliases);
  const [description, setDescription] = useState(character.description);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [view, setView] = useState<AssetDocView>(
    character.description.trim() ? "preview" : "write"
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const onCanonActionError = useCanonAction();

  // Resync local state when a different character is opened (prop identity
  // change). Adjusting state during render is React's recommended alternative
  // to a resync effect — no cascading render is committed.
  const [syncedCharacter, setSyncedCharacter] = useState(character);
  if (syncedCharacter !== character) {
    setSyncedCharacter(character);
    setName(character.name);
    setRole(character.role);
    setAliases(character.aliases);
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
      aliases,
      description,
    });
    setSaving(false);
    if (ok) setDirty(false);
  };

  /** 定稿 → Immutable Canon；解除定稿 → archive then downgrade to draft. */
  const setCanon = async (final: boolean) => {
    setLockBusy(true);
    try {
      await updateCharacter(character.id, final ? { status: "final" } : { reopen: true });
      await onRefresh();
    } catch (e) {
      onCanonActionError(e);
    } finally {
      setLockBusy(false);
    }
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
              readOnly={locked}
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
              readOnly={locked}
            />
            <Input
              value={aliases}
              onChange={(e) => {
                setAliases(e.target.value);
                setDirty(true);
              }}
              placeholder="Alternate names, comma-separated"
              className="min-w-0 sm:w-44"
              aria-label="Aliases"
              readOnly={locked}
            />
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="min-w-0 truncate font-display text-lg font-bold leading-tight">
                {name || character.name}
              </h2>
              {role.trim() && (
                <Badge variant="outline" className="shrink-0 text-[11px]">
                  {role.trim()}
                </Badge>
              )}
            </div>
            {aliases.trim() && (
              <p className="truncate text-xs text-muted-foreground">aka: {aliases}</p>
            )}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          {locked && <CanonFinalBadge />}
          <CanonLockButton
            locked={locked}
            busy={lockBusy}
            onFinalize={() => void setCanon(true)}
            onReopen={() => void setCanon(false)}
          />
        </div>
      </div>

      <DocToolbar
        view={view}
        onViewChange={setView}
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDelete={() => setConfirmDelete(true)}
        deleteAriaLabel="Delete character"
        locked={locked}
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
          readOnly={locked}
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
  groups,
  novelId,
  focusWorldId,
  onRefresh,
  onAdd,
  onUpdate,
  onDelete,
}: {
  entries: WorldEntryDTO[];
  /** 世界书 second-level groups (Phase 9) — chips filter the entry grid. */
  groups: WorldGroupDTO[];
  /** Novel id — group create + canon-locked entry deletes ride on it. */
  novelId: string;
  /** Card highlighted + scrolled into view (opened from the asset tree). */
  focusWorldId?: string | null;
  /** Parent refetch, called after group/canon mutations. */
  onRefresh: () => Promise<void>;
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
  const onCanonActionError = useCanonAction();

  // --- 世界书 group management state (Phase 9) ---
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<WorldGroupDTO | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of entries) {
      if (w.groupId) counts.set(w.groupId, (counts.get(w.groupId) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  const visibleEntries = useMemo(
    () =>
      groupFilter === "all"
        ? entries
        : entries.filter((w) => w.groupId === groupFilter),
    [entries, groupFilter]
  );

  const createGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    setGroupBusy(true);
    try {
      await addWorldGroup(novelId, name);
      setNewGroupName("");
      setCreatingGroup(false);
      await onRefresh();
    } catch (e) {
      onCanonActionError(e);
    } finally {
      setGroupBusy(false);
    }
  };

  const renameGroup = async (g: WorldGroupDTO) => {
    const name = renameValue.trim();
    if (!name || name === g.name) {
      setRenamingGroupId(null);
      return;
    }
    setGroupBusy(true);
    try {
      await updateWorldGroup(g.id, { name });
      setRenamingGroupId(null);
      await onRefresh();
    } catch (e) {
      onCanonActionError(e);
    } finally {
      setGroupBusy(false);
    }
  };

  const removeGroup = async (g: WorldGroupDTO) => {
    setGroupBusy(true);
    try {
      await deleteWorldGroup(g.id);
      setDeletingGroup(null);
      if (groupFilter === g.id) setGroupFilter("all");
      await onRefresh();
    } catch (e) {
      onCanonActionError(e);
    } finally {
      setGroupBusy(false);
    }
  };

  const openNew = () => {
    setTitle("");
    setCategory("other");
    setContent("");
    setGroupId(null);
    setEditing("new");
  };
  const openEdit = (w: WorldEntryDTO) => {
    setTitle(w.title);
    setCategory(w.category);
    setContent(w.content);
    setGroupId(w.groupId);
    setEditing(w);
  };

  const submit = async () => {
    if (!title.trim() || !editing) return;
    setBusy(true);
    const ok =
      editing === "new"
        ? await onAdd({ title: title.trim(), category, content })
        : await onUpdate(editing.id, { title: title.trim(), category, content });
    // Persist the 分组 assignment straight through the world-entry API
    // (the generic onUpdate handler only covers title/category/content).
    if (ok && editing !== "new" && groupId !== editing.groupId) {
      try {
        await updateWorldEntry(editing.id, { groupId });
        await onRefresh();
      } catch (e) {
        onCanonActionError(e);
      }
    }
    setBusy(false);
    if (ok) setEditing(null);
  };

  // --- 世界书 second-level group toolbar (Phase 9) ---
  const groupToolbar = (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
          分组
        </span>
        {!creatingGroup && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => {
              setNewGroupName("");
              setCreatingGroup(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            新建分组
          </Button>
        )}
      </div>
      {creatingGroup && (
        <div className="flex items-center gap-1.5">
          <Input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createGroup();
              if (e.key === "Escape") setCreatingGroup(false);
            }}
            placeholder="分组名称…"
            aria-label="新分组名称"
            autoFocus
            className="h-8 max-w-xs text-sm"
          />
          <Button
            size="sm"
            className="h-8 px-3 text-xs"
            onClick={() => void createGroup()}
            disabled={groupBusy || !newGroupName.trim()}
          >
            {groupBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            创建
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => setCreatingGroup(false)}
          >
            取消
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <GroupChip
          label="全部"
          count={entries.length}
          active={groupFilter === "all"}
          onSelect={() => setGroupFilter("all")}
        />
        {groups.map((g) =>
          renamingGroupId === g.id ? (
            <span
              key={g.id}
              className="flex items-center gap-0.5 rounded-full border bg-background px-2 py-0.5"
            >
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void renameGroup(g);
                  if (e.key === "Escape") setRenamingGroupId(null);
                }}
                aria-label="分组名称"
                autoFocus
                className="h-6 w-32 border-0 px-1 text-xs shadow-none focus-visible:ring-0"
              />
              <button
                type="button"
                onClick={() => void renameGroup(g)}
                aria-label="保存分组名称"
                className="rounded p-0.5 text-emerald-600 hover:text-emerald-700"
              >
                <Check className="h-3 w-3" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setRenamingGroupId(null)}
                aria-label="取消重命名"
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ) : (
            <span
              key={g.id}
              className={cn(
                "flex items-center gap-0.5 rounded-full border px-1 py-0.5 transition-colors",
                groupFilter === g.id
                  ? "border-primary/40 bg-primary/10"
                  : "border-border bg-background"
              )}
            >
              <GroupChip
                label={g.name}
                count={groupCounts.get(g.id) ?? 0}
                active={groupFilter === g.id}
                onSelect={() => setGroupFilter(g.id)}
              />
              <button
                type="button"
                onClick={() => {
                  setRenameValue(g.name);
                  setRenamingGroupId(g.id);
                }}
                aria-label={`重命名分组 ${g.name}`}
                title="重命名"
                className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-foreground"
              >
                <Pencil className="h-3 w-3" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setDeletingGroup(g)}
                aria-label={`删除分组 ${g.name}`}
                title="删除分组"
                className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          )
        )}
        {groups.length === 0 && !creatingGroup && (
          <span className="text-xs text-muted-foreground">
            暂无分组 — 用「新建分组」为世界书条目建立二级目录。
          </span>
        )}
      </div>
    </div>
  );

  return (
    <PanelShell
      icon={<Globe2 className="h-4 w-4" aria-hidden="true" />}
      title="Worldbuilding"
      count={entries.length}
      emptyText="No world entries yet. Places, factions, systems and lore belong here."
      onAdd={openNew}
      addLabel="Add entry"
      toolbar={groupToolbar}
      list={
        <div ref={focusRef}>
          {visibleEntries.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {visibleEntries.map((w) => (
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
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-1.5 font-semibold">
                      <span className="min-w-0 truncate">{w.title}</span>
                      {w.status === "final" && <CanonLockGlyph />}
                    </h3>
                    <Badge variant="outline" className="mt-1 text-[11px]">
                      {categoryLabel(w.category)}
                    </Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(w)}
                      disabled={w.status === "final"}
                      title={w.status === "final" ? "已定稿 — 解除定稿后可编辑" : undefined}
                      aria-label={`Edit ${w.title}`}
                    >
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
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              该分组暂无条目。
            </p>
          )}
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
            {editing !== "new" && (
              <div className="space-y-1.5">
                <Label>分组</Label>
                <Select
                  value={groupId ?? "ungrouped"}
                  onValueChange={(v) => setGroupId(v === "ungrouped" ? null : v)}
                >
                  <SelectTrigger aria-label="分组">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ungrouped">未分组</SelectItem>
                    {groups.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
        description={
          deleting?.status === "final"
            ? `“${deleting?.title ?? ""}” 已定稿：删除前原版将自动存档到版本史。`
            : `“${deleting?.title ?? ""}” will be removed from the world bible.`
        }
        onConfirm={async () => {
          if (!deleting) return;
          const target = deleting;
          if (target.status === "final") {
            // Immutable Canon: the server only allows the delete with reopen.
            try {
              await deleteWorldEntry(target.id, true);
              await onRefresh();
            } catch (e) {
              onCanonActionError(e);
            }
          } else {
            await onDelete(target);
          }
          setDeleting(null);
        }}
      />

      <ConfirmDialog
        open={deletingGroup !== null}
        onOpenChange={(v) => !v && setDeletingGroup(null)}
        title="删除分组？"
        description={`“${deletingGroup?.name ?? ""}” 将被删除，组内条目将变为未分组。`}
        confirmLabel="删除分组"
        busy={groupBusy}
        onConfirm={async () => {
          if (deletingGroup) await removeGroup(deletingGroup);
        }}
      />
    </PanelShell>
  );
}

/** Round filter chip for the 世界书 group toolbar (全部 / each group). */
function GroupChip({
  label,
  count,
  active,
  onSelect,
}: {
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      title={`只看「${label}」`}
      className={cn(
        "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      <span className="max-w-40 truncate">{label}</span>
      <span className="font-mono text-[10px] opacity-70">({count})</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// World entry document window (single-asset view opened from the asset tree)
// ---------------------------------------------------------------------------

export function WorldDocument({
  entry,
  novelId,
  onRefresh,
  onUpdate,
  onDelete,
  onBack,
}: {
  entry: WorldEntryDTO;
  /** Novel id — required by the canon lock API calls. */
  novelId: string;
  /** Parent refetch, called after a canon finalize/reopen. */
  onRefresh: () => Promise<void>;
  onUpdate: (id: string, patch: { title?: string; category?: WorldCategory; content?: string }) => Promise<boolean>;
  onDelete: (w: WorldEntryDTO) => Promise<void>;
  onBack: () => void;
}) {
  const locked = entry.status === "final";
  const [title, setTitle] = useState(entry.title);
  const [category, setCategory] = useState<WorldCategory>(entry.category);
  const [content, setContent] = useState(entry.content);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [view, setView] = useState<AssetDocView>(
    entry.content.trim() ? "preview" : "write"
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const onCanonActionError = useCanonAction();

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

  /** 定稿 → Immutable Canon；解除定稿 → archive then downgrade to draft. */
  const setCanon = async (final: boolean) => {
    setLockBusy(true);
    try {
      await updateWorldEntry(entry.id, final ? { status: "final" } : { reopen: true });
      await onRefresh();
    } catch (e) {
      onCanonActionError(e);
    } finally {
      setLockBusy(false);
    }
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
              readOnly={locked}
            />
            <Select
              value={category}
              onValueChange={(v) => {
                setCategory(v as WorldCategory);
                setDirty(true);
              }}
              disabled={locked}
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
        <div className="flex shrink-0 items-center gap-1.5">
          {locked && <CanonFinalBadge />}
          <CanonLockButton
            locked={locked}
            busy={lockBusy}
            onFinalize={() => void setCanon(true)}
            onReopen={() => void setCanon(false)}
          />
        </div>
      </div>

      <DocToolbar
        view={view}
        onViewChange={setView}
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDelete={() => setConfirmDelete(true)}
        deleteAriaLabel="Delete world entry"
        locked={locked}
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
          readOnly={locked}
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
  volumes,
  novelId,
  onRefresh,
  onOpenVolume,
  onAdd,
  onUpdate,
  onDelete,
}: {
  beats: OutlineBeatDTO[];
  /** Beat highlighted + scrolled into view (opened from the asset tree). */
  focusBeatId?: string | null;
  /** Volumes (卷) — present once the outline is grouped into volumes. */
  volumes?: VolumeDTO[];
  /** Novel id, needed to create volumes straight from the panel header. */
  novelId?: string;
  /** Parent refetch, called after a panel-driven volume create/delete. */
  onRefresh?: () => Promise<void>;
  /** Opens the volume plan document (routed by the artifact pane). */
  onOpenVolume?: (volumeId: string) => void;
  onAdd: (input: { title: string; summary: string }) => Promise<boolean>;
  onUpdate: (id: string, patch: { title?: string; summary?: string }) => Promise<boolean>;
  onDelete: (b: OutlineBeatDTO) => Promise<void>;
}) {
  const [editing, setEditing] = useState<OutlineBeatDTO | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<OutlineBeatDTO | null>(null);
  const [addingVolume, setAddingVolume] = useState(false);
  const [deletingVolume, setDeletingVolume] = useState<VolumeDTO | null>(null);
  const focusRef = useFocusScroll<HTMLDivElement>(focusBeatId ?? null);

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

  // Group beats under their volume; beats without a volume (or pointing at a
  // missing one) land in a trailing Unsorted section so nothing is ever hidden.
  const volumeList = volumes ?? [];
  const sections: { volume: VolumeDTO | null; beats: OutlineBeatDTO[] }[] = [];
  if (volumeList.length > 0) {
    const byId = new Map<string, OutlineBeatDTO[]>();
    for (const v of volumeList) byId.set(v.id, []);
    const unsorted: OutlineBeatDTO[] = [];
    for (const b of beats) {
      const bucket = b.volumeId ? byId.get(b.volumeId) : undefined;
      if (bucket) bucket.push(b);
      else unsorted.push(b);
    }
    for (const v of volumeList) {
      sections.push({ volume: v, beats: byId.get(v.id) ?? [] });
    }
    if (unsorted.length > 0) sections.push({ volume: null, beats: unsorted });
  }

  // Beat numbers stay global (matching the tree's positional prefixes) even
  // when the list is grouped into volume sections.
  const beatNumbers = new Map<string, number>(beats.map((b, i) => [b.id, i + 1]));
  const renderBeat = (b: OutlineBeatDTO) => {
    const no = beatNumbers.get(b.id) ?? 1;
    const locked = b.status === "final";
    return (
      <li
        key={b.id}
        data-asset-id={b.id}
        className={cn(
          "group flex scroll-mt-2 items-start gap-3 rounded-lg border bg-card p-4 transition-shadow",
          b.id === focusBeatId && "border-primary/50 ring-1 ring-primary/30"
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 font-display text-xs font-bold text-primary">
          {no}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 font-medium">
            <span className="min-w-0 truncate">{b.title}</span>
            {locked && <CanonLockGlyph />}
          </h3>
          {b.summary && (
            <MarkdownDocument
              content={b.summary}
              className="mt-1 text-muted-foreground"
            />
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => openEdit(b)}
            disabled={locked}
            title={locked ? "已定稿 — 解除定稿后可编辑" : undefined}
            aria-label={`Edit beat ${no}`}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDeleting(b)}
            aria-label={`Delete beat ${no}`}
            className="hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </li>
    );
  };

  const handleAddVolume = async () => {
    if (!novelId || !onRefresh) return;
    setAddingVolume(true);
    try {
      await addVolume(novelId, { title: `Volume ${volumeList.length + 1}` });
      await onRefresh();
    } catch (e) {
      console.error("addVolume failed", e);
    } finally {
      setAddingVolume(false);
    }
  };

  return (
    <PanelShell
      icon={<ScrollText className="h-4 w-4" aria-hidden="true" />}
      title="Outline"
      count={beats.length}
      emptyText="No outline yet. Sketch the story arc beat by beat — the AI drafts follow this."
      onAdd={openNew}
      addLabel="Add beat"
      headerAction={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleAddVolume()}
          disabled={addingVolume || !novelId || !onRefresh}
        >
          {addingVolume ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
          Add volume
        </Button>
      }
      list={
        <div ref={focusRef} className="space-y-4">
          {sections.length > 0 ? (
            sections.map((section) => {
              const v = section.volume;
              return v ? (
                <section key={v.id} className="space-y-2">
                  <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-1.5">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {String(v.index).padStart(2, "0")}
                    </span>
                    <h4 className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-semibold">
                      <span className="min-w-0 truncate">{v.title}</span>
                      {v.status === "final" && <CanonLockGlyph />}
                    </h4>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      ({section.beats.length})
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onOpenVolume?.(v.id)}
                      aria-label={`Open volume plan for ${v.title}`}
                    >
                      <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:text-destructive"
                      onClick={() => setDeletingVolume(v)}
                      aria-label={`Delete volume ${v.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                  <ol className="space-y-2">{section.beats.map(renderBeat)}</ol>
                </section>
              ) : (
                <section key="unsorted" className="space-y-2">
                  <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-1.5">
                    <h4 className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">
                      Unsorted / 未分组
                    </h4>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      ({section.beats.length})
                    </span>
                  </div>
                  <ol className="space-y-2">{section.beats.map(renderBeat)}</ol>
                </section>
              );
            })
          ) : (
            <ol className="space-y-2">{beats.map(renderBeat)}</ol>
          )}
        </div>
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
        description={
          deleting?.status === "final"
            ? `“${deleting?.title ?? ""}” 已定稿：删除前原版将自动存档到版本史。`
            : `“${deleting?.title ?? ""}” will be removed from the outline. Later beats keep their order.`
        }
        onConfirm={async () => {
          if (!deleting) return;
          const target = deleting;
          if (target.status === "final") {
            // Immutable Canon: the server only allows the delete with reopen.
            try {
              await deleteOutlineBeat(target.id, true);
              await onRefresh?.();
            } catch (e) {
              console.error("deleteOutlineBeat (reopen) failed", e);
            }
          } else {
            await onDelete(target);
          }
          setDeleting(null);
        }}
      />

      <ConfirmDialog
        open={deletingVolume !== null}
        onOpenChange={(v) => !v && setDeletingVolume(null)}
        title="Delete volume?"
        description={
          deletingVolume?.status === "final"
            ? `“${deletingVolume?.title ?? ""}” 已定稿：删除前原版将自动存档到版本史。卷内节拍将变为未分组（不会被删除）。`
            : `“${deletingVolume?.title ?? ""}” will be deleted. Beats in this volume will become unsorted (they are not deleted).`
        }
        onConfirm={async () => {
          const volume = deletingVolume;
          setDeletingVolume(null);
          if (!volume) return;
          try {
            await deleteVolume(volume.id, volume.status === "final");
            await onRefresh?.();
          } catch (e) {
            console.error("deleteVolume failed", e);
          }
        }}
      />
    </PanelShell>
  );
}

// ---------------------------------------------------------------------------
// Volume document window (卷) — single-volume plan view opened from the outline
// ---------------------------------------------------------------------------

export function VolumeDocument({
  volume,
  novelId,
  onRefresh,
  onUpdate,
  onDelete,
  onBack,
}: {
  volume: VolumeDTO;
  /** Novel id — required by the canon lock API calls. */
  novelId: string;
  /** Parent refetch, called after a canon finalize/reopen. */
  onRefresh: () => Promise<void>;
  onUpdate: (id: string, patch: { title?: string; synopsis?: string }) => Promise<boolean>;
  onDelete: (v: VolumeDTO) => Promise<void>;
  onBack: () => void;
}) {
  const locked = volume.status === "final";
  const [title, setTitle] = useState(volume.title);
  const [synopsis, setSynopsis] = useState(volume.synopsis);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [view, setView] = useState<AssetDocView>(
    volume.synopsis.trim() ? "preview" : "write"
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const onCanonActionError = useCanonAction();

  // Resync local state when a different volume is opened (see
  // CharacterDocument for why this is a render-time adjustment).
  const [syncedVolume, setSyncedVolume] = useState(volume);
  if (syncedVolume !== volume) {
    setSyncedVolume(volume);
    setTitle(volume.title);
    setSynopsis(volume.synopsis);
    setDirty(false);
    setView(volume.synopsis.trim() ? "preview" : "write");
  }

  const save = async () => {
    setSaving(true);
    const ok = await onUpdate(volume.id, {
      title: title.trim() || volume.title,
      synopsis,
    });
    setSaving(false);
    if (ok) setDirty(false);
  };

  /** 定稿 → Immutable Canon；解除定稿 → archive then downgrade to draft. */
  const setCanon = async (final: boolean) => {
    setLockBusy(true);
    try {
      await updateVolume(volume.id, final ? { status: "final" } : { reopen: true });
      await onRefresh();
    } catch (e) {
      onCanonActionError(e);
    } finally {
      setLockBusy(false);
    }
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
          All volumes
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
              aria-label="Volume title"
              readOnly={locked}
            />
            <span className="shrink-0 rounded border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
              Volume {volume.index}
            </span>
          </div>
        ) : (
          <h2 className="min-w-0 flex-1 truncate font-display text-lg font-bold leading-tight">
            {title || volume.title}
          </h2>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          {locked && <CanonFinalBadge />}
          <CanonLockButton
            locked={locked}
            busy={lockBusy}
            onFinalize={() => void setCanon(true)}
            onReopen={() => void setCanon(false)}
          />
        </div>
      </div>

      <DocToolbar
        view={view}
        onViewChange={setView}
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDelete={() => setConfirmDelete(true)}
        deleteAriaLabel="Delete volume"
        locked={locked}
      />

      {/* Body — textarea while writing, document window while reading */}
      {view === "write" ? (
        <Textarea
          value={synopsis}
          onChange={(e) => {
            setSynopsis(e.target.value);
            setDirty(true);
          }}
          placeholder="The plan for this volume — arc, turning points, how it pays off…"
          className="nice-scroll min-h-[280px] resize-y rounded-none border-0 font-serif text-[15px] leading-7 shadow-none focus-visible:ring-0"
          aria-label="Synopsis"
          readOnly={locked}
        />
      ) : (
        <div className="px-6 py-5" aria-label="Volume document preview">
          {synopsis.trim() ? (
            <>
              <span className="mb-3 inline-block rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                Volume {volume.index}
              </span>
              <MarkdownDocument content={synopsis} className="mx-auto max-w-prose" />
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
        title="Delete volume?"
        description={`“${volume.title}” will be deleted. Beats in this volume will become unsorted (they are not deleted).`}
        onConfirm={async () => {
          setConfirmDelete(false);
          await onDelete(volume);
          onBack();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outline beat document window (single-asset view opened from the asset tree)
// ---------------------------------------------------------------------------

export function BeatDocument({
  beat,
  novelId,
  onRefresh,
  volumes,
  onUpdate,
  onDelete,
  onBack,
}: {
  beat: OutlineBeatDTO;
  /** Novel id — required by the canon lock API calls. */
  novelId: string;
  /** Parent refetch, called after a canon finalize/reopen. */
  onRefresh: () => Promise<void>;
  /** Volumes (卷) for the quick reassignment select — hidden while absent. */
  volumes?: VolumeDTO[];
  onUpdate: (id: string, patch: { title?: string; summary?: string; volumeId?: string | null }) => Promise<boolean>;
  onDelete: (b: OutlineBeatDTO) => Promise<void>;
  onBack: () => void;
}) {
  const locked = beat.status === "final";
  const [title, setTitle] = useState(beat.title);
  const [summary, setSummary] = useState(beat.summary);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [view, setView] = useState<AssetDocView>(
    beat.summary.trim() ? "preview" : "write"
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const onCanonActionError = useCanonAction();

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

  /** 定稿 → Immutable Canon；解除定稿 → archive then downgrade to draft. */
  const setCanon = async (final: boolean) => {
    setLockBusy(true);
    try {
      await updateOutlineBeat(beat.id, final ? { status: "final" } : { reopen: true });
      await onRefresh();
    } catch (e) {
      onCanonActionError(e);
    } finally {
      setLockBusy(false);
    }
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
              readOnly={locked}
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
        {volumes && volumes.length > 0 && (
          <Select
            value={beat.volumeId ?? "unsorted"}
            onValueChange={(value) =>
              void onUpdate(beat.id, {
                volumeId: value === "unsorted" ? null : value,
              })
            }
            disabled={locked}
          >
            <SelectTrigger className="w-full shrink-0 sm:w-40" aria-label="Volume">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unsorted">Unsorted</SelectItem>
              {volumes.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {`V${String(v.index).padStart(2, "0")} · ${v.title}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex shrink-0 items-center gap-1.5">
          {locked && <CanonFinalBadge />}
          <CanonLockButton
            locked={locked}
            busy={lockBusy}
            onFinalize={() => void setCanon(true)}
            onReopen={() => void setCanon(false)}
          />
        </div>
      </div>

      <DocToolbar
        view={view}
        onViewChange={setView}
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDelete={() => setConfirmDelete(true)}
        deleteAriaLabel="Delete outline beat"
        locked={locked}
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
          readOnly={locked}
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
  headerAction,
  toolbar,
  list,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  emptyText: string;
  onAdd: () => void;
  addLabel: string;
  /** Extra secondary control beside the add button (e.g. "Add volume"). */
  headerAction?: React.ReactNode;
  /** Filter/management strip rendered between the header and the list
   * (e.g. the 世界书 second-level group toolbar) — shown even when empty. */
  toolbar?: React.ReactNode;
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
        <div className="flex items-center gap-2">
          {headerAction}
          <Button size="sm" onClick={onAdd}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {addLabel}
          </Button>
        </div>
      </div>
      {toolbar}
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
  locked = false,
}: {
  view: AssetDocView;
  onViewChange: (v: AssetDocView) => void;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDelete: () => void;
  deleteAriaLabel: string;
  /** Immutable Canon: hide save/delete, show the archive hint instead. */
  locked?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
      <DocViewToggle view={view} onChange={onViewChange} />
      {locked ? (
        <span className="flex items-center gap-1 text-amber-700">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          Immutable Canon — 解除定稿后可编辑，原版自动存档
        </span>
      ) : (
        dirty && (
          <span className="flex items-center gap-1 text-amber-700">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
            Unsaved changes
          </span>
        )
      )}
      {!locked && (
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
      )}
    </div>
  );
}
