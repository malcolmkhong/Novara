// ---------------------------------------------------------------------------
// Novara AI — canonical conversation persistence + executor lease (Phase 1).
//
// TWO responsibilities, both owned by AgentRun rows as the source of truth:
//
// 1. AgentMessage — the CANONICAL conversation transcript (full verbatim
//    content, per (runId, conversationId, seq)). AgentEvent stays the
//    truncated UI/SSE stream and is NEVER replayed into a model context.
//    seq is allocated inside the SAME interactive transaction as the insert:
//    SQLite permits exactly one writer at a time, so the read-MAX + INSERT
//    pair cannot interleave with any other writer. The
//    @@unique([runId, conversationId, seq]) index is the hard backstop — a
//    duplicate seq is impossible to commit (P2002 → bounded retry), not
//    merely unlikely. Restore order is seq ASC; createdAt is never used for
//    ordering (same-millisecond appends collide).
//
// 2. Executor lease — CAS-claimed, heartbeat-renewed, epoch-fenced:
//      claim   = conditional UPDATE (lease free OR heartbeat stale) +
//                leaseEpoch increment → the epoch is the fencing token;
//      renew   = CAS on (owner, epoch) touching the heartbeat;
//      verify  = read check for self-detection after long awaits (glmCall);
//      fenced writes = every stateJson checkpoint and every transcript
//                append verifies (owner, epoch) in the same transaction /
//                WHERE clause, so an evicted executor can neither advance
//                the loop cursor nor append to a conversation it lost.
//    Timing: renew opportunistically at every checkpoint + a 10s interval;
//    staleAfter = 240s — deliberately larger than glmChat's worst-case wall
//    time (3 attempts × 60s timeout + backoffs ≈ 190s) so a leaseholder
//    legitimately busy in provider retries is never falsely evicted.
//
// Ordering rule that makes resume decidable: persist transcript FIRST, bump
// the stateJson cursor SECOND. Conversation is at-least-once; effects are
// exactly-once via tool-level idempotency probes (runtime.ts).
// ---------------------------------------------------------------------------

import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

/** Leader conversation key — member conversations use the taskId. */
export const LEADER_CONVERSATION = "leader";

/** Heartbeat renewed at least this often (plus opportunistic checkpoints). */
export const LEASE_RENEW_MS = 10_000;

/** Lease is stealable after this much silence (see header: > glm worst case). */
export const LEASE_STALE_MS = 240_000;

export type ChatRole = "user" | "assistant";

export type MessageKind =
  | "system_note" // role card persisted as the fake assistant message (wire parity)
  | "envelope" // first user message of a conversation (goal/brief + context)
  | "reply" // model turn
  | "tool_results" // TOOL RESULTS feed appended after a model turn
  | "repair" // VERIFY FAILED pushes in member repair rounds
  | "gate_stop" // appended when a gate stop drops out of the loop (audit marker,
  //   NOT replayed into a model context)
  | "wrap_up" // the one-shot budget wrap-up directive (a real wire message)
  | "resume_note"; // appended by the resume path (audit marker; HISTORICAL rows
  //   are not replayed — the CURRENT resume's note is pushed onto the live
  //   wire as a user message for the first resumed model turn)

export interface ExecutorLease {
  owner: string;
  epoch: number;
}

export interface AppendMessageParams {
  runId: string;
  /** LEADER_CONVERSATION for the leader; the taskId for member tasks. */
  conversationId: string;
  /** Set for member conversations; null on leader rows. */
  taskId?: string | null;
  agent: string;
  role: ChatRole;
  kind: MessageKind;
  content: string;
  /** Executor lease — verified in the same transaction as the insert. */
  lease: ExecutorLease;
}

/** Leader-loop scalar state, checkpointed once per turn (fenced CAS). */
export interface RunLoopState {
  /** Where the run was when checkpointed — resume orientation. */
  phase: "post-impact" | "leading" | "wrap-up";
  /** Leader turns fully processed (bumped AFTER transcript appends). */
  turnsUsed: number;
  taskCounter: number;
  delegateCount: number;
  /** Model-reported counters (parsed run reports) — finalReport input. */
  claimed: Record<string, number>;
  /** Honesty/audit issues accumulated so far. */
  issues: string[];
  /** QC repair rounds per chapter index (stringified JSON keys). */
  qcRepairs: Record<string, number>;
  /** Task 0 impact assessment text (captured before the envelope persisted). */
  impactReport: string | null;
  /**
   * True once the run's ONE budgeted wrap-up turn has been granted (lifetime
   * property). Checkpointed BEFORE the wrap-up model call, so no number of
   * crash→resume cycles can mint a second wrap-up turn — a resume that finds
   * this flag set with the turn budget spent takes the deterministic,
   * zero-GLM reconciliation path instead.
   */
  wrapUpGranted: boolean;
}

export class LeaseLostError extends Error {
  constructor(message = "Executor lease lost — another executor owns this run") {
    super(message);
    this.name = "LeaseLostError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableWriteConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002 unique violation (seq backstop) / P2034 write conflict or tx timeout
    return error.code === "P2002" || error.code === "P2034";
  }
  return false;
}

// ---------------------------------------------------------------------------
// Transcript appends
// ---------------------------------------------------------------------------

/**
 * Append one message to a run conversation. The lease verification and the
 * insert share ONE interactive transaction — SQLite single-writer makes the
 * check-then-append atomic, so an executor that lost its lease can never
 * append (and the seq unique index makes duplicate appends uncommittable).
 */
export async function appendAgentMessage(params: AppendMessageParams): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await db.$transaction(async (tx) => {
        const run = await tx.agentRun.findUnique({
          where: { id: params.runId },
          select: { leaseOwner: true, leaseEpoch: true },
        });
        if (!run) throw new LeaseLostError("Run vanished before message append");
        if (run.leaseOwner !== params.lease.owner || run.leaseEpoch !== params.lease.epoch) {
          throw new LeaseLostError();
        }
        const prev = await tx.agentMessage.aggregate({
          where: { runId: params.runId, conversationId: params.conversationId },
          _max: { seq: true },
        });
        await tx.agentMessage.create({
          data: {
            runId: params.runId,
            taskId: params.taskId ?? null,
            conversationId: params.conversationId,
            agent: params.agent,
            role: params.role,
            seq: (prev._max.seq ?? 0) + 1,
            content: params.content,
            kind: params.kind,
          },
        });
      });
      return;
    } catch (error) {
      if (error instanceof LeaseLostError) throw error;
      if (attempt < maxAttempts && isRetryableWriteConflict(error)) {
        await sleep(25 * attempt);
        continue;
      }
      throw error;
    }
  }
}

export type AppendMessageEntry = Omit<AppendMessageParams, "lease">;

/**
 * Batch append — several messages committed in ONE lease-verified transaction
 * (seq continues across the batch, per conversation). Used for the
 * reply+tool_results pairs so a crash between the two appends is impossible:
 * a dangling assistant reply in the canonical transcript would replay as two
 * consecutive assistant messages.
 */
export async function appendAgentMessages(
  lease: ExecutorLease,
  entries: AppendMessageEntry[]
): Promise<void> {
  if (entries.length === 0) return;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await db.$transaction(async (tx) => {
        const runId = entries[0].runId;
        const run = await tx.agentRun.findUnique({
          where: { id: runId },
          select: { leaseOwner: true, leaseEpoch: true },
        });
        if (!run) throw new LeaseLostError("Run vanished before message append");
        if (run.leaseOwner !== lease.owner || run.leaseEpoch !== lease.epoch) {
          throw new LeaseLostError();
        }
        const runIds = new Set(entries.map((e) => e.runId));
        if (runIds.size !== 1) {
          throw new Error("appendAgentMessages: entries span multiple runs");
        }
        // Per-conversation seq allocation inside the same interactive
        // transaction — SQLite's single writer makes read-MAX + INSERT atomic.
        const nextSeq = new Map<string, number>();
        for (const conversationId of new Set(entries.map((e) => e.conversationId))) {
          const prev = await tx.agentMessage.aggregate({
            where: { runId, conversationId },
            _max: { seq: true },
          });
          nextSeq.set(conversationId, prev._max.seq ?? 0);
        }
        for (const entry of entries) {
          const seq = (nextSeq.get(entry.conversationId) ?? 0) + 1;
          nextSeq.set(entry.conversationId, seq);
          await tx.agentMessage.create({
            data: {
              runId,
              taskId: entry.taskId ?? null,
              conversationId: entry.conversationId,
              agent: entry.agent,
              role: entry.role,
              seq,
              content: entry.content,
              kind: entry.kind,
            },
          });
        }
      });
      return;
    } catch (error) {
      if (error instanceof LeaseLostError) throw error;
      if (attempt < maxAttempts && isRetryableWriteConflict(error)) {
        await sleep(25 * attempt);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Replay a conversation in canonical order — the ONLY restore source for
 * model contexts. Reads AgentMessage exclusively; AgentEvent (truncated UI
 * stream, usage events) is never mixed in.
 */
export async function loadConversation(
  runId: string,
  conversationId: string
): Promise<{ role: ChatRole; content: string; kind: MessageKind; agent: string }[]> {
  const rows = await db.agentMessage.findMany({
    where: { runId, conversationId },
    orderBy: { seq: "asc" },
    select: { role: true, content: true, kind: true, agent: true },
  });
  return rows.map((r) => ({
    role: r.role as ChatRole,
    content: r.content,
    kind: r.kind as MessageKind,
    agent: r.agent,
  }));
}

// ---------------------------------------------------------------------------
// Executor lease
// ---------------------------------------------------------------------------

/**
 * Atomically claim the run's executor lease (conditional UPDATE = compare-
 * and-swap on SQLite's single writer). Returns null when a live lease is
 * held elsewhere. The incremented epoch is the fencing token.
 */
export async function claimLease(
  runId: string,
  staleMs = LEASE_STALE_MS
): Promise<ExecutorLease | null> {
  const owner = randomUUID();
  const staleBefore = new Date(Date.now() - staleMs);
  const claim = await db.agentRun.updateMany({
    where: {
      id: runId,
      OR: [{ leaseOwner: null }, { leaseHeartbeatAt: { lt: staleBefore } }],
    },
    data: { leaseOwner: owner, leaseHeartbeatAt: new Date(), leaseEpoch: { increment: 1 } },
  });
  if (claim.count !== 1) return null;
  const run = await db.agentRun.findUnique({
    where: { id: runId },
    select: { leaseOwner: true, leaseEpoch: true },
  });
  if (!run || run.leaseOwner !== owner) return null; // defensive: re-verify ownership
  return { owner, epoch: run.leaseEpoch };
}

/** Heartbeat renewal — CAS on (owner, epoch). false ⇒ lease lost. */
export async function renewLease(runId: string, lease: ExecutorLease): Promise<boolean> {
  const r = await db.agentRun.updateMany({
    where: { id: runId, leaseOwner: lease.owner, leaseEpoch: lease.epoch },
    data: { leaseHeartbeatAt: new Date() },
  });
  return r.count === 1;
}

/** Ownership self-detection (read-only check after long awaits). */
export async function verifyLease(runId: string, lease: ExecutorLease): Promise<boolean> {
  const run = await db.agentRun.findUnique({
    where: { id: runId },
    select: { leaseOwner: true, leaseEpoch: true },
  });
  return !!run && run.leaseOwner === lease.owner && run.leaseEpoch === lease.epoch;
}

/**
 * Lease is alive if held and heartbeaten within staleMs — healStaleRuns and
 * the resume endpoint both key off this so an executor alive in a long gate
 * wait or provider retry is never treated as dead.
 */
export async function leaseIsAlive(runId: string, staleMs = LEASE_STALE_MS): Promise<boolean> {
  const run = await db.agentRun.findUnique({
    where: { id: runId },
    select: { leaseOwner: true, leaseHeartbeatAt: true },
  });
  if (!run || !run.leaseOwner || !run.leaseHeartbeatAt) return false;
  return run.leaseHeartbeatAt.getTime() > Date.now() - staleMs;
}

/** Graceful release on normal loop exit (epoch is kept — monotonic forever). */
export async function releaseLease(runId: string, lease: ExecutorLease): Promise<void> {
  await db.agentRun
    .updateMany({
      where: { id: runId, leaseOwner: lease.owner, leaseEpoch: lease.epoch },
      data: { leaseOwner: null },
    })
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Leader-loop state checkpoints
// ---------------------------------------------------------------------------

/**
 * Fenced checkpoint — the cursor advances ONLY if the writer still owns the
 * lease at the exact epoch. count === 0 ⇒ evicted ⇒ the caller must abort
 * without touching anything else. Atomic single-row UPDATE: no partial JSON.
 */
export async function writeLoopState(
  runId: string,
  lease: ExecutorLease,
  state: RunLoopState
): Promise<boolean> {
  const r = await db.agentRun.updateMany({
    where: { id: runId, leaseOwner: lease.owner, leaseEpoch: lease.epoch },
    data: { stateJson: JSON.stringify(state), leaseHeartbeatAt: new Date() },
  });
  return r.count === 1;
}

export async function readLoopState(runId: string): Promise<RunLoopState | null> {
  const run = await db.agentRun.findUnique({ where: { id: runId }, select: { stateJson: true } });
  return parseRunLoopState(run?.stateJson ?? null);
}

/** Defensive parse — a corrupt/legacy stateJson degrades to a fresh start. */
export function parseRunLoopState(raw: string | null | undefined): RunLoopState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<RunLoopState>;
    if (typeof s !== "object" || s === null) return null;
    const intOr = (v: unknown, fallback: number) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
    const recordOr = (v: unknown): Record<string, number> => {
      if (typeof v !== "object" || v === null) return {};
      const out: Record<string, number> = {};
      for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
        if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
      }
      return out;
    };
    return {
      phase: s.phase === "post-impact" || s.phase === "wrap-up" ? s.phase : "leading",
      turnsUsed: intOr(s.turnsUsed, 0),
      taskCounter: intOr(s.taskCounter, 0),
      delegateCount: intOr(s.delegateCount, 0),
      claimed: recordOr(s.claimed),
      issues: Array.isArray(s.issues) ? s.issues.filter((x): x is string => typeof x === "string") : [],
      qcRepairs: recordOr(s.qcRepairs),
      impactReport: typeof s.impactReport === "string" ? s.impactReport : null,
      wrapUpGranted: s.wrapUpGranted === true,
    };
  } catch {
    return null;
  }
}
