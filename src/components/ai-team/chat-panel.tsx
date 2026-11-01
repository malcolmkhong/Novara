"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  CheckCircle2,
  Clock,
  Crown,
  Loader2,
  Package,
  SendHorizontal,
  Wrench,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { AgentDto, MessageDto, TaskDto } from "@/lib/ai-team/types";
import { useConversation, useSendMessage, useTasks } from "./use-team";

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

export function AgentAvatar({ agent, size = 28 }: { agent: AgentDto; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full border"
      style={{
        width: size,
        height: size,
        backgroundColor: `${agent.color}1f`,
        borderColor: `${agent.color}55`,
        fontSize: Math.round(size * 0.55),
      }}
    >
      {agent.emoji}
    </span>
  );
}

function statusIcon(task: TaskDto) {
  switch (task.status) {
    case "completed":
      return <CheckCircle2 className="size-3 shrink-0 text-emerald-600" aria-hidden="true" />;
    case "failed":
      return <XCircle className="size-3 shrink-0 text-rose-500" aria-hidden="true" />;
    case "in_progress":
      return <Loader2 className="size-3 shrink-0 animate-spin text-amber-500" aria-hidden="true" />;
    default:
      return <Clock className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
}

function statusLabel(task: TaskDto): string {
  switch (task.status) {
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "in_progress":
      return `${task.progress}%`;
    default:
      return "queued";
  }
}

/** Live pill summarizing one delegated task (click → Tasks tab). */
export function TaskChip({ task, onClick }: { task: TaskDto; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-[11px] transition-colors hover:bg-accent"
      title={task.title}
    >
      {statusIcon(task)}
      <span aria-hidden="true" className="shrink-0">{task.assignee.emoji}</span>
      <span className="max-w-[150px] truncate font-medium">{task.title}</span>
      <span className="shrink-0 text-muted-foreground">{statusLabel(task)}</span>
    </button>
  );
}

/** Centered notice for task reports / tool activity in the chat stream. */
function ReportCard({ message }: { message: MessageDto }) {
  const isTool = message.content.startsWith("🔧");
  const body = isTool
    ? message.content.replace(/^🔧\s*Novel tools used:\s*/, "")
    : message.content.replace(/^📦\s*Task report\s*—\s*/, "");
  return (
    <div className="flex justify-center px-1">
      <div
        className={cn(
          "max-w-full rounded-lg border border-dashed px-3 py-2 text-xs",
          isTool
            ? "border-emerald-400/70 bg-emerald-50 text-emerald-900 dark:border-emerald-500/50 dark:bg-emerald-950/40 dark:text-emerald-100"
            : "border-amber-400/70 bg-amber-50 text-amber-900 dark:border-amber-500/50 dark:bg-amber-950/40 dark:text-amber-100",
        )}
      >
        <div className="mb-1 flex items-center gap-1.5 font-semibold">
          {isTool ? (
            <Wrench className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Package className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          {isTool ? "Novel activity" : "Task report"}
        </div>
        <div className="max-h-44 overflow-y-auto text-xs leading-relaxed [scrollbar-width:thin]">
          <AssistantMarkdown content={body} />
        </div>
      </div>
    </div>
  );
}

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <p className="mb-2 break-words last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0">{children}</ol>,
        h1: ({ children }) => <h3 className="mb-1 text-sm font-bold">{children}</h3>,
        h2: ({ children }) => <h3 className="mb-1 text-sm font-bold">{children}</h3>,
        h3: ({ children }) => <h4 className="mb-1 text-sm font-semibold">{children}</h4>,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="mb-2 border-l-2 border-muted-foreground/40 pl-2 italic last:mb-0">{children}</blockquote>
        ),
        pre: ({ children }) => (
          <pre className="my-1.5 overflow-x-auto rounded-md bg-muted p-2.5 font-mono text-xs leading-relaxed">
            {children}
          </pre>
        ),
        code: ({ children, className }) =>
          className ? (
            <code className={cn("font-mono text-xs", className)}>{children}</code>
          ) : (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>
          ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// ---------------------------------------------------------------------------
// ChatPanel
// ---------------------------------------------------------------------------

interface ChatPanelProps {
  agents: AgentDto[];
  /** Active agent key (store-driven). */
  agentKey: string;
  onSelectAgent: (key: string) => void;
  /** Navigate to the Tasks tab when a task chip is clicked. */
  onGoToTasks?: () => void;
  /** Pop-out mode: tighter spacing, no header/switcher chrome. */
  compact?: boolean;
}

const WELCOME_TEXT =
  "👋 I'm Atlas, your AI team leader. Tell me what you need — I'll break it down, delegate to the right specialist, track their progress and report the results back here. You can also open any specialist's own chat window from the Team tab.";

export function ChatPanel({ agents, agentKey, onSelectAgent, onGoToTasks, compact = false }: ChatPanelProps) {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const current = useMemo(
    () => agents.find((agent) => agent.key === agentKey) ?? agents.find((agent) => agent.isLeader) ?? agents[0],
    [agents, agentKey],
  );

  const conversation = useConversation(current?.id ?? "", true);
  const tasksQuery = useTasks(true);
  const sendMutation = useSendMessage();

  const tasksById = useMemo(() => {
    const map = new Map<string, TaskDto>();
    for (const task of tasksQuery.data ?? []) map.set(task.id, task);
    return map;
  }, [tasksQuery.data]);

  const messages = conversation.data?.messages ?? [];
  const activeTaskForAgent = useMemo(
    () =>
      (tasksQuery.data ?? []).find(
        (task) => task.assignee.id === current?.id && (task.status === "in_progress" || task.status === "pending"),
      ),
    [tasksQuery.data, current?.id],
  );

  // Keep the stream pinned to the latest message.
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length, sendMutation.isPending, conversation.data?.messages.at(-1)?.content]);

  const send = () => {
    const content = input.trim();
    if (!content || sendMutation.isPending || !current) return;
    setInput("");
    sendMutation.mutate(
      { agentId: current.id, content },
      {
        onError: (error: Error) => {
          setInput(content); // let the user retry without retyping
          toast({
            title: "Message failed",
            description: error.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  if (!current) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {agents.length === 0 ? "Loading team…" : "Select an agent."}
      </div>
    );
  }

  const sortedAgents = [...agents].sort((a, b) => Number(b.isLeader) - Number(a.isLeader) || a.sortOrder - b.sortOrder);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Agent switcher (main panel only) */}
      {!compact && (
        <div className="border-b px-2 py-2">
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
            {sortedAgents.map((agent) => (
              <button
                key={agent.key}
                type="button"
                onClick={() => onSelectAgent(agent.key)}
                aria-pressed={agent.key === current.key}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  agent.key === current.key
                    ? "border-transparent bg-primary text-primary-foreground shadow-sm"
                    : "bg-background hover:bg-accent",
                )}
              >
                <span aria-hidden="true">{agent.emoji}</span>
                <span className="font-medium">{agent.name}</span>
                {agent.isLeader && <Crown className="size-3" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active-task strip */}
      {activeTaskForAgent && (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 shrink-0 animate-spin text-amber-500" aria-hidden="true" />
          <span className="truncate">
            {activeTaskForAgent.status === "pending" ? "Queued" : "Working"}: {activeTaskForAgent.title}
          </span>
          <span className="ml-auto shrink-0 font-medium tabular-nums">{activeTaskForAgent.progress}%</span>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto p-3 [scrollbar-width:thin]"
        role="log"
        aria-label={`Conversation with ${current.name}`}
        aria-live="polite"
      >
        {conversation.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : messages.length === 0 ? (
          current.isLeader ? (
            <div className="flex justify-start">
              <div className="flex max-w-[88%] items-start gap-2">
                <AgentAvatar agent={current} />
                <div className="rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-sm leading-relaxed">
                  {WELCOME_TEXT}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
              <AgentAvatar agent={current} size={44} />
              <p className="font-medium text-foreground">{current.name}</p>
              <p className="max-w-[240px] text-xs">{current.description}</p>
              <p className="text-xs">Say hi or hand over work directly.</p>
            </div>
          )
        ) : (
          messages.map((message) => {
            if (message.role === "system") {
              return <ReportCard key={message.id} message={message} />;
            }
            if (message.role === "user") {
              return (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm leading-relaxed text-primary-foreground">
                    {message.content}
                  </div>
                </div>
              );
            }
            const relatedTasks = message.taskIds
              .map((taskId) => tasksById.get(taskId))
              .filter((task): task is TaskDto => Boolean(task));
            return (
              <div key={message.id} className="flex justify-start">
                <div className="flex max-w-[92%] items-start gap-2">
                  <AgentAvatar agent={current} />
                  <div className="min-w-0">
                    <div className="rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-sm leading-relaxed">
                      <AssistantMarkdown content={message.content} />
                    </div>
                    {relatedTasks.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {relatedTasks.map((task) => (
                          <TaskChip key={task.id} task={task} onClick={onGoToTasks} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {sendMutation.isPending && (
          <div className="flex justify-start">
            <div className="flex items-start gap-2">
              <AgentAvatar agent={current} />
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-muted px-3 py-2.5 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                {current.name} is thinking…
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t p-2">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            rows={compact ? 1 : 2}
            maxLength={2000}
            placeholder={`Message ${current.name}…`}
            aria-label={`Message ${current.name}`}
            className="min-h-[40px] resize-none text-sm"
          />
          <Button
            size="icon"
            onClick={send}
            disabled={!input.trim() || sendMutation.isPending}
            aria-label="Send message"
            className="size-9 shrink-0"
          >
            {sendMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <SendHorizontal className="size-4" aria-hidden="true" />
            )}
          </Button>
        </div>
        {input.length > 1700 && (
          <p className="mt-1 text-right text-[10px] text-muted-foreground">{input.length}/2000</p>
        )}
      </div>
    </div>
  );
}
