"use client";

// ---------------------------------------------------------------------------
// Novara AI — ModelPicker (P2).
//
// The composer's model control: a dropdown listing the model registry and,
// for the SELECTED model, its available thinking levels. Registry-driven —
// adding a model to src/lib/novara/models.ts makes it appear here with zero
// UI changes. Selection is persisted per novel by the caller (writer store).
// ---------------------------------------------------------------------------

import { Check, ChevronDown, CircleOff } from "lucide-react";
import { CHEVRON_ICON } from "./ui-bits";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getModelDefinition,
  formatTokenCount,
  MODEL_REGISTRY,
  THINKING_LEVEL_META,
  type ModelSelection,
} from "@/lib/novara/models";
import { cn } from "@/lib/utils";
import { TEXT_CAPTION, TEXT_MICRO, TEXT_LABEL } from "@/components/novara/styles";

export function ModelPicker({
  selection,
  onChange,
}: {
  selection: ModelSelection;
  onChange: (next: ModelSelection) => void;
}) {
  const selected = getModelDefinition(selection.modelId);
  const levelMeta = THINKING_LEVEL_META[selection.thinkingLevel] ?? THINKING_LEVEL_META.off;
  const showThinkingSuffix = selection.thinkingLevel !== "off";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-full px-2.5 text-caption font-medium"
          aria-label={`Model: ${selected.label}${showThinkingSuffix ? `, thinking ${levelMeta.label}` : ""}`}
        >
          {selected.label}
          {showThinkingSuffix && (
            <span className="text-muted-foreground">· {levelMeta.label}</span>
          )}
          <ChevronDown className={CHEVRON_ICON} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className={TEXT_CAPTION}>
          Model
        </DropdownMenuLabel>
        {MODEL_REGISTRY.map((model) => {
          const isSelected = model.id === selected.id;
          return (
            <DropdownMenuItem
              key={model.id}
              disabled={!model.available}
              className="items-start gap-2 py-2"
              onSelect={() =>
                onChange({
                  modelId: model.id,
                  thinkingLevel: model.defaultThinkingLevel,
                })
              }
            >
              {model.available ? (
                <Check
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    isSelected ? "opacity-100" : "opacity-0"
                  )}
                  aria-hidden="true"
                />
              ) : (
                <CircleOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={TEXT_LABEL}>{model.label}</span>
                  <span className={TEXT_MICRO}>
                    {model.vendor} · {formatTokenCount(model.contextWindow)} ctx
                  </span>
                </span>
                <span className="block text-caption leading-4 text-muted-foreground">
                  {model.note}
                  {!model.available && " — coming soon."}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className={TEXT_CAPTION}>
          Thinking level — {selected.label}
        </DropdownMenuLabel>
        {selected.thinkingLevels.map((level) => {
          const meta = THINKING_LEVEL_META[level];
          const isSelected = level === selection.thinkingLevel;
          return (
            <DropdownMenuItem
              key={level}
              className="items-start gap-2 py-2"
              onSelect={() => onChange({ modelId: selected.id, thinkingLevel: level })}
            >
              <Check
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  isSelected ? "opacity-100" : "opacity-0"
                )}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className={cn("block", TEXT_LABEL)}>{meta.label}</span>
                <span className="block text-caption leading-4 text-muted-foreground">
                  {meta.hint}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-caption leading-4 text-muted-foreground">
          Preference is saved for this novel.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
