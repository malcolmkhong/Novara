"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { authFetch } from "@/lib/firebase/client";
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
    // SSE over fetch(): EventSource cannot send an Authorization header, so
    // the stream was rejected with 401 and the bridge never fired. The wire
    // format is unchanged — "data: {json}\n\n" frames, ": ping\n\n" heartbeats.
    const controller = new AbortController();
    let closed = false;

    const run = async () => {
      try {
        const res = await authFetch("/api/novel/events", {
          cache: "no-store",
          signal: controller.signal,
          headers: { Accept: "text/event-stream" },
        });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done || closed) break;
          buffer += decoder.decode(value, { stream: true });
          let split = buffer.indexOf("\n\n");
          while (split !== -1) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            if (frame.startsWith("data:")) {
              const payload = frame.slice(5).trim();
              if (payload) {
                try {
                  const event = JSON.parse(payload) as NovelChangeEvent;
                  void queryClient.invalidateQueries({ queryKey: ["novel"] });
                  window.dispatchEvent(new CustomEvent(NOVEL_CHANGED_EVENT, { detail: event }));
                } catch {
                  // Malformed event — skip.
                }
              }
            }
            split = buffer.indexOf("\n\n");
          }
        }
      } catch {
        // Stream aborted or unavailable — consumers keep their polling
        // fallback.
      }
    };

    void run();

    return () => {
      closed = true;
      controller.abort();
    };
  }, [queryClient]);

  return null;
}
