import { describe, expect, it } from 'vitest';
import {
  collectDynamicChunkFiles,
  collectPrecacheFiles,
  MOBILE_PRECACHE_DYNAMIC_MODULES,
  toPrecacheUrls,
} from '../../../../../scripts/build-mobile-precache.mjs';

describe('build-mobile-precache', () => {
  it('collects the page, shared and manifest assets of the shell routes', () => {
    const { files, missingRoutes } = collectPrecacheFiles(
      {
        pages: {
          '/_app': ['static/chunks/app.js', 'static/css/app.css'],
          '/base/[baseId]/[[...slug]]': ['static/chunks/base.js', 'static/chunks/base.js.map'],
        },
        polyfillFiles: ['static/chunks/polyfills.js'],
        lowPriorityFiles: ['static/b1/_buildManifest.js'],
      },
      { buildId: 'b1', routes: ['/base/[baseId]/[[...slug]]', '/space/[spaceId]'] }
    );
    expect(files).toEqual([
      'static/chunks/app.js',
      'static/css/app.css',
      'static/chunks/polyfills.js',
      'static/chunks/base.js',
      'static/b1/_buildManifest.js',
      'static/b1/_ssgManifest.js',
    ]);
    expect(missingRoutes).toEqual(['/space/[spaceId]']);
  });

  it('adds the next/dynamic chunks the table page loads after hydration', () => {
    const loadable = {
      'src/features/app/base-node/TablePage.tsx -> @/features/app/blocks/table/Table': {
        id: 1,
        files: ['static/chunks/table.js', 'static/chunks/table.css', 'static/chunks/table.js.map'],
      },
      'src/features/app/hooks/usePrefetchBaseEntry.ts -> @/features/app/blocks/table/Table': {
        id: 1,
        files: ['static/chunks/table.js'],
      },
      'src/x.tsx -> @/features/app/other/Thing': { id: 2, files: ['static/chunks/other.js'] },
    };
    const { files, missingModules } = collectDynamicChunkFiles(loadable);
    expect(files).toEqual(['static/chunks/table.js', 'static/chunks/table.css']);
    expect(missingModules).toEqual(
      MOBILE_PRECACHE_DYNAMIC_MODULES.filter((m) => m !== '@/features/app/blocks/table/Table')
    );
    expect(collectDynamicChunkFiles(undefined)).toEqual({
      files: [],
      missingModules: MOBILE_PRECACHE_DYNAMIC_MODULES,
    });
  });

  it('points precache urls at the asset prefix', () => {
    expect(toPrecacheUrls(['static/chunks/a.js'], 'https://sss.teable.ai/')).toEqual([
      'https://sss.teable.ai/_next/static/chunks/a.js',
    ]);
    expect(toPrecacheUrls(['/static/chunks/a.js'])).toEqual(['/_next/static/chunks/a.js']);
  });
});
