/**
 * Small typed fetch helper for all TruthLab API calls.
 * Always uses relative URLs. Network and JSON-parse failures are
 * normalized into thrown Errors so panels can toast + render inline alerts.
 *
 * Resilience: transient gateway/model hiccups (502/503/504) and network
 * blips are retried ONCE automatically; a hard client-side timeout keeps
 * the UI responsive with an actionable message.
 */

const CLIENT_TIMEOUT_MS = 150_000;
const RETRY_DELAY_MS = 1_500;

function isRetriableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

async function fetchOnce(url: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function describeFailure(status: number): string {
  if (status === 502 || status === 503 || status === 504) {
    return "The model took too long or is momentarily unavailable. Please try again — shorter text analyzes faster.";
  }
  if (status === 429) {
    return "Rate limited by the model service. Wait a few seconds and try again.";
  }
  return `Request failed (HTTP ${status}). Please try again.`;
}

export async function postJSON<T>(url: string, body: unknown): Promise<T> {
  let lastError: Error | null = null;

  // Two attempts: initial + one automatic retry on transient failures.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }

    let response: Response;
    try {
      response = await fetchOnce(url, body);
    } catch {
      // AbortError (our own timeout) and network failures land here.
      lastError = new Error(
        "The request timed out or the network dropped. Please try again — shorter text helps.",
      );
      continue; // retry
    }

    if (isRetriableStatus(response.status)) {
      lastError = new Error(describeFailure(response.status));
      continue; // retry
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new Error(describeFailure(response.status));
    }

    if (!response.ok) {
      const maybeError = parsed as { error?: string } | null;
      if (
        maybeError &&
        typeof maybeError.error === "string" &&
        maybeError.error
      ) {
        throw new Error(maybeError.error);
      }
      throw new Error(describeFailure(response.status));
    }

    return parsed as T;
  }

  throw lastError ?? new Error("Request failed. Please try again.");
}
