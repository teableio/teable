import { CellValueType, FieldType } from '@teable/core';
import type { IFieldInstance } from '../../features/field/model/factory';
import { FieldFormatter, IndexBuilderPostgres } from './search-index-builder.postgres';

describe('FieldFormatter', () => {
  it('does not expose trigram search expressions for date fields, but still builds a btree index spec', () => {
    const field = {
      cellValueType: CellValueType.DateTime,
      dbFieldName: 'Due_Date',
      isMultipleCellValue: false,
      isStructuredCellValue: false,
      options: {
        formatting: {
          timeZone: 'Asia/Singapore',
        },
      },
      type: FieldType.Date,
    } as IFieldInstance;

    expect(FieldFormatter.getSearchableExpression(field)).toBeNull();
    expect(FieldFormatter.getIndexSpec(field)).toEqual({
      kind: 'btree',
      expression: '"Due_Date"',
    });
  });

  it('creates a btree index sql for single datetime fields', () => {
    const builder = new IndexBuilderPostgres();
    const field = {
      id: 'fldDateField000001',
      cellValueType: CellValueType.DateTime,
      dbFieldName: 'Due_Date',
      isMultipleCellValue: false,
      isStructuredCellValue: false,
      options: {
        formatting: {
          timeZone: 'Asia/Singapore',
        },
      },
      type: FieldType.Date,
    } as IFieldInstance;

    expect(builder.createSingleIndexSql('base_table.records', field)).toContain(
      'ON "base_table"."records" USING btree ("Due_Date")'
    );
    expect(builder.createSingleIndexSql('base_table.records', field)).not.toContain('gin_trgm_ops');
  });
});
