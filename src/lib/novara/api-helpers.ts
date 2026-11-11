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

// ---------------------------------------------------------------------------
// Content-Disposition header values
//
// A `filename="…"` header value is a ByteString (RFC 6266 §4.3): every
// character must be in the ASCII printable range. A CJK novel title produces
// a code point like U+4E16, and setting the header throws:
//   TypeError: Cannot convert argument to a ByteString because the character
//   at index N has a value of 19990 which is > 255
// The standard answer is RFC 5987: carry an ASCII fallback in `filename=` and
// the real name percent-encoded in `filename*=UTF-8''…`. Browsers prefer the
// RFC 5987 value when present, so the downloaded file keeps its real name.
// ---------------------------------------------------------------------------

/**
 * `attr-char` per RFC 5987 §3.2.1 — the only characters that may appear
 * unescaped inside `filename*`. Everything else is percent-encoded from its
 * UTF-8 bytes.
 */
const RFC5987_ATTR_CHAR = /[A-Za-z0-9!#$&+\-.^_`|~]/;

/** Percent-encode `value` per RFC 5987's `value-chars` rule. */
export function rfc5987Encode(value: string): string {
  let out = "";
  for (const ch of value) {
    if (RFC5987_ATTR_CHAR.test(ch)) {
      out += ch;
    } else {
      for (const byte of new TextEncoder().encode(ch)) {
        out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
      }
    }
  }
  return out;
}

/**
 * The ASCII fallback for the legacy `filename=` slot. ASCII only
 * [A-Za-z0-9._-], runs collapsed to a single "-", trimmed, capped at `max`
 * (the extension is preserved when truncation happens), and defaults to
 * "novel" when nothing usable survives.
 */
export function asciiFilenameFallback(name: string, max = 80): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  const cap = Math.max(0, max - ext.length);
  return (base.slice(0, cap) || "novel") + ext;
}

/**
 * Build a header-safe `Content-Disposition` value for a filename that may
 * contain non-ASCII characters:
 *
 *   attachment; filename="novara-novel-v2.json"; filename*=UTF-8''novara-%E4%B8%96…-v2.json
 */
export function contentDisposition(
  type: "attachment" | "inline",
  filename: string
): string {
  return `${type}; filename="${asciiFilenameFallback(filename)}"; filename*=UTF-8''${rfc5987Encode(filename)}`;
}
