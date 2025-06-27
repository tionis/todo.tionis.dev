import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  trailingSlash: true,
  output: 'export',
  images: {
    unoptimized: true,
  },
  distDir: 'out',
  skipTrailingSlashRedirect: true,
  generateBuildId: () => 'build',
};

export default nextConfig;
