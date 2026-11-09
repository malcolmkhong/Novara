// ---------------------------------------------------------------------------
// Novara AI — wire assembly + deterministic compaction projection (Phase 2).
//
// ONE replay path for canonical transcripts. Today's inline replay (runtime.ts
// resume init) is preserved byte-for-byte as legacyReplay(); when compaction
// is DISABLED (or no active summary exists) assembleWire() returns exactly
// that — the byte-identity guarantee asserted by scripts/verify-p2-b.ts.
//
// Binding input rule (agent-ctx/p2-design.md §2.0): every summary row is a
// DETERMINISTIC, ZERO-AI projection recomputed from the raw canonical
// AgentMessage rows over [fromSeq..toSeq] ONLY. Prior summary text is NEVER
// an input — the superseded row exists solely to define the prior cut and as
// the audit trail of cuts.
//
// The assembler is PURE over its inputs (no DB reads/writes); the lease-fenced
// summary writer (writeCompactionSummary) is the only DB-mutating primitive
// and is called between turns by the runtime in P2-c. Contiguity violations
// and corrupt chain state fail LOUD: console.error here + fallbackWarnings
// for the caller to raise an AgentEvent(kind="error") via
// fallbackErrorSummary() — content is never silently dropped (the fallback is
// always the full raw replay).
//
// Adjacency ownership (design §2.1.y, amendment M2): EVERY assembled output —
// disabled replay, projected replay, fallback replay — passes through ONE
// normalization step, finalizeWire(), as the single owner of the
// adjacent-user-messages decision (Phase-2 contract: preserved 1:1 verbatim,
// NEVER merged; transcript rows untouched on disk).
// ---------------------------------------------------------------------------

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { countTokens } from "./context-meter";
import { LeaseLostError, type ExecutorLease, type MessageKind } from "./messages";

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export interface WireMessage {
  role: "assistant" | "user";
  content: string;
}

/** Shape returned by loadConversation (seq added in Phase 2). */
export interface SequencedRow {
  seq: number;
  role: "user" | "assistant";
  content: string;
  kind: MessageKind;
  agent: string;
}

/** The active (or corrupt) chain-head inputs the assembler projects from. */
export interface ActiveSummary {
  id?: string;
  fromSeq: number;
  toSeq: number;
  summary: string;
}

export interface AssembleWireResult {
  messages: WireMessage[];
  /** Set iff the wire carries a projection block (compaction active). */
  projected: { fromSeq: number; toSeq: number; text: string } | null;
  /** Non-empty ⇒ the raw replay fallback fired; caller must fail loud. */
  fallbackWarnings: string[];
}

/** Static version token — framing changes must bump it (design §2.1.x). */
export const PROJECTION_VERSION = "ctx-proj/v1";

/** Per-row clip caps of the deterministic body (fixed constants, not config). */
export const REPLY_CLIP_CHARS = 220;
export const FEED_CLIP_CHARS = 160;

/**
 * Audit markers: persisted rows that are NEVER replayed into a model context.
 * They are covered by a summary's seq range (the seq domain is dense) but are
 * not rendered into the projection body — consistent with their contract.
 */
const MARKER_KINDS: ReadonlySet<string> = new Set(["gate_stop", "resume_note"]);

function isMarker(kind: string): boolean {
  return MARKER_KINDS.has(kind);
}

/**
 * Deterministic clip: collapse whitespace runs, trim, hard-cap with "…".
 */
function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1))}…`;
}

// ---------------------------------------------------------------------------
// Assembly-output normalization — the ONE adjacency owner (design §2.1.y, M2)
// ---------------------------------------------------------------------------

/**
 * The single normalization step applied to EVERY assembled wire — disabled
 * replay, projected replay, and fallback replay alike. Contract (Phase-2
 * shipped state):
 *   - adjacent user messages are preserved 1:1 VERBATIM — NEVER merged
 *     (projection→user-tail adjacency AND transcript-internal pairs). This is
 *     the provider-proven Phase 1 wire shape; keeping it also keeps the
 *     disabled path byte-identical (this step is identity-preserving on real
 *     wires).
 *   - the ONLY mutation: messages with empty/whitespace-only content are
 *     dropped (a contentless wire message is protocol garbage no provider
 *     path benefits from; real appends never produce one).
 *   - order, roles, and all other content pass through byte-verbatim.
 * If a provider constraint ever forces a merge, THIS function is the single
 * place to change — one owner, one diff (design §2.1.y).
 */
export function finalizeWire(messages: WireMessage[]): WireMessage[] {
  return messages.filter((m) => m.content.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Legacy replay — byte-for-byte today's path (runtime.ts resume init)
// ---------------------------------------------------------------------------

/**
 * The wire as Phase 1 shipped it: system-note-on-wire replay with historical
 * gate_stop / resume_note rows filtered out. When P2-c rewires the runtime
 * onto assembleWire(), this function becomes the single implementation of
 * that filter — until then the harness compares assembler-disabled against
 * this reference to prove byte identity.
 */
export function legacyReplay(rows: SequencedRow[]): WireMessage[] {
  return finalizeWire(
    rows
      .filter((r) => !isMarker(r.kind))
      .map((r) => ({ role: r.role, content: r.content }))
  );
}

// ---------------------------------------------------------------------------
// Deterministic projection builder (§2.0 binding rule)
// ---------------------------------------------------------------------------

/**
 * Build the projection BODY from raw canonical rows over [fromSeq..toSeq]
 * ONLY — one line per covered replayable row, seq ASC, fixed clips. Marker
 * rows inside the span are covered but not rendered (never-replayed contract).
 */
export function buildProjectionBody(
  rows: SequencedRow[],
  fromSeq: number,
  toSeq: number
): string {
  const covered = rows.filter(
    (r) =>
      r.seq >= fromSeq &&
      r.seq <= toSeq &&
      !isMarker(r.kind) &&
      r.kind !== "system_note" &&
      r.kind !== "envelope"
  );
  const lines = covered.map((r) => {
    switch (r.kind) {
      case "reply":
        return `seq ${r.seq} · replied: ${clip(r.content, REPLY_CLIP_CHARS)}`;
      case "final":
        return `seq ${r.seq} · closing reply: ${clip(r.content, REPLY_CLIP_CHARS)}`;
      case "tool_results":
        return `seq ${r.seq} · tool results: ${clip(r.content, FEED_CLIP_CHARS)}`;
      case "repair":
        return `seq ${r.seq} · repair note: ${clip(r.content, FEED_CLIP_CHARS)}`;
      default:
        return `seq ${r.seq} · ${r.kind}: ${clip(r.content, FEED_CLIP_CHARS)}`;
    }
  });
  return lines.join("\n");
}

/** The PINNED framing template (design §2.1.x) — byte-deterministic. */
export function renderProjection(fromSeq: number, toSeq: number, body: string): string {
  return (
    `[CONTEXT PROJECTION ${PROJECTION_VERSION} — deterministic compaction of transcript rows ` +
    `seq ${fromSeq}..${toSeq}. NOT verbatim history. Originals remain in canonical history; ` +
    `retrieve exact detail with read tools.]\n` +
    `${body}\n` +
    `[/CONTEXT PROJECTION]`
  );
}

// ---------------------------------------------------------------------------
// Cut selection + contiguity
// ---------------------------------------------------------------------------

/** seq of the conversation's envelope row (the compaction anchor). */
export function findEnvelopeSeq(rows: SequencedRow[]): number | null {
  return rows.find((r) => r.kind === "envelope")?.seq ?? null;
}

/**
 * Where would the cut land? Keeps the last `tailTurns` reply turns verbatim
 * (cut = seq of the row right before the first kept reply), refuses to
 * compact below `minCompactableRows` replayable covered rows. null ⇒ nothing
 * to compact (too few turns / no envelope / degenerate span).
 */
export function decideCut(
  rows: SequencedRow[],
  tailTurns: number,
  minCompactableRows: number
): { cut: number; coverableRows: number } | null {
  const envelopeSeq = findEnvelopeSeq(rows);
  if (envelopeSeq === null) return null;
  const replayable = rows.filter((r) => !isMarker(r.kind));
  const replies = replayable.filter((r) => r.kind === "reply");
  if (replies.length <= tailTurns) return null;
  const firstTail = replies[replies.length - tailTurns];
  const cut = firstTail.seq - 1;
  if (cut < envelopeSeq + 1) return null;
  const coverableRows = replayable.filter(
    (r) => r.seq >= envelopeSeq + 1 && r.seq <= cut
  ).length;
  if (coverableRows < minCompactableRows) return null;
  return { cut, coverableRows };
}

/**
 * Contiguity invariant (design §2.2). Returns warnings; empty ⇒ the summary
 * may project. Checks: single active head is the CALLER's array length; head
 * gap (fromSeq must be envelope+1); cover overshoot (toSeq ≤ maxSeq);
 * degenerate span.
 */
export function checkContiguity(
  summary: ActiveSummary,
  rows: SequencedRow[],
  envelopeSeq: number
): string[] {
  const warnings: string[] = [];
  const maxSeq = rows.length > 0 ? rows[rows.length - 1].seq : 0;
  if (summary.fromSeq !== envelopeSeq + 1) {
    warnings.push(
      `contiguity: head gap — summary.fromSeq=${summary.fromSeq} but envelope.seq+1=${envelopeSeq + 1} (rows between them would be silently lost)`
    );
  }
  if (summary.toSeq > maxSeq) {
    warnings.push(`contiguity: cover overshoot — summary.toSeq=${summary.toSeq} > maxSeq=${maxSeq}`);
  }
  if (summary.toSeq < summary.fromSeq) {
    warnings.push(`contiguity: degenerate cover — toSeq=${summary.toSeq} < fromSeq=${summary.fromSeq}`);
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Assembler
// ---------------------------------------------------------------------------

/**
 * Assemble the NEXT model wire from the canonical conversation.
 *
 * - No active summaries (or compaction inactive) ⇒ byte-identical legacy
 *   replay (the P2-b guarantee).
 * - One contiguous active summary ⇒ [system_note][envelope][projection(user)]
 *   [verbatim tail > toSeq] — non-identical BY DESIGN, metered as sent.
 * - Corrupt chain state (multiple active heads, head gap, overshoot) ⇒ full
 *   raw replay fallback + console.error + fallbackWarnings (caller raises
 *   AgentEvent kind="error" — P2-c). Never silent, never lossy.
 */
export function assembleWire(params: {
  rows: SequencedRow[];
  /** ALL active (supersededAt IS NULL) summary rows for this conversation. */
  activeSummaries?: ActiveSummary[];
}): AssembleWireResult {
  const { rows } = params;
  const summaries = params.activeSummaries ?? [];
  const legacy = legacyReplay(rows);

  if (summaries.length === 0) {
    // M2: the disabled path flows through the same single normalization owner.
    return { messages: finalizeWire(legacy), projected: null, fallbackWarnings: [] };
  }

  const fail = (warnings: string[]): AssembleWireResult => {
    for (const w of warnings) console.error(`[wire] compaction fallback — ${w}`);
    return { messages: finalizeWire(legacy), projected: null, fallbackWarnings: warnings };
  };

  if (summaries.length > 1) {
    return fail([`corrupt chain state: ${summaries.length} active summary rows (expected exactly 1)`]);
  }
  const summary = summaries[0];
  const envelopeSeq = findEnvelopeSeq(rows);
  if (envelopeSeq === null) {
    return fail(["no envelope row in conversation — nothing to anchor the compaction cover to"]);
  }
  const warnings = checkContiguity(summary, rows, envelopeSeq);
  if (warnings.length > 0) return fail(warnings);

  // v1 wire: system card rides as the fake assistant message, the envelope
  // stays verbatim, then the projection block, then the verbatim tail.
  // Adjacent user messages (projection → first tail row when it is a user
  // row) pass through finalizeWire 1:1 — never merged (design §2.1.y).
  const systemNote = rows.find((r) => r.kind === "system_note");
  const envelope = rows.find((r) => r.kind === "envelope");
  const tail = rows.filter((r) => r.seq > summary.toSeq && !isMarker(r.kind));
  const messages: WireMessage[] = [];
  if (systemNote) messages.push({ role: systemNote.role, content: systemNote.content });
  if (envelope) messages.push({ role: envelope.role, content: envelope.content });
  messages.push({ role: "user", content: summary.summary });
  for (const r of tail) messages.push({ role: r.role, content: r.content });

  return {
    messages: finalizeWire(messages),
    projected: { fromSeq: summary.fromSeq, toSeq: summary.toSeq, text: summary.summary },
    fallbackWarnings: [],
  };
}

// ---------------------------------------------------------------------------
// Fallback → error-event bridge (the runtime's AgentEvent(kind="error") body)
// ---------------------------------------------------------------------------

/**
 * The EXACT summary string the runtime emits as AgentEvent(kind="error") when
 * the assembler reports fallbackWarnings (design §2.2: fail loud, name the
 * row and the gap). Single owner of that wording so the harness can assert
 * the wiring without executing the runtime loop.
 */
export function fallbackErrorSummary(warnings: string[]): string {
  return `Context compaction fell back to the FULL raw transcript replay — ${warnings.join(" | ")}`;
}

// ---------------------------------------------------------------------------
// Monotone cost guard (P2-d, design §2.3.1)
// ---------------------------------------------------------------------------

/**
 * The margin the candidate must beat the skip-baseline by before a summary
 * row is written and the live wire is rewired. Below this saving a projection
 * rewrite is churn (a row write + a rewire + telemetry noise inside the
 * estimator's own precision band) — the cycle skips instead. Documented
 * constant, NOT config: changing it is a design-doc event (§2.3.1).
 */
export const COMPACTION_SLACK_TOKENS = 256;

/** Token estimate for a full next-call wire — the meter's own estimator. */
export function countWireTokens(messages: WireMessage[]): number {
  return messages.reduce((sum, m) => sum + countTokens(m.content), 0);
}

export interface GuardVerdict {
  /** true ⇒ write the summary row and rewire; false ⇒ skip this cycle loudly. */
  proceed: boolean;
  baselineTokens: number;
  projectedTokens: number;
  slackTokens: number;
}

/**
 * MONOTONE COST GUARD (design §2.3.1): an ENABLED compaction must never make
 * the NEXT model call more expensive than not compacting. Zero-AI: both
 * candidate next-call wires are assembled in memory and compared with the
 * meter's estimator —
 *   baseline  = the wire that would be sent if this cycle SKIPS (the current
 *               live wire — on the FIRST compaction cycle this IS the legacy
 *               full replay, so the comparison is "legacy vs projected"
 *               exactly; on re-compaction cycles it is the STRONGER, correct
 *               baseline that makes the monotone promise literal);
 *   candidate = the wire that would be sent if this cycle ADOPTS (new
 *               projection + its verbatim tail + live injections).
 * Adopt only if candidate < baseline − slack. Otherwise the caller skips
 * LOUDLY (telemetry event, NO row written) and the live wire stays untouched.
 * Pure + deterministic: same inputs ⇒ same verdict, zero AI, no I/O.
 */
export function monotoneGuardCheck(params: {
  baselineMessages: WireMessage[];
  candidateMessages: WireMessage[];
  slackTokens?: number;
}): GuardVerdict {
  const slackTokens = params.slackTokens ?? COMPACTION_SLACK_TOKENS;
  const baselineTokens = countWireTokens(params.baselineMessages);
  const projectedTokens = countWireTokens(params.candidateMessages);
  return {
    proceed: projectedTokens < baselineTokens - slackTokens,
    baselineTokens,
    projectedTokens,
    slackTokens,
  };
}

/**
 * Single owner of the loud-skip telemetry wording (harness-asserted, the
 * fallbackErrorSummary pattern): the caller emits this as a kind="message"
 * AgentEvent when monotoneGuardCheck refuses the cycle.
 */
export function guardSkipSummary(turn: number, v: GuardVerdict): string {
  return (
    `Context compaction skipped after leader turn ${turn} — monotone cost guard: projected wire ` +
    `≈ ${v.projectedTokens} tok ≥ skip-baseline ${v.baselineTokens} tok − slack ${v.slackTokens} tok ` +
    "(the turn-counted tail outweighs the covered span this cycle). " +
    "No summary row written; the live wire stays unchanged."
  );
}

// ---------------------------------------------------------------------------
// Lease-fenced summary writer (the only DB-mutating primitive)
// ---------------------------------------------------------------------------

/**
 * P2002 idempotence rule (design §2.3, amendment M3): a retry at an existing
 * cut completes the interrupted link ONLY when the existing row is ACTIVE.
 * A P2002 against a SUPERSEDED row is NOT "done" — the writer returns
 * ok:false("cut already superseded") and the caller skips loudly, never
 * adopting the dead row.
 */
export interface WriteSummaryResult {
  ok: boolean;
  /** true ⇒ an active row already existed at this cut (idempotent retry). */
  already?: boolean;
  reason?: string;
  row?: { id: string; fromSeq: number; toSeq: number; summary: string };
}

/**
 * Write ONE chain link: lease-verified interactive transaction —
 *   (a) re-verify (owner, epoch) on AgentRun — deposed writer lands nothing;
 *   (b) build the projection from RAW rows over [envelope+1 .. newCut] (§2.0 —
 *       prior summary text is never an input);
 *   (c) insert the new ContextSummary stamped leaseEpoch;
 *   (d) conditional supersede of every OTHER active row (the fence).
 * P2002 at the same cut = interrupted retry completing itself: if the
 * existing row is active, finish its supersede step and report already=true.
 */
export async function writeCompactionSummary(params: {
  runId: string;
  conversationId: string;
  taskId?: string | null;
  agent: string;
  /** FULL canonical conversation (loadConversation output), seq ASC. */
  rows: SequencedRow[];
  newCut: number;
  lease: ExecutorLease;
}): Promise<WriteSummaryResult> {
  const { runId, conversationId, rows, newCut, lease } = params;
  const envelopeSeq = findEnvelopeSeq(rows);
  if (envelopeSeq === null) return { ok: false, reason: "no envelope row" };
  const fromSeq = envelopeSeq + 1;
  if (newCut < fromSeq) return { ok: false, reason: "cut before envelope boundary" };
  const maxSeq = rows.length > 0 ? rows[rows.length - 1].seq : 0;
  if (newCut > maxSeq) return { ok: false, reason: "cut beyond transcript" };
  const body = buildProjectionBody(rows, fromSeq, newCut);
  if (!body) return { ok: false, reason: "nothing replayable to compact in cover" };
  const summary = renderProjection(fromSeq, newCut, body);

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const run = await tx.agentRun.findUnique({
          where: { id: runId },
          select: { leaseOwner: true, leaseEpoch: true },
        });
        if (!run) throw new LeaseLostError("Run vanished before summary write");
        if (run.leaseOwner !== lease.owner || run.leaseEpoch !== lease.epoch) {
          throw new LeaseLostError();
        }
        const priors = await tx.contextSummary.findMany({
          where: { runId, conversationId, supersededAt: null },
          select: { id: true },
        });
        let insertedId: string;
        let already = false;
        try {
          const created = await tx.contextSummary.create({
            data: {
              runId,
              conversationId,
              taskId: params.taskId ?? null,
              agent: params.agent,
              fromSeq,
              toSeq: newCut,
              summary,
              leaseEpoch: lease.epoch,
            },
          });
          insertedId = created.id;
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
          ) {
            // Same cut already written — complete the interrupted link.
            const existing = await tx.contextSummary.findUnique({
              where: {
                runId_conversationId_toSeq: { runId, conversationId, toSeq: newCut },
              },
            });
            if (!existing) throw error;
            if (existing.supersededAt !== null) {
              return { ok: false, reason: "cut already superseded" };
            }
            insertedId = existing.id;
            already = true;
          } else {
            throw error;
          }
        }
        const stalePriors = priors.filter((p) => p.id !== insertedId);
        if (stalePriors.length > 0) {
          await tx.contextSummary.updateMany({
            where: { id: { in: stalePriors.map((p) => p.id) }, supersededAt: null },
            data: { supersededAt: new Date() },
          });
        }
        return {
          ok: true,
          already,
          row: { id: insertedId, fromSeq, toSeq: newCut, summary },
        };
      });
    } catch (error) {
      if (error instanceof LeaseLostError) throw error;
      if (attempt < maxAttempts && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        await new Promise((r) => setTimeout(r, 25 * attempt));
        continue;
      }
      throw error;
    }
  }
  return { ok: false, reason: "unreachable" };
}
