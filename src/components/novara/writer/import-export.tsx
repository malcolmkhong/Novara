"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCopy,
  Download,
  FileText,
  FileUp,
  TriangleAlert,
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
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/firebase/client";
import { exportNovelBackup, importNovelBackup } from "@/lib/novara/api";
import type {
  ImportReport,
  NovelBackupFile,
  NovelMeta,
  NovelSummary,
} from "@/lib/novara/types";
import { formatWordCount } from "@/lib/novara/words";
import { Spinner } from "@/components/novara/primitives";
import { cn } from "@/lib/utils";
import { CELL_TILE, TEXT_LABEL, TEXT_LEAD, TEXT_META } from "@/components/novara/styles";

// ---------------------------------------------------------------------------
// Export: fetch the versioned JSON backup, show it, allow download / copy.
// Mounted only while open (parent conditionally renders it), so all state
// resets naturally on unmount.
// ---------------------------------------------------------------------------

export function ExportDialog({
  novel,
  onClose,
}: {
  novel: Pick<NovelMeta, "id" | "title">;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [json, setJson] = useState<string | null>(null);
  const [backupVersion, setBackupVersion] = useState(2);
  const [busy, setBusy] = useState(true);
  const [copied, setCopied] = useState(false);
  const [mdBusy, setMdBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    exportNovelBackup(novel.id)
      .then((backup: NovelBackupFile) => {
        if (!cancelled) {
          setBackupVersion(backup.version);
          setJson(JSON.stringify(backup, null, 2));
        }
      })
      .catch((e: Error) => {
        if (!cancelled)
          toast({
            title: "Export failed",
            description: e.message,
            variant: "destructive",
          });
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [novel.id, toast]);

  const download = () => {
    if (!json) return;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `novara-${novel.title.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "novel"}-v${backupVersion}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // Markdown manuscript: fetch the rendered file from the server as a blob.
  const downloadMarkdown = async () => {
    setMdBusy(true);
    try {
      // authFetch attaches the Firebase ID token — a raw fetch here would be
      // rejected by the middleware with 401.
      const res = await authFetch(`/api/novels/${novel.id}/export/markdown`);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${novel.title.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "novel"}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({
        title: "Markdown export failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setMdBusy(false);
    }
  };

  const copy = async () => {
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
    } catch {
      toast({
        title: "Copy failed",
        description: "Select the text manually and copy it.",
      });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export “{novel.title}”</DialogTitle>
          <DialogDescription>
            A portable, versioned JSON backup: novel, chapters (with briefs
            and draft history), characters, worldbuilding, outline — plus the
            memory layer (facts, states, foreshadows, digests). Re-import any
            time; v1 backups stay importable.
          </DialogDescription>
        </DialogHeader>

        {busy ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Spinner size="lg" />
            Preparing backup…
          </div>
        ) : json ? (
          <textarea
            readOnly
            value={json}
            rows={10}
            onFocus={(e) => e.currentTarget.select()}
            className="nice-scroll w-full rounded-md border bg-muted/40 p-3 font-mono text-xs leading-5"
            aria-label="Backup JSON"
          />
        ) : null}

        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="outline" onClick={copy} disabled={!json}>
            <ClipboardCopy className="size-4" aria-hidden="true" />
            {copied ? "Copied" : "Copy JSON"}
          </Button>
          <Button
            variant="outline"
            onClick={downloadMarkdown}
            disabled={mdBusy}
          >
            {mdBusy ? (
              <Spinner size="lg" />
            ) : (
              <FileText className="size-4" aria-hidden="true" />
            )}
            Markdown
          </Button>
          <Button onClick={download} disabled={!json}>
            <Download className="size-4" aria-hidden="true" />
            Download file
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Import: choose file or paste JSON → validate on server → integrity report.
// Mounted only while open; state resets naturally on unmount.
// ---------------------------------------------------------------------------

export function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (novelId: string) => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    novel: NovelSummary;
    report: ImportReport;
  } | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      setRaw(text);
      setError(null);
    } catch {
      setError("Could not read the selected file.");
    }
  };

  const doImport = async () => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setError("That is not valid JSON. Paste a Novara backup file or choose a file.");
      return;
    }
    setBusy(true);
    try {
      const res = await importNovelBackup(parsed);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        {!result ? (
          <>
            <DialogHeader>
              <DialogTitle>Import a novel backup</DialogTitle>
              <DialogDescription>
                Import a Novara JSON backup (format “novara-novel-backup”).
                It will be added as a new novel — nothing is overwritten.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground transition-colors hover:bg-accent"
              >
                <FileUp className="size-6 text-primary" aria-hidden="true" />
                Choose a .json backup file
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                aria-label="Choose backup file"
                onChange={(e) => onFile(e.target.files?.[0])}
              />

              <div className="space-y-2">
                <label
                  htmlFor="import-json"
                  className={TEXT_LABEL}
                >
                  …or paste the backup JSON
                </label>
                <textarea
                  id="import-json"
                  value={raw}
                  onChange={(e) => setRaw(e.target.value)}
                  rows={6}
                  placeholder='{ "format": "novara-novel-backup", "version": 1, … }'
                  className="nice-scroll w-full rounded-md border bg-muted/40 p-3 font-mono text-xs leading-5"
                />
              </div>

              {error && (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button onClick={doImport} disabled={busy || !raw.trim()}>
                {busy && <Spinner size="lg" />}
                {busy ? "Importing…" : "Import novel"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Import complete</DialogTitle>
              <DialogDescription>
                “{result.report.title}” was imported. Integrity was verified
                against the database, not the file&apos;s claims.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div
                className={`flex items-center gap-2 rounded-md border p-3 text-sm ${
                  result.report.integrityOk
                    ? "border-success-border bg-success-surface text-success-text-deep"
                    : "border-warning-border-strong bg-warning-surface text-warning-text-deep"
                }`}
              >
                {result.report.integrityOk ? (
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                ) : (
                  <TriangleAlert className="size-4" aria-hidden="true" />
                )}
                {result.report.integrityOk
                  ? "Integrity check passed — all declared counts match."
                  : "Integrity check found differences (see below)."}
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div className={CELL_TILE}>
                  <dt className={TEXT_META}>Chapters</dt>
                  <dd className={TEXT_LEAD}>
                    {result.report.counts.chapters}
                  </dd>
                </div>
                <div className={CELL_TILE}>
                  <dt className={TEXT_META}>Characters</dt>
                  <dd className={TEXT_LEAD}>
                    {result.report.counts.characters}
                  </dd>
                </div>
                <div className={CELL_TILE}>
                  <dt className={TEXT_META}>World entries</dt>
                  <dd className={TEXT_LEAD}>
                    {result.report.counts.worldEntries}
                  </dd>
                </div>
                <div className={CELL_TILE}>
                  <dt className={TEXT_META}>Outline beats</dt>
                  <dd className={TEXT_LEAD}>
                    {result.report.counts.outlineBeats}
                  </dd>
                </div>
                <div className={CELL_TILE}>
                  <dt className={TEXT_META}>Total words</dt>
                  <dd className={TEXT_LEAD}>
                    {formatWordCount(result.report.totalWords)}
                  </dd>
                </div>
              </dl>

              {result.report.warnings.length > 0 && (
                <ul className={cn("space-y-1.5 rounded-md border bg-muted/40 p-3", TEXT_META)}>
                  {result.report.warnings.map((w) => (
                    <li key={w} className="flex gap-2">
                      <TriangleAlert
                        className="mt-0.5 size-3.5 shrink-0 text-warning-text"
                        aria-hidden="true"
                      />
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <DialogFooter className="flex-row gap-2 sm:justify-end">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button onClick={() => onImported(result.novel.id)}>
                Open novel
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
