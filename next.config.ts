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
  // Remove headers - they don't work with static export
  // Cloudflare Pages will handle caching via _headers file
};

export default nextConfig;
