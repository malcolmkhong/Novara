"use client";

// ---------------------------------------------------------------------------
// Novara AI — "New with the AI team" creation wizard (4 steps).
// UI foundation: each step can auto-fill a canned mock template (Phase 1);
// the final create goes through the REAL novels API via the `onFinish`
// callback owned by the parent. The GLM pipeline replaces the mock
// generation in Phase 2.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
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
import type { CreateNovelInput } from "@/lib/novara/api";
import { cn } from "@/lib/utils";

export interface CreateWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Parent performs the real create; resolves true when the novel exists. */
  onFinish: (input: CreateNovelInput) => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Step model + mock templates
// ---------------------------------------------------------------------------

const STEPS = ["Concept", "Story foundation", "World & cast", "Outline"] as const;

type WizardField = "concept" | "premise" | "cast" | "beats";

interface WizardState {
  genre: string;
  logline: string;
  premise: string;
  characters: string;
  beats: string;
}

const EMPTY_STATE: WizardState = {
  genre: "",
  logline: "",
  premise: "",
  characters: "",
  beats: "",
};

const GEN_DELAY_MS = 900;

const SAMPLE_GENRE = "Contemporary fantasy";
const SAMPLE_LOGLINE =
  "In a 24-hour convenience store at the edge of the city, customers can trade years of their own life for anything on the shelves — and Mara, the night clerk, keeps the ledger that decides whether the arithmetic balances.";
const SAMPLE_PREMISE =
  "The Ledger is a convenience store that appears wherever the night is longest. Its shelves stock the ordinary — instant noodles, umbrellas, batteries — and the impossible: an hour of childhood, a first kiss, the courage to make one phone call. Customers pay with years of their own life, weighed on the counter scale to the day. Mara, the night clerk, records every trade in the store's book and has never made a purchase of her own. When a customer buys back a year the ledger marks as already spent, she discovers the book has a second column — one that names the people whose years fund the stock. To close the ledger without erasing them, Mara must make her first purchase and accept what it costs.";
const SAMPLE_CAST = `Mara Voss — protagonist: night clerk of the Ledger; keeps the trade book, claims she is only good at arithmetic, quietly keeps a copy of every receipt she has ever written.
The Proprietor — antagonist: owner of the Ledger; pays staff in spare years and never explains where the stock comes from.
Jun Park — supporting: a regular who keeps buying back the same hour of his daughter's childhood, one week of life at a time.
Auntie Rin — supporting: retired auditor of traded years; teaches Mara to read the ledger's second column.`;
const SAMPLE_BEATS = `Night shift, normal rules: Mara balances the ledger after a quiet shift; a trade goes through that leaves the till short by exactly one year.
The impossible receipt: a customer redeems a year the ledger marks as spent; Mara finds the second column of names and handwriting that looks exactly like hers.
Rin explains the arithmetic: every item on the shelf belongs to somebody; Mara decides to trace one name to its source.
The Proprietor makes an offer: keep the ledger, keep the store, forget the column — Mara asks what her own line in the book says.
Closing the ledger: Mara makes her first purchase — one hour of her own past — and uses it to prove where the stock comes from.
New arithmetic: the Ledger reopens under joint management; every trade needs two signatures and the second column is public.`;

const withPeriod = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);

/** Incorporates whatever the author already typed into a fuller logline. */
const expandLogline = (seed: string): string =>
  `${withPeriod(seed.trim().replace(/\s+/g, " "))} The team anchors it in a single neon-lit storefront — a convenience store that buys and sells years of life, kept honest by a ledger and its night clerk.`;

const loglineFor = (genre: string, existingLogline: string): string => {
  if (existingLogline.trim()) return expandLogline(existingLogline);
  const g = genre.trim();
  if (!g || g.toLowerCase() === SAMPLE_GENRE.toLowerCase()) {
    return SAMPLE_LOGLINE;
  }
  return `${g} — a story where customers trade years of their life at a 24-hour convenience store, and the night clerk keeps the ledger that decides what every trade costs.`;
};

/** Appends the canned expansion after whatever premise/logline exists. */
const expandPremise = (seed: string): string =>
  `${withPeriod(seed.trim().replace(/\s+/g, " "))}\n\nThe team expands this into a working premise: the exchange has rules (years are weighed to the day, every trade is final), a keeper of the rules, and a cost that compounds quietly until someone demands to see the second column of the book.`;

/** Appends sample lines that are not already present (idempotent). */
const appendLines = (existing: string, sample: string): string => {
  const have = new Set(
    existing
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
  );
  const add = sample.split("\n").filter((l) => !have.has(l.trim()));
  return add.length > 0 ? `${existing.trimEnd()}\n${add.join("\n")}` : existing;
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
      {busy ? "Generating" : "Generate (mock)"}
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
  const timerRef = useRef<number | null>(null);

  // Fresh wizard every time it opens.
  useEffect(() => {
    if (open) {
      setStep(0);
      setFields(EMPTY_STATE);
      setGenerating(null);
      setSubmitting(false);
    }
  }, [open]);

  // Clear a pending mock-generation timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const generate = (field: WizardField) => {
    if (generating !== null) return;
    setGenerating(field);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setFields((f) => {
        switch (field) {
          case "concept":
            return {
              ...f,
              genre: f.genre.trim() ? f.genre : SAMPLE_GENRE,
              logline: loglineFor(f.genre, f.logline),
            };
          case "premise": {
            const current = f.premise.trim();
            const seed = current || f.logline.trim();
            return {
              ...f,
              premise: seed ? expandPremise(seed) : SAMPLE_PREMISE,
            };
          }
          case "cast":
            return {
              ...f,
              characters: f.characters.trim()
                ? appendLines(f.characters, SAMPLE_CAST)
                : SAMPLE_CAST,
            };
          case "beats":
            return {
              ...f,
              beats: f.beats.trim()
                ? appendLines(f.beats, SAMPLE_BEATS)
                : SAMPLE_BEATS,
            };
        }
      });
      setGenerating(null);
    }, GEN_DELAY_MS);
  };

  const handleCreate = async () => {
    if (submitting) return;
    setSubmitting(true);
    const input: CreateNovelInput = {
      title: deriveTitle(fields),
      genre: fields.genre.trim() || undefined,
      synopsis: [
        fields.premise.trim(),
        fields.characters.trim(),
        fields.beats.trim(),
      ]
        .filter(Boolean)
        .join("\n\n"),
      targetWords: 100000,
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
            Describe the idea — the team drafts the foundation. Generation is
            mocked in this preview; the created novel is real.
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
            Mock generation — wiring the real GLM pipeline is Phase 2.
          </p>

          {/* Step bodies */}
          <div className="min-h-[240px] space-y-4">
            {step === 0 && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="wizard-genre">Genre</Label>
                  <GenerateButton
                    onClick={() => generate("concept")}
                    busy={generating === "concept"}
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
                    placeholder="One sentence that sells the story."
                  />
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
                    <Label htmlFor="wizard-characters">World & cast</Label>
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
