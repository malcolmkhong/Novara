// ---------------------------------------------------------------------------
// Novara AI — asset gate (Phase 9): the write-gate law for NON-BODY assets.
//
// Chapters already obey lib/novara/write-gate.ts (the finalization lock + 409
// + reopen demotion + ChapterVersion snapshots). This module extends the SAME
// law to the rest of the repository — characters, world entries, outline
// beats, volumes, ledger rows and the story contract:
//
//   1. A `final` asset is Immutable Canon: any PATCH/DELETE without an
//      explicit `reopen: true` is refused with 409 requiresReopen.
//   2. Reopening archives the final state VERBATIM into AssetVersion
//      (reason "reopen", the original is kept) and downgrades the asset to
//      draft in the same request — the revision then flows through the normal
//      draft path.
//   3. Locking an asset (status → "final") archives the pre-final state
//      (reason "finalize") so the canon trail is auditable end to end.
//
// Snapshot format is a labeled text block (SQLite + Prisma: no JSON columns).
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { jsonError } from "@/lib/novara/api-helpers";

export type AssetType =
  | "character"
  | "world_entry"
  | "outline_beat"
  | "volume"
  | "storyline"
  | "timeline_entry"
  | "character_arc"
  | "story_promise"
  | "story_clue"
  | "contract";

/** The row field that carries the canon lock: `status` (most assets) or
 * `lock` (storyline/promise/clue, whose `status` is a lifecycle state). */
export type AssetLockField = "status" | "lock";

/** Build the labeled snapshot block preserved into AssetVersion. */
export function buildAssetSnapshot(
  fields: Record<string, string | number | null | undefined>
): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    lines.push(`[${key}] ${value === null ? "" : String(value)}`);
  }
  return lines.join("\n");
}

/**
 * Archive a labeled snapshot of an asset's state.
 *
 * reason "reopen" | "finalize" preserve canon; reason "manual" records a
 * change that is neither — the agent moving a promise forward, for example.
 * createdBy carries WHO (author | agent) and the snapshot text carries the
 * WHY, so the trail is self-contained without inventing a column.
 */
export async function archiveAssetVersion(input: {
  novelId: string;
  assetType: AssetType;
  assetId: string;
  assetLabel: string;
  reason: "reopen" | "finalize" | "manual";
  snapshot: string;
  createdBy?: string;
  /** Optional transaction client — the base client would need a second
   *  connection inside an interactive transaction (connection_limit=1). */
  tx?: {
    assetVersion: {
      create(args: {
        data: {
          novelId: string;
          assetType: string;
          assetId: string;
          assetLabel: string;
          reason: string;
          snapshot: string;
          createdBy: string;
        };
      }): Promise<unknown>;
    };
  };
}): Promise<void> {
  const client = input.tx ?? db;
  await client.assetVersion.create({
    data: {
      novelId: input.novelId,
      assetType: input.assetType,
      assetId: input.assetId,
      assetLabel: input.assetLabel,
      reason: input.reason,
      snapshot: input.snapshot,
      createdBy: input.createdBy ?? "author",
    },
  });
}

export interface AssetGateInput {
  novelId: string;
  assetType: AssetType;
  assetId: string;
  assetLabel: string;
  /** Current lock field value: "draft" | "final". */
  lockState: string;
  /** Which row field carries the lock (drives the downgrade update). */
  lockField: AssetLockField;
  /** Client explicitly asked to reopen a locked asset. */
  reopen?: boolean;
  /** Patch tries to lock the asset (status/lock → "final"). */
  wantsFinal?: boolean;
  /** Full current row field values, archived verbatim. */
  snapshotFields: Record<string, string | number | null | undefined>;
}

export interface AssetGateResult {
  /** Reopen path ran: the final state was archived and the row must be
   * downgraded to draft as part of the caller's update. */
  reopened: boolean;
  /** Finalize path ran: the pre-final state was archived. */
  finalized: boolean;
}

/**
 * Evaluate the gate BEFORE any write. Returns the flags the caller must fold
 * into its update, or a ready-to-return 409 Response.
 *
 * On reopen the caller MUST also set `status/lock = "draft"` and
 * `finalizedAt = null` (convenience: `canonDowngrade(lockField)`).
 */
export async function assetGate(
  input: AssetGateInput
): Promise<AssetGateResult | Response> {
  const locked = input.lockState === "final";

  if (locked) {
    if (!input.reopen) {
      return jsonError(
        "该资产已定稿（Immutable Canon），不可直接修改。修订请先解除定稿（reopen）——原版会自动存档。",
        409
      );
    }
    // Archive the final state verbatim BEFORE the downgrade write.
    await archiveAssetVersion({
      novelId: input.novelId,
      assetType: input.assetType,
      assetId: input.assetId,
      assetLabel: input.assetLabel,
      reason: "reopen",
      snapshot: buildAssetSnapshot(input.snapshotFields),
    });
    return { reopened: true, finalized: false };
  }

  if (input.wantsFinal) {
    await archiveAssetVersion({
      novelId: input.novelId,
      assetType: input.assetType,
      assetId: input.assetId,
      assetLabel: input.assetLabel,
      reason: "finalize",
      snapshot: buildAssetSnapshot(input.snapshotFields),
    });
    return { reopened: false, finalized: true };
  }

  return { reopened: false, finalized: false };
}

/** The downgrade data every reopen path must fold into its update. */
export function canonDowngrade(lockField: AssetLockField): {
  status?: "draft";
  lock?: "draft";
  finalizedAt: null;
} {
  return lockField === "status"
    ? { status: "draft" as const, finalizedAt: null }
    : { lock: "draft" as const, finalizedAt: null };
}

/** The lock data every finalize path must fold into its update. */
export function canonLock(lockField: AssetLockField): {
  status?: "final";
  lock?: "final";
  finalizedAt: Date;
} {
  return lockField === "status"
    ? { status: "final" as const, finalizedAt: new Date() }
    : { lock: "final" as const, finalizedAt: new Date() };
}

/** DELETE gate — a locked asset refuses deletion unless reopen is explicit;
 * even then the final state is archived first (the original is kept). */
export async function assetDeleteGate(input: {
  novelId: string;
  assetType: AssetType;
  assetId: string;
  assetLabel: string;
  lockState: string;
  snapshotFields: Record<string, string | number | null | undefined>;
  reopen?: boolean;
}): Promise<Response | null> {
  if (input.lockState !== "final") return null;
  if (!input.reopen) {
    return jsonError(
      "该资产已定稿（Immutable Canon），不可直接删除。请先解除定稿（reopen）再删除——原版会自动存档。",
      409
    );
  }
  await archiveAssetVersion({
    novelId: input.novelId,
    assetType: input.assetType,
    assetId: input.assetId,
    assetLabel: input.assetLabel,
    reason: "reopen",
    snapshot: buildAssetSnapshot(input.snapshotFields),
  });
  return null;
}
