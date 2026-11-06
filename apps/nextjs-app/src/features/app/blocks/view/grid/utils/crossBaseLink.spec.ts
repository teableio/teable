import type { IFieldVo } from '@teable/core';
import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import { describe, expect, it } from 'vitest';
import { downgradeCrossBaseHeaders, downgradeCrossBaseRawContent } from './crossBaseLink';

const currentBaseId = 'bseCurrent';
const foreignBaseId = 'bseOther';

const buildField = (overrides: Partial<IFieldVo>): IFieldVo => ({
  id: 'fld1',
  name: 'Field',
  type: FieldType.SingleLineText,
  options: {},
  cellValueType: CellValueType.String,
  dbFieldType: DbFieldType.Text,
  dbFieldName: 'col',
  ...overrides,
});

describe('downgradeCrossBaseHeaders', () => {
  it('rewrites only cross-base columns to SingleLineText and records their indices', () => {
    const headers: IFieldVo[] = [
      buildField({ id: 'fldText', name: 'Notes' }),
      buildField({
        id: 'fldLink',
        name: 'Linked',
        type: FieldType.Link,
        options: { baseId: foreignBaseId, foreignTableId: 'tblOther' } as IFieldVo['options'],
      }),
    ];

    const { headers: next, downgradedIndices } = downgradeCrossBaseHeaders(headers, currentBaseId);

    expect(downgradedIndices).toEqual(new Set([1]));
    expect(next[0]).toBe(headers[0]);
    expect(next[1].type).toBe(FieldType.SingleLineText);
    expect(next[1].id).toBe('fldLink');
    expect(next[1].name).toBe('Linked');
    expect(next[1].options).toEqual({});
  });

  it('returns input unchanged when no cross-base columns exist', () => {
    const headers: IFieldVo[] = [buildField({ id: 'fldA' }), buildField({ id: 'fldB' })];
    const result = downgradeCrossBaseHeaders(headers, currentBaseId);
    expect(result.downgradedIndices.size).toBe(0);
    expect(result.headers[0]).toBe(headers[0]);
    expect(result.headers[1]).toBe(headers[1]);
  });

  it('downgrades explicit foreign-base headers when currentBaseId is missing', () => {
    const headers: IFieldVo[] = [
      buildField({ id: 'fldText', name: 'Notes' }),
      buildField({
        id: 'fldLink',
        name: 'Linked',
        type: FieldType.Link,
        options: { baseId: foreignBaseId, foreignTableId: 'tblOther' } as IFieldVo['options'],
      }),
    ];

    const { headers: next, downgradedIndices } = downgradeCrossBaseHeaders(headers, undefined);

    expect(downgradedIndices).toEqual(new Set([1]));
    expect(next[1].type).toBe(FieldType.SingleLineText);
    expect(next[1].options).toEqual({});
  });
});

describe('downgradeCrossBaseRawContent', () => {
  it('downgrades only foreign link cells while preserving allowed user objects', () => {
    const allowedUser = { id: 'usrA', title: 'Alice', email: 'alice@example.com' };
    const foreignLink = { id: 'recForeign', title: 'Foreign record' };
    const rawContent = [[allowedUser, foreignLink, 'note']];
    const displayContent = [['Alice', 'Foreign record', 'note']];

    const result = downgradeCrossBaseRawContent(rawContent, displayContent, new Set([1]));

    expect(result).toEqual([[allowedUser, 'Foreign record', 'note']]);
    expect(result[0]?.[0]).toBe(allowedUser);
  });

  it('returns the original payload when no columns need downgrading', () => {
    const rawContent = [[{ id: 'usrA', title: 'Alice' }]];
    expect(downgradeCrossBaseRawContent(rawContent, [['Alice']], new Set())).toBe(rawContent);
  });
});
