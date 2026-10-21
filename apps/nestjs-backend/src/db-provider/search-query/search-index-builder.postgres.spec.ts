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

  it.each([
    {
      name: 'number',
      field: {
        type: FieldType.Number,
        cellValueType: CellValueType.Number,
        dbFieldName: 'Amount',
      },
    },
    {
      name: 'rating',
      field: {
        type: FieldType.Rating,
        cellValueType: CellValueType.Number,
        dbFieldName: 'Score',
      },
    },
    {
      name: 'single select',
      field: {
        type: FieldType.SingleSelect,
        cellValueType: CellValueType.String,
        dbFieldName: 'Status',
      },
    },
    {
      name: 'attachment',
      field: {
        type: FieldType.Attachment,
        cellValueType: CellValueType.String,
        dbFieldName: 'Files',
        isMultipleCellValue: true,
        isStructuredCellValue: true,
      },
    },
    {
      name: 'lookup attachment',
      field: {
        type: FieldType.Attachment,
        cellValueType: CellValueType.String,
        dbFieldName: 'Lookup_Files',
        isLookup: true,
        isMultipleCellValue: true,
        isStructuredCellValue: true,
      },
    },
    {
      name: 'user',
      field: {
        type: FieldType.User,
        cellValueType: CellValueType.String,
        dbFieldName: 'Owner',
        isStructuredCellValue: true,
      },
    },
    {
      name: 'link',
      field: {
        type: FieldType.Link,
        cellValueType: CellValueType.String,
        dbFieldName: 'Related',
        isStructuredCellValue: true,
      },
    },
    {
      name: 'number formula',
      field: {
        type: FieldType.Formula,
        cellValueType: CellValueType.Number,
        dbFieldName: 'Amount_Formula',
      },
    },
  ])('does not build a trigram index for $name', ({ field }) => {
    expect(
      FieldFormatter.getIndexSpec({
        isMultipleCellValue: false,
        isStructuredCellValue: false,
        options: {},
        ...field,
      } as IFieldInstance)
    ).toBeNull();
  });

  it('still builds a trigram index for single line text', () => {
    expect(
      FieldFormatter.getIndexSpec({
        type: FieldType.SingleLineText,
        cellValueType: CellValueType.String,
        dbFieldName: 'Title',
        isMultipleCellValue: false,
        isStructuredCellValue: false,
      } as IFieldInstance)
    ).toEqual({
      kind: 'trgm',
      expression: '"Title"',
    });
  });

  it('still builds a trigram index for string formulas', () => {
    expect(
      FieldFormatter.getIndexSpec({
        type: FieldType.Formula,
        cellValueType: CellValueType.String,
        dbFieldName: 'Title_Formula',
        isMultipleCellValue: false,
        isStructuredCellValue: false,
      } as IFieldInstance)
    ).toEqual({
      kind: 'trgm',
      expression: '"Title_Formula"',
    });
  });

  it('keeps ILIKE expressions for rejected types without indexing them', () => {
    const field = {
      type: FieldType.Number,
      cellValueType: CellValueType.Number,
      dbFieldName: 'Amount',
      isMultipleCellValue: false,
      isStructuredCellValue: false,
      options: { formatting: { precision: 2 } },
    } as IFieldInstance;

    expect(FieldFormatter.getSearchableExpression(field)).toBe('ROUND("Amount"::numeric, 2)::text');
    expect(FieldFormatter.getIndexSpec(field)).toBeNull();
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

  it('installs pg_trgm in the shared public schema', () => {
    const builder = new IndexBuilderPostgres();

    expect(builder.getCreateIndexSql('base_table.records', [])).toEqual([
      'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;',
    ]);
  });

  it('casts pg_indexes name columns to text and scopes index info to the table schema', () => {
    const builder = new IndexBuilderPostgres();

    const sql = builder.getIndexInfoSql('base_table.records');

    expect(sql).toContain('schemaname::text, tablename::text, indexname::text, indexdef');
    expect(sql).not.toContain('SELECT *');
    expect(sql).toContain(`schemaname = 'base_table'`);
    expect(sql).toContain(`tablename = 'records'`);
  });
});
