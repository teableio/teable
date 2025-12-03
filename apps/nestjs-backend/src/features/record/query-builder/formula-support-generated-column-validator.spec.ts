import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import type { FieldCore, TableDomain } from '@teable/core';
import { describe, expect, it } from 'vitest';
import { GeneratedColumnQuerySupportValidatorPostgres } from '../../../db-provider/generated-column-query/postgres/generated-column-query-support-validator.postgres';
import { validateFormulaSupport } from './formula-validation';

const makeMockTable = (fields: Record<string, Partial<FieldCore>>): TableDomain =>
  ({
    getField: (id: string) => fields[id] as FieldCore | undefined,
  }) as unknown as TableDomain;

describe('FormulaSupportGeneratedColumnValidator', () => {
  it('rejects numeric formulas when args are definitely non-numeric', () => {
    const table = makeMockTable({
      fldDate: {
        id: 'fldDate',
        name: 'Date',
        dbFieldName: 'Field_45',
        type: FieldType.Date,
        cellValueType: CellValueType.DateTime,
        dbFieldType: DbFieldType.DateTime,
        isLookup: false,
        isMultipleCellValue: false,
      },
      fldText: {
        id: 'fldText',
        name: 'Text',
        dbFieldName: 'Field_1',
        type: FieldType.SingleLineText,
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        isLookup: false,
        isMultipleCellValue: false,
      },
    });

    const validator = new GeneratedColumnQuerySupportValidatorPostgres();
    expect(validateFormulaSupport(validator, 'SUM({fldDate},{fldText})', table)).toBe(false);
  });

  it('allows numeric formulas when args are numeric', () => {
    const table = makeMockTable({
      fldNum1: {
        id: 'fldNum1',
        name: 'Num1',
        dbFieldName: 'num1',
        type: FieldType.Number,
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        isLookup: false,
        isMultipleCellValue: false,
      },
      fldNum2: {
        id: 'fldNum2',
        name: 'Num2',
        dbFieldName: 'num2',
        type: FieldType.Number,
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Real,
        isLookup: false,
        isMultipleCellValue: false,
      },
    });

    const validator = new GeneratedColumnQuerySupportValidatorPostgres();
    expect(validateFormulaSupport(validator, 'SUM({fldNum1},{fldNum2})', table)).toBe(true);
  });
});
