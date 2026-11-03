/**
 * In-process event bus for novel-library changes — the realtime-sync
 * backbone between every writer (AI team tools, Novel Creator studio
 * endpoints) and every reader (bookshelf, studio, side-panel book tree).
 *
 * All writers already mutate the same Prisma/SQLite database (single
 * source of truth), but browsers cannot see server-side writes. Writers
 * emit here; the SSE endpoint (/api/novel/events) streams events to the
 * client, which invalidates its queries and refetches.
 *
 * The listener set lives on globalThis: Next.js compiles each route as a
 * separate bundle, so a module-level Set would be instantiated once per
 * route — emitters and the SSE subscriber would never meet. A globalThis
 * singleton is process-wide, exactly like the shared Prisma client.
 *
 * In-process only by design: every write path runs inside the Next.js
 * server process, so no external broker is needed. Missed events (SSE
 * drop) are covered by the client's low-frequency polling fallback.
 */

export type NovelEventKind = "novel" | "volume" | "chapter" | "foreshadow";

export interface NovelChangeEvent {
  /** Coarse entity kind for client-side cache invalidation. */
  kind: NovelEventKind;
  /** Affected novel id (best effort — lets clients refetch one book). */
  novelId: string | null;
  /** Which writer fired it (tool action or studio endpoint label). */
  source: string;
  at: string;
}

type Listener = (event: NovelChangeEvent) => void;

interface NovelEventBusState {
  listeners: Set<Listener>;
}

const globalForNovelEvents = globalThis as unknown as {
  __novelEventBus?: NovelEventBusState;
};

const bus: NovelEventBusState =
  globalForNovelEvents.__novelEventBus ?? { listeners: new Set<Listener>() };
globalForNovelEvents.__novelEventBus = bus;

/** Fire after a SUCCESSFUL database mutation on the novel library. */
export function emitNovelChange(
  kind: NovelEventKind,
  novelId: string | null,
  source: string,
): void {
  const event: NovelChangeEvent = { kind, novelId, source, at: new Date().toISOString() };
  for (const listener of bus.listeners) {
    try {
      listener(event);
    } catch {
      // A broken subscriber must never break the writer.
    }
  }
}

/** Subscribe to library changes. Returns an unsubscribe function. */
export function subscribeNovelChanges(listener: Listener): () => void {
  bus.listeners.add(listener);
  return () => {
    bus.listeners.delete(listener);
  };
}
