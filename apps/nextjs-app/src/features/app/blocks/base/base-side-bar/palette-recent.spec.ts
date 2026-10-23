import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPaletteRecent,
  PALETTE_RECENT_LIMIT,
  paletteRecentKey,
  readPaletteRecent,
  writePaletteRecent,
} from './palette-recent';

describe('palette recent history', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('scopes history to both user and project and never persists labels or URLs', () => {
    const visit = {
      resourceId: 'tblOne',
      viewId: 'viwOne',
      lastVisited: 100,
      visitCount: 2,
      label: 'Private name',
      href: '/private',
    };
    writePaletteRecent('usrOne', 'bseOne', [visit]);
    expect(readPaletteRecent('usrOne', 'bseOne')).toEqual([
      { resourceId: 'tblOne', viewId: 'viwOne', lastVisited: 100, visitCount: 2 },
    ]);
    expect(window.localStorage.getItem(paletteRecentKey('usrOne', 'bseOne'))).not.toContain(
      'Private'
    );
    expect(window.localStorage.getItem(paletteRecentKey('usrOne', 'bseOne'))).not.toContain('href');
    expect(readPaletteRecent('usrTwo', 'bseOne')).toEqual([]);
    expect(readPaletteRecent('usrOne', 'bseTwo')).toEqual([]);
  });

  it('deduplicates exact destinations, updates frequency, and bounds stored history', () => {
    let visits = addPaletteRecent([], { resourceId: 'tblOne', viewId: 'viwOne' }, 1);
    visits = addPaletteRecent(visits, { resourceId: 'tblOne', viewId: 'viwTwo' }, 2);
    visits = addPaletteRecent(visits, { resourceId: 'tblOne', viewId: 'viwOne' }, 3);
    expect(visits).toEqual([
      { resourceId: 'tblOne', viewId: 'viwOne', lastVisited: 3, visitCount: 2 },
      { resourceId: 'tblOne', viewId: 'viwTwo', lastVisited: 2, visitCount: 1 },
    ]);
    for (let index = 0; index < PALETTE_RECENT_LIMIT + 3; index++) {
      visits = addPaletteRecent(visits, { resourceId: `tbl${index}` }, index + 4);
    }
    writePaletteRecent('usrOne', 'bseOne', visits);
    expect(readPaletteRecent('usrOne', 'bseOne')).toHaveLength(PALETTE_RECENT_LIMIT);
    expect(visits[0].resourceId).toBe(`tbl${PALETTE_RECENT_LIMIT + 2}`);
  });

  it('rejects malformed storage and strips injected metadata', () => {
    const key = paletteRecentKey('usrOne', 'bseOne');
    window.localStorage.setItem(key, '{broken');
    expect(readPaletteRecent('usrOne', 'bseOne')).toEqual([]);
    window.localStorage.setItem(
      key,
      JSON.stringify([
        null,
        { resourceId: '../other', lastVisited: 1, visitCount: 1 },
        { resourceId: 'tblOne', lastVisited: 1, visitCount: -1 },
        { resourceId: 'tblOne', lastVisited: 1, visitCount: 1, label: 'stale' },
        { resourceId: 'tblOne', lastVisited: 2, visitCount: 2, label: 'stale too' },
      ])
    );
    expect(readPaletteRecent('usrOne', 'bseOne')).toEqual([
      { resourceId: 'tblOne', lastVisited: 2, visitCount: 2 },
    ]);
  });

  it('continues when storage access is denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota');
    });
    expect(readPaletteRecent('usrOne', 'bseOne')).toEqual([]);
    expect(() => writePaletteRecent('usrOne', 'bseOne', [])).not.toThrow();
  });
});
