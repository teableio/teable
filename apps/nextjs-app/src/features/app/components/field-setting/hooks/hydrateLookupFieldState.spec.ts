import { CellValueType, FieldType } from '@teable/core';
import { hydrateLookupFieldState } from './hydrateLookupFieldState';

describe('hydrateLookupFieldState', () => {
  it('hydrates stale lookup metadata from an existing selected lookup field', () => {
    const hydrated = hydrateLookupFieldState({
      field: {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: 'tblForeign',
          linkFieldId: 'fldLink',
          lookupFieldId: 'fldLookup',
        },
      },
      lookupField: {
        type: FieldType.AutoNumber,
        cellValueType: CellValueType.Number,
        isMultipleCellValue: false,
        options: {},
      },
      linkField: {
        isMultipleCellValue: false,
      },
    });

    expect(hydrated).toMatchObject({
      type: FieldType.AutoNumber,
      isLookup: true,
      cellValueType: CellValueType.Number,
      isMultipleCellValue: false,
      lookupOptions: {
        foreignTableId: 'tblForeign',
        linkFieldId: 'fldLink',
        lookupFieldId: 'fldLookup',
      },
    });
  });

  it('preserves customized lookup options once the field is already hydrated', () => {
    const hydrated = hydrateLookupFieldState({
      field: {
        type: FieldType.Number,
        isLookup: true,
        cellValueType: CellValueType.Number,
        isMultipleCellValue: false,
        options: {
          formatting: {
            type: 'currency',
            symbol: '$',
          },
        },
      },
      lookupField: {
        type: FieldType.Number,
        cellValueType: CellValueType.Number,
        isMultipleCellValue: false,
        options: {},
      },
      linkField: {
        isMultipleCellValue: false,
      },
    });

    expect(hydrated).toBeUndefined();
  });
});
