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
