// Server-only ADC token helper. This file MUST NOT be imported by any module
// reachable from the client bundle (registry.ts, models.ts, etc.); it is only
// imported by gemini.ts -> router.ts, which is server-side only.
import { GoogleAuth } from "google-auth-library";

let googleAuth: GoogleAuth | null = null;
function getGoogleAuth(): GoogleAuth {
  if (!googleAuth) {
    googleAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  }
  return googleAuth;
}

export async function adcToken(signal?: AbortSignal): Promise<string> {
  try {
    const client = await getGoogleAuth().getClient();
    const { token } = await client.getAccessToken();
    if (!token) {
      throw new Error(
        "ADC unavailable: run gcloud auth application-default login, or grant the Cloud Run service account aiplatform.user",
      );
    }
    return token;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `ADC unavailable: run gcloud auth application-default login, or grant the Cloud Run service account aiplatform.user (${message})`,
    );
  }
}
