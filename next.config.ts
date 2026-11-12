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
};

export default nextConfig;
