// ---------------------------------------------------------------------------
// Novara AI — zod schemas for the agent runtime contract.
// Phase 3 API routes must validate request bodies with these exact schemas;
// the mock gateway reuses them today so the swap is behavior-preserving.
// ---------------------------------------------------------------------------

import { z } from "zod";

export const agentRunModeSchema = z.enum(["approval", "full_access"]);

export const startRunInputSchema = z.object({
  novelId: z.string().min(1),
  goal: z.string().trim().min(3, "Describe the goal (at least 3 characters)").max(2000),
  mode: agentRunModeSchema,
});
export type StartRunInput = z.infer<typeof startRunInputSchema>;

export const approvalDecisionSchema = z.object({
  runId: z.string().min(1),
  taskId: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
});
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export const setRunModeSchema = z.object({
  runId: z.string().min(1),
  mode: agentRunModeSchema,
});

// ---------------------------------------------------------------------------
// Gateway start input — run fields + display context (novel title, chapter
// count) the real runtime will measure from the DB at run start.
// ---------------------------------------------------------------------------

export interface MockStartOptions extends StartRunInput {
  novelTitle: string;
  chapterCount: number;
}
