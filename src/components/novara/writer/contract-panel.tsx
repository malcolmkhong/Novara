"use client";

// ---------------------------------------------------------------------------
// Novara AI — Contract tab (Phase 8): two novel-level documents.
//
//   - 作品契约 (story contract)  — read into every AI writing context.
//   - 构想快照 (concept snapshot) — the wizard's vision, kept verbatim so
//     drift between vision and plan stays auditable.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Lightbulb, Loader2, Save, ScrollText, type LucideIcon } from "lucide-react";
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
import { PinButton } from "./ui-bits";

export function ContractPanel({
  novelId,
  contract,
  conceptSnapshot,
  onSaveContract,
  onSaveConcept,
}: {
  novelId: string;
  contract: string | null;
  conceptSnapshot: string;
  onSaveContract: (content: string) => Promise<boolean>;
  onSaveConcept: (content: string) => Promise<boolean>;
}) {
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
}) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

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

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="font-display text-base">{title}</CardTitle>
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
          className="nice-scroll min-h-[220px] resize-y text-sm"
        />
        <div className="flex items-center justify-end gap-2">
          {dirty && (
            <span className="mr-auto text-[11px] text-muted-foreground">
              Unsaved changes
            </span>
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
      </CardContent>
    </Card>
  );
}
