import { FieldType } from '@teable/core';
import { describe, expect, it } from 'vitest';

import { mapLegacyCreateTableToV2Input } from './table-open-api-v2.mapper';

describe('mapLegacyCreateTableToV2Input', () => {
  const foreignTableId = 'tblForeign';
  const revenueFieldId = 'fldRevenue';
  const sumValuesExpression = 'sum({values})';

  it('maps legacy rollup fields into v2 create-table config', () => {
    const input = mapLegacyCreateTableToV2Input('bseTest', {
      name: 'Rollup Table',
      fields: [
        {
          id: 'fldRollup',
          name: 'Revenue Total',
          type: FieldType.Rollup,
          cellValueType: 'number',
          isMultipleCellValue: false,
          options: {
            expression: sumValuesExpression,
            timeZone: 'UTC',
          },
          lookupOptions: {
            linkFieldId: 'fldLink',
            foreignTableId,
            lookupFieldId: revenueFieldId,
          },
        },
      ],
      views: [{ type: 'grid', name: 'Grid' }],
      records: [],
    });

    expect(input.fields).toEqual([
      {
        id: 'fldRollup',
        name: 'Revenue Total',
        type: 'rollup',
        cellValueType: 'number',
        options: {
          expression: sumValuesExpression,
          timeZone: 'utc',
        },
        config: {
          linkFieldId: 'fldLink',
          foreignTableId,
          lookupFieldId: revenueFieldId,
        },
      },
    ]);
  });

  it('maps legacy conditional rollup and conditional lookup fields into v2 create-table inputs', () => {
    const input = mapLegacyCreateTableToV2Input('bseTest', {
      name: 'Conditional Table',
      fields: [
        {
          id: 'fldConditionalRollup',
          name: 'High Revenue Total',
          type: FieldType.ConditionalRollup,
          cellValueType: 'number',
          isMultipleCellValue: false,
          options: {
            foreignTableId,
            lookupFieldId: revenueFieldId,
            expression: sumValuesExpression,
            timeZone: 'UTC',
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: revenueFieldId, operator: 'isGreater', value: 100 }],
            },
          },
        },
        {
          id: 'fldConditionalLookup',
          name: 'High Revenue Company',
          type: FieldType.SingleLineText,
          isLookup: true,
          isConditionalLookup: true,
          isMultipleCellValue: true,
          options: {
            formatting: { type: 'singleLineText' },
          },
          lookupOptions: {
            foreignTableId,
            lookupFieldId: 'fldName',
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: revenueFieldId, operator: 'isGreater', value: 100 }],
            },
          },
        },
      ],
      views: [{ type: 'grid', name: 'Grid' }],
      records: [],
    });

    expect(input.fields).toEqual([
      {
        id: 'fldConditionalRollup',
        name: 'High Revenue Total',
        type: 'conditionalRollup',
        cellValueType: 'number',
        options: {
          expression: sumValuesExpression,
          timeZone: 'utc',
        },
        config: {
          foreignTableId,
          lookupFieldId: revenueFieldId,
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: revenueFieldId, operator: 'isGreater', value: 100 }],
            },
          },
        },
      },
      {
        id: 'fldConditionalLookup',
        name: 'High Revenue Company',
        type: 'conditionalLookup',
        isMultipleCellValue: true,
        options: {
          foreignTableId,
          lookupFieldId: 'fldName',
          condition: {
            filter: {
              conjunction: 'and',
              filterSet: [{ fieldId: revenueFieldId, operator: 'isGreater', value: 100 }],
            },
          },
        },
        innerOptions: {
          formatting: { type: 'singleLineText' },
        },
      },
    ]);
  });

  it('preserves db table and field names in v2 create-table inputs', () => {
    const input = mapLegacyCreateTableToV2Input('bseTest', {
      name: 'Custom Names',
      dbTableName: 'bseTest.custom_table',
      fields: [
        {
          id: 'fldName',
          name: 'Name',
          dbFieldName: 'db_field_name',
          type: FieldType.SingleLineText,
        },
      ],
      views: [{ type: 'grid', name: 'Grid' }],
      records: [],
    });

    expect(input.dbTableName).toBe('bseTest.custom_table');
    expect(input.fields).toEqual([
      {
        id: 'fldName',
        name: 'Name',
        dbFieldName: 'db_field_name',
        type: 'singleLineText',
      },
    ]);
  });

  it('normalizes legacy UTC values for generic field options', () => {
    const input = mapLegacyCreateTableToV2Input('bseTest', {
      name: 'Date Table',
      fields: [
        {
          id: 'fldDate',
          name: 'Due Date',
          type: FieldType.Date,
          options: {
            formatting: {
              date: 'YYYY-MM-DD',
              time: 'HH:mm',
              timeZone: 'UTC',
            },
          },
        },
      ],
      views: [{ type: 'grid', name: 'Grid' }],
      records: [],
    });

    expect(input.fields).toEqual([
      {
        id: 'fldDate',
        name: 'Due Date',
        type: 'date',
        options: {
          formatting: {
            date: 'YYYY-MM-DD',
            time: 'HH:mm',
            timeZone: 'utc',
          },
        },
      },
    ]);
  });
});
