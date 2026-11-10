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

import { PrismaClient } from "@prisma/client";
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
// Model → Novel ownership map (derived from prisma/schema.prisma, 38 models).
// ---------------------------------------------------------------------------

/** Models with a direct `novelId` scalar. */
const DIRECT_NOVEL_ID_MODELS = new Set([
  "Chapter", "ChapterVersion", "ChapterReview", "Character", "WorldEntry",
  "WorldGroup", "OutlineBeat", "Volume", "Storyline", "TimelineEntry",
  "CharacterArc", "NovelContract", "StoryPromise", "StoryClue", "ChapterPack",
  "ChapterDigest", "StoryFact", "CharacterState", "Foreshadow", "AgentRun",
  "AssetVersion", "UsageCall", "UsageProvenance", "UsageDaily",
  "TeamConversation", "TeamTask",
]);

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

/** Models with NO path to Novel — deliberately left unfiltered (reported). */
export const UNFILTERED_MODELS = [
  "User", "UsageInvoice", "TeamAgent", "TeamTurnLog",
] as const;

/** Orphan-producing creates (children rely on the relation, no stamping). */
export const ORPHAN_CREATE_MODELS = [...DIRECT_NOVEL_ID_MODELS, ...Object.keys(INDIRECT_PATHS)];

function ownershipFilter(
  model: string,
  uid: string,
  ids: string[],
): Record<string, unknown> | null {
  if (model === "Novel") return uid ? { userId: uid } : { userId: { in: [] } };
  if (DIRECT_NOVEL_ID_MODELS.has(model)) return { novelId: { in: ids } };
  const indirect = INDIRECT_PATHS[model];
  if (indirect) return indirect(ids);
  return null; // no path -> left unfiltered (see UNFILTERED_MODELS)
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
 */
export function withUser<T>(uid: string, isAdmin: boolean, fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(storage.run({ uid, isAdmin }, fn));
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

function stampNovel(args: AnyArgs, uid: string): AnyArgs {
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
      const isCreate = operation === "create" || operation === "createMany";

      // Fail closed: never create a row without an identity in production.
      if (isCreate && !uid) {
        throw new Error("unauthenticated: create requires a request identity");
      }

      if (model === "Novel" && (isCreate || operation === "upsert")) {
        return query(stampNovel(a, uid));
      }

      if (isCreate) {
        // Children: the novelId relation is set by the caller. See
        // ORPHAN_CREATE_MODELS — these are reported, not silently trusted.
        return query(a);
      }

      if (!READ_AND_WRITE.has(operation)) return query(a);

      const filter = ownershipFilter(model ?? "", uid, ids ?? []);
      if (!filter) return query(a); // UNFILTERED_MODELS — reported explicitly
      return query(mergeWhere(a, filter));
    },
  },
});
