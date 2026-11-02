"use client";

// ---------------------------------------------------------------------------
// Memory tab (Phase 4 preview) — story memory + doctor health check.
//
// Honest placeholder: the shapes below are the designed contracts
// (MemoryItem, DoctorCheck) populated with static mock data. No persistence,
// no scans — the real engine lands in Phase 4.
// ---------------------------------------------------------------------------

import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Info,
  Stethoscope,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  DoctorCheck,
  MemoryCategory,
  MemoryItem,
} from "@/lib/novara/agent-types";
import type { NovelMeta } from "@/lib/novara/types";

const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  world_rule: "World rule",
  character_state: "Character state",
  relationship: "Relationship",
  story_fact: "Story fact",
  open_loop: "Open loop",
};

// Static mock — one item per category, all anchored to chapter 1.
const MOCK_MEMORY: readonly MemoryItem[] = [
  {
    id: "mem-world-1",
    category: "world_rule",
    content:
      "The ledger records lifespan trades in exact years and never lies.",
    sourceChapter: 1,
    firstSeen: "2025-01-06T09:15:00.000Z",
    lastSeen: "2025-01-06T09:15:00.000Z",
  },
  {
    id: "mem-character-1",
    category: "character_state",
    content: "Mara knows the register accepts years as payment.",
    sourceChapter: 1,
    firstSeen: "2025-01-06T09:15:00.000Z",
    lastSeen: "2025-01-06T09:15:00.000Z",
  },
  {
    id: "mem-relationship-1",
    category: "relationship",
    content: "Mara owes the unhurried customer a favor — origin unknown.",
    sourceChapter: 1,
    firstSeen: "2025-01-06T09:15:00.000Z",
    lastSeen: "2025-01-06T09:15:00.000Z",
  },
  {
    id: "mem-fact-1",
    category: "story_fact",
    content: "The store's door chimes before every trade.",
    sourceChapter: 1,
    firstSeen: "2025-01-06T09:15:00.000Z",
    lastSeen: "2025-01-06T09:15:00.000Z",
  },
  {
    id: "mem-loop-1",
    category: "open_loop",
    content: "Who audited the ledger before Mara took the night shift?",
    sourceChapter: 1,
    firstSeen: "2025-01-06T09:15:00.000Z",
    lastSeen: "2025-01-06T09:15:00.000Z",
  },
];

const MOCK_CHECKS: readonly DoctorCheck[] = [
  {
    id: "check-bible-integrity",
    name: "Bible integrity",
    status: "pass",
    detail: "All entries reference valid chapters.",
  },
  {
    id: "check-timeline-order",
    name: "Timeline order",
    status: "warn",
    detail: "1 beat has no time anchor.",
  },
  {
    id: "check-foreshadow-ledger",
    name: "Foreshadow ledger",
    status: "fail",
    detail: "1 promise is past its pay-by chapter (mock).",
  },
];

const CHECK_META: Record<
  DoctorCheck["status"],
  { icon: LucideIcon; className: string }
> = {
  pass: { icon: CheckCircle2, className: "text-emerald-600" },
  warn: { icon: AlertTriangle, className: "text-amber-600" },
  fail: { icon: XCircle, className: "text-rose-600" },
};

export function MemoryPanel({ novel }: { novel: NovelMeta }) {
  return (
    <div className="space-y-4">
      {/* Phase honesty banner */}
      <div
        role="note"
        className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          Story memory and the doctor health check are Phase 4 features. The
          shapes below are the designed contracts, populated with static mock
          data.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Story memory */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <CardTitle className="font-display text-base">
                Story memory
              </CardTitle>
              <Badge
                variant="outline"
                className="ml-auto text-[11px] text-muted-foreground"
              >
                Phase 4
              </Badge>
            </div>
            <CardDescription>
              Static preview for “{novel.title}” — nothing is extracted or
              stored yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul>
              {MOCK_MEMORY.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-2 border-b py-2 last:border-0"
                >
                  <Badge
                    variant="outline"
                    className="mt-0.5 shrink-0 text-[11px] text-muted-foreground"
                  >
                    {MEMORY_CATEGORY_LABELS[item.category]}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm">{item.content}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      since ch. {item.sourceChapter}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Doctor checks */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Stethoscope
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <CardTitle className="font-display text-base">
                Doctor checks
              </CardTitle>
              <Badge
                variant="outline"
                className="ml-auto text-[11px] text-muted-foreground"
              >
                Phase 4
              </Badge>
            </div>
            <CardDescription>Three designed checks, mock results.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul>
              {MOCK_CHECKS.map((check) => {
                const meta = CHECK_META[check.status];
                const Icon = meta.icon;
                return (
                  <li
                    key={check.id}
                    className="flex items-start gap-2 border-b py-2 last:border-0"
                  >
                    <Icon
                      className={`mt-0.5 h-4 w-4 shrink-0 ${meta.className}`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{check.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {check.detail}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="pt-2 text-xs text-muted-foreground">
              Doctor scans run on demand once Phase 4 lands.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
