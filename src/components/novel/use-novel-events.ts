"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { NovelChangeEvent } from "@/lib/novel/events";

/**
 * DOM event re-dispatched on every server-side library change so plain
 * state-based consumers (bookshelf, studio) can refetch without going
 * through TanStack Query.
 */
export const NOVEL_CHANGED_EVENT = "novel-changed";

/**
 * Realtime sync bridge (server → browser).
 *
 * AI-team tools and studio endpoints mutate the SAME database (single
 * source of truth); this client component keeps the UI informed: an SSE
 * subscription to /api/novel/events invalidates every TanStack novel
 * query (side-panel book tree) and re-dispatches a DOM event for the
 * legacy state-based views. EventSource reconnects automatically, and
 * consumers keep a low-frequency polling fallback for missed events.
 */
export function NovelSyncBridge() {
  const queryClient = useQueryClient();

  React.useEffect(() => {
    const source = new EventSource("/api/novel/events");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as NovelChangeEvent;
        void queryClient.invalidateQueries({ queryKey: ["novel"] });
        window.dispatchEvent(new CustomEvent(NOVEL_CHANGED_EVENT, { detail: event }));
      } catch {
        // Malformed event — skip.
      }
    };
    // On error EventSource retries by itself; keep the subscription.
    return () => source.close();
  }, [queryClient]);

  return null;
}
