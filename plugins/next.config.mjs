import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSecureHeaders } from 'next-secure-headers';
import { UniverPlugin } from '@univerjs/webpack-plugin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '..', '..');

const isProd = process.env.NODE_ENV === 'production';
const basePath = '/plugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  output: 'standalone',
  turbopack: {
    root: workspaceRoot,
  },
  // Webpack configuration (use --webpack flag to enable)
  webpack: (config) => {
    config.plugins.push(new UniverPlugin());
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path((?!api).*)*',
        headers: [
          ...createSecureHeaders({
            contentSecurityPolicy: {
              defaultSrc: "'self'",
              styleSrc: ["'self'", "'unsafe-inline'"],
              scriptSrc: ["'self'", "'unsafe-eval'", "'unsafe-inline'", 'https://www.clarity.ms'],
              frameSrc: ["'self'", 'https:', 'http:'],
              connectSrc: ["'self'", 'https:'],
              mediaSrc: ["'self'", 'https:', 'http:', 'data:'],
              imgSrc: ["'self'", 'https:', 'http:', 'data:'],
            } 
          }),
          {
            key: 'Content-Security-Policy',
            value: 'frame-ancestors *'
          },
          { key: 'Cross-Origin-Opener-Policy', value: isProd ? 'same-origin' : 'unsafe-none' },
          { key: 'Cross-Origin-Embedder-Policy', value: isProd ? 'same-origin' : 'unsafe-none' }
        ],
      },
    ];
  },
  async rewrites() {
    const socketProxy = {
      source: '/socket/:path*',
      destination: `http://localhost:3000/socket/:path*`,
      basePath: !Boolean(basePath),
    };

    const httpProxy = {
      source: '/api/:path*',
      destination: `http://localhost:3000/api/:path*`,
      basePath: !Boolean(basePath),
    };

    return isProd ? [] : [socketProxy, httpProxy];
  },
};

export default nextConfig;
