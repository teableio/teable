import { describe, expect, it } from 'vitest';

import { FieldId } from '../fields/FieldId';
import {
  keepPrimaryColumnVisible,
  keepPrimaryFieldVisible,
  ViewColumnMeta,
} from './ViewColumnMeta';
import { ViewType } from './ViewType';

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

describe('keepPrimaryFieldVisible', () => {
  it('repairs a hidden gallery primary entry without mutating the input', () => {
    const entry = { order: 0, width: 260, visible: false, hidden: false };

    expect(keepPrimaryFieldVisible(ViewType.gallery(), entry)).toEqual({
      ...entry,
      visible: true,
    });
    expect(entry.visible).toBe(false);
  });

  it('leaves other view types and already visible entries untouched', () => {
    const hiddenEntry = { visible: false };
    const visibleEntry = { visible: true };

    expect(keepPrimaryFieldVisible(ViewType.kanban(), hiddenEntry)).toBe(hiddenEntry);
    expect(keepPrimaryFieldVisible(ViewType.grid(), hiddenEntry)).toBe(hiddenEntry);
    expect(keepPrimaryFieldVisible(ViewType.gallery(), visibleEntry)).toBe(visibleEntry);
  });
});

describe('keepPrimaryColumnVisible', () => {
  const secondaryFieldId = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();

  it('normalizes only the primary key and preserves sibling metadata', () => {
    const columnMeta = {
      [fieldId.toString()]: { order: 0, width: 260, visible: false },
      [secondaryFieldId.toString()]: { order: 1, width: 120, visible: false },
    };

    const result = keepPrimaryColumnVisible(ViewType.gallery(), fieldId, columnMeta);

    expect(result[fieldId.toString()]).toEqual({ order: 0, width: 260, visible: true });
    expect(result[secondaryFieldId.toString()]).toBe(columnMeta[secondaryFieldId.toString()]);
    expect(columnMeta[fieldId.toString()]).toEqual({ order: 0, width: 260, visible: false });
  });

  it('returns the same map for non-gallery views and visible primary entries', () => {
    const hiddenPrimary = { [fieldId.toString()]: { order: 0, visible: false } };
    const visiblePrimary = { [fieldId.toString()]: { order: 0, visible: true } };

    expect(keepPrimaryColumnVisible(ViewType.kanban(), fieldId, hiddenPrimary)).toBe(hiddenPrimary);
    expect(keepPrimaryColumnVisible(ViewType.grid(), fieldId, hiddenPrimary)).toBe(hiddenPrimary);
    expect(keepPrimaryColumnVisible(ViewType.gallery(), fieldId, visiblePrimary)).toBe(
      visiblePrimary
    );
  });
});
