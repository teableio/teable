import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  MOBILE_PRECACHE_ROUTES,
  MOBILE_SW_CACHE_PREFIX,
  collectPrecacheFiles,
  renderServiceWorker,
  toPrecacheUrls,
} from '../../scripts/build-mobile-precache.mjs';

const BUILD_ID = 'BUILD123';

const manifest = {
  pages: {
    '/_app': ['static/chunks/webpack-1.js', 'static/chunks/main-1.js', 'static/css/app.css'],
    '/_error': ['static/chunks/webpack-1.js', 'static/chunks/pages/_error.js'],
    '/base/[baseId]/[[...slug]]': [
      'static/chunks/webpack-1.js',
      'static/chunks/pages/base/slug.js',
      'static/chunks/pages/base/slug.js.map',
      'static/css/base.css',
    ],
    '/base/[baseId]/design': ['static/chunks/pages/base/design.js'],
    '/space/[spaceId]': ['static/chunks/pages/space.js'],
    '/admin/setting': ['static/chunks/pages/admin.js'],
  },
  polyfillFiles: ['static/chunks/polyfills.js'],
  lowPriorityFiles: [`static/${BUILD_ID}/_ssgManifest.js`, `static/${BUILD_ID}/_buildManifest.js`],
};

describe('collectPrecacheFiles', () => {
  it('collects the shell routes, _app, polyfills and the build manifests, de-duplicated', () => {
    const { files, missingRoutes } = collectPrecacheFiles(manifest, { buildId: BUILD_ID });

    expect(files).toEqual([
      'static/chunks/webpack-1.js',
      'static/chunks/main-1.js',
      'static/css/app.css',
      'static/chunks/polyfills.js',
      'static/chunks/pages/base/slug.js',
      'static/css/base.css',
      'static/chunks/pages/base/design.js',
      'static/chunks/pages/space.js',
      `static/${BUILD_ID}/_ssgManifest.js`,
      `static/${BUILD_ID}/_buildManifest.js`,
    ]);
    // routes the shell never opens stay out, as do source maps
    expect(files).not.toContain('static/chunks/pages/admin.js');
    expect(files).not.toContain('static/chunks/pages/_error.js');
    expect(files.some((file) => file.endsWith('.map'))).toBe(false);
    // the artifact page only exists in the EE app
    expect(missingRoutes).toEqual(['/artifact/[artifactId]']);
  });

  it('guarantees the build manifests even when the manifest omits them', () => {
    const { files } = collectPrecacheFiles(
      { pages: { '/_app': [] }, polyfillFiles: [], lowPriorityFiles: [] },
      { buildId: BUILD_ID, routes: [] }
    );
    expect(files).toEqual([
      `static/${BUILD_ID}/_buildManifest.js`,
      `static/${BUILD_ID}/_ssgManifest.js`,
    ]);
  });

  it('targets the routes the WebView opens', () => {
    expect(MOBILE_PRECACHE_ROUTES).toEqual([
      '/base/[baseId]/[[...slug]]',
      '/base/[baseId]/design',
      '/space/[spaceId]',
      '/artifact/[artifactId]',
    ]);
  });
});

describe('toPrecacheUrls', () => {
  it('maps to /_next URLs, honouring an asset prefix', () => {
    expect(toPrecacheUrls(['static/chunks/a.js'])).toEqual(['/_next/static/chunks/a.js']);
    expect(
      toPrecacheUrls(['static/chunks/a.js', '/static/css/b.css'], 'https://cdn.example.com/')
    ).toEqual([
      'https://cdn.example.com/_next/static/chunks/a.js',
      'https://cdn.example.com/_next/static/css/b.css',
    ]);
  });
});

describe('renderServiceWorker', () => {
  it('emits a syntactically valid worker keyed by the build id with the precache list', () => {
    const precacheUrls = [
      '/_next/static/chunks/a.js',
      `/_next/static/${BUILD_ID}/_buildManifest.js`,
    ];
    const source = renderServiceWorker({ buildId: BUILD_ID, precacheUrls });

    expect(() => new Script(source)).not.toThrow();
    expect(source).toContain(`const BUILD_ID = "${BUILD_ID}";`);
    expect(source).toContain(`const CACHE_PREFIX = "${MOBILE_SW_CACHE_PREFIX}";`);
    for (const url of precacheUrls) {
      expect(source).toContain(JSON.stringify(url));
    }
    // runtime strategy markers: hashed assets only, nothing account-bound is cached
    expect(source).toContain("'/_next/static/'");
    expect(source).toContain("request.method !== 'GET'");
    expect(source).toContain('self.skipWaiting()');
    expect(source).not.toContain("request.mode === 'navigate'");
    expect(source).not.toContain('self.clients.claim()');
    expect(source).not.toContain('allSettled');
  });
});
