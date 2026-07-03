import { describe, expect, it } from 'vitest';

import type { TableRecordOrderBy } from '../../ports/TableRecordQueryRepository';
import {
  mergeOrderBy,
  mergeOrderByWithViewRowTieBreaker,
  resolveGroupByToOrderBy,
  resolveOrderBy,
} from './orderBy';

const fieldA = 'fld0000000000000001';
const fieldB = 'fld0000000000000002';
const invalidField = 'bad-field';
const viewId = 'viw0000000000000001';

const serializeOrderBy = (orderBy: ReadonlyArray<TableRecordOrderBy> | undefined) => {
  if (!orderBy) return undefined;
  return orderBy.map((item) => {
    if ('fieldId' in item) {
      return {
        type: 'field',
        fieldId: item.fieldId.toString(),
        direction: item.direction,
      };
    }
    return {
      type: 'column',
      column: item.column,
      direction: item.direction,
    };
  });
};

describe('orderBy helpers', () => {
  it('returns undefined for empty sort input', () => {
    const result = resolveOrderBy(undefined);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchInlineSnapshot(`undefined`);
  });

  it('filters invalid field ids in sort', () => {
    const result = resolveOrderBy([
      { fieldId: invalidField, order: 'asc' },
      { fieldId: fieldA, order: 'desc' },
    ]);
    expect(result.isOk()).toBe(true);
    expect(serializeOrderBy(result._unsafeUnwrap())).toMatchInlineSnapshot(`
      [
        {
          "direction": "desc",
          "fieldId": "fld0000000000000001",
          "type": "field",
        },
      ]
    `);
  });

  it('filters invalid field ids in groupBy', () => {
    const result = resolveGroupByToOrderBy([
      { fieldId: fieldB, order: 'asc' },
      { fieldId: invalidField, order: 'desc' },
    ]);
    expect(result.isOk()).toBe(true);
    expect(serializeOrderBy(result._unsafeUnwrap())).toMatchInlineSnapshot(`
      [
        {
          "direction": "asc",
          "fieldId": "fld0000000000000002",
          "type": "field",
        },
      ]
    `);
  });

  it('merges group + sort and appends view row order + auto number as tie-breakers', () => {
    const groupBy = resolveGroupByToOrderBy([{ fieldId: fieldA, order: 'asc' }])._unsafeUnwrap();
    const sortBy = resolveOrderBy([{ fieldId: fieldB, order: 'desc' }])._unsafeUnwrap();
    const merged = mergeOrderBy(groupBy, sortBy, viewId);
    expect(serializeOrderBy(merged)).toMatchInlineSnapshot(`
      [
        {
          "direction": "asc",
          "fieldId": "fld0000000000000001",
          "type": "field",
        },
        {
          "direction": "desc",
          "fieldId": "fld0000000000000002",
          "type": "field",
        },
        {
          "column": "__row_viw0000000000000001",
          "direction": "asc",
          "type": "column",
        },
        {
          "column": "__auto_number",
          "direction": "asc",
          "type": "column",
        },
      ]
    `);
  });

  it('uses view row order + auto number for pure manual ordering', () => {
    const merged = mergeOrderBy(undefined, undefined, viewId);
    expect(serializeOrderBy(merged)).toMatchInlineSnapshot(`
      [
        {
          "column": "__row_viw0000000000000001",
          "direction": "asc",
          "type": "column",
        },
        {
          "column": "__auto_number",
          "direction": "asc",
          "type": "column",
        },
      ]
    `);
  });

  it('appends auto number when viewId is undefined', () => {
    const groupBy = resolveGroupByToOrderBy([{ fieldId: fieldA, order: 'asc' }])._unsafeUnwrap();
    const merged = mergeOrderBy(groupBy, undefined, undefined);
    expect(serializeOrderBy(merged)).toMatchInlineSnapshot(`
      [
        {
          "direction": "asc",
          "fieldId": "fld0000000000000001",
          "type": "field",
        },
        {
          "column": "__auto_number",
          "direction": "asc",
          "type": "column",
        },
      ]
    `);
  });

  it('deduplicates repeated fields and tie-breaker columns', () => {
    const groupBy = resolveGroupByToOrderBy([{ fieldId: fieldA, order: 'asc' }])._unsafeUnwrap();
    // The signature only accepts field sorts; smuggle a column item past the
    // type system to exercise tie-breaker dedup at runtime.
    const sortBy = [
      ...resolveOrderBy([{ fieldId: fieldA, order: 'asc' }])._unsafeUnwrap()!,
      { column: `__row_${viewId}`, direction: 'asc' } as const,
    ] as unknown as Parameters<typeof mergeOrderBy>[1];
    const merged = mergeOrderBy(groupBy, sortBy, viewId);
    expect(serializeOrderBy(merged)).toMatchInlineSnapshot(`
      [
        {
          "direction": "asc",
          "fieldId": "fld0000000000000001",
          "type": "field",
        },
        {
          "column": "__row_viw0000000000000001",
          "direction": "asc",
          "type": "column",
        },
        {
          "column": "__auto_number",
          "direction": "asc",
          "type": "column",
        },
      ]
    `);
  });

  it('uses the list-query tie breaker for range-command row offsets', () => {
    const sortBy = resolveOrderBy([{ fieldId: fieldB, order: 'desc' }])._unsafeUnwrap();
    const merged = mergeOrderByWithViewRowTieBreaker(undefined, sortBy, viewId);
    expect(serializeOrderBy(merged)).toMatchInlineSnapshot(`
      [
        {
          "direction": "desc",
          "fieldId": "fld0000000000000002",
          "type": "field",
        },
        {
          "column": "__row_viw0000000000000001",
          "direction": "asc",
          "type": "column",
        },
        {
          "column": "__auto_number",
          "direction": "asc",
          "type": "column",
        },
      ]
    `);
  });
});
