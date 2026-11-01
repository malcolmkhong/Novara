"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Bot,
  FlaskConical,
  Loader2,
  ShieldAlert,
  ShieldCheck,
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
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { postJSON } from "./api";
import { ScoreGauge } from "./score-gauge";
import type {
  CheckMode,
  ClaimStatus,
  GenerateResponse,
  HallucinationResponse,
  HallucinationSuccess,
  RiskLevel,
} from "./types";

/* ------------------------------------------------------------------ */
/* Display mappings                                                    */
/* ------------------------------------------------------------------ */

const RISK_META: Record<RiskLevel, { label: string; className: string }> = {
  low: {
    label: "Low risk",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  },
  medium: {
    label: "Medium risk",
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  },
  high: {
    label: "High risk",
    className:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  },
};

const CLAIM_META: Record<ClaimStatus, { label: string; className: string; bar: string }> = {
  supported: {
    label: "Supported",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
    bar: "[&>div]:bg-emerald-500",
  },
  unsupported: {
    label: "Unsupported",
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
    bar: "[&>div]:bg-amber-500",
  },
  contradicted: {
    label: "Contradicted",
    className:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
    bar: "[&>div]:bg-red-500",
  },
  unverifiable: {
    label: "Unverifiable",
    className:
      "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
    bar: "[&>div]:bg-zinc-400",
  },
};

const MODE_META: Record<CheckMode, string> = {
  "open-domain": "Open-domain check",
  grounded: "Source-grounded check",
};

const SCROLLBAR =
  "[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 dark:[&::-webkit-scrollbar-thumb]:bg-zinc-700";

type ModeSelection = "open" | "grounded";

/* ------------------------------------------------------------------ */

export function HallucinationPanel() {
  const { toast } = useToast();

  const [mode, setMode] = React.useState<ModeSelection>("open");
  const [question, setQuestion] = React.useState("");
  const [text, setText] = React.useState("");
  const [source, setSource] = React.useState("");
  const [checking, setChecking] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [result, setResult] = React.useState<HallucinationSuccess | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const isGrounded = mode === "grounded";

  const handleAskGlm = async (): Promise<void> => {
    if (!question.trim() || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const data = await postJSON<GenerateResponse>("/api/generate", {
        mode: "glm-answer",
        question: question.trim(),
      });
      if (!data.success) {
        throw new Error(data.error || "Generation failed.");
      }
      setText(data.text);
      toast({
        title: "Answer generated",
        description: "GLM's answer was placed in the response editor.",
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      toast({
        title: "Generation failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleCheck = async (): Promise<void> => {
    if (!text.trim() || checking) return;
    setChecking(true);
    setError(null);
    try {
      const data = await postJSON<HallucinationResponse>(
        "/api/detect/hallucination",
        {
          text,
          source: isGrounded && source.trim() ? source.trim() : undefined,
          question: question.trim() || undefined,
        }
      );
      if (!data.success) {
        throw new Error(data.error || "Hallucination check failed.");
      }
      setResult(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
      toast({
        title: "Analysis failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ------------------------- Input column ------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Hallucination check</CardTitle>
          <CardDescription>
            GLM extracts factual claims and verifies them, flagging anything
            unsupported, contradicted, or unverifiable.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {/* Mode selector */}
          <div className="flex flex-col gap-2">
            <Label>Check mode</Label>
            <RadioGroup
              value={mode}
              onValueChange={(value) => setMode(value as ModeSelection)}
              className="grid gap-3 sm:grid-cols-2"
              aria-label="Hallucination check mode"
            >
              <Label
                htmlFor="mode-open"
                className="flex cursor-pointer flex-col gap-1.5 rounded-lg border p-4 transition-colors hover:bg-muted/60 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
              >
                <span className="flex items-center gap-2">
                  <RadioGroupItem id="mode-open" value="open" />
                  <span className="text-sm font-medium">Open-domain check</span>
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  GLM fact-checks claims from its own knowledge.
                </span>
              </Label>
              <Label
                htmlFor="mode-grounded"
                className="flex cursor-pointer flex-col gap-1.5 rounded-lg border p-4 transition-colors hover:bg-muted/60 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
              >
                <span className="flex items-center gap-2">
                  <RadioGroupItem id="mode-grounded" value="grounded" />
                  <span className="text-sm font-medium">
                    Source-grounded check
                  </span>
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  Verify strictly against your own document.
                </span>
              </Label>
            </RadioGroup>
          </div>

          {/* Question + Ask GLM */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="hallucination-question">
              Question asked to the AI (optional)
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="hallucination-question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. What causes the seasons on Earth?"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0 sm:h-10"
                onClick={handleAskGlm}
                disabled={!question.trim() || generating || checking}
                aria-label="Ask GLM to generate an answer for this question"
              >
                {generating ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Bot aria-hidden="true" />
                )}
                {generating ? "Asking…" : "Ask GLM"}
              </Button>
            </div>
          </div>

          {/* AI response to check */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="hallucination-text">AI response to check</Label>
            <Textarea
              id="hallucination-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the AI answer you want verified…"
              className="min-h-[160px] resize-y"
            />
          </div>

          {/* Source document (grounded mode only) */}
          {isGrounded ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="hallucination-source">Source document</Label>
              <Textarea
                id="hallucination-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="Paste the reference document claims will be checked against…"
                className="min-h-[120px] resize-y"
              />
            </div>
          ) : null}

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <Button
            type="button"
            onClick={handleCheck}
            disabled={!text.trim() || checking}
            className="h-11 w-full sm:h-10 sm:w-auto"
            aria-label="Check the response for hallucinations"
          >
            {checking ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <ShieldAlert aria-hidden="true" />
            )}
            {checking ? "Checking…" : "Check for hallucinations"}
          </Button>
        </CardContent>
      </Card>

      {/* ------------------------ Results column ------------------------ */}
      <div className="flex flex-col gap-6" aria-live="polite">
        {checking ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            GLM is fact-checking… this can take up to a minute for long texts
            (shorter text is faster; failed calls retry once automatically).
          </p>
        ) : null}

        {result === null && !checking ? (
          <div className="flex min-h-[420px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <ShieldCheck
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
            <p className="text-sm font-medium">No hallucination check yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Paste an AI response (or ask GLM for one) and run a check to see
              claim-by-claim verification results.
            </p>
          </div>
        ) : null}

        {result !== null ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="flex flex-col gap-6"
          >
            {/* Overview */}
            <Card>
              <CardHeader>
                <CardTitle>Overview</CardTitle>
                <CardDescription>
                  Overall hallucination risk for this response.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <ScoreGauge
                  value={result.hallucinationScore}
                  label="Hallucination"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={RISK_META[result.riskLevel].className}
                    >
                      {RISK_META[result.riskLevel].label}
                    </Badge>
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {result.summary}
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <FlaskConical className="size-3.5" aria-hidden="true" />
                    Checked by GLM · {MODE_META[result.mode]}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Claims */}
            <Card>
              <CardHeader>
                <CardTitle>Claims ({result.claims.length})</CardTitle>
                <CardDescription>
                  Each factual claim is verified individually.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {result.claims.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No checkable factual claims found.
                  </p>
                ) : (
                  <ul
                    className={cn(
                      "max-h-[520px] space-y-3 overflow-y-auto pr-1",
                      SCROLLBAR
                    )}
                  >
                    {result.claims.map((claim, i) => (
                      <li key={i} className="rounded-lg border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Badge
                            variant="outline"
                            className={CLAIM_META[claim.status].className}
                          >
                            {CLAIM_META[claim.status].label}
                          </Badge>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {Math.round(claim.confidence)}%
                          </span>
                        </div>
                        <p className="mt-2 text-sm font-medium leading-snug">
                          {claim.claim}
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {claim.explanation}
                        </p>
                        <div className="mt-3 flex items-center gap-3">
                          <Progress
                            value={Math.min(
                              100,
                              Math.max(0, claim.confidence)
                            )}
                            className={cn("h-1 flex-1", CLAIM_META[claim.status].bar)}
                            aria-label={`Confidence for claim ${i + 1}`}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ) : null}
      </div>
    </div>
  );
}
