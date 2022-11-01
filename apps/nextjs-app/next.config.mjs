// @ts-check

import { readFileSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import withBundleAnalyzer from '@next/bundle-analyzer';
import { withSentryConfig } from '@sentry/nextjs'; // https://docs.sentry.io/platforms/javascript/guides/nextjs/

import { createSecureHeaders } from 'next-secure-headers';
import withNextTranspileModules from 'next-transpile-modules';
import pc from 'picocolors';
import nextI18nConfig from './next-i18next.config.js';

const workspaceRoot = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '..',
  '..'
);
/**
 * Once supported replace by node / eslint / ts and out of experimental, replace by
 * `import packageJson from './package.json' assert { type: 'json' };`
 * @type {import('type-fest').PackageJson}
 */
const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url)).toString('utf-8')
);

const trueEnv = ['true', '1', 'yes'];

const isProd = process.env.NODE_ENV === 'production';
const isCI = trueEnv.includes(process.env?.CI ?? 'false');
const enableCSP = true;

const NEXTJS_IGNORE_ESLINT = trueEnv.includes(
  process.env?.NEXTJS_IGNORE_ESLINT ?? 'false'
);
const NEXTJS_IGNORE_TYPECHECK = trueEnv.includes(
  process.env?.NEXTJS_IGNORE_TYPECHECK ?? 'false'
);
const NEXTJS_SENTRY_UPLOAD_DRY_RUN = trueEnv.includes(
  process.env?.NEXTJS_SENTRY_UPLOAD_DRY_RUN ?? 'false'
);
const NEXTJS_DISABLE_SENTRY = trueEnv.includes(
  process.env?.NEXTJS_DISABLE_SENTRY ?? 'false'
);

const NEXTJS_SENTRY_DEBUG = trueEnv.includes(
  process.env?.NEXTJS_SENTRY_DEBUG ?? 'false'
);
const NEXTJS_SENTRY_TRACING = trueEnv.includes(
  process.env?.NEXTJS_SENTRY_TRACING ?? 'false'
);

/**
 * A way to allow CI optimization when the build done there is not used
 * to deliver an image or deploy the files.
 * @link https://nextjs.org/docs/advanced-features/source-maps
 */
const disableSourceMaps = trueEnv.includes(
  process.env?.NEXT_DISABLE_SOURCEMAPS ?? 'false'
);

if (disableSourceMaps) {
  console.log(
    `${pc.green(
      'notice'
    )}- Sourcemaps generation have been disabled through NEXT_DISABLE_SOURCEMAPS`
  );
}

// Tell webpack to compile those packages
// @link https://www.npmjs.com/package/next-transpile-modules
const tmModules = [
  // for legacy browsers support (only in prod)
  ...(isProd
    ? [
        'ky', // dist folder contains '??', not es2017 compliant
      ]
    : []),
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
    directives: enableCSP
      ? {
          defaultSrc: "'self'",
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://unpkg.com/@graphql-yoga/graphiql/dist/style.css',
            'https://meet.jitsi.si',
            'https://8x8.vc',
          ],
          scriptSrc: [
            "'self'",
            "'unsafe-eval'",
            "'unsafe-inline'",
            'https://unpkg.com/@graphql-yoga/graphiql',
            // 'https://meet.jit.si/external_api.js',
            // 'https://8x8.vc/external_api.js',
          ],
          frameSrc: [
            "'self'",
            // 'https://meet.jit.si',
            // 'https://8x8.vc',
          ],
          connectSrc: [
            "'self'",
            'https://vitals.vercel-insights.com',
            'https://*.sentry.io',
            // 'wss://ws.pusherapp.com',
            // 'wss://ws-eu.pusher.com',
            // 'https://sockjs.pusher.com',
            // 'https://sockjs-eu.pusher.com',
          ],
          imgSrc: ["'self'", 'https:', 'http:', 'data:'],
          workerSrc: ['blob:'],
        }
      : {},
  },
  ...(enableCSP && process.env.NODE_ENV === 'production'
    ? {
        forceHTTPSRedirect: [
          true,
          { maxAge: 60 * 60 * 24 * 4, includeSubDomains: true },
        ],
      }
    : {}),
  referrerPolicy: 'same-origin',
});

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  productionBrowserSourceMaps: !disableSourceMaps,
  i18n: nextI18nConfig.i18n,
  optimizeFonts: true,

  httpAgentOptions: {
    // @link https://nextjs.org/blog/next-11-1#builds--data-fetching
    keepAlive: true,
  },

  onDemandEntries: {
    // period (in ms) where the server will keep pages in the buffer
    maxInactiveAge: (isCI ? 3600 : 25) * 1000,
  },

  // @link https://nextjs.org/docs/advanced-features/compiler#minification
  // Sometimes buggy so enable/disable when debugging.
  swcMinify: true,

  compiler: {
    // emotion: true,
  },

  // Standalone build
  // @link https://nextjs.org/docs/advanced-features/output-file-tracing#automatically-copying-traced-files-experimental
  output: 'standalone',

  sentry: {
    hideSourceMaps: true,
  },

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
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
    ],
    unoptimized: false,
  },

  experimental: {
    // @link https://nextjs.org/docs/advanced-features/output-file-tracing#caveats
    outputFileTracingRoot: workspaceRoot,

    // Prefer loading of ES Modules over CommonJS
    // @link {https://nextjs.org/blog/next-11-1#es-modules-support|Blog 11.1.0}
    // @link {https://github.com/vercel/next.js/discussions/27876|Discussion}
    esmExternals: true,
    // Experimental monorepo support
    // @link {https://github.com/vercel/next.js/pull/22867|Original PR}
    // @link {https://github.com/vercel/next.js/discussions/26420|Discussion}
    externalDir: true,
  },

  typescript: {
    ignoreBuildErrors: NEXTJS_IGNORE_TYPECHECK,
  },

  eslint: {
    ignoreDuringBuilds: NEXTJS_IGNORE_ESLINT,
    // dirs: [`${__dirname}/src`],
  },

  async headers() {
    return [
      {
        // All page routes, not the api ones
        source: '/:path((?!api).*)*',
        headers: [
          ...secureHeaders,
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'same-origin' },
        ],
      },
    ];
  },

  // @link https://nextjs.org/docs/api-reference/next.config.js/rewrites
  async rewrites() {
    return [
      /*
      {
        source: `/about-us`,
        destination: '/about',
      },
      */
    ];
  },

  webpack: (config, { webpack, isServer }) => {
    if (!isServer) {
      // Fixes npm packages that depend on `fs` module
      // @link https://github.com/vercel/next.js/issues/36514#issuecomment-1112074589
      config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    }

    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/tree-shaking/
    config.plugins.push(
      new webpack.DefinePlugin({
        __SENTRY_DEBUG__: NEXTJS_SENTRY_DEBUG,
        __SENTRY_TRACING__: NEXTJS_SENTRY_TRACING,
      })
    );

    config.module.rules.push({
      test: /\.svg$/,
      issuer: /\.(js|ts)x?$/,
      use: [
        {
          loader: '@svgr/webpack',
          // https://react-svgr.com/docs/webpack/#passing-options
          options: {
            svgo: true,
            // @link https://github.com/svg/svgo#configuration
            svgoConfig: {
              multipass: false,
              datauri: 'base64',
              js2svg: {
                indent: 2,
                pretty: false,
              },
            },
          },
        },
      ],
    });

    return config;
  },
  env: {
    APP_NAME: packageJson.name ?? 'not-in-package.json',
    APP_VERSION: packageJson.version ?? 'not-in-package.json',
    BUILD_TIME: new Date().toISOString(),
  },
};

let config = nextConfig;

if (!NEXTJS_DISABLE_SENTRY) {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore because sentry does not match nextjs current definitions
  config = withSentryConfig(config, {
    // Additional config options for the Sentry Webpack plugin. Keep in mind that
    // the following options are set automatically, and overriding them is not
    // recommended:
    //   release, url, org, project, authToken, configFile, stripPrefix,
    //   urlPrefix, include, ignore
    // For all available options, see:
    // https://github.com/getsentry/sentry-webpack-plugin#options.
    // silent: isProd, // Suppresses all logs
    dryRun: NEXTJS_SENTRY_UPLOAD_DRY_RUN,
  });
}

if (tmModules.length > 0) {
  console.info(
    `${pc.green('notice')}- Will transpile [${tmModules.join(',')}]`
  );

  config = withNextTranspileModules(tmModules, {
    resolveSymlinks: true,
    debug: false,
  })(config);
}

if (process.env.ANALYZE === 'true') {
  config = withBundleAnalyzer({
    enabled: true,
  })(config);
}

export default config;
