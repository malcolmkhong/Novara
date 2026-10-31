/**
 * Small typed fetch helper for all TruthLab API calls.
 * Always uses relative URLs. Network and JSON-parse failures are
 * normalized into thrown Errors so panels can toast + render inline alerts.
 */
export async function postJSON<T>(url: string, body: unknown): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "Network error — could not reach the analysis service. Please try again."
    );
  }

  let parsed: unknown;

  try {
    parsed = await response.json();
  } catch {
    throw new Error(
      `Unexpected server response (HTTP ${response.status}). The service may be unavailable.`
    );
  }

  if (!response.ok) {
    const maybeError = parsed as { error?: string } | null;
    if (maybeError && typeof maybeError.error === "string" && maybeError.error) {
      throw new Error(maybeError.error);
    }
    throw new Error(`Request failed (HTTP ${response.status}).`);
  }

  return parsed as T;
}
