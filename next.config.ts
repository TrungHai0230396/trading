import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // The mariadb driver is a native CommonJS module — keep it external so
  // Next/Turbopack doesn't try to bundle it for the server runtime.
  serverExternalPackages: ["mariadb", "@prisma/adapter-mariadb"],
};

export default nextConfig;
