"use client";

import { ArrowRight, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AI_TEAM } from "@/config/novara";

// Honest roster: the full agent runtime is on the roadmap (Phase 3-5).
// Today, the Novel Writer agent exists as the experimental AI Draft action
// in the chapter editor — everything else is a designed contract.
export function AiTeamPanel() {
  return (
    <div className="space-y-6">
      <div className="flex gap-3 rounded-lg border bg-amber-50/60 p-4 text-sm text-amber-950">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          The roster below is the designed AI Team. In this preview build, the
          team&apos;s work happens with you in the loop: use the experimental{" "}
          <strong>AI Draft</strong> action in the chapter editor to draft with
          the Novel Writer agent. Full autonomous orchestration arrives with
          the agent runtime (roadmap Phase 3-5).{" "}
          <a
            href="#/about"
            className="font-medium underline underline-offset-2"
          >
            About the roadmap
          </a>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AI_TEAM.map((agent) => (
          <Card key={agent.name}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-primary">
                  <agent.icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <Badge
                  variant="outline"
                  className="text-[11px] text-muted-foreground"
                >
                  {agent.role}
                </Badge>
              </div>
              <h3 className="mt-3 font-display font-semibold">{agent.name}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {agent.description}
              </p>
              <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-primary">
                Delivers
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
                <span className="text-foreground">{agent.delivers}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="text-center">
        <Button variant="outline" asChild>
          <a href="#/product">See how the team collaborates</a>
        </Button>
      </div>
    </div>
  );
}
