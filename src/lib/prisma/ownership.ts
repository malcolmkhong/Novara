// ---------------------------------------------------------------------------
// Novara AI — admin-aware ownership helpers.
//
// Route handlers read `x-novara-uid` and `x-novara-admin` from the request
// headers (set by src/middleware.ts) and use `ownershipWhere()` to build the
// Prisma `where` clause. When the caller is an admin, ownership filtering is
// skipped entirely.
//
// NOTE: Novel/Chapter/etc. do not yet carry a `userId` column — the
// ownership filter is a scaffold for when auth lands (DEPLOYMENT-GOOGLE.md
// v2 Step 4). Until then, `novelOwnershipWhere` returns {} for everyone,
// which matches the current behaviour.
// ---------------------------------------------------------------------------

import { headers } from "next/headers";

export async function isAdminRequest(): Promise<boolean> {
  try {
    const h = await headers();
    return h.get("x-novara-admin") === "1";
  } catch {
    return false;
  }
}

export async function currentUserId(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get("x-novara-uid");
  } catch {
    return null;
  }
}

/**
 * Build the ownership `where` clause for a Novel-scoped query.
 * NOTE: the real enforcement lives in src/lib/db.ts (`$allOperations`), which
 * applies this to every model. This helper mirrors it for ad-hoc callers.
 * Admins get no filter; a missing uid fails closed.
 */
export async function novelOwnershipWhere(): Promise<Record<string, unknown>> {
  if (await isAdminRequest()) return {};
  const uid = await currentUserId();
  if (!uid) return { id: { in: [] } };
  return { userId: uid };
}
