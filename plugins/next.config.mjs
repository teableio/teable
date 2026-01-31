import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSecureHeaders } from 'next-secure-headers';
import { UniverPlugin } from '@univerjs/webpack-plugin';

const trueEnv = ['true', '1', 'yes'];

const NEXT_BUILD_ENV_TSCONFIG = process.env?.NEXT_BUILD_ENV_TSCONFIG ?? 'tsconfig.json';
const NEXT_BUILD_ENV_TYPECHECK = trueEnv.includes(process.env?.NEXT_BUILD_ENV_TYPECHECK ?? 'true');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Find the topmost workspace root by looking for pnpm-workspace.yaml
function findWorkspaceRoot(startDir) {
  let dir = startDir;
  let found = null;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      found = dir; // Keep looking for a higher one
    }
    dir = path.dirname(dir);
  }
  return found ?? startDir;
}

const workspaceRoot = findWorkspaceRoot(__dirname);
console.log('[plugins/next.config.mjs] __dirname:', __dirname);
console.log('[plugins/next.config.mjs] workspaceRoot:', workspaceRoot);

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
  typescript: {
    ignoreBuildErrors: !NEXT_BUILD_ENV_TYPECHECK,
    tsconfigPath: NEXT_BUILD_ENV_TSCONFIG,
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
