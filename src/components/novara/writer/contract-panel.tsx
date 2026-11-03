"use client";

// ---------------------------------------------------------------------------
// Novara AI — Contract tab (Phase 8): two novel-level documents.
//
//   - 作品契约 (story contract)  — read into every AI writing context.
//   - 构想快照 (concept snapshot) — the wizard's vision, kept verbatim so
//     drift between vision and plan stays auditable.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Lightbulb, Loader2, Lock, Save, ScrollText, Sparkles, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { PinnedRef } from "@/lib/novara/agent-types";
import { generateWizardSection, updateNovel } from "@/lib/novara/api";
import { useToast } from "@/hooks/use-toast";
import { CanonLockButton } from "./bible-panels";
import { PinButton } from "./ui-bits";

export function ContractPanel({
  novelId,
  contract,
  contractStatus,
  conceptSnapshot,
  genre,
  synopsis,
  onSaveContract,
  onSaveConcept,
  onRefresh,
}: {
  novelId: string;
  contract: string | null;
  /** Canon lock of the story contract (Phase 9) — "final" is Immutable Canon. */
  contractStatus: "draft" | "final";
  conceptSnapshot: string;
  /** Novel context for the AI contract draft (Phase 9). */
  genre: string;
  synopsis: string;
  onSaveContract: (content: string) => Promise<boolean>;
  onSaveConcept: (content: string) => Promise<boolean>;
  /** Refetch novel detail after lock changes. */
  onRefresh: () => Promise<void>;
}) {
  const { toast } = useToast();
  const contractPin: PinnedRef = {
    type: "contract",
    id: novelId,
    label: "作品契约 Story contract",
  };
  const conceptPin: PinnedRef = {
    type: "concept",
    id: novelId,
    label: "构想快照 Concept snapshot",
  };

  // Canon lock (Phase 9) — the story contract is novel-level Immutable Canon:
  // "final" locks the text (server 409s edits without reopen); reopen archives
  // the final text into AssetVersion and downgrades to draft. The concept
  // snapshot stays an editable audit document.
  const contractLocked = contractStatus === "final";
  const [lockBusy, setLockBusy] = useState(false);

  const setContractLock = async (finalize: boolean) => {
    setLockBusy(true);
    try {
      await updateNovel(novelId, finalize ? { contractStatus: "final" } : { contractReopen: true });
      await onRefresh();
    } finally {
      setLockBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <ContractDocument
        title="作品契约"
        icon={ScrollText}
        description="The promise this book makes: genre expectations, audience, style commitments, hard taboos. Read into every AI writing context."
        value={contract ?? ""}
        onSave={onSaveContract}
        placeholder="Genre expectations, audience, style commitments, hard taboos…"
        ariaLabel="Story contract"
        novelId={novelId}
        pinTarget={contractPin}
        locked={contractLocked}
        lockBusy={lockBusy}
        onFinalize={() => void setContractLock(true)}
        onReopen={() => void setContractLock(false)}
        onGenerate={async () => {
          // Phase 9 — AI contract draft: GLM writes the 5-line promise
          // document from the novel's genre/logline; the author edits and
          // saves (human-in-the-loop, same as the wizard).
          try {
            const { content } = await generateWizardSection({
              section: "contract",
              genre: genre || undefined,
              logline: synopsis.slice(0, 400) || undefined,
            });
            return content;
          } catch (e) {
            toast({
              title: "AI generation failed",
              description:
                e instanceof Error ? e.message : "Unknown error — try again.",
              variant: "destructive",
            });
            return null;
          }
        }}
      />
      <ContractDocument
        title="构想快照"
        icon={Lightbulb}
        description="The initial creative vision, kept verbatim (构想/构想快照.md analog) so drift between vision and plan stays auditable."
        value={conceptSnapshot}
        onSave={onSaveConcept}
        placeholder="Paste the vision from the creation wizard here — it stays verbatim so you can audit how far the plan has drifted."
        ariaLabel="Concept snapshot"
        novelId={novelId}
        pinTarget={conceptPin}
      />
    </div>
  );
}

function ContractDocument({
  title,
  icon: Icon,
  description,
  value,
  onSave,
  placeholder,
  ariaLabel,
  novelId,
  pinTarget,
  locked = false,
  lockBusy = false,
  onFinalize,
  onReopen,
  onGenerate,
}: {
  title: string;
  icon: LucideIcon;
  description: string;
  value: string;
  onSave: (content: string) => Promise<boolean>;
  placeholder: string;
  ariaLabel: string;
  novelId: string;
  pinTarget: PinnedRef;
  /** Canon lock (Phase 9) — locked docs are read-only until reopened. */
  locked?: boolean;
  lockBusy?: boolean;
  onFinalize?: () => void;
  onReopen?: () => void;
  /** Optional AI draft hook (Phase 9) — fills the textarea with GLM output. */
  onGenerate?: () => Promise<string | null>;
}) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Local draft state synced from props — whenever the persisted value
  // changes (shell refetch), the draft resets. Guarded setState during
  // render is the documented pattern for "reset state when a prop changes"
  // (React: You Might Not Need an Effect).
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(value);
    setDirty(false);
  }

  const save = async () => {
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok) setDirty(false);
  };

  const generate = async () => {
    if (!onGenerate || generating) return;
    setGenerating(true);
    const content = await onGenerate();
    setGenerating(false);
    if (content) {
      setDraft(content);
      setDirty(true);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="font-display text-base">{title}</CardTitle>
          {locked && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-700" title="Immutable Canon — 已定稿，修订请先解除定稿">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              Canon
            </span>
          )}
          {onFinalize && onReopen && (
            <CanonLockButton
              locked={locked}
              busy={lockBusy}
              onFinalize={onFinalize}
              onReopen={onReopen}
            />
          )}
          {onGenerate && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => void generate()}
              disabled={locked || generating}
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {generating ? "Drafting…" : "Draft with AI"}
            </Button>
          )}
          <PinButton
            novelId={novelId}
            target={pinTarget}
            label="Pin to chat"
            className="ml-auto"
          />
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
          placeholder={placeholder}
          aria-label={ariaLabel}
          readOnly={locked}
          className="nice-scroll min-h-[220px] resize-y text-sm"
        />
        <div className="flex items-center justify-end gap-2">
          {locked ? (
            <p className="mr-auto flex items-center gap-1 text-[11px] text-muted-foreground">
              <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
              已定稿（Immutable Canon）— 解除定稿后可修订，原版自动存档。
            </p>
          ) : (
            dirty && (
              <span className="mr-auto text-[11px] text-muted-foreground">
                Unsaved changes
              </span>
            )
          )}
          <Button
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => void save()}
            disabled={saving || !dirty || locked}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
