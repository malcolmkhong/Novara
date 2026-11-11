"use client";

// ---------------------------------------------------------------------------
// Novara AI — the client's credit state (Step 61).
//
// One fetch on mount, no polling: the balance moves only when the user
// spends, and every AI action that settles should call refresh() (the badge
// and the composer both need the number AFTER the action, not before).
//
// The endpoint is /api/usage/credits (GET) — the ONE place that answers
// "what can I spend right now?".
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/firebase/client";
import type { CreditsSnapshot } from "@/lib/usage/usage-shapes";

export interface UseCreditsResult {
  /** The last successful snapshot, or null before the first load / on error. */
  credits: CreditsSnapshot | null;
  /** True while the first fetch is in flight. */
  loading: boolean;
  /** The last error message, or null. */
  error: string | null;
  /** Re-read the balance — call it after an AI action settles. */
  refresh: () => Promise<void>;
}

export function useCredits(): UseCreditsResult {
  const [credits, setCredits] = useState<CreditsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch("/api/usage/credits", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as CreditsSnapshot;
      if (!alive.current) return;
      setCredits(body);
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  return { credits, refresh, loading, error };
}
