import { z } from "zod";

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function parseBody(
  req: Request
): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, data: await req.json() };
  } catch {
    return { ok: false, response: jsonError("Invalid JSON body", 400) };
  }
}

export function validationError(error: z.ZodError): Response {
  const issue = error.issues[0];
  const where = issue?.path?.length ? issue.path.join(".") : "body";
  return jsonError(issue ? `${where}: ${issue.message}` : "Invalid request", 400);
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
        ms
      )
    ),
  ]);
}

export function slugifyFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "novel";
}
