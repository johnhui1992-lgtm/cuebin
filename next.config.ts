import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Browser opens via 127.0.0.1 while next dev binds localhost.
  allowedDevOrigins: ["127.0.0.1"],
  // MP3 uploads (up to ~15MB) buffer through the proxy clone path.
  experimental: {
    proxyClientMaxBodySize: "20mb",
  },
  // Cursor identity helpers import ./identity.dev.js beside .ts sources.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
