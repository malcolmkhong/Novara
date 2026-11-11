// ---------------------------------------------------------------------------
// Novara AI — request middleware.
//
// Verifies the Firebase ID token on every /api/* request. Returns 401 for
// missing/invalid tokens; never 500. On success, forwards the request with
// `x-novara-uid` set to the token's `sub` so route handlers can read the
// caller's identity without re-verifying.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { isAdminUid } from "@/lib/auth/admin";

const PUBLIC_PATHS = new Set<string>(["/api/health"]);

// Module-scope JWKS cache — fetched once, refreshed by jose automatically.
const jwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

function projectId(): string {
  return process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // SECURITY / trust boundary: the Prisma ownership extension (src/lib/db.ts)
  // trusts x-novara-uid / x-novara-admin. Never let a client supply them.
  // Build the forwarded header set by DELETING both from the incoming request
  // FIRST; only the verified values below are ever set. Without these two
  // deletes, a non-admin could send `x-novara-admin: 1` (we only set it for
  // admins) and gain an unfiltered client, and a public path could be tricked
  // with `x-novara-uid`.
  const headers = new Headers(req.headers);
  headers.delete("x-novara-uid");
  headers.delete("x-novara-admin");

  if (PUBLIC_PATHS.has(path)) {
    return NextResponse.next({ request: { headers } });
  }

  const auth = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!match) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const token = match[1].trim();

  const pid = projectId();
  if (!pid) {
    // Misconfigured server — but still a 401, not a 500.
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      audience: pid,
      issuer: `https://securetoken.google.com/${pid}`,
    });
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    if (!sub) throw new Error("missing sub");

    // The admin allowlist lives in ONE place (src/lib/auth/admin.ts) — the
    // credit ledger uses the same rule, so there is no second copy to drift.
    const isAdmin = isAdminUid(sub);

    headers.set("x-novara-uid", sub);
    if (isAdmin) headers.set("x-novara-admin", "1");
    return NextResponse.next({ request: { headers } });
  } catch {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
}

export const config = {
  matcher: ["/api/:path*"],
};
