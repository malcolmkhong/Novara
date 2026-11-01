"use client";

/**
 * Floating side panel for the AI team widget, modeled after the DeepSeek
 * "Harness" sidebar:
 *
 *   [ brand ]                     [ 新会话 ]
 *   nav: 对话 / 智能体 / 任务
 *   ─ 工作区 | 书房 ─
 *   书房:  search + 我的作品 tree
 *          novel → 设定集 / 大纲(卷) / 章节 / 伏笔台账
 *   工作区: 在线成员 + 进行中任务
 *   最近任务 (shared activity feed)
 *   footer: session status
 *
 * Tree rows inject a human-readable reference (《书》第N章「题」) into the
 * chat composer so the user can ground the team on a specific file; the
 * agents resolve it with their novel tools (library snapshot carries ids).
 */

import { useMemo, useState } from "react";
import {
  BookMarked,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Crown,
  Library,
  ListTodo,
  Loader2,
  MessagesSquare,
  Plus,
  RotateCcw,
  ScrollText,
  Search,
  Sprout,
  Users,
  X,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { AgentDto, TaskDto } from "@/lib/ai-team/types";
import type { NovelDetail, NovelListItem } from "@/lib/novel/types";
import { AgentAvatar } from "./chat-panel";
import { useNovelDetail, useNovelList } from "./use-team";
import { resetSessionKey, useSessionKey } from "./use-session";
import { useTeamUi, type SidePanelTab, type TeamTab } from "./store";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function StatusDot({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-1.5 shrink-0 rounded-full", className)}
    />
  );
}

function chapterDot(status: string): string {
  return status === "final"
    ? "bg-emerald-500"
    : status === "drafted"
      ? "bg-amber-500"
      : "bg-muted-foreground/40";
}

function foreshadowDot(status: string): string {
  return status === "paid"
    ? "bg-emerald-500"
    : status === "advanced"
      ? "bg-sky-500"
      : "bg-amber-500";
}

function taskStatusIcon(task: TaskDto) {
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

function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center justify-between px-1 pb-1 pt-0.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {typeof count === "number" && (
        <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Novel tree node (lazy detail fetch per expanded book)
// ---------------------------------------------------------------------------

type FolderKey = "bible" | "outline" | "chapters" | "foreshadows";

function NovelNode({
  novel,
  tasks,
  onReference,
}: {
  novel: NovelListItem;
  tasks: TaskDto[];
  onReference: (text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [folders, setFolders] = useState<Record<FolderKey, boolean>>({
    bible: false,
    outline: false,
    chapters: true,
    foreshadows: false,
  });
  const detailQuery = useNovelDetail(expanded ? novel.id : null);
  const detail: NovelDetail | undefined = detailQuery.data;

  const working = useMemo(
    () =>
      tasks.some(
        (task) =>
          (task.status === "pending" || task.status === "in_progress") &&
          (task.title.includes(novel.title) || task.description.includes(novel.title)),
      ),
    [tasks, novel.title],
  );

  const toggleFolder = (key: FolderKey) =>
    setFolders((prev) => ({ ...prev, [key]: !prev[key] }));

  const toggleExpand = () => setExpanded((prev) => !prev);

  return (
    <div className="select-none">
      {/* Book row */}
      <button
        type="button"
        onClick={toggleExpand}
        aria-expanded={expanded}
        className="group flex w-full items-start gap-1.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-accent"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform",
            !expanded && "-rotate-90",
          )}
        />
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border bg-muted/60"
        >
          <BookOpen className="size-3 text-amber-600 dark:text-amber-400" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-xs font-semibold leading-tight">{novel.title}</span>
            {working && (
              <span className="shrink-0 rounded-sm border border-amber-500/60 px-1 text-[9px] font-semibold leading-4 text-amber-600 dark:text-amber-400">
                工作中
              </span>
            )}
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted-foreground">
            {novel.logline}
          </span>
        </span>
      </button>

      {/* Children */}
      {expanded && (
        <div className="ml-3 border-l pl-1.5">
          {detailQuery.isLoading && (
            <div className="flex items-center gap-2 px-1.5 py-2 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              正在载入书目…
            </div>
          )}
          {detailQuery.isError && (
            <div className="px-1.5 py-2 text-[11px] text-rose-600 dark:text-rose-400">
              载入失败，请点侧边栏的刷新按钮重试。
            </div>
          )}

          {detail && (
            <>
              {/* 设定集 */}
              <TreeRow
                depth={0}
                open={folders.bible}
                hasChildren
                onToggle={() => toggleFolder("bible")}
                icon={<BookMarked className="size-3.5 shrink-0 text-violet-500 dark:text-violet-400" aria-hidden="true" />}
                label="设定集"
              />
              {folders.bible && (
                <div className="ml-3 border-l pl-1.5">
                  {detail.bible && (
                    <>
                      <LeafRow
                        label={`世界观 · ${detail.bible.world.slice(0, 26)}`}
                        onClick={() => onReference(`《${novel.title}》设定集 · 世界观`)}
                      />
                      <LeafRow
                        label={`力量体系 · ${detail.bible.power.slice(0, 26)}`}
                        onClick={() => onReference(`《${novel.title}》设定集 · 力量体系`)}
                      />
                      <LeafRow
                        label={`金手指 · ${detail.bible.goldenFinger.slice(0, 26)}`}
                        onClick={() => onReference(`《${novel.title}》设定集 · 金手指`)}
                      />
                    </>
                  )}
                  {detail.characters.map((character) => (
                    <LeafRow
                      key={character.name}
                      label={`${character.name}（${character.role}）`}
                      onClick={() => onReference(`《${novel.title}》设定集 · 角色 ${character.name}`)}
                    />
                  ))}
                  {detail.villain && (
                    <LeafRow
                      label={`反派 · ${detail.villain.name}`}
                      onClick={() => onReference(`《${novel.title}》设定集 · 反派 ${detail.villain?.name ?? ""}`)}
                    />
                  )}
                </div>
              )}

              {/* 大纲（卷） */}
              <TreeRow
                depth={0}
                open={folders.outline}
                hasChildren={detail.volumes.length > 0}
                onToggle={() => toggleFolder("outline")}
                icon={<ListTreeIcon aria-hidden="true" />}
                label={`大纲 · ${detail.volumes.length} 卷`}
              />
              {folders.outline && (
                <div className="ml-3 border-l pl-1.5">
                  {detail.volumes.map((volume) => (
                    <LeafRow
                      key={volume.id}
                      label={`第${volume.index}卷 ${volume.name}`}
                      hint={`第${volume.startChapter}-${volume.endChapter}章`}
                      onClick={() =>
                        onReference(`《${novel.title}》第${volume.index}卷「${volume.name}」（第${volume.startChapter}-${volume.endChapter}章）`)
                      }
                    />
                  ))}
                </div>
              )}

              {/* 章节 */}
              <TreeRow
                depth={0}
                open={folders.chapters}
                hasChildren={detail.chapters.length > 0}
                onToggle={() => toggleFolder("chapters")}
                icon={<ScrollText className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />}
                label={`章节 · ${detail.chapters.length}`}
              />
              {folders.chapters && (
                <div className="ml-3 border-l pl-1.5">
                  {detail.chapters.map((chapter) => (
                    <LeafRow
                      key={chapter.id}
                      icon={
                        <StatusDot
                          className={chapterDot(chapter.status)}
                        />
                      }
                      label={`第${chapter.number}章 ${chapter.title}`}
                      hint={chapter.status === "final" ? "定稿" : chapter.status === "drafted" ? "草稿" : "未写"}
                      onClick={() => onReference(`《${novel.title}》第${chapter.number}章「${chapter.title}」`)}
                    />
                  ))}
                </div>
              )}

              {/* 伏笔台账 */}
              <TreeRow
                depth={0}
                open={folders.foreshadows}
                hasChildren={detail.foreshadows.length > 0}
                onToggle={() => toggleFolder("foreshadows")}
                icon={<Sprout className="size-3.5 shrink-0 text-lime-600 dark:text-lime-400" aria-hidden="true" />}
                label={`伏笔台账 · ${detail.foreshadows.length}`}
              />
              {folders.foreshadows && (
                <div className="ml-3 border-l pl-1.5">
                  {detail.foreshadows.map((foreshadow) => (
                    <LeafRow
                      key={foreshadow.id}
                      icon={<StatusDot className={foreshadowDot(foreshadow.status)} />}
                      label={foreshadow.title}
                      hint={`第${foreshadow.plantedAt}章埋设 · ${
                        foreshadow.status === "paid"
                          ? "已回收"
                          : foreshadow.status === "advanced"
                            ? "推进中"
                            : "未回收"
                      }`}
                      onClick={() => onReference(`《${novel.title}》伏笔「${foreshadow.title}」`)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ListTreeIcon({ className }: { className?: string }) {
  // Local mini "list tree" glyph so 大纲 reads as an outline, not a chapter list.
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("size-3.5 shrink-0 text-sky-600 dark:text-sky-400", className)}
    >
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

/** Expandable folder row inside a book. */
function TreeRow({
  depth,
  open,
  hasChildren,
  onToggle,
  icon,
  label,
}: {
  depth: number;
  open: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent",
        depth > 0 && "pl-3",
      )}
    >
      {hasChildren ? (
        <ChevronDown
          aria-hidden="true"
          className={cn("size-3 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
        />
      ) : (
        <span className="inline-block size-3 shrink-0" aria-hidden="true" />
      )}
      {icon}
      <span className="truncate font-medium">{label}</span>
    </button>
  );
}

/** Clickable leaf row — injects a reference into the chat composer. */
function LeafRow({
  label,
  hint,
  icon,
  onClick,
}: {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="点击引用到聊天输入框"
      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent"
    >
      {icon ?? <span className="inline-block size-3 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-[10px] text-muted-foreground">{hint}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Task mini rows (工作区 + 最近任务)
// ---------------------------------------------------------------------------

function TaskMiniRow({ task, onClick }: { task: TaskDto; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent"
    >
      {taskStatusIcon(task)}
      <span className="min-w-0 flex-1 truncate">{task.title}</span>
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {task.status === "in_progress" ? `${task.progress}%` : task.status === "completed" ? "done" : task.status === "failed" ? "failed" : "queued"}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// SidePanel
// ---------------------------------------------------------------------------

interface SidePanelProps {
  agents: AgentDto[];
  tasks: TaskDto[];
  /** Mobile-only X button: hide the overlay. */
  onClose?: () => void;
  /** Called after nav/tree interactions — the widget closes the panel on mobile. */
  onNavigate?: () => void;
  onGoToTab: (tab: TeamTab) => void;
  onChatWith: (agentKey: string) => void;
}

const NAV_ITEMS: { tab: TeamTab; label: string; icon: React.ReactNode }[] = [
  { tab: "chat", label: "对话", icon: <MessagesSquare className="size-4" aria-hidden="true" /> },
  { tab: "team", label: "智能体", icon: <Users className="size-4" aria-hidden="true" /> },
  { tab: "tasks", label: "任务", icon: <ListTodo className="size-4" aria-hidden="true" /> },
];

const SIDE_TABS: { key: SidePanelTab; label: string }[] = [
  { key: "workspace", label: "工作区" },
  { key: "library", label: "书房" },
];

export function SidePanel({ agents, tasks, onClose, onNavigate, onGoToTab, onChatWith }: SidePanelProps) {
  const { toast } = useToast();
  const sessionKey = useSessionKey();
  const sideTab = useTeamUi((state) => state.sidePanelTab);
  const setSideTab = useTeamUi((state) => state.setSidePanelTab);
  const appendToComposer = useTeamUi((state) => state.appendToComposer);
  const setTab = useTeamUi((state) => state.setTab);
  const setChatAgent = useTeamUi((state) => state.setChatAgent);

  const [query, setQuery] = useState("");
  const novelListQuery = useNovelList();
  const novels = novelListQuery.data ?? [];

  const activeTasks = useMemo(
    () => tasks.filter((task) => task.status === "pending" || task.status === "in_progress"),
    [tasks],
  );
  const recentTasks = useMemo(
    () =>
      [...tasks]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 4),
    [tasks],
  );
  const filteredNovels = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return novels;
    return novels.filter(
      (novel) =>
        novel.title.toLowerCase().includes(keyword) ||
        novel.genre.toLowerCase().includes(keyword) ||
        novel.logline.toLowerCase().includes(keyword),
    );
  }, [novels, query]);

  const sortedAgents = useMemo(
    () =>
      [...agents].sort(
        (a, b) => Number(b.isLeader) - Number(a.isLeader) || a.sortOrder - b.sortOrder,
      ),
    [agents],
  );

  /** Reference click: ground the chat on a specific book file. */
  const reference = (text: string) => {
    appendToComposer(text);
    setTab("chat");
    onNavigate?.();
  };

  const goToTab = (tab: TeamTab) => {
    onGoToTab(tab);
    onNavigate?.();
  };

  const chatWith = (agentKey: string) => {
    setChatAgent(agentKey);
    onChatWith(agentKey);
    onNavigate?.();
  };

  const newSession = () => {
    resetSessionKey();
    setTab("chat");
    toast({ title: "已开启新会话", description: "各智能体的对话将从空白开始，旧记录仍保留在数据库中。" });
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background sm:w-64 sm:shrink-0">
      {/* Brand */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white"
        >
          <Bot className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold leading-tight">AI 写作团队</p>
          <p className="truncate text-[10px] text-muted-foreground">HARNESS · 小说工作室</p>
        </div>
        {onClose && (
          <Button
            size="icon"
            variant="ghost"
            className="size-7 sm:hidden"
            onClick={onClose}
            aria-label="关闭侧边栏"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* New session */}
      <div className="shrink-0 px-3 pt-3">
        <Button
          variant="outline"
          className="w-full gap-2 rounded-lg text-xs font-semibold"
          onClick={newSession}
        >
          <Plus className="size-4" aria-hidden="true" />
          新会话
        </Button>
      </div>

      {/* Nav */}
      <nav className="shrink-0 px-3 pt-2" aria-label="主导航">
        {NAV_ITEMS.map((item) => {
          const activeCount =
            item.tab === "tasks"
              ? activeTasks.length
              : 0;
          return (
            <button
              key={item.tab}
              type="button"
              onClick={() => goToTab(item.tab)}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium text-foreground/90 transition-colors hover:bg-accent"
            >
              {item.icon}
              <span className="flex-1 text-left">{item.label}</span>
              {activeCount > 0 && (
                <span
                  className="inline-flex min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white"
                  aria-label={`${activeCount} 个进行中的任务`}
                >
                  {activeCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Segmented tabs */}
      <div className="shrink-0 px-3 pt-2.5">
        <div className="grid grid-cols-2 rounded-lg border bg-muted/40 p-0.5" role="tablist" aria-label="侧边栏视图">
          {SIDE_TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={sideTab === item.key}
              onClick={() => setSideTab(item.key)}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                sideTab === item.key
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 [scrollbar-width:thin]">
        {sideTab === "workspace" ? (
          <div className="space-y-3">
            <section>
              <SectionHeader label="在线成员" />
              <div className="space-y-0.5">
                {sortedAgents.map((agent) => {
                  const activeForAgent = tasks.filter(
                    (task) =>
                      task.assignee.id === agent.id &&
                      (task.status === "pending" || task.status === "in_progress"),
                  ).length;
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => chatWith(agent.key)}
                      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-accent"
                    >
                      <AgentAvatar agent={agent} size={22} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1 text-xs font-medium">
                          <span className="truncate">{agent.name}</span>
                          {agent.isLeader && <Crown className="size-3 shrink-0 text-amber-500" aria-hidden="true" />}
                        </span>
                        <span className="block truncate text-[10px] text-muted-foreground">{agent.role}</span>
                      </span>
                      {activeForAgent > 0 && (
                        <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[9px] font-semibold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                          {activeForAgent}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <SectionHeader label="进行中任务" count={activeTasks.length} />
              {activeTasks.length === 0 ? (
                <p className="px-1.5 py-1 text-[11px] leading-relaxed text-muted-foreground">
                  暂无进行中的任务 — 在对话里交代一件大事，进度会实时显示在这里。
                </p>
              ) : (
                <div className="space-y-0.5">
                  {activeTasks.map((task) => (
                    <TaskMiniRow key={task.id} task={task} onClick={() => goToTab("tasks")} />
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Search */}
            <div className="flex items-center gap-1.5">
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索书名或题材…"
                  aria-label="搜索书名或题材"
                  className="h-8 rounded-lg bg-muted/50 pl-7 text-xs"
                />
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 shrink-0"
                aria-label="刷新书目"
                onClick={() => void novelListQuery.refetch()}
              >
                <RotateCcw
                  className={cn("size-3.5", novelListQuery.isFetching && "animate-spin")}
                  aria-hidden="true"
                />
              </Button>
            </div>

            {/* 我的作品 */}
            <section>
              <SectionHeader label="我的作品" count={filteredNovels.length} />
              {novelListQuery.isLoading ? (
                <div className="flex items-center gap-2 px-1.5 py-2 text-[11px] text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  正在载入书架…
                </div>
              ) : novelListQuery.isError ? (
                <p className="px-1.5 py-1 text-[11px] text-rose-600 dark:text-rose-400">
                  书架载入失败，请点击刷新按钮重试。
                </p>
              ) : filteredNovels.length === 0 ? (
                <div className="flex flex-col items-center gap-1 px-1.5 py-4 text-center">
                  <Library className="size-5 text-muted-foreground" aria-hidden="true" />
                  <p className="text-[11px] text-muted-foreground">
                    {query ? "没有匹配的作品" : "书架还是空的 — 去小说创作台创建一本"}
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {filteredNovels.map((novel) => (
                    <NovelNode
                      key={novel.id}
                      novel={novel}
                      tasks={tasks}
                      onReference={reference}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* 最近任务 */}
            {recentTasks.length > 0 && (
              <section>
                <SectionHeader label="最近任务" />
                <div className="space-y-0.5">
                  {recentTasks.map((task) => (
                    <TaskMiniRow key={task.id} task={task} onClick={() => goToTab("tasks")} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {/* Footer — session status */}
      <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2.5">
        <span className="relative flex size-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          会话已连接 · {sessionKey ? sessionKey.slice(0, 8) : "……"}
        </p>
      </div>
    </div>
  );
}
