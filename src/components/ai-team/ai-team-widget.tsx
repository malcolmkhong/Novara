"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, ListTodo, MessagesSquare, Minimize2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AgentsTab } from "./agents-tab";
import { ChatPanel } from "./chat-panel";
import { PopoutChat } from "./popout-chat";
import { useTeamUi, type TeamTab } from "./store";
import { TasksTab } from "./tasks-tab";
import { useAgents, useTasks } from "./use-team";

function AiTeamInner() {
  const {
    open,
    tab,
    chatAgentKey,
    popouts,
    toggleOpen,
    setTab,
    setChatAgent,
    openPopout,
    closePopout,
  } = useTeamUi();

  const agentsQuery = useAgents();
  const tasksQuery = useTasks(true);
  const agents = agentsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const activeCount = tasks.filter(
    (task) => task.status === "pending" || task.status === "in_progress",
  ).length;

  return (
    <>
      {/* Floating action button — hidden behind the panel while open */}
      <div className="fixed bottom-24 right-4 z-40 sm:right-6 print:hidden">
        <Button
          size="icon"
          onClick={toggleOpen}
          aria-label={open ? "Close AI team panel" : "Open AI team panel"}
          aria-expanded={open}
          className="relative size-14 rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/30 hover:bg-emerald-700"
        >
          {open ? <Minimize2 className="size-5" aria-hidden="true" /> : <Bot className="size-6" aria-hidden="true" />}
          {!open && activeCount > 0 && (
            <span
              className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white"
              aria-label={`${activeCount} tasks in progress`}
            >
              {activeCount}
            </span>
          )}
        </Button>
      </div>

      {/* Main floating panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="ai-team-panel"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed bottom-24 right-4 z-50 flex h-[min(620px,calc(100dvh-8.5rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl sm:right-6"
            role="dialog"
            aria-label="AI team workspace"
          >
            {/* Panel header */}
            <div className="flex shrink-0 items-center gap-2.5 border-b px-3 py-2.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                <Bot className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight">AI Team</p>
                <p className="truncate text-xs text-muted-foreground">
                  1 leader + {Math.max(agents.length - 1, 0)} specialists · live task progress
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={toggleOpen}
                aria-label="Minimize panel"
              >
                <Minimize2 className="size-4" aria-hidden="true" />
              </Button>
            </div>

            <Tabs
              value={tab}
              onValueChange={(value) => setTab(value as TeamTab)}
              className="flex min-h-0 flex-1 flex-col"
            >
              <TabsList className="mx-3 mt-2 grid shrink-0 grid-cols-3">
                <TabsTrigger value="chat" className="gap-1.5 px-2 text-xs">
                  <MessagesSquare className="size-3.5" aria-hidden="true" />
                  Chat
                </TabsTrigger>
                <TabsTrigger value="team" className="gap-1.5 px-2 text-xs">
                  <Users className="size-3.5" aria-hidden="true" />
                  Team
                </TabsTrigger>
                <TabsTrigger value="tasks" className="gap-1.5 px-2 text-xs">
                  <ListTodo className="size-3.5" aria-hidden="true" />
                  Tasks
                  {activeCount > 0 && (
                    <span
                      className={cn(
                        "ml-0.5 inline-flex size-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white",
                      )}
                    >
                      {activeCount}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="chat"
                className="flex min-h-0 flex-1 flex-col outline-none data-[state=inactive]:hidden"
              >
                <ChatPanel
                  agents={agents}
                  agentKey={chatAgentKey}
                  onSelectAgent={setChatAgent}
                  onGoToTasks={() => setTab("tasks")}
                />
              </TabsContent>

              <TabsContent
                value="team"
                className="flex min-h-0 flex-1 flex-col outline-none data-[state=inactive]:hidden"
              >
                <AgentsTab
                  agents={agents}
                  tasks={tasks}
                  isLoading={agentsQuery.isLoading}
                  onChat={(key) => {
                    setChatAgent(key);
                    setTab("chat");
                  }}
                  onPopOut={openPopout}
                  onGoToTasks={() => setTab("tasks")}
                />
              </TabsContent>

              <TabsContent
                value="tasks"
                className="flex min-h-0 flex-1 flex-col outline-none data-[state=inactive]:hidden"
              >
                <TasksTab tasks={tasks} isLoading={tasksQuery.isLoading} />
              </TabsContent>
            </Tabs>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Independent pop-out windows for individual sub-agents */}
      {popouts.map((key, index) => (
        <PopoutChat
          key={key}
          agents={agents}
          agentKey={key}
          offset={index}
          zIndex={60 + index}
          onClose={() => closePopout(key)}
        />
      ))}
    </>
  );
}

/**
 * Floating multi-agent chat workspace: one team leader the user talks to for
 * everything, plus specialist sub-agents with their own chat windows,
 * separate histories and live-tracked delegated tasks.
 */
export function AiTeamWidget() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <AiTeamInner />
    </QueryClientProvider>
  );
}
