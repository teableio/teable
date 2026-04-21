import { CellValueType, FieldType } from '@teable/core';
import type { IFieldInstance } from '../../features/field/model/factory';
import { FieldFormatter } from './search-index-builder.postgres';

describe('FieldFormatter', () => {
  it('formats date fields for search without creating a trigram index expression', () => {
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

    expect(FieldFormatter.getSearchableExpression(field)).toBe(
      "TO_CHAR(TIMEZONE('Asia/Singapore', \"Due_Date\"), 'YYYY-MM-DD HH24:MI')"
    );
    expect(FieldFormatter.getIndexExpression(field)).toBeNull();
  });
});
