import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  experimental: {},
  webpack: (config) => {
    config.resolve.alias = config.resolve.alias || {};
    config.resolve.alias['@file:///'] = path.join(process.cwd(), 'src');
    return config;
  },
};

export default nextConfig;
