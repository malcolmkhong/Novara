"use client";

import { useEffect, useSyncExternalStore } from "react";

const SESSION_STORAGE_KEY = "truthlab-ai-team-session";

let cachedSessionKey: string | null = null;
const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

/** Read (and lazily create) the per-browser session key. Idempotent. */
function readOrCreateSessionKey(): string {
  if (cachedSessionKey) return cachedSessionKey;
  if (typeof window === "undefined") return "";
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (!stored) {
    stored =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      window.localStorage.setItem(SESSION_STORAGE_KEY, stored);
    } catch {
      // Private mode without storage — the in-memory value still works.
    }
  }
  cachedSessionKey = stored;
  return stored;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): string {
  return readOrCreateSessionKey();
}

function getServerSnapshot(): string {
  return "";
}

/**
 * Start a fresh session: generate a new session key and persist it.
 * Existing conversations stay in the database under the old key; every
 * conversation query re-keyed by the new value starts clean.
 */
export function resetSessionKey(): void {
  if (typeof window === "undefined") return;
  const fresh =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  cachedSessionKey = fresh;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, fresh);
  } catch {
    // Private mode without storage — the in-memory value still works.
  }
  emitChange();
}

/**
 * Stable per-browser session key (localStorage) keeping each agent's
 * conversation history separate and persistent across reloads.
 *
 * Implemented as an external store: the hydration render uses the server
 * snapshot (""), then React re-reads the client snapshot after mount — no
 * setState-in-effect and no hydration mismatch.
 */
export function useSessionKey(): string {
  useEffect(() => {
    const before = cachedSessionKey;
    readOrCreateSessionKey();
    if (before !== cachedSessionKey) emitChange();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
