import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Server Actions default to a 1MB body cap; Section 5's document
    // upload allows files up to 5MB, so this needs headroom above that.
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
