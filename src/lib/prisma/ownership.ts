// ---------------------------------------------------------------------------
// Novara AI — admin-aware ownership helpers.
//
// Route handlers read `x-novara-uid` and `x-novara-admin` from the request
// headers (set by src/middleware.ts) and use `currentUserId()` to identify
// the caller.
//
// Auth has landed: Firebase Auth (Google sign-in) verified by
// src/middleware.ts, which injects the uid these helpers read. Novel carries
// userId; the other authored models are filtered through their novel.
// (The old "scaffold for when auth lands / DEPLOYMENT-GOOGLE.md v2 Step 4"
// note is obsolete — that GIS proposal was archived and never shipped.)
//
// The real enforcement lives in src/lib/db.ts (`$allOperations`), which
// applies ownership to every model on every query — including queries made
// from an interactive transaction.
// ---------------------------------------------------------------------------

import { headers } from "next/headers";

export async function currentUserId(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get("x-novara-uid");
  } catch {
    return null;
  }
}
