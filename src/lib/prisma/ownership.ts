// ---------------------------------------------------------------------------
// Novara AI — admin-aware ownership helpers.
//
// Route handlers read `x-novara-uid` and `x-novara-admin` from the request
// headers (set by src/middleware.ts) and use `currentUserId()` to identify
// the caller.
//
// NOTE: Novel/Chapter/etc. do not yet carry a `userId` column — the
// ownership filter is a scaffold for when auth lands (DEPLOYMENT-GOOGLE.md
// v2 Step 4).
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
