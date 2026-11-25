import { pickTemplateOfSnapshotBase } from './template';

const snapshotOf = (baseId: string, name = 'Snapshot') =>
  JSON.stringify({ baseId, snapshotTime: '2026-11-24T00:00:00.000Z', spaceId: 'spcT', name });

describe('pickTemplateOfSnapshotBase', () => {
  it('returns the row whose snapshot base is the id, with the snapshot parsed', () => {
    const row = { id: 'tplOwn', snapshot: snapshotOf('bseOwn') };

    expect(pickTemplateOfSnapshotBase([row], 'bseOwn')).toEqual({
      id: 'tplOwn',
      snapshot: {
        baseId: 'bseOwn',
        snapshotTime: '2026-11-24T00:00:00.000Z',
        spaceId: 'spcT',
        name: 'Snapshot',
      },
    });
  });

  it('does not take a row that only mentions the id in another snapshot field', () => {
    const planted = { id: 'tplOther', snapshot: snapshotOf('bseOther', 'bseVictim') };

    expect(pickTemplateOfSnapshotBase([planted], 'bseVictim')).toBeNull();
  });

  it('keeps looking past a row that only mentions the id', () => {
    const planted = { id: 'tplOther', snapshot: snapshotOf('bseOther', 'bseOwn') };
    const own = { id: 'tplOwn', snapshot: snapshotOf('bseOwn') };

    expect(pickTemplateOfSnapshotBase([planted, own], 'bseOwn')?.id).toBe('tplOwn');
  });

  it('does not take a snapshot base whose id merely contains the id', () => {
    const longer = { id: 'tplLonger', snapshot: snapshotOf('bseOwnSuffix') };

    expect(pickTemplateOfSnapshotBase([longer], 'bseOwn')).toBeNull();
  });

  it('skips rows without a snapshot or with one that is not JSON', () => {
    const rows = [
      { id: 'tplNone', snapshot: null },
      { id: 'tplBroken', snapshot: '{"baseId":"bseOwn"' },
      { id: 'tplNull', snapshot: 'null' },
    ];

    expect(pickTemplateOfSnapshotBase(rows, 'bseOwn')).toBeNull();
  });
});
