import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  // The production build IS the type gate: a TypeScript error must fail
  // `next build` (and therefore the container image). The `typescript`
  // block is intentionally absent — `ignoreBuildErrors` stays OFF, so the
  // flag cannot be re-introduced by accident. The separate
  // `bunx tsc --noEmit` step in deploy/cloudbuild.v2.yaml is a
  // belt-and-braces gate, not the only one.
  reactStrictMode: false,
  // Do not advertise the framework. `X-Powered-By: Next.js` tells a scanner
  // exactly what to try; the header costs nothing to remove.
  poweredByHeader: false,
  async headers() {
    return [
      {
        // Everything the app serves is HTML/CSS/JS from this origin. The
        // security headers below are deliberately NOT set per-route: they are
        // uniform for /, /_next/* and /api/*.
        source: "/:path*",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            // The app is never embedded in a frame. Firebase Auth uses a
            // POPUP (window.open), not an iframe, so this cannot break
            // sign-in — but it does block clickjacking.
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            // Cloud Run terminates TLS in front of the container, so this is
            // safe to send. max-age 1 year, includeSubDomains — the run.app
            // host and any custom domain must both be HTTPS-only.
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
