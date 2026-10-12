import { describe, expect, it } from 'vitest';

import { FieldId } from '../fields/FieldId';
import { ViewColumnMeta } from './ViewColumnMeta';

const fieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();

describe('ViewColumnMeta.applyPatches', () => {
  it('merges repeated patches in request order and reports exact transitions', () => {
    const metadata = ViewColumnMeta.create({
      [fieldId.toString()]: { order: 0, width: 180 },
    })._unsafeUnwrap();

    const result = metadata
      .applyPatches([
        { fieldId, columnMeta: { width: 240 } },
        { fieldId, columnMeta: { hidden: true } },
      ])
      ._unsafeUnwrap();

    expect(result.columnMeta.toDto()[fieldId.toString()]).toEqual({
      order: 0,
      width: 240,
      hidden: true,
    });
    expect(result.changes).toEqual([
      {
        fieldId,
        previousColumnMeta: { order: 0, width: 180 },
        nextColumnMeta: { order: 0, width: 240, hidden: true },
      },
    ]);
  });

  it('does not produce a change for an identical patch', () => {
    const metadata = ViewColumnMeta.create({
      [fieldId.toString()]: { order: 0, width: 180 },
    })._unsafeUnwrap();

    const result = metadata
      .applyPatches([{ fieldId, columnMeta: { order: 0, width: 180 } }])
      ._unsafeUnwrap();

    expect(result.columnMeta.equals(metadata)).toBe(true);
    expect(result.changes).toEqual([]);
  });
});

describe('ViewColumnMeta.rehydrate', () => {
  it('accepts persisted column maps without zod parsing', () => {
    const fieldKey = fieldId.toString();
    const raw = {
      [fieldKey]: { order: 0, width: 180, extra: true },
    };

    const metadata = ViewColumnMeta.rehydrate(raw)._unsafeUnwrap();

    expect(metadata.toDto()[fieldKey]).toEqual({ order: 0, width: 180, extra: true });
  });

  it('treats null as empty and rejects arrays', () => {
    expect(ViewColumnMeta.rehydrate(null)._unsafeUnwrap().toDto()).toEqual({});
    expect(ViewColumnMeta.rehydrate([]).isErr()).toBe(true);
  });

  it('rejects malformed entries while copying valid ones into a fresh object', () => {
    const fieldKey = fieldId.toString();
    expect(ViewColumnMeta.rehydrate({ [fieldKey]: { width: '180' } }).isErr()).toBe(true);
    expect(ViewColumnMeta.rehydrate({ [fieldKey]: null }).isErr()).toBe(true);

    const raw = { [fieldKey]: { order: 0, width: 180, extra: true } };
    const metadata = ViewColumnMeta.rehydrate(raw)._unsafeUnwrap();
    const dto = metadata.toDto();
    raw[fieldKey]!.width = 1;
    dto[fieldKey]!.width = 2;
    expect(metadata.toDto()[fieldKey]).toEqual({ order: 0, width: 180, extra: true });
  });
});
