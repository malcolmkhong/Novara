"use client";

import { useState } from "react";
import { Crown, Loader2, MessageCircle, PictureInPicture2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { AgentDto, TaskDto } from "@/lib/ai-team/types";
import { AgentAvatar } from "./chat-panel";
import { useCreateTask } from "./use-team";

interface AgentsTabProps {
  agents: AgentDto[];
  tasks: TaskDto[];
  isLoading: boolean;
  onChat: (agentKey: string) => void;
  onPopOut: (agentKey: string) => void;
  onGoToTasks: () => void;
}

function AssignTaskDialog({
  agent,
  open,
  onOpenChange,
  onCreated,
}: {
  agent: AgentDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const createMutation = useCreateTask();

  const submit = () => {
    if (!title.trim() || !description.trim() || createMutation.isPending) return;
    createMutation.mutate(
      { assigneeId: agent.id, title: title.trim(), description: description.trim() },
      {
        onSuccess: () => {
          toast({
            title: `Task assigned to ${agent.name}`,
            description: "Progress and the result will appear in the Tasks tab; the team leader stays informed.",
          });
          setTitle("");
          setDescription("");
          onOpenChange(false);
          onCreated();
        },
        onError: (error: Error) => {
          toast({ title: "Could not create task", description: error.message, variant: "destructive" });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AgentAvatar agent={agent} size={24} /> Assign a task to {agent.name}
          </DialogTitle>
          <DialogDescription>
            {agent.name} will start immediately. The result lands in the Tasks tab and is reported to the team leader.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`task-title-${agent.id}`}>Title</Label>
            <Input
              id={`task-title-${agent.id}`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder="e.g. Draft a product launch tweet"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`task-desc-${agent.id}`}>Description (self-contained brief)</Label>
            <Textarea
              id={`task-desc-${agent.id}`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Context, requirements, expected deliverable…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!title.trim() || !description.trim() || createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Assign task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgentsTab({ agents, tasks, isLoading, onChat, onPopOut, onGoToTasks }: AgentsTabProps) {
  const [assignTarget, setAssignTarget] = useState<AgentDto | null>(null);

  const activeCountFor = (agent: AgentDto) =>
    tasks.filter(
      (task) => task.assignee.id === agent.id && (task.status === "pending" || task.status === "in_progress"),
    ).length;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3 [scrollbar-width:thin]">
      {agents.map((agent) => (
        <div
          key={agent.id}
          className={
            "rounded-xl border bg-background p-3 transition-colors " +
            (agent.isLeader ? "border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]" : "")
          }
        >
          <div className="flex items-start gap-2.5">
            <AgentAvatar agent={agent} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold">{agent.name}</span>
                {agent.isLeader && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
                    <Crown className="size-2.5" aria-hidden="true" /> Leader
                  </span>
                )}
                {activeCountFor(agent) > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                    <Loader2 className="size-2.5 animate-spin" aria-hidden="true" />
                    {activeCountFor(agent)} active
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{agent.role}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{agent.description}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {agent.capabilities.slice(0, 3).map((capability) => (
                  <span
                    key={capability}
                    className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {capability}
                  </span>
                ))}
                {agent.capabilities.length > 3 && (
                  <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    +{agent.capabilities.length - 3}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2.5 text-xs" onClick={() => onChat(agent.key)}>
                  <MessageCircle className="size-3.5" aria-hidden="true" />
                  Chat
                </Button>
                {!agent.isLeader && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 px-2.5 text-xs"
                      onClick={() => onPopOut(agent.key)}
                    >
                      <PictureInPicture2 className="size-3.5" aria-hidden="true" />
                      Pop out
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1.5 px-2.5 text-xs"
                      onClick={() => setAssignTarget(agent)}
                    >
                      <UserPlus className="size-3.5" aria-hidden="true" />
                      Assign task
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}

      {assignTarget && (
        <AssignTaskDialog
          agent={assignTarget}
          open
          onOpenChange={(open) => {
            if (!open) setAssignTarget(null);
          }}
          onCreated={onGoToTasks}
        />
      )}
    </div>
  );
}
