import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Remove output: 'export' to allow dynamic routes without generateStaticParams
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  experimental: {
    // Enable static exports for better PWA support
  },
};

export default nextConfig;
