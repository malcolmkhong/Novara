"use client";

/**
 * Typed client helpers for the Novel Creator APIs.
 * - getJSON/deleteJSON: resilient JSON transport (150s cap, one retry on
 *   transient gateway statuses) mirroring ./detector/api.ts.
 * - streamChapterWrite: SSE reader for the streaming write endpoint;
 *   forwards prose deltas live and reports terminal done/error events.
 */

const CLIENT_TIMEOUT_MS = 150_000;
const RETRY_DELAY_MS = 1_500;

function isRetriableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function describeFailure(status: number): string {
  if (status === 502 || status === 503 || status === 504) {
    return "The model took too long or is momentarily unavailable. Please try again.";
  }
  if (status === 429) {
    return "Rate limited by the model service. Wait a few seconds and try again.";
  }
  return `Request failed (HTTP ${status}). Please try again.`;
}

async function errorFromResponse(response: Response): Promise<Error> {
  try {
    const parsed = (await response.json()) as { error?: string } | null;
    if (parsed && typeof parsed.error === "string" && parsed.error) {
      return new Error(parsed.error);
    }
  } catch {
    // fall through to generic message
  }
  return new Error(describeFailure(response.status));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function requestWithRetry(
  url: string,
  method: "GET" | "DELETE",
): Promise<unknown> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
    let response: Response;
    try {
      response = await fetchWithTimeout(url, { method });
    } catch {
      lastError = new Error(
        "The request timed out or the network dropped. Please try again.",
      );
      continue;
    }
    if (isRetriableStatus(response.status)) {
      lastError = new Error(describeFailure(response.status));
      continue;
    }
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    try {
      return await response.json();
    } catch {
      throw new Error(describeFailure(response.status));
    }
  }
  throw lastError ?? new Error("Request failed. Please try again.");
}

export async function getJSON<T>(url: string): Promise<T> {
  return (await requestWithRetry(url, "GET")) as T;
}

export async function deleteJSON<T>(url: string): Promise<T> {
  return (await requestWithRetry(url, "DELETE")) as T;
}

/** POST JSON with the same resilience contract (body requests). */
export async function postJSON<T>(url: string, body: unknown): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
    let response: Response;
    try {
      response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      lastError = new Error(
        "The request timed out or the network dropped. Please try again.",
      );
      continue;
    }
    if (isRetriableStatus(response.status)) {
      lastError = new Error(describeFailure(response.status));
      continue;
    }
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new Error(describeFailure(response.status));
    }
  }
  throw lastError ?? new Error("Request failed. Please try again.");
}

// ---------------------------------------------------------------------------
// SSE streaming for /api/novel/[id]/write
// ---------------------------------------------------------------------------

export interface WriteStreamResult {
  ok: boolean;
  wordCount: number;
  revision: number;
  message?: string;
  saved?: boolean;
}

export async function streamChapterWrite(
  url: string,
  body: { chapterNumber: number },
  onDelta: (text: string) => void,
): Promise<WriteStreamResult> {
  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      wordCount: 0,
      revision: 0,
      message:
        "The request timed out or the network dropped. Please try again.",
    };
  }

  if (!response.ok || !response.body) {
    const error = await errorFromResponse(response);
    return { ok: false, wordCount: 0, revision: 0, message: error.message };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let wordCount = 0;
  let revision = 0;
  let errorMessage: string | undefined;
  let saved = false;
  let sawTerminal = false;

  const handleEvent = (rawEvent: string) => {
    for (const line of rawEvent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      try {
        const evt = JSON.parse(trimmed.slice(5).trim()) as {
          type?: string;
          text?: string;
          wordCount?: number;
          revision?: number;
          message?: string;
          saved?: boolean;
        };
        if (evt.type === "delta" && typeof evt.text === "string") {
          onDelta(evt.text);
        } else if (evt.type === "done") {
          sawTerminal = true;
          wordCount = evt.wordCount ?? 0;
          revision = evt.revision ?? 0;
        } else if (evt.type === "error") {
          sawTerminal = true;
          errorMessage = evt.message ?? "Generation failed.";
          saved = evt.saved ?? false;
        }
      } catch {
        // Malformed event — skip.
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (part.trim().length > 0) handleEvent(part);
    }
  }
  if (buffer.trim().length > 0) handleEvent(buffer);

  if (!sawTerminal) {
    return {
      ok: false,
      wordCount,
      revision,
      message:
        "The connection closed before the chapter finished. Check whether a partial draft was saved, then try again.",
    };
  }
  if (errorMessage !== undefined) {
    return { ok: false, wordCount, revision, message: errorMessage, saved };
  }
  return { ok: true, wordCount, revision };
}
