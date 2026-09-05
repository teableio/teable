#!/usr/bin/env node
/**
 * Builds `public/mobile-sw.js`, the Service Worker the native mobile app's
 * WebView registers (embed mode only, see useMobileServiceWorker) so the
 * base / space / artifact app shell keeps loading on a flaky connection.
 *
 * Runs after `next build` (wired as the `postbuild` script of the apps):
 *
 *   node scripts/build-mobile-precache.mjs [--app-dir <dir>] [--out <file>]
 *
 * Inputs, all under `<app-dir>/.next`: `build-manifest.json`, `BUILD_ID` and
 * the asset prefix the build used (`required-server-files.json`), so precache
 * URLs point at the CDN when one is configured.
 *
 * The emitted worker:
 *  - precaches every JS/CSS file of the routes the shell opens
 *    (MOBILE_PRECACHE_ROUTES) plus the shared `_app` chunks, polyfills and the
 *    `_buildManifest` / `_ssgManifest`;
 *  - names its cache after the build id; the install fails as a whole when any
 *    entry cannot be fetched (the previous worker and cache stay in place),
 *    and old caches are dropped on activate without claiming open clients;
 *  - at runtime serves `/_next/static/*` cache-first (hashed, account-neutral
 *    assets) and nothing else: navigations, `/api/*`, `/socket*` and non-GET
 *    requests always go to the network, so no signed-in HTML ever lands in a
 *    shared cache.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** Pages-router routes the native shell opens in its WebView. */
export const MOBILE_PRECACHE_ROUTES = [
  '/base/[baseId]/[[...slug]]',
  '/base/[baseId]/design',
  '/space/[spaceId]',
  '/artifact/[artifactId]',
];

/** Entries every page needs. */
const SHARED_ROUTES = ['/_app'];

export const MOBILE_SW_CACHE_PREFIX = 'teable-mobile-';

const ASSET_FILE_RE = /\.(?:js|css)$/u;

/**
 * @typedef {object} IBuildManifest
 * @property {Record<string, string[]>} [pages]
 * @property {string[]} [polyfillFiles]
 * @property {string[]} [lowPriorityFiles]
 */

/**
 * Build manifest → ordered, de-duplicated `.next/`-relative asset paths.
 * Routes missing from the manifest (e.g. `/artifact/[artifactId]` in the
 * community app) are reported, not fatal.
 *
 * @param {IBuildManifest} manifest
 * @param {{ buildId: string; routes?: string[] }} options
 * @returns {{ files: string[]; missingRoutes: string[] }}
 */
export function collectPrecacheFiles(manifest, { buildId, routes = MOBILE_PRECACHE_ROUTES }) {
  const pages = manifest.pages ?? {};
  /** @type {Set<string>} */
  const files = new Set();
  /** @param {string[] | undefined} list */
  const add = (list) => {
    for (const file of list ?? []) {
      if (ASSET_FILE_RE.test(file)) files.add(file);
    }
  };

  for (const route of SHARED_ROUTES) add(pages[route]);
  add(manifest.polyfillFiles);

  /** @type {string[]} */
  const missingRoutes = [];
  for (const route of routes) {
    if (pages[route]) add(pages[route]);
    else missingRoutes.push(route);
  }

  add(manifest.lowPriorityFiles);
  // The low-priority list normally carries both manifests; guarantee them anyway.
  add([`static/${buildId}/_buildManifest.js`, `static/${buildId}/_ssgManifest.js`]);

  return { files: [...files], missingRoutes };
}

/**
 * `.next/`-relative paths → URLs as the page references them (`/_next/...`,
 * behind the asset prefix when the build has one).
 *
 * @param {string[]} files
 * @param {string} [assetPrefix]
 * @returns {string[]}
 */
export function toPrecacheUrls(files, assetPrefix = '') {
  const prefix = assetPrefix.replace(/\/+$/u, '');
  return files.map((file) => `${prefix}/_next/${file.replace(/^\/+/u, '')}`);
}

// Worker runtime. Plain string on purpose: it is emitted verbatim, so keep it
// free of template placeholders.
const SERVICE_WORKER_RUNTIME = `const STATIC_PATH = '/_next/static/';

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

// Old build caches go; clients keep the worker they loaded with until they navigate.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
  );
});

// Only hashed build assets are served from the cache. Navigations (signed-in HTML),
// API and realtime traffic never touch the worker.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.pathname.indexOf(STATIC_PATH) !== 0) return;
  event.respondWith(cacheFirst(request));
});

// All-or-nothing: a partial precache would replace a complete previous shell.
async function precache() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(PRECACHE_URLS.map((url) => cache.add(url)));
}

function isCacheableAsset(response) {
  return response.ok && (response.type === 'basic' || response.type === 'cors');
}

// Hashed build assets: cache-first, filled at runtime for anything not precached.
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheableAsset(response)) {
    cache.put(request, response.clone()).catch(() => undefined);
  }
  return response;
}
`;

/**
 * @param {{ buildId: string; precacheUrls: string[] }} options
 * @returns {string}
 */
export function renderServiceWorker({ buildId, precacheUrls }) {
  const header = [
    '/* eslint-disable */',
    `// Generated by scripts/build-mobile-precache.mjs for build ${buildId}. Do not edit.`,
    `const BUILD_ID = ${JSON.stringify(buildId)};`,
    `const CACHE_PREFIX = ${JSON.stringify(MOBILE_SW_CACHE_PREFIX)};`,
    'const CACHE_NAME = CACHE_PREFIX + BUILD_ID;',
    `const PRECACHE_URLS = ${JSON.stringify(precacheUrls, null, 2)};`,
  ].join('\n');
  return `${header}\n\n${SERVICE_WORKER_RUNTIME}`;
}

/** @param {string} nextDir */
function readAssetPrefix(nextDir) {
  const requiredFilesPath = join(nextDir, 'required-server-files.json');
  if (existsSync(requiredFilesPath)) {
    try {
      const { config } = JSON.parse(readFileSync(requiredFilesPath, 'utf8'));
      if (typeof config?.assetPrefix === 'string') return config.assetPrefix;
    } catch {
      // fall through to the env mirror of next.config.js
    }
  }
  return (process.env.NODE_ENV === 'production' && process.env.NEXT_BUILD_ENV_ASSET_PREFIX) || '';
}

/**
 * @param {{ appDir?: string; outFile?: string }} [options]
 */
export function buildMobileServiceWorker({ appDir = process.cwd(), outFile } = {}) {
  const nextDir = join(appDir, '.next');
  const manifestPath = join(nextDir, 'build-manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`${manifestPath} not found: run \`next build\` before this script`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const buildId = readFileSync(join(nextDir, 'BUILD_ID'), 'utf8').trim();
  const assetPrefix = readAssetPrefix(nextDir);
  const { files, missingRoutes } = collectPrecacheFiles(manifest, { buildId });
  const precacheUrls = toPrecacheUrls(files, assetPrefix);
  const target = resolve(outFile ?? join(appDir, 'public', 'mobile-sw.js'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, renderServiceWorker({ buildId, precacheUrls }));
  return { outFile: target, buildId, assetPrefix, precacheUrls, missingRoutes };
}

const isDirectRun =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  const { values } = parseArgs({
    options: { 'app-dir': { type: 'string' }, out: { type: 'string' } },
  });
  try {
    const result = buildMobileServiceWorker({
      appDir: values['app-dir'] ? resolve(values['app-dir']) : undefined,
      outFile: values.out,
    });
    const prefixNote = result.assetPrefix ? `, asset prefix ${result.assetPrefix}` : '';
    console.log(
      `[mobile-sw] wrote ${result.outFile} (build ${result.buildId}, ${result.precacheUrls.length} precache entries${prefixNote})`
    );
    if (result.missingRoutes.length > 0) {
      console.log(
        `[mobile-sw] routes not in this build, skipped: ${result.missingRoutes.join(', ')}`
      );
    }
  } catch (error) {
    console.error(`[mobile-sw] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
