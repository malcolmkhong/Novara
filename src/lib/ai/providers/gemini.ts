// Google Vertex AI — OpenAI-compatible endpoint, Application Default Credentials.
import type { ChatRequest, ProviderAdapter, ThinkingEffort } from "./types";
import { adcToken } from "./adc";
import { openAiCompatibleAdapter, readEnv } from "./http";

const project = (): string =>
  readEnv("GCP_PROJECT_ID") ?? readEnv("GOOGLE_CLOUD_PROJECT") ?? "";
const location = (): string =>
  readEnv("GCP_VERTEX_LOCATION") ?? readEnv("GOOGLE_CLOUD_LOCATION") ?? "global";

/** gemini-3.8-flash has no zero-thinking mode — "off"/"none"/"minimal" are
 *  rejected, so every request must carry an explicit reasoning_effort. */
function reasoningEffort(level: ThinkingEffort | undefined): "low" | "medium" | "high" {
  if (level === "medium") return "medium";
  if (level === "high") return "high";
  return "low"; // "off" | "low" | undefined
}

export const geminiAdapter: ProviderAdapter = openAiCompatibleAdapter({
  id: "gemini",
  label: "gemini",
  url: () =>
    `https://aiplatform.googleapis.com/v1/projects/${project()}/locations/${location()}/endpoints/openapi/chat/completions`,
  headers: async () => {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await adcToken()}`,
    };
    // Service accounts (Cloud Run) must NOT send a quota project; only user
    // credentials (local dev via gcloud ADC) need one. The env var is the
    // switch so behaviour is identical locally (it is set in .env) and safe
    // in production (unset on Cloud Run).
    const quotaProject = readEnv("GCP_QUOTA_PROJECT");
    if (quotaProject) headers["x-goog-user-project"] = quotaProject;
    return headers;
  },
  body: (req: ChatRequest) => ({ reasoning_effort: reasoningEffort(req.thinking) }),
});
