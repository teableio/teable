import type { IRecord } from '@teable/core';
import type { Doc } from 'sharedb/lib/client';
import { describe, expect, it } from 'vitest';
import { Record as RecordInstance } from '../../model/record/record';
import { docsForProjectedFill, mergeProjectedFieldsIntoDocs } from './mergeProjectedRecordFields';

const doc = (
  id: string,
  fields: Record<string, unknown>,
  permissions?: IRecord['permissions']
): Doc<IRecord> =>
  ({
    id,
    data: { id, fields, ...(permissions ? { permissions } : {}) },
  }) as Doc<IRecord>;

describe('mergeProjectedFieldsIntoDocs', () => {
  it('refresh writes a fetched value and ignores omitted keys', () => {
    const live = doc('rec1', { fldA: 'old', fldLocal: 'optimistic' });
    const fetched = new Map<string, IRecord>([
      ['rec1', { id: 'rec1', fields: { fldA: 'new' } } as IRecord],
    ]);

    mergeProjectedFieldsIntoDocs([live], fetched, ['fldA', 'fldLocal'], 'refresh');

    expect(live.data.fields).toEqual({ fldA: 'new', fldLocal: 'optimistic' });
  });

  it('fill does not clobber a live op already on the doc', () => {
    const live = doc('rec1', { fldOffscreen: 'from-op' });
    const fetched = new Map<string, IRecord>([
      ['rec1', { id: 'rec1', fields: { fldOffscreen: 'stale-http' } } as IRecord],
    ]);

    mergeProjectedFieldsIntoDocs([live], fetched, ['fldOffscreen'], 'fill');

    expect(live.data.fields.fldOffscreen).toBe('from-op');
  });

  it('fill writes a viewport cell that was never on the snapshot', () => {
    const live = doc('rec1', { fldPrefix: 'keep' });
    const fetched = new Map<string, IRecord>([
      ['rec1', { id: 'rec1', fields: { fldViewport: 'hello' } } as IRecord],
    ]);

    const changed = mergeProjectedFieldsIntoDocs([live], fetched, ['fldViewport'], 'fill');

    expect(changed).toHaveLength(1);
    expect(live.data.fields).toEqual({ fldPrefix: 'keep', fldViewport: 'hello' });
  });
});

describe('projected field permissions', () => {
  it('merges the projected field permissions so the late-loaded column is readable and editable', () => {
    const live = doc(
      'rec1',
      { fldPrefix: 'keep' },
      { read: { fldPrefix: true }, update: { fldPrefix: true } }
    );
    const fetched = new Map<string, IRecord>([
      [
        'rec1',
        {
          id: 'rec1',
          fields: { fldLate: 'late' },
          permissions: { read: { fldLate: true }, update: { fldLate: true } },
        } as IRecord,
      ],
    ]);

    const changed = mergeProjectedFieldsIntoDocs([live], fetched, ['fldLate'], 'fill');

    expect(live.data.fields.fldLate).toBe('late');
    expect(RecordInstance.isHidden(live.data.permissions, 'fldLate')).toBe(false);
    expect(RecordInstance.isLocked(live.data.permissions, 'fldLate')).toBe(false);
    expect(changed).toHaveLength(1);
  });

  it('reports a doc whose permissions changed as changed', () => {
    const live = doc(
      'rec1',
      { fldLate: 'late' },
      { read: { fldLate: true }, update: { fldLate: true } }
    );
    const fetched = new Map<string, IRecord>([
      [
        'rec1',
        {
          id: 'rec1',
          fields: { fldLate: 'late' },
          permissions: { read: { fldLate: true }, update: { fldLate: false } },
        } as IRecord,
      ],
    ]);

    const changed = mergeProjectedFieldsIntoDocs([live], fetched, ['fldLate'], 'fill');

    expect(RecordInstance.isLocked(live.data.permissions, 'fldLate')).toBe(true);
    expect(changed).toHaveLength(1);
  });

  it('does not restrict an unrestricted doc with a partial permission map', () => {
    const live = doc('rec1', { fldPrefix: 'keep' });
    const fetched = new Map<string, IRecord>([
      [
        'rec1',
        {
          id: 'rec1',
          fields: { fldLate: 'late' },
          permissions: { read: { fldLate: true }, update: { fldLate: true } },
        } as IRecord,
      ],
    ]);

    mergeProjectedFieldsIntoDocs([live], fetched, ['fldLate'], 'fill');

    expect(live.data.permissions).toBeUndefined();
  });

  it('keeps an empty permission map empty', () => {
    const live = doc('rec1', { fldPrefix: 'keep' }, {});
    const fetched = new Map<string, IRecord>([
      [
        'rec1',
        {
          id: 'rec1',
          fields: { fldLate: 'late' },
          permissions: { read: { fldLate: false }, update: { fldLate: false } },
        } as IRecord,
      ],
    ]);

    mergeProjectedFieldsIntoDocs([live], fetched, ['fldLate'], 'fill');

    expect(RecordInstance.isHidden(live.data.permissions, 'fldPrefix')).toBe(false);
    expect(RecordInstance.isLocked(live.data.permissions, 'fldLate')).toBe(false);
  });

  it('does not write an empty permission map when the fetch carries none', () => {
    const live = doc(
      'rec1',
      { fldPrefix: 'keep' },
      { read: { fldPrefix: true }, update: { fldPrefix: true } }
    );
    const fetched = new Map<string, IRecord>([
      ['rec1', { id: 'rec1', fields: { fldLate: 'late' } } as IRecord],
    ]);

    mergeProjectedFieldsIntoDocs([live], fetched, ['fldLate'], 'fill');

    expect(live.data.permissions).toEqual({
      read: { fldPrefix: true },
      update: { fldPrefix: true },
    });
  });
});

describe('docsForProjectedFill', () => {
  it('returns undefined when subscribe docs have not arrived', () => {
    expect(docsForProjectedFill([], [{ id: 'rec1' } as IRecord])).toBeUndefined();
  });
});
