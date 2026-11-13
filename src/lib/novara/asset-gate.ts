// ---------------------------------------------------------------------------
// Novara AI — asset archive (Phase 9 + STEP 79).
//
// The canon RULE (a final asset is immutable; a reopen archives it, a
// finalize locks it) lives in src/lib/novara/lifecycle.ts and is enforced at
// the route layer — a mutation of a final asset is refused with 409 and the
// typed body { error: "asset_finalized", kind, id, reopen }.
//
// This module keeps the ARCHIVE half of that rule:
//
//   1. Reopening archives the final state VERBATIM into AssetVersion
//      (reason "reopen", the original is kept).
//   2. Locking an asset (status → "final") archives the pre-final state
//      (reason "finalize") so the canon trail is auditable end to end.
//
// Snapshot format is a labeled text block (SQLite + Prisma: no JSON columns).
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";

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
  | "contract"
  | "pack";

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
