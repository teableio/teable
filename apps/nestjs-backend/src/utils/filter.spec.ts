import {
  CellValueType,
  FieldType,
  TimeFormatting,
  exactFormatDate,
  isNot,
  isNotExactly,
} from '@teable/core';
import type { IFieldInstance } from '../features/field/model/factory';
import { generateFilterItem } from './filter';

const createField = (partial: Partial<IFieldInstance>): IFieldInstance =>
  ({
    id: 'fld_test',
    type: FieldType.SingleSelect,
    cellValueType: CellValueType.String,
    isMultipleCellValue: false,
    ...partial,
  }) as IFieldInstance;

describe('generateFilterItem', () => {
  it('uses isNotExactly for multi-value singleSelect fields', () => {
    const field = createField({
      type: FieldType.SingleSelect,
      cellValueType: CellValueType.String,
      isMultipleCellValue: true,
    });

    const result = generateFilterItem(field, ['Supplier A']);

    expect(result.operator).toBe(isNotExactly.value);
    expect(result.value).toEqual(['Supplier A']);
  });

  it('keeps isNot for single-value singleSelect fields', () => {
    const field = createField({
      type: FieldType.SingleSelect,
      cellValueType: CellValueType.String,
      isMultipleCellValue: false,
    });

    const result = generateFilterItem(field, 'Supplier A');

    expect(result.operator).toBe(isNot.value);
    expect(result.value).toBe('Supplier A');
  });

  describe('date group values', () => {
    // 2025-11-01 00:00 in Asia/Shanghai — the group key is an absolute instant.
    const groupValueIso = '2025-10-31T16:00:00.000Z';
    const originalTz = process.env.TZ;

    afterEach(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    it.each(['UTC', 'Asia/Shanghai', 'America/New_York'])(
      'keeps the absolute group instant under process timezone %s',
      (tz) => {
        process.env.TZ = tz;
        const field = createField({
          type: FieldType.Date,
          cellValueType: CellValueType.DateTime,
          options: {
            formatting: {
              date: 'YYYY-MM-DD',
              time: TimeFormatting.None,
              timeZone: 'Asia/Shanghai',
            },
          },
        });

        const result = generateFilterItem(field, groupValueIso);

        expect(result.operator).toBe(isNot.value);
        expect(result.value).toEqual({
          exactDate: groupValueIso,
          mode: exactFormatDate.value,
          timeZone: 'Asia/Shanghai',
        });
      }
    );

    it('treats datetime formula group values the same way', () => {
      const field = createField({
        type: FieldType.Formula,
        cellValueType: CellValueType.DateTime,
        options: {
          expression: 'NOW()',
          formatting: {
            date: 'YYYY-MM-DD',
            time: TimeFormatting.None,
            timeZone: 'America/New_York',
          },
        },
      });

      const result = generateFilterItem(field, groupValueIso);

      expect(result.operator).toBe(isNot.value);
      expect(result.value).toEqual({
        exactDate: groupValueIso,
        mode: exactFormatDate.value,
        timeZone: 'America/New_York',
      });
    });
  });
});
