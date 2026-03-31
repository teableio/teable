import { domainError } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type {
  FieldColumn,
  TableRecordSelectColumnsVisitor,
} from './TableRecordSelectColumnsVisitor';
import { TableRecordSelectColumnsVisitor as TableRecordSelectColumnsVisitorImpl } from './TableRecordSelectColumnsVisitor';

type SupportedVisitMethod =
  | 'visitSingleLineTextField'
  | 'visitLongTextField'
  | 'visitNumberField'
  | 'visitRatingField'
  | 'visitFormulaField'
  | 'visitRollupField'
  | 'visitSingleSelectField'
  | 'visitMultipleSelectField'
  | 'visitCheckboxField'
  | 'visitAttachmentField'
  | 'visitDateField'
  | 'visitCreatedTimeField'
  | 'visitLastModifiedTimeField'
  | 'visitUserField'
  | 'visitCreatedByField'
  | 'visitLastModifiedByField'
  | 'visitAutoNumberField'
  | 'visitButtonField'
  | 'visitLinkField'
  | 'visitLookupField'
  | 'visitConditionalRollupField'
  | 'visitConditionalLookupField';

type FakeField = {
  id(): string;
  dbFieldName(): ReturnType<typeof ok<{ value: () => ReturnType<typeof ok<string>> }>>;
  accept(
    visitor: TableRecordSelectColumnsVisitor
  ): ReturnType<TableRecordSelectColumnsVisitor['visitSingleLineTextField']>;
};

const createField = (id: string, column: string, method: SupportedVisitMethod): FakeField => {
  const field: FakeField = {
    id: () => id,
    dbFieldName: () =>
      ok({
        value: () => ok(column),
      }),
    accept(visitor) {
      return (visitor[method] as (field: FakeField) => ReturnType<typeof ok<FieldColumn>>)(field);
    },
  };

  return field;
};

describe('TableRecordSelectColumnsVisitor', () => {
  const methods: SupportedVisitMethod[] = [
    'visitSingleLineTextField',
    'visitLongTextField',
    'visitNumberField',
    'visitRatingField',
    'visitFormulaField',
    'visitRollupField',
    'visitSingleSelectField',
    'visitMultipleSelectField',
    'visitCheckboxField',
    'visitAttachmentField',
    'visitDateField',
    'visitCreatedTimeField',
    'visitLastModifiedTimeField',
    'visitUserField',
    'visitCreatedByField',
    'visitLastModifiedByField',
    'visitAutoNumberField',
    'visitButtonField',
    'visitLinkField',
    'visitLookupField',
    'visitConditionalRollupField',
    'visitConditionalLookupField',
  ];

  it.each(methods)('adds a column for %s', (method, index) => {
    const visitor = new TableRecordSelectColumnsVisitorImpl();
    const field = createField(`fld_${index}`, `col_${index}`, method);

    const result = (visitor[method] as (field: FakeField) => ReturnType<typeof ok<FieldColumn>>)(
      field
    );

    expect(result._unsafeUnwrap()).toEqual({
      fieldId: `fld_${index}`,
      dbFieldName: `col_${index}`,
    });
  });

  it('collects columns in order when applying to a table and expands select refs', () => {
    const visitor = new TableRecordSelectColumnsVisitorImpl();
    const table = {
      getFields: () => [
        createField('fld_a', 'col_a', 'visitSingleLineTextField'),
        createField('fld_b', 'col_b', 'visitLookupField'),
        createField('fld_c', 'col_c', 'visitConditionalLookupField'),
      ],
    };

    const result = visitor.apply(table as never);

    expect(result._unsafeUnwrap()).toEqual([
      { fieldId: 'fld_a', dbFieldName: 'col_a' },
      { fieldId: 'fld_b', dbFieldName: 'col_b' },
      { fieldId: 'fld_c', dbFieldName: 'col_c' },
    ]);
    expect(
      visitor.selectColumns(
        {
          ref: (name: string) => `ref:${name}`,
        } as never,
        '__id'
      )
    ).toEqual(['ref:__id', 'ref:col_a', 'ref:col_b', 'ref:col_c']);
  });

  it('returns a conflict error for duplicate database field names', () => {
    const visitor = new TableRecordSelectColumnsVisitorImpl();
    const first = createField('fld_a', 'col_a', 'visitSingleLineTextField');
    const duplicate = createField('fld_b', 'col_a', 'visitLookupField');

    expect(visitor.visitSingleLineTextField(first as never).isOk()).toBe(true);
    const result = visitor.visitLookupField(duplicate as never);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'conflict',
      message: 'Duplicate DbFieldName',
    });
  });

  it('propagates invalid dbFieldName errors', () => {
    const visitor = new TableRecordSelectColumnsVisitorImpl();
    const field = {
      id: () => 'fld_invalid',
      dbFieldName: () => err(domainError.validation({ message: 'missing db field name' })),
    };

    const result = visitor.visitButtonField(field as never);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'validation.invalid',
      message: 'missing db field name',
    });
  });
});
