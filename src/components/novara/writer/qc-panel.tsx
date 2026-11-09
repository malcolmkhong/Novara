"use client";

// ---------------------------------------------------------------------------
// QC tab (Phase 6) — behavioral eval console.
//
// Runs the deterministic fixture probes (tool protocol tolerance, write gate,
// E2 gates, revision budget, digital audit, line protocols, word counting)
// against the exact functions the runtime uses. Zero AI calls, zero DB
// writes — safe to re-run anytime. Also documents the live QC budgets.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { runQcEvals, type QcEvalReport } from "@/lib/novara/api";
import { cn } from "@/lib/utils";

const GROUP_LABELS: Record<string, string> = {
  "protocol-tolerance": "Tool protocol tolerance",
  "write-gate": "Anti-overwrite gate",
  "e2-gate": "E2 gates (finalize / settle)",
  "revision-loop": "Revision loop budget",
  "digital-audit": "Run-report digital audit",
  "line-protocols": "Line protocols & memory feed",
  words: "Word counting",
};

export function QcPanel() {
  const [report, setReport] = useState<QcEvalReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await runQcEvals();
      setReport(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setRunning(false);
    }
  };

  const groups =
    report
      ? [...new Set(report.checks.map((c) => c.group))].map((group) => ({
          group,
          checks: report.checks.filter((c) => c.group === group),
        }))
      : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-base">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Behavioral QC evals
          </CardTitle>
          <CardDescription>
            Fixture probes over the exact gate code the team runtime executes —
            protocol tolerance, write gate, E2 gates, revision budget, digital
            audit. No AI calls, no writes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleRun} disabled={running}>
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              )}
              {running ? "Running probes…" : report ? "Re-run evals" : "Run evals"}
            </Button>
            {report && (
              <>
                <Badge
                  variant="outline"
                  className={cn(
                    report.failed === 0
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-rose-300 bg-rose-50 text-rose-800"
                  )}
                >
                  {report.passed}/{report.checks.length} passed
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {report.totalMs} ms · budget: {report.budgets.revisionRounds} repair
                  round(s)/chapter · ai retries {report.budgets.aiRetries} · concurrency{" "}
                  {report.budgets.maxConcurrent}
                </span>
              </>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
            >
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {groups.map(({ group, checks }) => {
        const allPass = checks.every((c) => c.pass);
        return (
          <Card key={group}>
            <CardHeader className="py-3">
              <CardTitle className="flex items-center justify-between gap-2 text-sm font-medium">
                <span>{GROUP_LABELS[group] ?? group}</span>
                <Badge
                  variant="outline"
                  className={cn(
                    allPass
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-rose-300 bg-rose-50 text-rose-800"
                  )}
                >
                  {checks.filter((c) => c.pass).length}/{checks.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="space-y-1.5">
                {checks.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-start gap-2 text-sm"
                    title={`expected ${c.expected} · got ${c.actual}`}
                  >
                    {c.pass ? (
                      <CheckCircle2
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600"
                        aria-hidden="true"
                      />
                    ) : (
                      <XCircle
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600"
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      {c.name}
                      {!c.pass && (
                        <span className="mt-0.5 block text-xs text-rose-700">
                          expected {c.expected} — got {c.actual}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {c.ms} ms
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
