"use client";

// ---------------------------------------------------------------------------
// Novara AI — PromptBox: the composer as one unified rounded surface.
//
// P0: single rounded container (input area, pinned chips inside, toolbar with
//     pin menu · model picker · permissions dropdown · voice placeholder ·
//     round primary send).
// P1: typing "@" opens a mention-style context search over the loaded novel
//     tree (chapters, characters, world entries, outline beats, volumes).
// P2: the GLM badge becomes the ModelPicker — registry-driven model list
//     plus per-model thinking levels; the selection rides the next run.
// P3: typing "/" as the first character opens the agent command menu — six
//     goal templates (/next /write /review /outline /recap /doctor) that
//     expand into the draft for review before sending. Templates are pure
//     prompt sugar; the runtime and tool whitelist are untouched.
//
// Both overlays share one token engine: the text from the trigger to the
// caret is the query, keyboard (↑ ↓ ↵ esc) and mouse work identically, and
// selecting an entry rewrites the token in the draft. Focus never leaves the
// textarea.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Loader2,
  Mic,
  Plus,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AgentEvent, AgentRunMode, PinnedRef, PinnedRefType } from "@/lib/novara/agent-types";
import type { ModelSelection } from "@/lib/novara/models";
import type { NovelDetail } from "@/lib/novara/types";
import {
  SLASH_COMMANDS,
  filterSlashCommands,
  type SlashCommand,
} from "./slash-commands";
import { ContextUsageButton } from "./context-usage-panel";
import { ModelPicker } from "./model-picker";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Pin options — flat, grouped menu source built from the loaded NovelDetail.
// ---------------------------------------------------------------------------

export type PinOptionGroup = "Chapters" | "Characters" | "World" | "Outline" | "Volumes";

export interface PinOption {
  type: PinnedRefType;
  id: string;
  label: string;
  group: PinOptionGroup;
}

export function buildPinOptions(detail: NovelDetail): PinOption[] {
  return [
    ...detail.chapters.map<PinOption>((c) => ({
      type: "chapter",
      id: c.id,
      label: `${c.index}. ${c.title || "Untitled"}`,
      group: "Chapters",
    })),
    ...detail.characters.map<PinOption>((ch) => ({
      type: "character",
      id: ch.id,
      label: ch.name,
      group: "Characters",
    })),
    ...detail.worldEntries.map<PinOption>((w) => ({
      type: "world_entry",
      id: w.id,
      label: w.title,
      group: "World",
    })),
    ...detail.outlineBeats.map<PinOption>((b) => ({
      type: "outline_beat",
      id: b.id,
      label: `${b.index}. ${b.title || "Untitled"}`,
      group: "Outline",
    })),
    ...detail.volumes.map<PinOption>((v) => ({
      type: "volume",
      id: v.id,
      label: v.title,
      group: "Volumes",
    })),
  ];
}

/** Client-side search over the loaded tree data (case-insensitive). */
export function filterPinOptions(options: PinOption[], query: string): PinOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter(
    (o) => o.label.toLowerCase().includes(q) || o.group.toLowerCase().includes(q)
  );
}

// ---------------------------------------------------------------------------
// Token engine — the active "@query" (pin) or "/query" (command) under the
// caret. A pin token starts at "@" only when it begins a token (start of
// input or after whitespace), so addresses like "name@mail" never trigger.
// A command token starts only when "/" is the draft's first character —
// commands are the whole message.
// ---------------------------------------------------------------------------

type TokenKind = "pin" | "command";

interface TokenState {
  kind: TokenKind;
  /** Index of the trigger character ("@" or "/") in the draft. */
  start: number;
  /** Caret position when the token was last recomputed. */
  end: number;
  /** Text between the trigger and the caret (spaces allowed → args). */
  query: string;
}

function detectPinToken(value: string, caret: number): TokenState | null {
  const upToCaret = value.slice(0, Math.max(0, Math.min(caret, value.length)));
  const at = upToCaret.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(value[at - 1])) return null;
  const query = upToCaret.slice(at + 1);
  if (query.includes("\n")) return null;
  return { kind: "pin", start: at, end: upToCaret.length, query };
}

function detectCommandToken(value: string, caret: number): TokenState | null {
  if (!value.startsWith("/") || caret <= 0) return null;
  const upToCaret = value.slice(0, caret);
  if (upToCaret.includes("\n")) return null;
  return { kind: "command", start: 0, end: caret, query: upToCaret.slice(1) };
}

function detectToken(value: string, caret: number): TokenState | null {
  if (value.startsWith("/")) return detectCommandToken(value, caret);
  return detectPinToken(value, caret);
}

// ---------------------------------------------------------------------------
// PromptBox
// ---------------------------------------------------------------------------

const MODE_META: Record<
  AgentRunMode,
  { icon: typeof ShieldCheck; label: string; hint: string }
> = {
  approval: {
    icon: ShieldCheck,
    label: "Approval",
    hint: "The team pauses at settle gates and waits for you.",
  },
  full_access: {
    icon: Zap,
    label: "Full access",
    hint: "The team runs through gates automatically — irreversible actions still stop for you.",
  },
};

export function PromptBox({
  value,
  onChange,
  onStart,
  submitting,
  mode,
  onModeChange,
  modelSelection,
  onModelChange,
  pinnedRefs,
  onTogglePin,
  onClearPins,
  pinOptions,
  novelId,
  usageEvents,
}: {
  value: string;
  onChange: (next: string) => void;
  onStart: () => void;
  submitting: boolean;
  mode: AgentRunMode;
  onModeChange: (next: AgentRunMode) => void;
  /** P2 — registry selection persisted per novel by the pane. */
  modelSelection: ModelSelection;
  onModelChange: (next: ModelSelection) => void;
  pinnedRefs: PinnedRef[];
  onTogglePin: (ref: PinnedRef) => void;
  onClearPins: () => void;
  pinOptions: PinOption[];
  /** Context Usage lives on the toolbar's left cluster (next to +). */
  novelId: string;
  /** The displayed run's events — powers the live/last-measured usage. */
  usageEvents: AgentEvent[];
}) {
  const [pinOpen, setPinOpen] = useState(false);
  const [token, setToken] = useState<TokenState | null>(null);
  const [highlight, setHighlight] = useState(0);
  // Restart keyboard navigation whenever the query changes — adjusted during
  // render (React's "adjust state when a prop changes" pattern) instead of an
  // effect, so a new query always starts at the first row.
  const [lastQuery, setLastQuery] = useState<string | null>(null);
  const currentQuery = token?.query ?? null;
  if (currentQuery !== lastQuery) {
    setLastQuery(currentQuery);
    setHighlight(0);
  }
  // Non-null assertion: the ref is attached to the rendered container before
  // Radix ever measures it, and PopoverAnchor's virtualRef requires a
  // non-null RefObject<Measurable>.
  const containerRef = useRef<HTMLDivElement>(null!);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  /** Armed by Escape so caret moves don't instantly reopen a dismissed token. */
  const suppressRef = useRef(false);

  const canSend = !submitting && value.trim().length >= 3;

  // Palette source for the [+] button, grouped by category.
  const grouped = useMemo(() => {
    const byGroup = new Map<PinOptionGroup, PinOption[]>();
    for (const opt of pinOptions) {
      const list = byGroup.get(opt.group) ?? [];
      list.push(opt);
      byGroup.set(opt.group, list);
    }
    return byGroup;
  }, [pinOptions]);

  const pinnedKeys = useMemo(
    () => new Set(pinnedRefs.map((r) => `${r.type}:${r.id}`)),
    [pinnedRefs]
  );

  // Overlay sources — filtered per the active token.
  const filteredPins = useMemo(
    () => (token?.kind === "pin" ? filterPinOptions(pinOptions, token.query) : []),
    [pinOptions, token]
  );
  const filteredCommands = useMemo(
    () =>
      token?.kind === "command"
        ? filterSlashCommands(SLASH_COMMANDS, token.query)
        : [],
    [token]
  );
  const filteredCount =
    token?.kind === "pin" ? filteredPins.length : filteredCommands.length;
  const activeHighlight = Math.min(highlight, Math.max(filteredCount - 1, 0));

  // Contiguous groups of the filtered pin list, each with its flat offset so
  // keyboard highlight navigation can address rows across group headings.
  const pinGroups = useMemo(() => {
    const out: { group: PinOptionGroup; options: PinOption[]; offset: number }[] = [];
    let offset = 0;
    for (const opt of filteredPins) {
      const last = out[out.length - 1];
      if (last && last.group === opt.group) {
        last.options.push(opt);
      } else {
        out.push({ group: opt.group, options: [opt], offset });
      }
      offset += 1;
    }
    return out;
  }, [filteredPins]);

  // Keep the highlighted row visible inside the overlay list.
  useEffect(() => {
    if (!token) return;
    listScrollRef.current
      ?.querySelector<HTMLElement>(`[data-pin-index="${activeHighlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeHighlight, token]);

  const applyToken = (next: TokenState | null) =>
    setToken((prev) => {
      if (prev === next) return prev;
      if (
        prev &&
        next &&
        prev.kind === next.kind &&
        prev.start === next.start &&
        prev.end === next.end &&
        prev.query === next.query
      ) {
        return prev;
      }
      return next;
    });

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    suppressRef.current = false;
    onChange(next);
    applyToken(detectToken(next, e.target.selectionStart ?? next.length));
  };

  // Caret moved without typing (click, arrows, Home/End) — follow it unless
  // the token was just dismissed with Escape.
  const handleSelect = () => {
    if (suppressRef.current) return;
    const ta = textareaRef.current;
    if (!ta) return;
    applyToken(detectToken(ta.value, ta.selectionStart ?? 0));
  };

  /** Common tail of token selection: rewrite the draft, restore the caret. */
  const finishTokenEdit = (nextValue: string, caret: number) => {
    const ta = textareaRef.current;
    onChange(nextValue);
    applyToken(null);
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(caret, caret);
    });
  };

  const selectPinOption = (opt: PinOption) => {
    onTogglePin({ type: opt.type, id: opt.id, label: opt.label });
    const ta = textareaRef.current;
    const t = token;
    if (!ta || !t || t.kind !== "pin") {
      applyToken(null);
      return;
    }
    // Remove the "@query" token from the draft — the pinned chip now carries
    // the context, and the goal text stays clean for the team.
    const before = value.slice(0, t.start);
    const after = value.slice(t.end);
    const join =
      before !== "" &&
      after !== "" &&
      !/\s$/.test(before) &&
      !/^\s/.test(after)
        ? " "
        : "";
    finishTokenEdit(before + join + after, before.length + join.length);
  };

  const applyCommand = (cmd: SlashCommand) => {
    const ta = textareaRef.current;
    const t = token;
    if (!ta || !t || t.kind !== "command") {
      applyToken(null);
      return;
    }
    const parts = t.query.trim().split(/\s+/);
    const args = parts.slice(1).join(" ");
    const goal = cmd.buildGoal(args, mode);
    const before = value.slice(0, t.start);
    const after = value.slice(t.end);
    const join = after !== "" && !/^\s/.test(after) ? " " : "";
    finishTokenEdit(before + goal + join + after, before.length + goal.length);
  };

  const ModeIcon = MODE_META[mode].icon;

  return (
    <div
      ref={containerRef}
      className={cn(
        "rounded-2xl border bg-card shadow-sm transition-colors",
        "focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20"
      )}
    >
      {/* Input area — borderless textarea over a rich placeholder layer */}
      <div className="relative px-4 pt-3.5">
        {value === "" && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-4 top-3.5 select-none text-sm leading-6 text-muted-foreground/80"
          >
            Give the team a goal…
            <span className="font-medium text-primary/90"> @ pin context</span>,
            <span className="font-medium text-primary/90"> / agent commands</span>
          </div>
        )}
        <textarea
          id="agent-goal"
          ref={textareaRef}
          aria-label="Run goal"
          rows={2}
          value={value}
          onChange={handleInputChange}
          onSelect={handleSelect}
          onKeyDown={(e) => {
            // IME composition (CJK input) — let every key reach the editor.
            if (e.nativeEvent.isComposing) return;
            if (token) {
              if (e.key === "ArrowDown" && filteredCount > 0) {
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, filteredCount - 1));
                return;
              }
              if (e.key === "ArrowUp" && filteredCount > 0) {
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
                return;
              }
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                if (filteredCount === 0) {
                  applyToken(null);
                  return;
                }
                if (token.kind === "pin") {
                  selectPinOption(filteredPins[activeHighlight]);
                } else {
                  applyCommand(filteredCommands[activeHighlight]);
                }
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                suppressRef.current = true;
                applyToken(null);
                return;
              }
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (canSend) onStart();
            }
          }}
          className={cn(
            "block w-full resize-none border-0 bg-transparent p-0 text-sm leading-6",
            "min-h-[72px] max-h-56 overflow-y-auto",
            "outline-none focus-visible:outline-none focus-visible:ring-0",
            "placeholder:text-transparent"
          )}
          placeholder="Give the team a goal"
        />
      </div>

      {/* Pinned context chips — inside the container, under the text */}
      {pinnedRefs.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5 px-4 pb-1"
          aria-label="Pinned context"
        >
          {pinnedRefs.map((ref) => (
            <Badge
              key={`${ref.type}:${ref.id}`}
              variant="outline"
              className="h-6 max-w-[240px] gap-1 bg-primary/5 pr-1 text-[11px]"
            >
              <span className="truncate">{ref.label}</span>
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-muted"
                aria-label={`Unpin — ${ref.label}`}
                onClick={() => onTogglePin(ref)}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}
          <button
            type="button"
            className="rounded px-1 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={onClearPins}
          >
            Clear
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3 pt-1.5">
        {/* Left — pin menu + context usage. The gauge sits exactly between
            the + button and the model picker: run parameters share one row. */}
        <div className="flex items-center gap-1.5">
          <Popover open={pinOpen} onOpenChange={setPinOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                aria-label="Pin context — attach chapters, characters, world entries"
                title="Pin context — or type @ in the composer"
              >
                <Plus className="h-4.5 w-4.5" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-0">
              <Command>
                <CommandInput placeholder="Search chapters, characters, world…" />
                <CommandList className="max-h-72 overflow-y-auto">
                  <CommandEmpty>Nothing matches in this novel.</CommandEmpty>
                  {[...grouped.entries()].map(([group, options]) => (
                    <CommandGroup key={group} heading={group}>
                      {options.map((opt) => {
                        const pinned = pinnedKeys.has(`${opt.type}:${opt.id}`);
                        return (
                          <CommandItem
                            key={`${opt.type}:${opt.id}`}
                            value={`${opt.label} ${group}`}
                            onSelect={() =>
                              onTogglePin({ type: opt.type, id: opt.id, label: opt.label })
                            }
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4 shrink-0",
                                pinned ? "opacity-100" : "opacity-0"
                              )}
                              aria-hidden="true"
                            />
                            <span className="truncate">{opt.label}</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <ContextUsageButton
            novelId={novelId}
            modelId={modelSelection.modelId}
            events={usageEvents}
          />
        </div>

        {/* Right — model picker · permissions · voice · send */}
        <div className="flex items-center gap-1.5">
          <ModelPicker selection={modelSelection} onChange={onModelChange} />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-full px-3 text-xs"
                aria-label={`Run permission: ${MODE_META[mode].label}`}
              >
                <ModeIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {MODE_META[mode].label}
                <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                Preference is saved for this novel
              </DropdownMenuLabel>
              {(Object.keys(MODE_META) as AgentRunMode[]).map((m) => {
                const meta = MODE_META[m];
                const Icon = meta.icon;
                return (
                  <DropdownMenuItem
                    key={m}
                    className="items-start gap-2 py-2"
                    onSelect={() => onModeChange(m)}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{meta.label}</span>
                      <span className="block text-[11px] leading-4 text-muted-foreground">
                        {meta.hint}
                      </span>
                    </span>
                    {m === mode && (
                      <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled
            className="h-8 w-8 rounded-full text-muted-foreground"
            aria-label="Voice input — arrives later"
            title="Voice input arrives later"
          >
            <Mic className="h-4 w-4" aria-hidden="true" />
          </Button>

          <Button
            type="button"
            size="icon"
            className="h-9 w-9 rounded-full"
            disabled={!canSend}
            onClick={onStart}
            aria-label="Run team"
            title="Run team — ⌘/Ctrl + Enter"
          >
            {submitting ? (
              <Loader2 className="h-4.5 w-4.5 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowUp className="h-4.5 w-4.5" aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>

      {/* Token overlay — anchored to the whole prompt box, floats above it.
          One popover serves both token kinds: "/" → agent command menu,
          "@" → pin context search. Focus stays in the textarea; rows are
          mouse- and keyboard-selectable without stealing focus. */}
      <Popover
        open={token !== null}
        onOpenChange={(open) => {
          if (!open) applyToken(null);
        }}
      >
        <PopoverAnchor virtualRef={containerRef} />
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="w-80 rounded-xl p-1"
        >
          {token?.kind === "command" ? (
            /* ---- "/" — agent command menu ---- */
            <div
              ref={listScrollRef}
              role="listbox"
              aria-label="Agent command menu"
              className="max-h-64 overflow-y-auto"
            >
              {filteredCommands.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  Unknown command — try /next /write /review /outline /recap
                  /doctor
                </p>
              ) : (
                filteredCommands.map((cmd, idx) => (
                  <button
                    key={cmd.id}
                    type="button"
                    role="option"
                    aria-selected={idx === activeHighlight}
                    data-pin-index={idx}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left",
                      idx === activeHighlight
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted/60"
                    )}
                    // Keep focus in the textarea while clicking a row.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => applyCommand(cmd)}
                  >
                    <span className="flex w-full items-baseline gap-2">
                      <span className="font-mono text-xs font-semibold text-primary">
                        {cmd.command}
                      </span>
                      {cmd.paramHint && (
                        <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                          {cmd.paramHint}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                        {cmd.description}
                      </span>
                    </span>
                    {cmd.detail && (
                      <span className="block text-[10px] leading-4 text-muted-foreground/70">
                        {cmd.detail}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          ) : (
            /* ---- "@" — pin context search ---- */
            <div
              ref={listScrollRef}
              role="listbox"
              aria-label="Pin context search results"
              className="max-h-64 overflow-y-auto"
            >
              {filteredPins.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Nothing matches “{token?.query.trim()}” in this novel.
                </p>
              ) : (
                pinGroups.map(({ group, options, offset }) => (
                  <div key={group} role="presentation" className="px-1 py-1">
                    <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                      {group}
                    </p>
                    {options.map((opt, i) => {
                      const idx = offset + i;
                      const pinned = pinnedKeys.has(`${opt.type}:${opt.id}`);
                      return (
                        <button
                          key={`${opt.type}:${opt.id}`}
                          type="button"
                          role="option"
                          aria-selected={idx === activeHighlight}
                          data-pin-index={idx}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                            idx === activeHighlight
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-muted/60"
                          )}
                          // Keep focus in the textarea while clicking a row.
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setHighlight(idx)}
                          onClick={() => selectPinOption(opt)}
                        >
                          <Check
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              pinned ? "text-primary" : "opacity-0"
                            )}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground/70">
                            {opt.group}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          )}
          <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
            <span>
              <kbd className="rounded border bg-muted px-1">↑</kbd>{" "}
              <kbd className="rounded border bg-muted px-1">↓</kbd> navigate
            </span>
            <span>
              <kbd className="rounded border bg-muted px-1">↵</kbd>{" "}
              {token?.kind === "command" ? "insert" : "pin"}
            </span>
            <span>
              <kbd className="rounded border bg-muted px-1">esc</kbd> dismiss
            </span>
            <span className="ml-auto">
              {token?.kind === "command"
                ? `${filteredCount} of ${SLASH_COMMANDS.length}`
                : `${filteredCount} found`}
            </span>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
