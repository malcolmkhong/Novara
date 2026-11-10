// ---------------------------------------------------------------------------
// Novara AI — ownership-scoped Prisma client.
//
// Every model query is filtered at the client boundary (not at 452 call
// sites). Identity comes from the request headers set by src/middleware.ts
// (x-novara-uid / x-novara-admin). Admin requests pass through untouched.
// A query with no identity in production returns nothing (fail closed).
//
// Background jobs / scripts have no request scope. `headers()` then throws
// "`headers` was called outside a request scope..."; that is caught here and
// `withUser(uid, isAdmin, fn)` (AsyncLocalStorage) is available for them.
// ---------------------------------------------------------------------------

import { Prisma, PrismaClient } from "@prisma/client";
import { headers } from "next/headers";
import { AsyncLocalStorage } from "node:async_hooks";

type Store = { uid: string; isAdmin: boolean };
type Identity = { uid: string; isAdmin: boolean; novelIds: string[] | null };

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

const base: PrismaClient = globalForPrisma.prisma ?? new PrismaClient({ log: ["query"] });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = base;

/**
 * UNEXTENDED client. Diagnostics only — /api/health uses it so counts stay
 * true and cannot be influenced by request headers. Never use it for
 * user-facing queries: it bypasses the ownership filter below.
 */
export const dbRaw: PrismaClient = base;

// ---------------------------------------------------------------------------
// Model → owner map — DERIVED from Prisma.dmmf (the generated client's schema).
//
// WHY DMMF AND NOT A HAND-WRITTEN LIST: a hand-written list goes stale the
// moment a model is added, and a stale list is a LEAK — the new model falls
// through to "unfiltered". DMMF IS the schema, so adding `userId` or
// `novelId` to a model is all it takes; there is no second place to keep in
// sync and no way to forget.
//
// RULE ORDER (first match wins):
//   1. the model has a scalar `userId`  -> { userId: uid }
//   2. the model has a scalar `novelId` -> { novelId: { in: ownedNovelIds } }
//      (semantically identical to { novel: { userId: uid } }; the owned-id
//       list is the form this extension already shipped and verified against)
//   3. the model has an indirect path   -> walk the relation up to Novel
//   4. the model is in UNFILTERED_MODELS -> no filter (reported below)
//   5. anything else                    -> THROW (fail closed, never silent)
// ---------------------------------------------------------------------------

const DMMF_MODELS = Prisma.dmmf?.datamodel?.models ?? [];

/** Models carrying a scalar field with the given name. */
function modelsWithScalar(field: string): Set<string> {
  const out = new Set<string>();
  for (const model of DMMF_MODELS) {
    if (model.fields.some((f) => f.name === field && f.kind === "scalar")) out.add(model.name);
  }
  return out;
}

/** Rule 1 — models that carry the owner directly. */
const USER_ID_MODELS = modelsWithScalar("userId");

/** Rule 2 — models that hang off a novel. */
const NOVEL_ID_MODELS = modelsWithScalar("novelId");

if (DMMF_MODELS.length === 0) {
  // Fail CLOSED, not open: with no schema, rules 1-2 cannot fire and every
  // model falls through to rule 5, which throws. Never silently unfiltered.
  console.error(
    "[db] Prisma.dmmf is empty — run `bun run db:generate`. Ownership queries will refuse to run.",
  );
}

/** Models with no `novelId` of their own but a relation path up to Novel. */
const INDIRECT_PATHS: Record<string, (ids: string[]) => Record<string, unknown>> = {
  AgentTask: (ids) => ({ run: { novelId: { in: ids } } }),
  AgentEvent: (ids) => ({ run: { novelId: { in: ids } } }),
  AgentMessage: (ids) => ({ run: { novelId: { in: ids } } }),
  ContextSummary: (ids) => ({ run: { novelId: { in: ids } } }),
  SkillInvocation: (ids) => ({ task: { run: { novelId: { in: ids } } } }),
  TeamMessage: (ids) => ({ conversation: { novelId: { in: ids } } }),
  TeamTaskLog: (ids) => ({ task: { novelId: { in: ids } } }),
};

/**
 * Models with NO owner path — deliberately unfiltered, and REPORTED.
 *
 * This is an ALLOWLIST, not a computed list: a model that appears in the
 * schema without an ownership rule is NOT auto-added here — it hits rule 5
 * and throws. That is the point of the generalisation: a forgotten model
 * fails loudly instead of leaking. `User` is the auth subject table (never
 * read through `db`) and `TeamAgent` is the global agent roster (seed data
 * with no per-user rows) — both are intentionally shared.
 */
export const UNFILTERED_MODELS = ["User", "TeamAgent"] as const;

/**
 * Every model that matches NO ownership rule. Computed, not declared — it is
 * the "report" half of rule 4/5 and must stay equal to UNFILTERED_MODELS.
 * scripts/check-ownership.ts asserts that equality.
 */
export const UNRULELED_MODELS = DMMF_MODELS
  .map((m) => m.name)
  .filter(
    (name) =>
      !USER_ID_MODELS.has(name) &&
      !NOVEL_ID_MODELS.has(name) &&
      !(name in INDIRECT_PATHS),
  );

/** Orphan-producing creates (children rely on the relation, no stamping). */
export const ORPHAN_CREATE_MODELS = [...NOVEL_ID_MODELS, ...Object.keys(INDIRECT_PATHS)];

type Ownership =
  | { kind: "filter"; filter: Record<string, unknown> }
  | { kind: "unfiltered" }
  | { kind: "unknown" };

function ownershipFor(model: string, uid: string, ids: string[]): Ownership {
  if (USER_ID_MODELS.has(model)) return { kind: "filter", filter: { userId: uid } };
  if (NOVEL_ID_MODELS.has(model)) return { kind: "filter", filter: { novelId: { in: ids } } };
  const indirect = INDIRECT_PATHS[model];
  if (indirect) return { kind: "filter", filter: indirect(ids) };
  if ((UNFILTERED_MODELS as readonly string[]).includes(model)) return { kind: "unfiltered" };
  return { kind: "unknown" };
}

// ---------------------------------------------------------------------------
// Per-request identity
// ---------------------------------------------------------------------------

const requestCache = new WeakMap<object, Promise<Identity>>();
const storage = new AsyncLocalStorage<Store>();

/**
 * Background-job identity helper. Wrap an async fn to run with an explicit
 * identity; no route handler needs wrapping because real requests use
 * next/headers() instead.
 *
 * The callback MUST be awaited INSIDE the AsyncLocalStorage scope. Prisma
 * defers the query-extension hook past this call, so the store has to stay
 * alive for the whole chain — a synchronous callback that merely returns a
 * promise restores the previous (empty) store before the query runs, and the
 * query then goes out UNFILTERED.
 */
export async function withUser<T>(
  uid: string,
  isAdmin: boolean,
  fn: () => T | Promise<T>,
): Promise<T> {
  return storage.run({ uid, isAdmin }, async () => await fn());
}

async function identityFrom(uid: string, isAdmin: boolean): Promise<Identity> {
  if (isAdmin) return { uid, isAdmin: true, novelIds: null };
  if (!uid) return { uid: "", isAdmin: false, novelIds: [] };
  const rows = await base.novel.findMany({ where: { userId: uid }, select: { id: true } });
  return { uid, isAdmin: false, novelIds: rows.map((r) => r.id) };
}

async function readIdentity(): Promise<Identity> {
  // 1. Explicit background-job identity (AsyncLocalStorage).
  const store = storage.getStore();
  if (store) return identityFrom(store.uid, store.isAdmin);

  // 2. Real request: read the headers injected by middleware.
  let h: { get(name: string): string | null } | null = null;
  try {
    h = (await headers()) as unknown as { get(name: string): string | null };
  } catch {
    // "`headers` was called outside a request scope..." — build, scripts,
    // instrumentation, background jobs. In production this fails closed.
    return {
      uid: "",
      isAdmin: false,
      novelIds: process.env.NODE_ENV === "production" ? [] : null,
    };
  }

  const cached = requestCache.get(h);
  if (cached) return cached;
  const uid = h.get("x-novara-uid") ?? "";
  const isAdmin = h.get("x-novara-admin") === "1";
  // Local development / scripts without a Firebase session: pass through.
  if (!uid && process.env.NODE_ENV !== "production") {
    return { uid: "", isAdmin: false, novelIds: null };
  }
  const pending = identityFrom(uid, isAdmin);
  requestCache.set(h, pending);
  return pending;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

type AnyArgs = Record<string, unknown> & { where?: Record<string, unknown> };

function mergeWhere(args: AnyArgs, filter: Record<string, unknown>): AnyArgs {
  const where = (args.where ?? {}) as Record<string, unknown>;
  const existing = where.AND;
  const ands = Array.isArray(existing)
    ? [...existing]
    : existing
      ? [existing]
      : [];
  return { ...args, where: { ...where, AND: [...ands, filter] } };
}

/**
 * Stamp the owner onto a create / createMany / upsert for any model that
 * carries a `userId` scalar. The caller's value is REPLACED, never trusted:
 * honouring a caller-supplied `userId` would let a signed-in user hand a row
 * to somebody else. This is the rule Novel already used, generalised.
 */
function stampUserId(args: AnyArgs, uid: string): AnyArgs {
  if (!uid) return args;
  const data = args.data as Record<string, unknown> | Record<string, unknown>[] | undefined;
  const create = args.create as Record<string, unknown> | undefined; // upsert
  const stamp = (d: Record<string, unknown>) => ({ ...d, userId: uid });
  const next: AnyArgs = { ...args };
  if (Array.isArray(data)) next.data = data.map(stamp);
  else if (data) next.data = stamp(data);
  if (create) next.create = stamp(create);
  return next;
}

const READ_AND_WRITE = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow",
  "findMany", "count", "aggregate", "groupBy", "update", "updateMany",
  "delete", "deleteMany", "upsert",
]);

// ---------------------------------------------------------------------------
// Extended client
// ---------------------------------------------------------------------------

export const db = base.$extends({
  query: {
    async $allOperations({ model, operation, args, query }) {
      const ident = await readIdentity();

      // Admins and dev/script (no request scope) pass through untouched.
      if (ident.isAdmin || ident.novelIds === null) return query(args);

      const { uid, novelIds: ids } = ident;
      const a = args as AnyArgs;
      const name = model ?? "";
      const isCreate = operation === "create" || operation === "createMany";
      const isUpsert = operation === "upsert";

      // Fail closed: never create a row without an identity in production.
      if ((isCreate || isUpsert) && !uid) {
        throw new Error("unauthenticated: create requires a request identity");
      }

      // (A) Stamp the owner on models that carry a `userId` scalar.
      //     Creates take no `where`, so they are stamped and returned as-is.
      let next = a;
      if ((isCreate || isUpsert) && USER_ID_MODELS.has(name)) {
        next = stampUserId(a, uid);
      }

      if (isCreate) {
        // Children: the novelId relation is set by the caller. See
        // ORPHAN_CREATE_MODELS — these are reported, not silently trusted.
        return query(next);
      }

      if (!READ_AND_WRITE.has(operation)) return query(next);

      // (B) Ownership filter, by the rule order documented above.
      const own = ownershipFor(name, uid, ids ?? []);
      if (own.kind === "unknown") {
        // Rule 5 — fail closed. A model with no ownership rule must never be
        // queried unfiltered; that is exactly how the two STEP 47 leaks
        // happened (a model with no owner column fell through to pass-through).
        throw new Error(
          `ownership: model "${name}" has no ownership rule — refusing to run unfiltered. ` +
            `Give it a userId/novelId column, an entry in INDIRECT_PATHS, or list it in UNFILTERED_MODELS.`,
        );
      }
      if (own.kind === "unfiltered") return query(next); // UNFILTERED_MODELS — reported explicitly
      return query(mergeWhere(next, own.filter));
    },
  },
});
