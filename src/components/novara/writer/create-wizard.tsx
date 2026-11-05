"use client";

// ---------------------------------------------------------------------------
// Novara AI — "New with the AI team" creation wizard (4 steps).
// Each step's Generate button calls the REAL GLM pipeline
// (POST /api/ai/wizard, one section per call). Cast and outline stay as
// editable canonical text; on Create they are parsed into structured rows
// (wizard-parse.ts) and persisted atomically through POST /api/novels.
// Nothing is saved until the user presses Create.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Wand2,
} from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  generateWizardSection,
  type CreateNovelInput,
  type WizardSection,
} from "@/lib/novara/api";
import { parseBeatLines, parseCastLines, parseWorldLines } from "@/lib/novara/wizard-parse";
import { cn } from "@/lib/utils";

export interface CreateWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Parent performs the real create; resolves true when the novel exists. */
  onFinish: (input: CreateNovelInput) => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Step model
// ---------------------------------------------------------------------------

const STEPS = ["Concept", "Story foundation", "World & cast", "Outline"] as const;

type WizardField = "logline" | "premise" | "cast" | "world" | "beats";

interface WizardState {
  genre: string;
  logline: string;
  premise: string;
  characters: string;
  world: string;
  beats: string;
  targetWords: string;
}

const EMPTY_STATE: WizardState = {
  genre: "",
  logline: "",
  premise: "",
  characters: "",
  world: "",
  beats: "",
  targetWords: "100000",
};

const isStepValid = (step: number, f: WizardState): boolean => {
  switch (step) {
    case 0:
      return f.logline.trim().length > 0;
    case 1:
      return f.premise.trim().length > 0;
    case 2:
      return f.characters.trim().length > 0;
    case 3:
      return f.beats.trim().length > 0;
    default:
      return false;
  }
};

/** First 6-8 words of the premise (or logline), capped at 60 chars. */
const deriveTitle = (f: WizardState): string => {
  const source = (f.premise.trim() || f.logline.trim())
    .replace(/\s+/g, " ")
    .trim();
  if (!source) return "Untitled novel";
  const words = source.split(" ").slice(0, 8).join(" ");
  const clean = words.replace(/[.,;:!?—-]+$/, "").trim();
  if (!clean) return "Untitled novel";
  return clean.length > 60 ? `${clean.slice(0, 57).trimEnd()}…` : clean;
};

/** Joins generated content onto what the author already typed. */
const appendContent = (existing: string, generated: string): string => {
  const have = generated.trim();
  if (!existing.trim()) return have;
  // Skip if the generator returned exactly what's already there.
  if (existing.trim() === have) return existing;
  return `${existing.trimEnd()}\n\n${have}`;
};

// ---------------------------------------------------------------------------
// Internal bits
// ---------------------------------------------------------------------------

function GenerateButton({
  onClick,
  busy,
  disabled,
}: {
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled || busy}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Wand2 className="h-4 w-4" aria-hidden="true" />
      )}
      {busy ? "Generating…" : "Generate with AI"}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// CreateWizard
// ---------------------------------------------------------------------------

export function CreateWizard({
  open,
  onOpenChange,
  onFinish,
}: CreateWizardProps) {
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [fields, setFields] = useState<WizardState>(EMPTY_STATE);
  const [generating, setGenerating] = useState<WizardField | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // P5 — one usage-ledger session id per wizard session: every GLM section
  // call and the final create carry it, so the ledger retro-tags the whole
  // session's consumption onto the novel it culminates in. Regenerated on
  // every open (a fresh wizard is a fresh correlation thread).
  const [wizardSessionId, setWizardSessionId] = useState<string | null>(null);

  // Fresh wizard every time it opens.
  useEffect(() => {
    if (open) {
      setStep(0);
      setFields(EMPTY_STATE);
      setGenerating(null);
      setSubmitting(false);
      setWizardSessionId(
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `wizard-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      );
    }
  }, [open]);

  const parseTarget = (): number | undefined => {
    const n = Number.parseInt(fields.targetWords, 10);
    return Number.isFinite(n) && n >= 1000 && n <= 5000000 ? n : undefined;
  };

  const generate = async (field: WizardField) => {
    if (generating !== null) return;
    setGenerating(field);

    const section: WizardSection =
      field === "logline"
        ? "logline"
        : field === "premise"
          ? "premise"
          : field === "cast"
            ? "characters"
            : field === "world"
              ? "world"
              : "beats";

    try {
      const { content } = await generateWizardSection({
        section,
        genre: fields.genre.trim() || undefined,
        logline: fields.logline.trim() || undefined,
        premise: fields.premise.trim() || undefined,
        characters: field === "beats" ? fields.characters.trim() || undefined : undefined,
        targetWords: parseTarget(),
        sessionId: wizardSessionId ?? undefined,
      });
      setFields((f) => {
        switch (field) {
          case "logline":
            // A logline is one sentence — replace only if empty, else keep
            // the author's version and append as an alternative.
            return { ...f, logline: appendContent(f.logline, content) };
          case "premise":
            return { ...f, premise: appendContent(f.premise, content) };
          case "cast":
            return { ...f, characters: appendContent(f.characters, content) };
          case "world":
            return { ...f, world: appendContent(f.world, content) };
          case "beats":
            return { ...f, beats: appendContent(f.beats, content) };
        }
      });
    } catch (e) {
      toast({
        title: "AI generation failed",
        description:
          e instanceof Error ? e.message : "Unknown error — try again.",
        variant: "destructive",
      });
    } finally {
      setGenerating(null);
    }
  };

  const handleCreate = async () => {
    if (submitting) return;
    setSubmitting(true);

    const characters = parseCastLines(fields.characters);
    const worldEntries = parseWorldLines(fields.world);
    const outlineBeats = parseBeatLines(fields.beats);
    const targetWords = parseTarget();

    // Phase 9 — 构想快照: the confirmed vision, kept verbatim as the
    // creation-time baseline (audit analog of 构想/构想快照.md).
    const snapshotParts: string[] = [];
    if (fields.genre.trim()) snapshotParts.push(`题材 GENRE: ${fields.genre.trim()}`);
    if (targetWords) snapshotParts.push(`目标字数 TARGET: ${targetWords}`);
    if (fields.logline.trim()) snapshotParts.push(`【一句话 LOGLINE】\n${fields.logline.trim()}`);
    if (fields.premise.trim()) snapshotParts.push(`【前提 PREMISE】\n${fields.premise.trim()}`);
    if (fields.characters.trim()) snapshotParts.push(`【人物 CAST】\n${fields.characters.trim()}`);
    if (fields.world.trim()) snapshotParts.push(`【世界书 WORLD】\n${fields.world.trim()}`);
    if (fields.beats.trim()) snapshotParts.push(`【大纲 OUTLINE】\n${fields.beats.trim()}`);
    const conceptSnapshot =
      snapshotParts.length > 0
        ? `# 构想快照 — captured by "New with the AI team" at creation\n\n${snapshotParts.join("\n\n")}`
        : undefined;

    const input: CreateNovelInput = {
      title: deriveTitle(fields),
      genre: fields.genre.trim() || undefined,
      synopsis: fields.premise.trim() || undefined,
      targetWords,
      ...(characters.length > 0 ? { characters } : {}),
      ...(worldEntries.length > 0 ? { worldEntries } : {}),
      ...(outlineBeats.length > 0 ? { outlineBeats } : {}),
      ...(conceptSnapshot ? { conceptSnapshot } : {}),
      ...(wizardSessionId ? { wizardSessionId } : {}),
    };

    let ok = false;
    try {
      ok = await onFinish(input);
    } catch (e) {
      toast({
        title: "Could not create novel",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-4 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New with the AI team</DialogTitle>
          <DialogDescription>
            Describe the idea — the team drafts the foundation. Everything
            stays editable, and nothing is saved until you press Create.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Stepper */}
          <ol
            aria-label="Creation steps"
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
          >
            {STEPS.map((title, i) => {
              const done = i < step;
              const current = i === step;
              return (
                <li key={title} className="flex items-center gap-2">
                  <span
                    aria-current={current ? "step" : undefined}
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                      done && "border-emerald-300 bg-emerald-100 text-emerald-800",
                      current && "border-primary text-primary ring-2 ring-primary/30",
                      !done && !current && "text-muted-foreground"
                    )}
                  >
                    {done ? (
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span
                    className={cn(
                      "hidden text-xs font-medium sm:inline",
                      current ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {title}
                  </span>
                  {i < STEPS.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="h-px w-4 bg-border sm:w-6"
                    />
                  )}
                </li>
              );
            })}
          </ol>
          <p className="text-xs text-muted-foreground">
            Generated by GLM — edit anything before creating.
          </p>

          {/* Step bodies */}
          <div className="min-h-[240px] space-y-4">
            {step === 0 && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="wizard-genre">Genre</Label>
                  <GenerateButton
                    onClick={() => generate("logline")}
                    busy={generating === "logline"}
                    disabled={generating !== null}
                  />
                </div>
                <Input
                  id="wizard-genre"
                  value={fields.genre}
                  onChange={(e) =>
                    setFields((f) => ({ ...f, genre: e.target.value }))
                  }
                  placeholder="e.g. Contemporary fantasy"
                />
                <div className="space-y-1.5">
                  <Label htmlFor="wizard-logline">Logline</Label>
                  <Textarea
                    id="wizard-logline"
                    rows={2}
                    value={fields.logline}
                    onChange={(e) =>
                      setFields((f) => ({ ...f, logline: e.target.value }))
                    }
                    placeholder="One sentence that sells the story. Leave empty and press Generate for an idea."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wizard-target">Target words</Label>
                  <Input
                    id="wizard-target"
                    type="number"
                    min={1000}
                    max={5000000}
                    value={fields.targetWords}
                    onChange={(e) =>
                      setFields((f) => ({ ...f, targetWords: e.target.value }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    The team paces the outline to this budget — 8,000 for a
                    short story, 100,000 for a full novel.
                  </p>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="wizard-premise">Premise</Label>
                  <GenerateButton
                    onClick={() => generate("premise")}
                    busy={generating === "premise"}
                    disabled={generating !== null}
                  />
                </div>
                <Textarea
                  id="wizard-premise"
                  rows={4}
                  value={fields.premise}
                  onChange={(e) =>
                    setFields((f) => ({ ...f, premise: e.target.value }))
                  }
                  placeholder="What is the story about — the situation, the pressure, the cost?"
                />
              </>
            )}

            {step === 2 && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <Label htmlFor="wizard-characters">Cast</Label>
                    <p className="text-xs text-muted-foreground">
                      One per line — Name — role: description.
                    </p>
                  </div>
                  <GenerateButton
                    onClick={() => generate("cast")}
                    busy={generating === "cast"}
                    disabled={generating !== null}
                  />
                </div>
                <Textarea
                  id="wizard-characters"
                  rows={4}
                  value={fields.characters}
                  onChange={(e) =>
                    setFields((f) => ({ ...f, characters: e.target.value }))
                  }
                  placeholder={"Mara Voss — protagonist: night clerk who keeps the ledger."}
                />
                <div className="flex items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <Label htmlFor="wizard-world">World bible（世界书）</Label>
                    <p className="text-xs text-muted-foreground">
                      One per line — Title — category: content. Lands in the
                      世界规则 group of the tree.
                    </p>
                  </div>
                  <GenerateButton
                    onClick={() => generate("world")}
                    busy={generating === "world"}
                    disabled={generating !== null}
                  />
                </div>
                <Textarea
                  id="wizard-world"
                  rows={4}
                  value={fields.world}
                  onChange={(e) =>
                    setFields((f) => ({ ...f, world: e.target.value }))
                  }
                  placeholder={"The Ledger Hall — location: a converted bank where debts are measured in years."}
                />
              </>
            )}

            {step === 3 && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <Label htmlFor="wizard-beats">Outline</Label>
                    <p className="text-xs text-muted-foreground">
                      One beat per line — Beat title: summary.
                    </p>
                  </div>
                  <GenerateButton
                    onClick={() => generate("beats")}
                    busy={generating === "beats"}
                    disabled={generating !== null}
                  />
                </div>
                <Textarea
                  id="wizard-beats"
                  rows={4}
                  value={fields.beats}
                  onChange={(e) =>
                    setFields((f) => ({ ...f, beats: e.target.value }))
                  }
                  placeholder={"Night shift, normal rules: a trade leaves the till short by one year."}
                />
              </>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || submitting}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              type="button"
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              disabled={!isStepValid(step, fields) || submitting}
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleCreate}
              disabled={submitting}
            >
              {submitting && (
                <Loader2
                  className="h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
              )}
              Create novel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
