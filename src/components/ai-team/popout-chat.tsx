"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { GripVertical, Loader2, X } from "lucide-react";

import type { AgentDto } from "@/lib/ai-team/types";
import { AgentAvatar, ChatPanel } from "./chat-panel";
import { useTasks } from "./use-team";

const WIDTH = 344;

const noopSubscribe = () => () => undefined;

interface PopoutChatProps {
  agents: AgentDto[];
  agentKey: string;
  /** Stack offset so multiple windows don't overlap perfectly. */
  offset: number;
  zIndex: number;
  onClose: () => void;
}

/**
 * Independent, draggable chat window for one sub-agent. History is shared
 * with the same agent's conversation (same query key), so messages stay in
 * sync with the main panel — but the window itself can be moved anywhere,
 * letting the user monitor and instruct agents while working elsewhere.
 */
export function PopoutChat({ agents, agentKey, offset, zIndex, onClose }: PopoutChatProps) {
  const tasksQuery = useTasks(true);
  // Client flag (hydration-safe): position math needs the real viewport.
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  const current = agents.find((agent) => agent.key === agentKey);
  const activeTask = (tasksQuery.data ?? []).find(
    (task) => task.assignee.key === agentKey && (task.status === "in_progress" || task.status === "pending"),
  );

  // Default position: right side, stacked per open window. Computed during
  // render (not in an effect) to keep it lint-clean; drag overrides via state.
  const defaultPosition = useMemo(() => {
    if (!isClient) return null;
    const x = Math.max(8, Math.min(window.innerWidth - WIDTH - 8, window.innerWidth - WIDTH - 20 - offset * 28));
    const y = Math.max(8, Math.min(window.innerHeight - 200, 88 + offset * 26));
    return { x, y };
  }, [isClient, offset]);
  const position = dragPosition ?? defaultPosition;

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!position) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    setDragPosition({
      x: clamp(drag.originX + event.clientX - drag.startX, 8, window.innerWidth - 80),
      y: clamp(drag.originY + event.clientY - drag.startY, 8, window.innerHeight - 64),
    });
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragState.current = null;
  };

  if (!current) return null;

  return (
    <div
      className="fixed flex flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
      style={{
        width: `min(${WIDTH}px, calc(100vw - 1rem))`,
        height: "min(480px, calc(100dvh - 2rem))",
        left: position?.x,
        top: position?.y,
        visibility: position ? "visible" : "hidden",
        zIndex,
      }}
      role="dialog"
      aria-label={`Chat with ${current.name}`}
    >
      {/* Draggable title bar */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex shrink-0 cursor-move touch-none select-none items-center gap-2 border-b bg-muted/60 px-2 py-1.5"
      >
        <GripVertical className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <AgentAvatar agent={current} size={22} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold leading-tight">
            {current.name}
            <span className="font-normal text-muted-foreground"> · {current.role}</span>
          </p>
          {activeTask && (
            <p className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
              <Loader2 className="size-2.5 shrink-0 animate-spin text-amber-500" aria-hidden="true" />
              {activeTask.title} — {activeTask.progress}%
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${current.name} chat window`}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      <ChatPanel agents={agents} agentKey={agentKey} onSelectAgent={() => undefined} compact />
    </div>
  );
}
