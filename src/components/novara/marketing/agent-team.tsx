"use client";

// ---------------------------------------------------------------------------
// The AI Team.
//
// Five specialists, one shared story bible. Each card carries a small live
// console showing what that agent is doing right now — Atlas dispatching
// work, Sage drafting, Nova reading canon, Prism flagging a contradiction,
// Forge filing the exports.
//
// A static description tells the visitor what an agent is for. A live one
// tells them what it feels like to work with.
// ---------------------------------------------------------------------------

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AI_TEAM } from "@/config/novara";
import { cn } from "@/lib/utils";
import { EASE_OUT_EXPO } from "./motion";
import { Spinner } from "@/components/novara/primitives";
import { TEXT_PROSE, TEXT_LABEL, TEXT_HEADING } from "@/components/novara/styles";

const ATLAS_TASKS = [
  "Decompose premise into acts",
  "Delegate world-building",
  "Verify outline coverage",
];

const SAGE_PROSE =
  "The rain had not stopped for nine days. Lyra counted the lanterns along the quay.";

const NOVA_QUERY = "Sera — eye colour?";
const NOVA_RESULT = "steel grey · set in Ch. 2";

const PRISM_FLAG = "Ch. 12: eye colour drift (amber → grey)";

const FORGE_EXPORTS = ["Manuscript.md", "Story-bible.json", "Outline.csv"];

// ---------------------------------------------------------------------------
// Activity consoles.
// ---------------------------------------------------------------------------

function AtlasConsole({ step }: { step: number }) {
  return (
    <ul className="space-y-1.5">
      {ATLAS_TASKS.map((task, index) => {
        const done = index < step;
        const running = index === step;
        return (
          <li key={task} className="flex items-center gap-2 font-mono text-caption">
            {done ? (
              <Check className="size-3 shrink-0 text-emerald-500" aria-hidden="true" />
            ) : running ? (
              <Spinner size="sm" className="shrink-0 text-primary" />
            ) : (
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-full border border-border"
              />
            )}
            <span className={cn(done ? "text-muted-foreground line-through" : "text-foreground")}>
              {task}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// Remounted by the caller on every run (key={step}), so each pass starts
// from an empty string and the effect below only ever writes from a timer
// callback.
function SageConsole() {
  const reduce = useReducedMotion();
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (reduce) return;
    let index = 0;
    const id = window.setInterval(() => {
      index += 1;
      setTyped(SAGE_PROSE.slice(0, index));
      if (index >= SAGE_PROSE.length) window.clearInterval(id);
    }, 22);
    return () => window.clearInterval(id);
  }, [reduce]);

  const shown = reduce ? SAGE_PROSE : typed;

  return (
    <p className="font-mono text-caption leading-relaxed text-muted-foreground">
      {shown}
      <span
        aria-hidden="true"
        className="ml-0.5 inline-block h-3 w-[6px] translate-y-[2px] bg-primary animate-caret"
      />
    </p>
  );
}

function NovaConsole({ step }: { step: number }) {
  const found = step % 2 === 1;
  return (
    <div className="space-y-1.5 font-mono text-caption">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Spinner
          size="sm"
          spin={found}
          className={cn("shrink-0 text-primary", !found && "opacity-40")}
        />
        <span>searching story bible</span>
      </div>
      <div className="truncate text-foreground">&gt; {NOVA_QUERY}</div>
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: found ? 1 : 0, y: 0 }}
        transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
        className="truncate text-emerald-600 dark:text-emerald-400"
      >
        &rarr; {NOVA_RESULT}
      </motion.div>
    </div>
  );
}

function PrismConsole({ step }: { step: number }) {
  const flagged = step % 2 === 1;
  return (
    <div className="space-y-1.5 font-mono text-caption">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            flagged ? "bg-amber-500" : "bg-muted-foreground/40",
          )}
        />
        <span>continuity sweep</span>
      </div>
      <motion.div
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: flagged ? 1 : 0, x: 0 }}
        transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
        className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-300"
      >
        {PRISM_FLAG}
      </motion.div>
    </div>
  );
}

function ForgeConsole({ step }: { step: number }) {
  return (
    <ul className="space-y-1.5 font-mono text-caption">
      {FORGE_EXPORTS.map((file, index) => {
        const done = index < step;
        const running = index === step;
        return (
          <li key={file} className="flex items-center gap-2">
            {done ? (
              <Check className="size-3 shrink-0 text-emerald-500" aria-hidden="true" />
            ) : running ? (
              <Spinner size="sm" className="shrink-0 text-primary" />
            ) : (
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-full border border-border"
              />
            )}
            <span className={cn(done ? "text-muted-foreground" : "text-foreground")}>{file}</span>
          </li>
        );
      })}
    </ul>
  );
}

const CONSOLE_HEADERS: Record<string, string> = {
  Atlas: "Dispatching work",
  Sage: "Drafting prose",
  Nova: "Searching canon",
  Prism: "Reviewing continuity",
  Forge: "Filing exports",
};

function ActivityConsole({ agent }: { agent: string }) {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 2600);
    return () => window.clearInterval(id);
  }, [reduce]);

  const step = agent === "Sage" ? tick % 2 : tick % 4;

  return (
    <div className="mt-auto rounded-lg border bg-muted/40 p-3">
      <div className="mb-2 flex items-center gap-2 text-tiny font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <span aria-hidden="true" className="relative flex size-1.5">
          <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-primary" />
          <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
        </span>
        {CONSOLE_HEADERS[agent] ?? "Working"}
      </div>
      {agent === "Atlas" && <AtlasConsole step={step} />}
      {agent === "Sage" && <SageConsole key={step} />}
      {agent === "Nova" && <NovaConsole step={step} />}
      {agent === "Prism" && <PrismConsole step={step} />}
      {agent === "Forge" && <ForgeConsole step={step} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The team grid.
// ---------------------------------------------------------------------------

export function AgentTeam() {
  return (
    <div className="mt-10 grid gap-5 sm:mt-12 lg:grid-cols-3">
      {AI_TEAM.map((agent, index) => {
        const Icon = agent.icon;
        // Atlas leads the team, so it gets the wide card. That also removes
        // the ragged 3 + 2 row the five-agent grid used to leave.
        const wide = index === 0;

        return (
          <motion.div
            key={agent.name}
            initial={{ opacity: 0, y: 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{
              duration: 0.7,
              delay: Math.min(index, 4) * 0.08,
              ease: EASE_OUT_EXPO,
            }}
            className={cn(wide && "lg:col-span-2")}
          >
            <Card className="group pointer-sheen h-full overflow-hidden transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5">
              <CardContent
                className={cn(
                  "flex h-full flex-col gap-3",
                  wide && "lg:flex-row lg:items-start lg:gap-8",
                )}
              >
                <div className={cn("flex flex-col gap-3", wide && "lg:flex-1")}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <Badge
                      variant="outline"
                      className="text-tiny uppercase tracking-wide text-muted-foreground"
                    >
                      {agent.role}
                    </Badge>
                  </div>
                  <h3 className={TEXT_HEADING}>{agent.name}</h3>
                  <p className={TEXT_PROSE}>
                    {agent.description}
                  </p>
                  <p className={cn(TEXT_LABEL, "text-primary")}>
                    Delivers: {agent.delivers}
                  </p>
                </div>

                <div className={cn("lg:w-72 lg:shrink-0", wide && "lg:self-end")}>
                  <ActivityConsole agent={agent.name} />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}