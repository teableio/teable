import { describe, expect, it } from 'vitest';
import {
  CELL_PROJECTION_THRESHOLD,
  buildSubscribeProjection,
  frozenFieldIdsFromView,
  missingFieldIds,
  loadedFieldsForRecord,
  missingFieldsAcrossRecords,
  pruneLoadedFieldsToRecordIds,
  resolveRecordSubscribeProjection,
  viewportFieldIds,
} from './column-projection';

const ids = (count: number) =>
  Array.from({ length: count }, (_, i) => `fld${String(i).padStart(2, '0')}`);

describe('frozenFieldIdsFromView', () => {
  it('slices through frozenFieldId in column order', () => {
    expect(
      frozenFieldIdsFromView({
        orderedVisibleFieldIds: ['a', 'b', 'c'],
        frozenFieldId: 'b',
      })
    ).toEqual(['a', 'b']);
  });

  it('defaults to the first column when no freeze is set', () => {
    expect(frozenFieldIdsFromView({ orderedVisibleFieldIds: ['a', 'b', 'c'] })).toEqual(['a']);
  });
});

describe('buildSubscribeProjection', () => {
  it('returns all visible ids sorted when under the threshold', () => {
    expect(
      buildSubscribeProjection({
        orderedVisibleFieldIds: ['c', 'a', 'b'],
        primaryFieldId: 'c',
      })
    ).toEqual(['a', 'b', 'c']);
  });

  it('keeps a sorted stable prefix above the threshold', () => {
    const ordered = ids(80);
    const projection = buildSubscribeProjection({
      orderedVisibleFieldIds: ordered,
      frozenFieldIds: ordered.slice(0, 2),
      primaryFieldId: ordered[0],
    });
    expect(projection).toHaveLength(CELL_PROJECTION_THRESHOLD);
    expect(projection).toEqual([...projection].sort());
    expect(projection).toContain(ordered[0]);
    expect(projection).toContain(ordered[1]);
    expect(projection).not.toContain(ordered[50]);
  });

  it('includes a frozen column that sits past the first threshold columns', () => {
    const ordered = ids(80);
    const frozen = ordered[40];
    const projection = buildSubscribeProjection({
      orderedVisibleFieldIds: ordered,
      frozenFieldIds: ordered.slice(0, 41),
      primaryFieldId: ordered[0],
      threshold: 24,
    });
    expect(projection).toContain(frozen);
    expect(projection.length).toBeGreaterThanOrEqual(24);
  });
});

describe('viewportFieldIds', () => {
  it('unions freeze columns with the real scrolled viewport and overscan', () => {
    const ordered = ids(80);
    expect(
      viewportFieldIds({
        orderedVisibleFieldIds: ordered,
        startColumnIndex: 40,
        columnSpan: 5,
        freezeCount: 1,
        overscan: 2,
      })
    ).toEqual([ordered[0], ...ordered.slice(38, 48)]);
  });

  it('treats columnSpan 0 as a single visible column', () => {
    const ordered = ids(10);
    expect(
      viewportFieldIds({
        orderedVisibleFieldIds: ordered,
        startColumnIndex: 5,
        columnSpan: 0,
        freezeCount: 1,
        overscan: 0,
      })
    ).toEqual([ordered[0], ordered[5]]);
  });
});

describe('missingFieldIds', () => {
  it('drops ids already marked loaded', () => {
    expect(missingFieldIds(['a', 'b', 'c'], new Set(['b']))).toEqual(['a', 'c']);
  });
});

describe('resolveRecordSubscribeProjection', () => {
  const ordered = Array.from({ length: 40 }, (_, i) => `fld${String(i).padStart(2, '0')}`);

  it('does not truncate when sparse column fill is off', () => {
    expect(
      resolveRecordSubscribeProjection({
        sparseColumnFill: false,
        orderedVisibleFieldIds: ordered,
      })
    ).toEqual([...ordered].sort());
  });

  it('keeps an explicit hidden readable field when sparse fill is off', () => {
    expect(
      resolveRecordSubscribeProjection({
        sparseColumnFill: false,
        requestedProjection: ['fld00', 'fldCover'],
        orderedVisibleFieldIds: ['fld00'],
        readableFieldIds: new Set(['fld00', 'fldCover']),
      })
    ).toEqual(['fld00', 'fldCover']);
  });

  it('uses the stable prefix only when sparse column fill is on', () => {
    const projection = resolveRecordSubscribeProjection({
      sparseColumnFill: true,
      requestedProjection: ordered,
      orderedVisibleFieldIds: ordered,
      primaryFieldId: ordered[0],
    });
    expect(projection).toHaveLength(CELL_PROJECTION_THRESHOLD);
    expect(projection).not.toContain(ordered[39]);
  });
});

describe('missingFieldsAcrossRecords', () => {
  it('requests viewport fields for a new record even if other rows already loaded them', () => {
    const snapshot = new Set(['fldPrefix']);
    const oldDoc = { id: 'old' };
    const loaded = new Map([
      ['recOld', { source: oldDoc, fields: new Set(['fldPrefix', 'fldViewport']) }],
    ]);
    expect(
      missingFieldsAcrossRecords(
        [{ id: 'recOld', docSource: oldDoc }, { id: 'recNew' }],
        ['fldPrefix', 'fldViewport'],
        loaded,
        snapshot
      )
    ).toEqual(['fldViewport']);
  });

  it('treats a replaced ShareDB doc as a fresh snapshot', () => {
    const snapshot = new Set(['fldPrefix']);
    const loaded = new Map([
      ['rec1', { source: { id: 'doc-a' }, fields: new Set(['fldPrefix', 'fldViewport']) }],
    ]);
    expect(
      loadedFieldsForRecord({ id: 'rec1', docSource: { id: 'doc-b' } }, loaded, snapshot).has(
        'fldViewport'
      )
    ).toBe(false);
    expect(
      missingFieldsAcrossRecords(
        [{ id: 'rec1', docSource: { id: 'doc-b' } }],
        ['fldPrefix', 'fldViewport'],
        loaded,
        snapshot
      )
    ).toEqual(['fldViewport']);
  });
});

describe('pruneLoadedFieldsToRecordIds', () => {
  it('drops marks for records that left the subscribe window', () => {
    const loaded = new Map([
      ['recOld', { source: undefined, fields: new Set(['fldPrefix', 'fldViewport']) }],
      ['recKeep', { source: undefined, fields: new Set(['fldPrefix', 'fldViewport']) }],
    ]);
    const next = pruneLoadedFieldsToRecordIds(loaded, ['recKeep']);
    expect(next?.has('recOld')).toBe(false);
    expect(next?.get('recKeep')?.fields.has('fldViewport')).toBe(true);
  });
});
