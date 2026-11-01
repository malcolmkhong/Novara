"use client";

import * as React from "react";
import { CheckCircle2, ListTree, Loader2, RefreshCw } from "lucide-react";

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

import { postJSON } from "./api";
import type { NovelDetail, VolumeBeat, VolumeView } from "@/lib/novel/types";

interface PlanResponse {
  success: boolean;
  volume: VolumeView;
}

const PHASE_ORDER = [
  "开局钩子",
  "递进危机一",
  "递进危机二",
  "递进危机三",
  "中段反转",
  "卷末高潮",
  "跨卷新钩子",
] as const;

function phaseBadgeClass(phase: string): string {
  if (phase.includes("高潮")) return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
  if (phase.includes("反转")) return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  if (phase.includes("钩子")) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
  return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

function sortBeats(beats: VolumeBeat[]): VolumeBeat[] {
  return [...beats].sort((a, b) => {
    const ia = PHASE_ORDER.findIndex((p) => a.phase.includes(p));
    const ib = PHASE_ORDER.findIndex((p) => b.phase.includes(p));
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

interface OutlineViewProps {
  novel: NovelDetail;
  onDataChanged: () => void;
}

/**
 * 总纲 (master outline): one card per volume with conflict / climax /
 * cross-volume hook, the beat sheet (卷节拍表) and the plan action that
 * generates beats + per-chapter outlines.
 */
export function OutlineView({ novel, onDataChanged }: OutlineViewProps) {
  const [planningIndex, setPlanningIndex] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const planVolume = async (volumeIndex: number) => {
    setPlanningIndex(volumeIndex);
    setError(null);
    try {
      await postJSON<PlanResponse>(`/api/novel/${novel.id}/plan`, {
        volumeIndex,
      });
      onDataChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to plan the volume.");
    } finally {
      setPlanningIndex(null);
    }
  };

  return (
    <div className="grid gap-4">
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Planning failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {novel.volumes.map((volume) => {
        const chapterCount = volume.endChapter - volume.startChapter + 1;
        const isPlanning = planningIndex === volume.index;
        return (
          <Card key={volume.id}>
            <CardHeader className="pb-3">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-base">
                    <ListTree className="size-4 shrink-0 text-amber-500" aria-hidden="true" />
                    <span className="break-words">
                      Volume {volume.index} · {volume.name}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      Ch {volume.startChapter}–{volume.endChapter}
                    </Badge>
                    {volume.planned ? (
                      <Badge className="gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        <CheckCircle2 className="size-3" aria-hidden="true" />
                        Planned
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Not planned</Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {chapterCount} chapters
                    {volume.planned
                      ? ` · beat sheet + ${chapterCount} chapter outlines`
                      : " · plan to generate beat sheet & chapter outlines"}
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant={volume.planned ? "outline" : "default"}
                  onClick={() => planVolume(volume.index)}
                  disabled={planningIndex !== null}
                  className="gap-1.5"
                >
                  {isPlanning ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                  )}
                  {isPlanning
                    ? "Generating beats & outlines…"
                    : volume.planned
                      ? "Replan"
                      : "Plan this volume"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {(volume.coreConflict || volume.climax || volume.hook) && (
                <div className="grid gap-1.5 rounded-lg border bg-muted/30 p-3">
                  {volume.coreConflict && (
                    <p className="leading-relaxed">
                      <span className="font-medium">卷级冲突: </span>
                      {volume.coreConflict}
                    </p>
                  )}
                  {volume.climax && (
                    <p className="leading-relaxed">
                      <span className="font-medium">卷末高潮: </span>
                      {volume.climax}
                    </p>
                  )}
                  {volume.hook && (
                    <p className="leading-relaxed">
                      <span className="font-medium">跨卷新钩子: </span>
                      {volume.hook}
                    </p>
                  )}
                </div>
              )}

              {volume.beats.length > 0 && (
                <ol className="grid gap-2 sm:grid-cols-2">
                  {sortBeats(volume.beats).map((beat, i) => (
                    <li
                      key={`${beat.phase}-${beat.title}-${i}`}
                      className="rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                          {i + 1}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[11px] ${phaseBadgeClass(beat.phase)}`}
                        >
                          {beat.phase}
                        </Badge>
                      </div>
                      <p className="mt-1.5 font-medium">{beat.title}</p>
                      {beat.description && (
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          {beat.description}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
