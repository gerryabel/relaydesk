import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {},
  turbopack: {
    resolveAlias: {
      '@': './src',
    },
  },
};

export default nextConfig;
