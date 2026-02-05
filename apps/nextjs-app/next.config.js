// @ts-check

const { readFileSync } = require('fs');
const path = require('path');
const { createSecureHeaders } = require('next-secure-headers');
const pc = require('picocolors');

const workspaceRoot = path.resolve(__dirname, '..', '..');
/**
 * Once supported replace by node / eslint / ts and out of experimental, replace by
 * `import packageJson from './package.json' assert { type: 'json' };`
 * @type {import('type-fest').PackageJson}
 */
const packageJson = JSON.parse(
  readFileSync(path.join(__dirname, './package.json')).toString('utf-8')
);

const trueEnv = ['true', '1', 'yes'];

const isProd = process.env.NODE_ENV === 'production';
const isCI = trueEnv.includes(process.env?.CI ?? 'false');

const NEXT_BUILD_ENV_OUTPUT = process.env?.NEXT_BUILD_ENV_OUTPUT ?? 'classic';
const NEXT_BUILD_ENV_TSCONFIG = process.env?.NEXT_BUILD_ENV_TSCONFIG ?? 'tsconfig.json';

const NEXT_BUILD_ENV_TYPECHECK = trueEnv.includes(process.env?.NEXT_BUILD_ENV_TYPECHECK ?? 'true');
const NEXT_BUILD_ENV_SOURCEMAPS = trueEnv.includes(
  process.env?.NEXT_BUILD_ENV_SOURCEMAPS ?? String(isProd)
);

const NEXT_BUILD_ENV_CSP = trueEnv.includes(process.env?.NEXT_BUILD_ENV_CSP ?? 'true');

const NEXT_BUILD_ENV_SENTRY_ENABLED = trueEnv.includes(
  process.env?.NEXT_BUILD_ENV_SENTRY_ENABLED ?? 'false'
);

const NEXT_BUILD_ENV_SENTRY_DEBUG = trueEnv.includes(
  process.env?.NEXT_BUILD_ENV_SENTRY_DEBUG ?? 'false'
);
const NEXT_BUILD_ENV_SENTRY_TRACING = trueEnv.includes(
  process.env?.NEXT_BUILD_ENV_SENTRY_TRACING ?? 'false'
);
// Whether to upload sourcemaps to Sentry (default: false for security)
const NEXT_BUILD_ENV_SENTRY_SOURCEMAPS_UPLOAD = trueEnv.includes(
  process.env?.NEXT_BUILD_ENV_SENTRY_SOURCEMAPS_UPLOAD ?? 'false'
);

const NEXTJS_SOCKET_PORT = process.env.SOCKET_PORT || '3001';

if (!NEXT_BUILD_ENV_SOURCEMAPS) {
  console.log(
    `- ${pc.green(
      'info'
    )} Sourcemaps generation have been disabled through NEXT_BUILD_ENV_SOURCEMAPS`
  );
}

// Tell webpack to compile those packages
// @link https://www.npmjs.com/package/next-transpile-modules
const tmModules = [
  // for legacy browsers support (only in prod and none electron)
  ...(isProd && !process.versions['electron'] ? [] : []),
  // ESM only packages are not yet supported by NextJs if you're not
  // using experimental esmExternals
  // @link {https://nextjs.org/blog/next-11-1#es-modules-support|Blog 11.1.0}
  // @link {https://github.com/vercel/next.js/discussions/27876|Discussion}
  // @link https://github.com/vercel/next.js/issues/23725
  // @link https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c
  ...[
    // ie: newer versions of https://github.com/sindresorhus packages
  ],
];

// @link https://github.com/jagaapple/next-secure-headers
const secureHeaders = createSecureHeaders({
  contentSecurityPolicy: {
    directives: NEXT_BUILD_ENV_CSP
      ? {
          defaultSrc: "'self'",
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: [
            "'self'",
            "'unsafe-eval'",
            "'unsafe-inline'",
            'https://www.clarity.ms',
            'https://*.teable.io',
            'https://*.teable.ai',
            'https://*.teable.cn',
          ],
          frameSrc: ["'self'", 'blob:', '*'],
          connectSrc: [
            "'self'",
            'https://*.sentry.io',
            'https://*.teable.io',
            'https://*.teable.ai',
            'https://*.teable.cn',
            'https://*.clarity.ms',
          ],
          mediaSrc: ["'self'", 'https:', 'http:', 'data:'],
          imgSrc: ["'self'", 'https:', 'http:', 'data:'],
          workerSrc: ['blob:'],
        }
      : {},
  },
  ...(NEXT_BUILD_ENV_CSP && isProd
    ? {
        forceHTTPSRedirect: [true, { maxAge: 60 * 60 * 24 * 4, includeSubDomains: true }],
      }
    : {}),
  referrerPolicy: 'same-origin',
});

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  assetPrefix:
    isProd && process.env.NEXT_BUILD_ENV_ASSET_PREFIX
      ? process.env.NEXT_BUILD_ENV_ASSET_PREFIX
      : undefined,
  crossOrigin: 'anonymous',
  reactStrictMode: true,
  productionBrowserSourceMaps: NEXT_BUILD_ENV_SOURCEMAPS === true,
  // Transpile packages that use React to ensure single React instance
  transpilePackages: [
    'streamdown',
    'd3-interpolate',
    'd3-color',
    // Fix Turbopack "unexpected export *" warnings for CommonJS modules
    '@dnd-kit/core',
    '@dnd-kit/sortable',
    '@dnd-kit/utilities',
  ],

  httpAgentOptions: {
    // @link https://nextjs.org/blog/next-11-1#builds--data-fetching
    keepAlive: true,
  },

  onDemandEntries: {
    // period (in ms) where the server will keep pages in the buffer
    maxInactiveAge: (isCI ? 3600 : 25) * 1000,
  },

  // Note: sentry configuration moved to withSentryConfig wrapper
  // See: https://docs.sentry.io/platforms/javascript/guides/nextjs/

  // @link https://nextjs.org/docs/basic-features/image-optimization
  images: {
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60,
    formats: ['image/webp'],
    loader: 'default',
    dangerouslyAllowSVG: false,
    disableStaticImages: false,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    unoptimized: false,
  },

  // Standalone build
  // @link https://nextjs.org/docs/advanced-features/output-file-tracing#automatically-copying-traced-files-experimental
  ...(NEXT_BUILD_ENV_OUTPUT === 'standalone'
    ? { output: 'standalone', outputFileTracing: true }
    : {}),

  // Server-only packages that should not be bundled for the browser
  // @link https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages
  serverExternalPackages: ['next-i18next', 'i18next-fs-backend'],

  experimental: {
    // @link https://nextjs.org/docs/advanced-features/output-file-tracing#caveats
    ...(NEXT_BUILD_ENV_OUTPUT === 'standalone' ? { outputFileTracingRoot: workspaceRoot } : {}),

    // Prefer loading of ES Modules over CommonJS
    // @link {https://nextjs.org/blog/next-11-1#es-modules-support|Blog 11.1.0}
    // @link {https://github.com/vercel/next.js/discussions/27876|Discussion}
    esmExternals: true,
    // Experimental monorepo support
    // @link {https://github.com/vercel/next.js/pull/22867|Original PR}
    // @link {https://github.com/vercel/next.js/discussions/26420|Discussion}
    externalDir: true,

    // Increase middleware client max body size for large file uploads (e.g., .tea import files)
    // @link https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize
    proxyClientMaxBodySize: '1024mb',

    // Optimize package imports for better bundle size and faster builds
    // @link https://vercel.com/blog/how-we-optimized-package-imports-in-next-js
    optimizePackageImports: ['lucide-react', 'date-fns', '@tanstack/react-virtual'],

    // Experimental /app dir
    // appDir: true,
  },

  // Turbopack configuration (Next.js 16 default bundler)
  turbopack: {
    root: workspaceRoot,
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
    resolveAlias: {
      // Required: next-i18next and i18next-fs-backend require 'fs' at top level
      fs: './turbopack-empty-stub.js',
    },
  },

  typescript: {
    ignoreBuildErrors: !NEXT_BUILD_ENV_TYPECHECK,
    tsconfigPath: NEXT_BUILD_ENV_TSCONFIG,
  },

  // Note: eslint configuration is no longer supported in next.config.js
  // Use ESLint CLI directly: npx eslint .

  // @link https://nextjs.org/docs/api-reference/next.config.js/rewrites
  async rewrites() {
    const socketProxy = {
      source: '/socket/:path*',
      destination: `http://localhost:${NEXTJS_SOCKET_PORT}/socket/:path*`,
    };

    return isProd ? [] : [socketProxy];
  },

  // @link https://nextjs.org/docs/api-reference/next.config.js/headers
  async headers() {
    return [
      {
        // StreamSaver service worker files - needs relaxed CORS for iframe/popup
        source: '/streamsaver/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
        ],
      },
      {
        // All page routes, not the api ones
        source: '/:path((?!api|streamsaver).*)*',
        headers: [
          ...secureHeaders,
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'same-origin' },
        ],
      },
      {
        source: '/images/(.*)',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET' },
          // Override the restrictive CORS policies for images
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
          { key: 'Cross-Origin-Opener-Policy', value: 'unsafe-none' },
        ],
      },
    ];
  },

  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Fixes npm packages that depend on `fs` module
      // @link https://github.com/vercel/next.js/issues/36514#issuecomment-1112074589
      config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    }

    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find(
      (/** @type {{ test: { test: (arg0: string) => any; }; }} */ rule) => rule.test?.test?.('.svg')
    );

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: fileLoaderRule.issuer,
        resourceQuery: { not: [...fileLoaderRule.resourceQuery.not, /url/] }, // exclude if *.svg?url
        use: ['@svgr/webpack'],
      }
    );

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i;

    return config;
  },
  env: {
    APP_NAME: packageJson.name ?? 'not-in-package.json',
    APP_VERSION: packageJson.version ?? 'not-in-package.json',
    BUILD_TIME: new Date().toISOString(),
    // Note: Sentry debug/tracing variables are handled via webpack DefinePlugin
    // and cannot be set via Next.js env config (reserved key format)
  },
};

let config = nextConfig;

if (NEXT_BUILD_ENV_SENTRY_ENABLED === true) {
  try {
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/
    const { withSentryConfig } = require('@sentry/nextjs');
    // @ts-ignore because sentry does not match nextjs current definitions
    config = withSentryConfig(config, {
      // Additional config options for the Sentry webpack plugin. Keep in mind that
      // the following options are set automatically, and overriding them is not
      // recommended:
      //   release, url, org, project, authToken, configFile, stripPrefix,
      //   urlPrefix, include, ignore
      // For all available options, see:
      // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/build/
      // silent: isProd, // Suppresses all logs
      sourcemaps: {
        // Upload only when explicitly enabled (default: disabled for security)
        disable: !NEXT_BUILD_ENV_SENTRY_SOURCEMAPS_UPLOAD,
        deleteSourcemapsAfterUpload: true, // Prevent .map files from leaking source code
      },
      bundleSizeOptimizations: {
        excludeDebugStatements: !NEXT_BUILD_ENV_SENTRY_DEBUG,
        excludeTracing: !NEXT_BUILD_ENV_SENTRY_TRACING,
      },
      silent: NEXT_BUILD_ENV_SENTRY_DEBUG === false,
    });
    console.log(`- ${pc.green('info')} Sentry enabled for this build`);
  } catch {
    console.log(`- ${pc.red('error')} Could not enable sentry, import failed`);
  }
}

if (tmModules.length > 0) {
  console.info(`${pc.green('notice')}- Will transpile [${tmModules.join(',')}]`);
  const withNextTranspileModules = require('next-transpile-modules');

  config = withNextTranspileModules(tmModules, {
    resolveSymlinks: true,
    debug: false,
  })(config);
}

if (process.env.ANALYZE === 'true') {
  const withBundleAnalyzer = require('@next/bundle-analyzer');
  config = withBundleAnalyzer({
    enabled: true,
  })(config);
}

module.exports = config;
