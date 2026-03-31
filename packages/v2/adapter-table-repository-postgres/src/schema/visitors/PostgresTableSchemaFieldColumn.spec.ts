import { domainError } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { resolveColumnName, resolveColumnType } from './PostgresTableSchemaFieldColumn';

const asId = (value: string) => ({
  toString: () => value,
});

const createField = (params: {
  id: string;
  type: string;
  dbFieldName?: string;
  cellValueType?: string;
  isMultiple?: boolean;
}) => ({
  id: () => asId(params.id),
  type: () => ({
    toString: () => params.type,
    equals: (other: { toString(): string }) => other.toString() === params.type,
  }),
  dbFieldName: () =>
    params.dbFieldName
      ? ok({
          value: () => ok(params.dbFieldName as string),
        })
      : err(domainError.invariant({ message: 'db name missing' })),
  ...(params.cellValueType
    ? {
        cellValueType: () =>
          ok({
            toString: () => params.cellValueType as string,
          }),
      }
    : {}),
  ...(params.isMultiple !== undefined
    ? {
        isMultipleCellValue: () =>
          ok({
            toBoolean: () => params.isMultiple as boolean,
          }),
      }
    : {}),
  ...(params.type === 'lookup' || params.type === 'conditionalLookup'
    ? {
        innerField: () => err(domainError.notFound({ message: 'inner field unavailable' })),
      }
    : {}),
  accept(visitor: Record<string, (field: unknown) => unknown>) {
    const map: Record<string, string> = {
      singleLineText: 'visitSingleLineTextField',
      multipleSelect: 'visitMultipleSelectField',
      checkbox: 'visitCheckboxField',
      date: 'visitDateField',
      formula: 'visitFormulaField',
      rollup: 'visitRollupField',
      lookup: 'visitLookupField',
      conditionalLookup: 'visitConditionalLookupField',
      conditionalRollup: 'visitConditionalRollupField',
      autoNumber: 'visitAutoNumberField',
    };
    return visitor[map[params.type] as string](this);
  },
});

describe('PostgresTableSchemaFieldColumn', () => {
  it('resolves db column names and wraps missing-field errors', () => {
    const field = createField({
      id: 'fld_name_ok',
      type: 'singleLineText',
      dbFieldName: 'title_col',
    });
    const missingDbField = createField({
      id: 'fld_name_missing',
      type: 'singleLineText',
    });

    expect(resolveColumnName(field as never)._unsafeUnwrap()).toBe('title_col');
    expect(resolveColumnName()._unsafeUnwrapErr()).toMatchObject({
      code: 'invariant.missing_schema_rule_field',
    });
    expect(resolveColumnName(missingDbField as never)._unsafeUnwrapErr()).toMatchObject({
      code: 'invariant.missing_db_field_name',
      details: {
        fieldId: 'fld_name_missing',
      },
    });
  });

  it('resolves simple, formula, rollup, and lookup column types', () => {
    const textField = createField({
      id: 'fld_text',
      type: 'singleLineText',
      dbFieldName: 'text_col',
    });
    const multiSelectField = createField({
      id: 'fld_multi',
      type: 'multipleSelect',
      dbFieldName: 'multi_col',
    });
    const checkboxField = createField({
      id: 'fld_checkbox',
      type: 'checkbox',
      dbFieldName: 'checkbox_col',
    });
    const formulaNumberField = createField({
      id: 'fld_formula',
      type: 'formula',
      dbFieldName: 'formula_col',
      cellValueType: 'number',
      isMultiple: false,
    });
    const rollupMultiField = createField({
      id: 'fld_rollup',
      type: 'rollup',
      dbFieldName: 'rollup_col',
      cellValueType: 'boolean',
      isMultiple: true,
    });
    const lookupBooleanField = createField({
      id: 'fld_lookup_bool',
      type: 'lookup',
      dbFieldName: 'lookup_bool_col',
      cellValueType: 'boolean',
      isMultiple: false,
    });
    const conditionalLookupMultiField = createField({
      id: 'fld_lookup_multi',
      type: 'conditionalLookup',
      dbFieldName: 'lookup_multi_col',
      cellValueType: 'dateTime',
      isMultiple: true,
    });
    const conditionalRollupDateField = createField({
      id: 'fld_cond_rollup',
      type: 'conditionalRollup',
      dbFieldName: 'cond_rollup_col',
      cellValueType: 'dateTime',
      isMultiple: false,
    });

    expect(resolveColumnType(textField as never)._unsafeUnwrap()).toBe('text');
    expect(resolveColumnType(multiSelectField as never)._unsafeUnwrap()).toBe('jsonb');
    expect(resolveColumnType(checkboxField as never)._unsafeUnwrap()).toBe('boolean');
    expect(resolveColumnType(formulaNumberField as never)._unsafeUnwrap()).toBe('double precision');
    expect(resolveColumnType(rollupMultiField as never)._unsafeUnwrap()).toBe('jsonb');
    expect(resolveColumnType(lookupBooleanField as never)._unsafeUnwrap()).toBe('boolean');
    expect(resolveColumnType(conditionalLookupMultiField as never)._unsafeUnwrap()).toBe('jsonb');
    expect(resolveColumnType(conditionalRollupDateField as never)._unsafeUnwrap()).toBe(
      'timestamptz'
    );
  });

  it('handles special column type fallbacks and missing field context', () => {
    const autoNumberField = createField({
      id: 'fld_auto',
      type: 'autoNumber',
      dbFieldName: 'auto_col',
    });
    const formulaFallbackField = createField({
      id: 'fld_formula_text',
      type: 'formula',
      dbFieldName: 'formula_text_col',
      cellValueType: 'string',
      isMultiple: false,
    });
    const lookupFallbackField = createField({
      id: 'fld_lookup_text',
      type: 'lookup',
      dbFieldName: 'lookup_text_col',
      cellValueType: 'unknown',
      isMultiple: false,
    });

    expect(resolveColumnType(autoNumberField as never)._unsafeUnwrap()).toBe('integer');
    expect(resolveColumnType(formulaFallbackField as never)._unsafeUnwrap()).toBe('text');
    expect(resolveColumnType(lookupFallbackField as never)._unsafeUnwrap()).toBe('text');
    expect(resolveColumnType()._unsafeUnwrapErr()).toMatchObject({
      code: 'invariant.missing_schema_rule_field',
    });
  });
});
