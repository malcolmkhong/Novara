"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  Bot,
  Eraser,
  Info,
  Loader2,
  ScanSearch,
  Sparkles,
  User,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import { postJSON } from "./api";
import { ScoreGauge, scoreTint } from "./score-gauge";
import type {
  AIDetectResponse,
  AIDetectSuccess,
  AIVerdict,
  GenerateResponse,
  Severity,
} from "./types";

/* ------------------------------------------------------------------ */
/* Static built-in samples (~130 words each)                           */
/* ------------------------------------------------------------------ */

const AI_SAMPLE =
  "In today's rapidly evolving digital landscape, it is important to note that technology plays a crucial role in shaping our daily lives. Moreover, organizations must adapt to changing circumstances in order to remain competitive. Furthermore, the integration of artificial intelligence has revolutionized various industries, offering unprecedented opportunities for growth. It is essential to consider the multifaceted implications of these advancements. In conclusion, a comprehensive approach is necessary to navigate this complex terrain. Additionally, stakeholders should leverage cutting-edge solutions to drive innovation. It's worth mentioning that collaboration remains key to success. Moreover, by fostering a culture of continuous improvement, businesses can unlock their full potential and achieve sustainable, long-term results. Ultimately, embracing change is not merely an option but a strategic imperative for organizations worldwide.";

const HUMAN_SAMPLE =
  "ok so honestly i have no idea how this happened lol. woke up at like 6:40am?? couldn't sleep again. the neighbors dog started barking around 5 and that was... that. anyway made coffee, burnt the toast AGAIN (third time this week, i need a new toaster fr). my sister called mid-breakfast talking about some drama at work and i just nodded along, wasn't really listening tbh. whatever. kinda dreading tonight's meeting but also?? free pizza. so yk, silver linings i guess. gonna finish this coffee, maybe go for a walk if it stops raining. probs won't tho. oh and i finally booked that dentist thing. only took me four months lol. small wins.";

/* ------------------------------------------------------------------ */
/* Display mappings                                                    */
/* ------------------------------------------------------------------ */

const VERDICT_META: Record<
  AIVerdict,
  { label: string; className: string }
> = {
  ai: {
    label: "Likely AI-generated",
    className:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  },
  human: {
    label: "Likely human",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  },
  mixed: {
    label: "Mixed signals",
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  },
  uncertain: {
    label: "Uncertain",
    className:
      "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
  },
};

const SEVERITY_META: Record<Severity, { label: string; dot: string; badge: string }> = {
  high: {
    label: "High",
    dot: "bg-red-500",
    badge:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  },
  medium: {
    label: "Medium",
    dot: "bg-amber-500",
    badge:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  },
  low: {
    label: "Low",
    dot: "bg-emerald-500",
    badge:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  },
  info: {
    label: "Info",
    dot: "bg-zinc-400",
    badge:
      "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
  },
};

/* Tailwind arbitrary-variant scrollbar styling (no global CSS needed). */
const SCROLLBAR =
  "[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 dark:[&::-webkit-scrollbar-thumb]:bg-zinc-700";

const toPercent = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n <= 1 ? n * 100 : Math.min(n, 100));
};

/* ------------------------------------------------------------------ */

export function AiDetectorPanel() {
  const { toast } = useToast();

  const [text, setText] = React.useState("");
  const [topic, setTopic] = React.useState("");
  const [analyzing, setAnalyzing] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [result, setResult] = React.useState<AIDetectSuccess | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const words = React.useMemo(
    () => text.trim().split(/\s+/).filter(Boolean).length,
    [text]
  );

  const handleAnalyze = async (): Promise<void> => {
    if (!text.trim() || analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const data = await postJSON<AIDetectResponse>("/api/detect/ai", { text });
      if (!data.success) {
        throw new Error(data.error || "Detection failed.");
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
      setAnalyzing(false);
    }
  };

  const handleGenerate = async (): Promise<void> => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const data = await postJSON<GenerateResponse>("/api/generate", {
        mode: "ai-essay",
        topic: topic.trim() || undefined,
      });
      if (!data.success) {
        throw new Error(data.error || "Generation failed.");
      }
      setText(data.text);
      toast({
        title: "Generated with GLM",
        description: "A fresh AI-style sample was placed in the editor.",
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

  const heuristicMismatch =
    result !== null && Math.abs(result.aiScore - result.glmScore) >= 25;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ------------------------- Input column ------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Text to analyze</CardTitle>
          <CardDescription>
            Paste any text — GLM scores how likely it is AI-generated.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-text">Text</Label>
            <Textarea
              id="ai-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste or generate a sample to analyze…"
              className="min-h-[220px] resize-y font-normal"
              aria-describedby="ai-text-counts"
            />
            <p id="ai-text-counts" className="text-xs text-muted-foreground">
              {words} {words === 1 ? "word" : "words"} · {text.length}{" "}
              characters
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={() => setText("")}
              disabled={!text || analyzing}
              aria-label="Clear the text editor"
            >
              <Eraser aria-hidden="true" />
              Clear
            </Button>
            <span
              className="mx-1 hidden h-4 w-px bg-border sm:block"
              aria-hidden="true"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => setText(AI_SAMPLE)}
              disabled={analyzing}
            >
              <Bot aria-hidden="true" />
              AI sample
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => setText(HUMAN_SAMPLE)}
              disabled={analyzing}
            >
              <User aria-hidden="true" />
              Human sample
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-topic">Topic (optional)</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="ai-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Topic (optional)"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0 sm:h-10"
                onClick={handleGenerate}
                disabled={generating || analyzing}
              >
                {generating ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles aria-hidden="true" />
                )}
                {generating ? "Generating…" : "Generate with GLM"}
              </Button>
            </div>
          </div>

          {error ? (
            <Alert variant="destructive">
              <Info aria-hidden="true" />
              <AlertTitle>Analysis failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="button"
            onClick={handleAnalyze}
            disabled={!text.trim() || analyzing}
            className="h-11 w-full sm:h-10 sm:w-auto"
            aria-label="Analyze the text for AI-generated content"
          >
            {analyzing ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <ScanSearch aria-hidden="true" />
            )}
            {analyzing ? "Analyzing…" : "Analyze"}
          </Button>
        </CardContent>
      </Card>

      {/* ------------------------ Results column ------------------------ */}
      <div className="flex flex-col gap-6" aria-live="polite">
        {analyzing ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            GLM is analyzing… this can take 10–30 seconds.
          </p>
        ) : null}

        {result === null && !analyzing ? (
          <div className="flex min-h-[420px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <ScanSearch className="size-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium">Run an analysis to see results</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              GLM combines heuristic signals with an LLM judgment to estimate
              how likely the text is machine-generated.
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
            {/* Verdict */}
            <Card>
              <CardHeader>
                <CardTitle>Verdict</CardTitle>
                <CardDescription>
                  Overall judgment from GLM with local heuristic support.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <ScoreGauge value={result.aiScore} label="AI-generated" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={VERDICT_META[result.verdict].className}
                    >
                      {VERDICT_META[result.verdict].label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      GLM confidence: {Math.round(result.confidence)}%
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {result.summary}
                  </p>
                </div>
              </CardContent>
              {heuristicMismatch ? (
                <CardContent className="pt-0">
                  <Alert>
                    <Info aria-hidden="true" />
                    <AlertTitle>Heuristic &amp; GLM scores diverge</AlertTitle>
                    <AlertDescription>
                      The blended AI score ({Math.round(result.aiScore)}%)
                      differs notably from GLM&apos;s own assessment (
                      {Math.round(result.glmScore)}%). Heuristics are a rough
                      proxy — treat GLM&apos;s judgment as the primary signal.
                    </AlertDescription>
                  </Alert>
                </CardContent>
              ) : null}
            </Card>

            {/* Signals detected */}
            <Card>
              <CardHeader>
                <CardTitle>Signals detected</CardTitle>
                <CardDescription>
                  Patterns that pushed the score up or down.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {result.signals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No notable signals were reported for this text.
                  </p>
                ) : (
                  <ul
                    className={cn(
                      "flex max-h-96 flex-col gap-1 overflow-y-auto pr-1",
                      SCROLLBAR
                    )}
                  >
                    {result.signals.map((signal, i) => (
                      <li
                        key={`${signal.label}-${i}`}
                        className="flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
                      >
                        <span
                          className={cn(
                            "mt-1.5 size-2 shrink-0 rounded-full",
                            SEVERITY_META[signal.severity].dot
                          )}
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium">{signal.label}</p>
                            <Badge
                              variant="outline"
                              className={cn(
                                "px-1.5 py-0 text-[10px] uppercase tracking-wide",
                                SEVERITY_META[signal.severity].badge
                              )}
                            >
                              {SEVERITY_META[signal.severity].label}
                            </Badge>
                          </div>
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {signal.description}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Sentence-level analysis */}
            <Card>
              <CardHeader>
                <CardTitle>Sentence-level analysis</CardTitle>
                <CardDescription>
                  Per-sentence AI likelihood with GLM notes.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {result.sentences.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No sentence breakdown is available for this text.
                  </p>
                ) : (
                  <ul
                    className={cn(
                      "flex max-h-96 flex-col gap-3 overflow-y-auto pr-1",
                      SCROLLBAR
                    )}
                  >
                    {result.sentences.map((sentence, i) => {
                      const tint = scoreTint(sentence.aiLikelihood, "ai");
                      return (
                        <li
                          key={i}
                          className={cn(
                            "rounded-r-lg border-l-4 bg-muted/40 py-3 pl-4 pr-4",
                            tint.borderL
                          )}
                        >
                          <p className="text-sm leading-relaxed">
                            {sentence.text}
                          </p>
                          <div className="mt-2 flex items-center gap-3">
                            <Progress
                              value={Math.min(100, Math.max(0, sentence.aiLikelihood))}
                              className={cn("h-1 flex-1", tint.bar)}
                              aria-label={`AI likelihood for sentence ${i + 1}`}
                            />
                            <span
                              className={cn(
                                "w-10 text-right text-xs font-semibold tabular-nums",
                                tint.text
                              )}
                            >
                              {Math.round(sentence.aiLikelihood)}%
                            </span>
                          </div>
                          {sentence.note ? (
                            <p className="mt-1.5 text-xs text-muted-foreground">
                              {sentence.note}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Local heuristics */}
            <Card>
              <CardHeader>
                <CardTitle>Local heuristics</CardTitle>
                <CardDescription>
                  Fast statistical checks computed in the browser&apos;s
                  backend — no model call.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <StatTile
                    label="Burstiness"
                    value={result.heuristics.burstiness.toFixed(2)}
                    hint="Sentence rhythm variance"
                  />
                  <StatTile
                    label="Lexical diversity"
                    value={`${toPercent(result.heuristics.lexicalDiversity)}%`}
                    progress={toPercent(result.heuristics.lexicalDiversity)}
                  />
                  <StatTile
                    label="Punctuation diversity"
                    value={`${toPercent(result.heuristics.punctuationDiversity)}%`}
                    progress={toPercent(result.heuristics.punctuationDiversity)}
                  />
                  <StatTile
                    label="Avg sentence length"
                    value={`${result.heuristics.avgSentenceLength.toFixed(1)} words`}
                  />
                  <StatTile
                    label="AI-phrase hits"
                    value={String(result.heuristics.aiPhraseCount)}
                    hint={
                      result.heuristics.aiPhrasesFound.length > 0
                        ? result.heuristics.aiPhrasesFound.join(", ")
                        : "No characteristic AI phrases found"
                    }
                  />
                  <StatTile
                    label="Repetitive starters"
                    value={String(result.heuristics.repetitiveStarters)}
                    hint="Sentences beginning the same way"
                  />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StatTile({
  label,
  value,
  progress,
  hint,
}: {
  label: string;
  value: string;
  progress?: number;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <p className="text-sm font-semibold tabular-nums">{value}</p>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {typeof progress === "number" ? (
        <Progress value={progress} className="h-1" aria-label={`${label}: ${progress}%`} />
      ) : hint ? (
        <p
          className="line-clamp-2 text-[10px] leading-snug text-muted-foreground/80"
          title={hint}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
