"use client";

import { ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentRunMode } from "@/lib/novara/agent-types";
import { cn } from "@/lib/utils";

const MODE_HINT: Record<AgentRunMode, string> = {
  approval: "The team pauses at settle gates and waits for you.",
  full_access:
    "The team runs through gates automatically — irreversible actions still stop for you.",
};

const SELECTED_CLASS = "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground";
const UNSELECTED_CLASS = "text-muted-foreground hover:bg-accent hover:text-foreground";

export function ModeSwitch({
  mode,
  onChange,
  disabled = false,
}: {
  mode: AgentRunMode;
  onChange: (mode: AgentRunMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex flex-col gap-1.5">
      <div
        role="group"
        aria-label="Run mode"
        className="inline-flex gap-1 rounded-lg border p-1"
      >
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-pressed={mode === "approval"}
          disabled={disabled}
          onClick={() => onChange("approval")}
          className={cn(mode === "approval" ? SELECTED_CLASS : UNSELECTED_CLASS)}
        >
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Approval
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-pressed={mode === "full_access"}
          disabled={disabled}
          onClick={() => onChange("full_access")}
          className={cn(mode === "full_access" ? SELECTED_CLASS : UNSELECTED_CLASS)}
        >
          <Zap className="h-3.5 w-3.5" aria-hidden="true" />
          Full access
        </Button>
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">{MODE_HINT[mode]}</p>
    </div>
  );
}
