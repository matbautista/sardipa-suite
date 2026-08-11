import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained deployment folder (Section 8 / Section 10 phase 17):
  // produces .next/standalone (server.js + a minimal traced node_modules)
  // that runs with a plain `node server.js`, no `next` CLI or full
  // node_modules needed on the target machine. scripts/package-release.mjs
  // assembles the rest (public/, .next/static, the migrated db, .env)
  // around it.
  output: "standalone",
  experimental: {
    // Server Actions default to a 1MB body cap; Section 5's document
    // upload allows files up to 5MB, so this needs headroom above that.
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
