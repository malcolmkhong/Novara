"use client";

import * as React from "react";
import { Bookmark, CircleDot, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { ForeshadowView, NovelDetail } from "@/lib/novel/types";

function statusBadge(f: ForeshadowView) {
  if (f.status === "paid") {
    return (
      <Badge className="gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        <CheckCircle2 className="size-3" aria-hidden="true" />
        Paid · ch {f.paidAt ?? "?"}
      </Badge>
    );
  }
  if (f.status === "advanced") {
    return (
      <Badge className="gap-1 bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
        <CircleDot className="size-3" aria-hidden="true" />
        Advanced
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
      <Bookmark className="size-3" aria-hidden="true" />
      Open
    </Badge>
  );
}

/**
 * 伏笔台账 (foreshadowing ledger): every planted loop with its status —
 * the long-range consistency backbone from webnovel-writer.
 */
export function ForeshadowViewPanel({ novel }: { novel: NovelDetail }) {
  if (novel.foreshadows.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bookmark className="size-4 text-amber-500" aria-hidden="true" />
            伏笔台账 · Foreshadowing ledger
          </CardTitle>
          <CardDescription>
            No foreshadowing recorded yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Loops appear here automatically when chapters are sedimented: GLM
          registers planted hooks as “Open”, tracks advances, and closes them
          as “Paid” — so chapter 80 still remembers chapter 3.
        </CardContent>
      </Card>
    );
  }

  const open = novel.foreshadows.filter((f) => f.status === "open").length;
  const advanced = novel.foreshadows.filter((f) => f.status === "advanced").length;
  const paid = novel.foreshadows.filter((f) => f.status === "paid").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Bookmark className="size-4 text-amber-500" aria-hidden="true" />
          伏笔台账 · Foreshadowing ledger
          <Badge variant="outline" className="text-xs">
            {open} open
          </Badge>
          <Badge variant="outline" className="text-xs">
            {advanced} advanced
          </Badge>
          <Badge variant="outline" className="text-xs">
            {paid} paid
          </Badge>
        </CardTitle>
        <CardDescription>
          Registered by the sediment step; the writing brief feeds these back
          into every new chapter.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table className="min-w-[560px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[26%]">Loop</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[16%]">Planted</TableHead>
              <TableHead className="w-[14%]">Touched</TableHead>
              <TableHead className="w-[18%]">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {novel.foreshadows.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="align-top font-medium">
                  {f.title}
                </TableCell>
                <TableCell className="align-top text-xs leading-relaxed text-muted-foreground">
                  {f.description}
                </TableCell>
                <TableCell className="align-top text-xs">
                  Chapter {f.plantedAt}
                </TableCell>
                <TableCell className="align-top text-xs">
                  {f.lastTouched ? `Chapter ${f.lastTouched}` : "—"}
                </TableCell>
                <TableCell className="align-top">{statusBadge(f)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
